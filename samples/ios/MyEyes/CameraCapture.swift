import AVFoundation
import CoreImage
import Foundation
import SwiftUI
import UIKit

struct CapturedFrame: @unchecked Sendable {
    let jpeg: Data
    let size: CGSize
    let capturedAt: TimeInterval
    let depth: DepthSnapshot?
    let depthDiagnostic: String
}

struct CameraDiagnostics: Sendable {
    let multitaskingSupported: Bool
    let multitaskingEnabled: Bool
    let depthStatus: String
}

enum CameraFailure: LocalizedError {
    case permission, unavailable, configuration, encoding
    var errorDescription: String? {
        switch self {
        case .permission: return "Camera access is off. Allow it in Settings → Clarity to start scanning."
        case .unavailable: return "A rear camera is unavailable. Use a physical iPhone to try live scanning."
        case .configuration: return "The camera could not start. Close other camera apps and try again."
        case .encoding: return "This camera frame could not be encoded. Stop and try again."
        }
    }
}

/// Capture runs on dedicated queues. The lock protects the small request/handler state only.
final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureDataOutputSynchronizerDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "myeyes.camera.session", qos: .userInitiated)
    private let frameQueue = DispatchQueue(label: "myeyes.camera.frames", qos: .userInitiated)
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let lock = NSLock()
    private var configured = false
    private var configuredLiDAR = false
    private var depthStatus = "Off"
    // Installed/removed while stopped; frameQueue is drained before reconfiguration.
    private var synchronizer: AVCaptureDataOutputSynchronizer?
    private var synchronizedVideo: AVCaptureVideoDataOutput?
    private var synchronizedDepth: AVCaptureDepthDataOutput?
    private var captureToken = UUID()
    private var active = false
    private var frameRequested = false
    private var frameHandler: (@Sendable (CapturedFrame) -> Void)?
    private var previewHandler: (@Sendable (PiPFrame) -> Void)?
    private var depthSampleHandler: (@Sendable (CenterDepthSample) async -> Void)?
    private var failureHandler: (@Sendable (String) -> Void)?
    private var observers: [NSObjectProtocol] = []
    private var interrupted = false
    /// Monotonic time of the most recent delivered frame, used to detect a silent stall.
    private var lastFrameAt: TimeInterval = 0
    private var livenessTimer: DispatchSourceTimer?
    // Accessed only on frameQueue.
    private var diagnosticFrames = 0
    private var depthCounters: [String: Int] = [:]
    private var lastDepthLog: TimeInterval = 0
    private var lastCenterLog: TimeInterval = 0
    private var centerDelivery = CenterDepthDeliveryGate()
    private var syncReason = "waiting for synchronized depth"
    private var previousRGBTime: CMTime?
    // Strong Swift reference retains exactly one SDK sample until the next callback.
    private var previousRGBSampleBuffer: CMSampleBuffer?
    private func clearDepthPairing() {
        previousRGBTime = nil
        previousRGBSampleBuffer = nil
    }
    private var lastSyncMetadataLog: TimeInterval = 0
    private func depthEvent(_ reason: String) {
        depthCounters[reason, default: 0] += 1
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastDepthLog >= 3 {
            lastDepthLog = now
            PiPDiagnostics.log("lidar.counters", depthCounters.keys.sorted().map { "\($0)=\(depthCounters[$0]!)" }.joined(separator: " | "))
        }
    }
    /// Reports recoverable pauses and resumptions separately from fatal failures.
    private var interruptionHandler: (@Sendable (Bool, String) -> Void)?

    override init() {
        super.init()
        // Moving, resizing, or hiding the floating window interrupts capture. Those pauses are
        // routine and recoverable, so they must not be reported as a failed scan.
        observers.append(NotificationCenter.default.addObserver(
            forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil
        ) { [weak self] note in
            self?.handleInterruption(note)
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: nil
        ) { [weak self] _ in
            self?.handleInterruptionEnded()
        })
        // A runtime error is different: capture has actually stopped and must be restarted.
        observers.append(NotificationCenter.default.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil
        ) { [weak self] note in
            if let error = note.userInfo?[AVCaptureSessionErrorKey] as? Error { PiPDiagnostics.error("camera.runtimeError", error) }
            self?.restartAfterRuntimeError()
        })
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    private func handleInterruption(_ note: Notification) {
        let raw = note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
        PiPDiagnostics.log("camera.interrupted", "reason=\(raw ?? -1)")
        let reason = raw.flatMap(AVCaptureSession.InterruptionReason.init(rawValue:))
        let message: String
        switch reason {
        case .videoDeviceNotAvailableWithMultipleForegroundApps:
            message = "Camera paused while another app is using it. It resumes automatically."
        case .videoDeviceNotAvailableInBackground:
            message = "Camera paused in the background. It resumes when the window is visible."
        case .videoDeviceInUseByAnotherClient:
            message = "Another app is using the camera. Scanning resumes when it is free."
        default:
            message = "Camera paused. It resumes automatically."
        }
        lock.lock()
        let shouldReport = active
        if active { interrupted = true }
        let handler = interruptionHandler
        lock.unlock()
        guard shouldReport else { return }
        frameQueue.async { [self] in clearDepthPairing() }
        handler?(true, message)
        // Do not rely on interruptionEnded arriving. After a long stay off screen the system
        // may leave the session stopped without that notification, which froze the feed until
        // the user stopped and started again.
        scheduleRecoveryCheck()
    }

    /// Repeatedly tries to bring capture back for as long as a scan is active.
    ///
    /// Each attempt is cheap and self-cancelling: it stops as soon as capture is running again
    /// or the scan ends, so an arbitrarily long interruption still recovers on its own.
    private func scheduleRecoveryCheck(attempt: Int = 0) {
        lock.lock()
        let stillActive = active
        lock.unlock()
        guard stillActive else { return }
        // Back off from a quarter second up to two seconds, then keep retrying indefinitely.
        let delay = min(2.0, 0.25 * pow(1.5, Double(min(attempt, 6))))
        sessionQueue.asyncAfter(deadline: .now() + delay) { [self] in
            lock.lock()
            let active = self.active
            let wasInterrupted = interrupted
            lock.unlock()
            guard active else { return }
            if session.isRunning, !wasInterrupted {
                return
            }
            if !session.isRunning, !session.isInterrupted {
                PiPDiagnostics.log("camera.recovery.restart attempt=\(attempt)")
                session.startRunning()
            }
            if session.isRunning, !session.isInterrupted {
                lock.lock()
                let shouldReport = self.active && interrupted
                interrupted = false
                let handler = interruptionHandler
                lock.unlock()
                if shouldReport {
                    PiPDiagnostics.log("camera.recovery.resumed attempt=\(attempt)")
                    handler?(false, "Camera resumed.")
                }
                return
            }
            scheduleRecoveryCheck(attempt: attempt + 1)
        }
    }

    /// Watches for a feed that stopped without any interruption notification.
    ///
    /// Staying off screen long enough can leave the session stopped silently, so polling the
    /// session state is the only way to notice and recover. The timer is cheap and runs only
    /// while a scan is active.
    private func startLivenessTimer() {
        livenessTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: sessionQueue)
        timer.schedule(deadline: .now() + 2, repeating: 2)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            lock.lock()
            let active = self.active
            let interrupted = self.interrupted
            let since = ProcessInfo.processInfo.systemUptime - lastFrameAt
            lock.unlock()
            guard active, !interrupted, since > 3 else { return }
            guard !session.isInterrupted else { return }
            PiPDiagnostics.log("camera.liveness.stalled", "since=\(String(format: "%.1f", since))s running=\(session.isRunning)")
            if !session.isRunning {
                session.startRunning()
            }
            if session.isRunning {
                lock.lock()
                lastFrameAt = ProcessInfo.processInfo.systemUptime
                let handler = interruptionHandler
                lock.unlock()
                handler?(false, "Camera resumed.")
            }
        }
        timer.resume()
        livenessTimer = timer
    }

    private func handleInterruptionEnded() {
        PiPDiagnostics.log("camera.interruptionEnded")
        lock.lock()
        let shouldReport = active && interrupted
        interrupted = false
        let handler = interruptionHandler
        lock.unlock()
        guard shouldReport else { return }
        // The system restarts capture itself after an interruption ends; make sure it is running.
        sessionQueue.async { [self] in
            lock.lock()
            let stillActive = active
            lock.unlock()
            guard stillActive, !session.isRunning else { return }
            session.startRunning()
        }
        handler?(false, "Camera resumed.")
    }

    /// Runtime errors stop capture outright, so retry a few times before giving up.
    private func restartAfterRuntimeError() {
        frameQueue.async { [self] in clearDepthPairing() }
        lock.lock()
        let stillActive = active
        lock.unlock()
        guard stillActive else { return }
        sessionQueue.asyncAfter(deadline: .now() + 0.4) { [self] in
            lock.lock()
            let active = self.active
            let handler = interruptionHandler
            lock.unlock()
            guard active else { return }
            if !session.isRunning { session.startRunning() }
            if session.isRunning {
                handler?(false, "Camera resumed.")
            } else {
                reportFailure("The camera stopped and could not restart. Stop and start scanning again.")
            }
        }
    }

    /// May be requested before connecting to the backend. Does not start capture.
    func requestAuthorization() async throws {
        try Task.checkCancellation()
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else { throw CameraFailure.permission }
        default: throw CameraFailure.permission
        }
        try Task.checkCancellation()
    }

    func start(lidarEnabled: Bool = false, onFrame: @escaping @Sendable (CapturedFrame) -> Void,
               onPreview: @escaping @Sendable (PiPFrame) -> Void,
               onDepthSample: @escaping @Sendable (CenterDepthSample) async -> Void = { _ in },
               onInterruption: @escaping @Sendable (Bool, String) -> Void,
               onFailure: @escaping @Sendable (String) -> Void) async throws -> CameraDiagnostics {
        let token = UUID()
        lock.withLock { captureToken = token }
        try await requestAuthorization()
        return try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async { [self] in
                do {
                    guard lock.withLock({ captureToken == token }) else { throw CancellationError() }
                    // An RGB fallback records the requested mode, not successful depth setup.
                    // Retry on the next explicit start rather than caching a transient failure forever.
                    if !configured || configuredLiDAR != lidarEnabled || (lidarEnabled && synchronizedDepth == nil) {
                        try configure(lidarEnabled: lidarEnabled)
                    }
                    // Video-call Picture in Picture needs camera frames while another app is
                    // foreground. Apple gates that behind this capture-session switch, which is
                    // only settable on supported hardware.
                    let supported = session.isMultitaskingCameraAccessSupported
                    if supported, !session.isMultitaskingCameraAccessEnabled {
                        session.beginConfiguration()
                        session.isMultitaskingCameraAccessEnabled = true
                        session.commitConfiguration()
                    }
                    let enabledAccess = session.isMultitaskingCameraAccessEnabled
                    lock.lock()
                    guard captureToken == token else { lock.unlock(); throw CancellationError() }
                    active = true
                    frameRequested = false
                    interrupted = false
                    lastFrameAt = ProcessInfo.processInfo.systemUptime
                    frameHandler = onFrame
                    previewHandler = onPreview
                    depthSampleHandler = onDepthSample
                    interruptionHandler = onInterruption
                    failureHandler = onFailure
                    lock.unlock()
                    session.startRunning()
                    guard session.isRunning else { throw CameraFailure.configuration }
                    startLivenessTimer()
                    continuation.resume(returning: CameraDiagnostics(multitaskingSupported: supported,
                                                                     multitaskingEnabled: enabledAccess, depthStatus: depthStatus))
                } catch {
                    clearHandlers(ifToken: token)
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func requestFrame() {
        lock.lock()
        if active { frameRequested = true }
        lock.unlock()
    }

    func stop(onStopped: @escaping @Sendable () -> Void = {}) {
        clearHandlers()
        sessionQueue.async { [self] in
            if session.isRunning { session.stopRunning() }
            frameQueue.sync { clearDepthPairing(); centerDelivery.reset() }
            onStopped()
        }
    }

    private func clearHandlers(ifToken token: UUID? = nil) {
        lock.lock()
        if let token, captureToken != token { lock.unlock(); return }
        captureToken = UUID()
        active = false
        frameRequested = false
        interrupted = false
        frameHandler = nil
        previewHandler = nil
        depthSampleHandler = nil
        interruptionHandler = nil
        failureHandler = nil
        lock.unlock()
        livenessTimer?.cancel()
        livenessTimer = nil
    }

    private func configure(lidarEnabled: Bool) throws {
        if session.isRunning { session.stopRunning() }
        frameQueue.sync {
            synchronizer?.setDelegate(nil, queue: nil)
            synchronizer = nil
            synchronizedVideo = nil
            synchronizedDepth = nil
            depthCounters = [:]
            lastDepthLog = 0
            syncReason = "waiting for synchronized depth"
            clearDepthPairing()
            centerDelivery.reset()
            lastSyncMetadataLog = 0
        }
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        for output in session.outputs { session.removeOutput(output) }
        for input in session.inputs { session.removeInput(input) }
        configured = false
        configuredLiDAR = lidarEnabled
        depthStatus = lidarEnabled ? "Unavailable · ordinary detection continues" : "Off"
        if lidarEnabled {
            do {
                let (video, depth) = try LiDARCapture.configure(in: session)
                let sync = AVCaptureDataOutputSynchronizer(dataOutputs: [video, depth])
                frameQueue.sync {
                    synchronizedVideo = video
                    synchronizedDepth = depth
                    synchronizer = sync
                    sync.setDelegate(self, queue: frameQueue)
                }
                depthStatus = "LiDAR configured · estimates require valid depth"
                configured = true
                return
            } catch {
                let reason = (error as? LiDARCapture.ConfigurationFailure)?.stage ?? "configuration error \((error as NSError).code)"
                depthStatus = "RGB fallback · " + reason
                PiPDiagnostics.log("lidar.fallback", "reason=\(reason)")
                // A missing LiDAR camera/format/connection never removes ordinary detection.
                for output in session.outputs { session.removeOutput(output) }
                for input in session.inputs { session.removeInput(input) }
            }
        }
        try configureWideCamera()
    }

    private func configureWideCamera() throws {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            throw CameraFailure.unavailable
        }
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.setSampleBufferDelegate(self, queue: frameQueue)

        session.sessionPreset = session.canSetSessionPreset(.vga640x480) ? .vga640x480 : .medium
        guard session.canAddInput(input) else { throw CameraFailure.configuration }
        session.addInput(input)
        guard session.canAddOutput(output) else {
            session.removeInput(input)
            throw CameraFailure.configuration
        }
        session.addOutput(output)
        if let connection = output.connection(with: .video) {
            // The sample is portrait-only; rotate both buffers and preview the same way.
            if connection.isVideoOrientationSupported { connection.videoOrientation = .portrait }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = false
            }
        }
        configured = true
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        process(sampleBuffer, depthData: nil, synchronizedTime: nil)
    }

    func dataOutputSynchronizer(_ synchronizer: AVCaptureDataOutputSynchronizer,
                                didOutput collection: AVCaptureSynchronizedDataCollection) {
        guard lock.withLock({ active && !interrupted }) else { clearDepthPairing(); return }
        guard synchronizer === self.synchronizer, let video = synchronizedVideo,
              let rgb = collection.synchronizedData(for: video) as? AVCaptureSynchronizedSampleBufferData,
              !rgb.sampleBufferWasDropped else { clearDepthPairing(); depthEvent("RGB missing/dropped"); return }
        defer {
            previousRGBTime = rgb.timestamp
            previousRGBSampleBuffer = rgb.sampleBuffer
        }
        var depthData: AVDepthData?
        var analysisSampleBuffer: CMSampleBuffer?
        var analysisTime = rgb.timestamp
        syncReason = "depth missing/dropped"
        if let output = synchronizedDepth,
           let depth = collection.synchronizedData(for: output) as? AVCaptureSynchronizedDepthData,
           !depth.depthDataWasDropped {
            let difference = CMTimeGetSeconds(CMTimeSubtract(depth.timestamp, rgb.timestamp))
            let match = DepthFrameMatch.select(depthTime: CMTimeGetSeconds(depth.timestamp),
                                               currentRGBTime: CMTimeGetSeconds(rgb.timestamp),
                                               previousRGBTime: previousRGBTime.map(CMTimeGetSeconds))
            switch match {
            case .current:
                depthData = depth.depthData
                analysisTime = CMTimeMinimum(rgb.timestamp, depth.timestamp)
                syncReason = "matched current RGB"
            case .previous where previousRGBSampleBuffer != nil:
                depthData = depth.depthData
                analysisSampleBuffer = previousRGBSampleBuffer
                analysisTime = CMTimeMinimum(previousRGBTime!, depth.timestamp)
                syncReason = "matched previous RGB"
            default:
                syncReason = "timestamp mismatch"
            }
            let metadataNow = ProcessInfo.processInfo.systemUptime
            if metadataNow - lastSyncMetadataLog >= 3 {
                lastSyncMetadataLog = metadataNow
                let pts = CMSampleBufferGetPresentationTimeStamp(rgb.sampleBuffer)
                let ptsDelta = CMTimeGetSeconds(CMTimeSubtract(depth.timestamp, pts)) * 1000
                let previousDelta = previousRGBTime.map { CMTimeGetSeconds(CMTimeSubtract(depth.timestamp, $0)) * 1000 } ?? .nan
                PiPDiagnostics.log("lidar.syncMetadata", "deltaMs=\(difference * 1000) depthToRGBptsMs=\(ptsDelta) depthToPreviousRGBms=\(previousDelta) rgbTime=\(CMTimeGetSeconds(rgb.timestamp)) pts=\(CMTimeGetSeconds(pts)) depthTime=\(CMTimeGetSeconds(depth.timestamp)) accuracy=\(depth.depthData.depthDataAccuracy.rawValue) quality=\(depth.depthData.depthDataQuality.rawValue) filtered=\(depth.depthData.isDepthDataFiltered) calibration=\(depth.depthData.cameraCalibrationData != nil)")
            }
        }
        depthEvent(syncReason)
        // Even a dropped/invalid depth frame still feeds ordinary detection and PiP.
        process(rgb.sampleBuffer, depthData: depthData, synchronizedTime: analysisTime,
                analysisSampleBuffer: analysisSampleBuffer)
    }

    private func process(_ sampleBuffer: CMSampleBuffer, depthData: AVDepthData?, synchronizedTime: CMTime?,
                         analysisSampleBuffer: CMSampleBuffer? = nil) {
        lock.lock()
        guard active, !interrupted else { lock.unlock(); return }
        let preview = previewHandler
        let sensorHandler = depthSampleHandler
        let token = captureToken
        let wanted = frameRequested
        let handler = frameHandler
        if wanted { frameRequested = false }
        lock.unlock()

        // Every frame feeds Picture in Picture; only requested frames enter local inference.
        diagnosticFrames += 1
        lock.lock()
        lastFrameAt = ProcessInfo.processInfo.systemUptime
        lock.unlock()
        if diagnosticFrames == 1 || diagnosticFrames % 150 == 0 {
            PiPDiagnostics.log("camera.frames", "captured=\(diagnosticFrames) previewHandler=\(preview != nil)")
        }
        preview?(PiPFrame(sampleBuffer: sampleBuffer))

        let now = ProcessInfo.processInfo.systemUptime
        let sensorReservation = sensorHandler != nil && configuredLiDAR ? centerDelivery.reserve(now: now) : nil
        guard (wanted && handler != nil) || sensorReservation != nil else { return }
        var sensorDispatched = false
        defer {
            if let sensorReservation, !sensorDispatched { centerDelivery.complete(sensorReservation) }
        }
        var depthCapturedAt: TimeInterval?
        if let timestamp = synchronizedTime, let clock = session.synchronizationClock {
            let hostTime = CMSyncConvertTime(timestamp, from: clock, to: CMClockGetHostTimeClock())
            let hostNow = CMClockGetTime(CMClockGetHostTimeClock())
            let age = CMTimeGetSeconds(CMTimeSubtract(hostNow, hostTime))
            // Translate the host-clock age to systemUptime rather than assuming equal epochs.
            if age.isFinite, age >= 0, age < DepthSnapshot.maximumAge { depthCapturedAt = now - age }
        }
        let capturedAt = depthCapturedAt ?? now

        // PiP above always receives current RGB immediately. Only inference uses the
        // retained RGB whose capture timestamp actually matches this depth map.
        guard let buffer = CMSampleBufferGetImageBuffer(analysisSampleBuffer ?? sampleBuffer) else {
            reportFailure(CameraFailure.encoding.localizedDescription)
            return
        }
        let depth: DepthSnapshot?
        var reason = depthData == nil ? syncReason : "capture clock missing/stale"
        if let depthData, let depthCapturedAt {
            depth = LiDARCapture.snapshot(depthData, rgb: buffer, capturedAt: depthCapturedAt) { reason = $0 }
            if depth != nil { reason = "snapshot accepted" }
        } else {
            depth = nil
        }
        if configuredLiDAR, synchronizedDepth != nil { depthEvent(reason) }
        let diagnostic = synchronizedDepth == nil ? depthStatus : "LiDAR · " + reason
        if let sensorReservation, let sensorHandler {
            let sample = CenterDepthSample(snapshot: depth, now: now, diagnostic: diagnostic)
            sensorDispatched = true
            Task { [weak self] in
                guard let self else { return }
                if self.lock.withLock({ self.active && !self.interrupted && self.captureToken == token }) {
                    await sensorHandler(sample)
                }
                self.frameQueue.async { [weak self] in self?.centerDelivery.complete(sensorReservation) }
            }
        }
        if now - lastCenterLog >= 3, synchronizedDepth != nil {
            lastCenterLog = now
            let center = depth?.centerSurface(now: now)
            if let depth { PiPDiagnostics.log("lidar.distribution", depth.distributionSummary) }
            PiPDiagnostics.log("lidar.center", "meters=\(center.map { String(format: "%.3f", $0) } ?? "unavailable") ageMs=\(depthCapturedAt.map { Int((now - $0) * 1000) } ?? -1) snapshot=\(reason)")
        }
        // Sensor observations never encode JPEG or wait for object inference.
        guard wanted, let handler else { return }
        let source = CIImage(cvPixelBuffer: buffer)
        let scale = min(1, 640 / max(source.extent.width, source.extent.height))
        let image = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cgImage = context.createCGImage(image, from: image.extent),
              let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.65),
              jpeg.count <= 1_048_576 else {
            reportFailure(CameraFailure.encoding.localizedDescription)
            return
        }
        handler(CapturedFrame(jpeg: jpeg, size: CGSize(width: cgImage.width, height: cgImage.height), capturedAt: capturedAt, depth: depth, depthDiagnostic: diagnostic))
    }

    private func reportFailure(_ message: String) {
        lock.lock()
        let handler = active ? failureHandler : nil
        lock.unlock()
        handler?(message)
    }
}

private final class CameraPreviewUIView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> UIView {
        let view = CameraPreviewUIView()
        view.backgroundColor = .black
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspect
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        guard let view = uiView as? CameraPreviewUIView else { return }
        if let connection = view.previewLayer.connection, connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = false
            }
        }
    }
}
