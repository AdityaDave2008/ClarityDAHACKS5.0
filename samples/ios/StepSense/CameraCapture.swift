import AVFoundation
import CoreImage
import Foundation
import SwiftUI
import UIKit

struct CapturedFrame: @unchecked Sendable {
    let jpeg: Data
    let size: CGSize
    let capturedAt: TimeInterval
}

struct CameraDiagnostics: Sendable {
    let multitaskingSupported: Bool
    let multitaskingEnabled: Bool
}

enum CameraFailure: LocalizedError {
    case permission, unavailable, configuration, encoding
    var errorDescription: String? {
        switch self {
        case .permission: return "Camera access is off. Allow it in Settings → StepSense to start scanning."
        case .unavailable: return "A rear camera is unavailable. Use a physical iPhone to try live scanning."
        case .configuration: return "The camera could not start. Close other camera apps and try again."
        case .encoding: return "This camera frame could not be encoded. Stop and try again."
        }
    }
}

/// Capture runs on dedicated queues. The lock protects the small request/handler state only.
final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "stepsense.camera.session", qos: .userInitiated)
    private let frameQueue = DispatchQueue(label: "stepsense.camera.frames", qos: .userInitiated)
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let lock = NSLock()
    private var configured = false
    private var active = false
    private var frameRequested = false
    private var frameHandler: (@Sendable (CapturedFrame) -> Void)?
    private var previewHandler: (@Sendable (PiPFrame) -> Void)?
    private var failureHandler: (@Sendable (String) -> Void)?
    private var observers: [NSObjectProtocol] = []
    private var interrupted = false
    // Accessed only on frameQueue.
    private var diagnosticFrames = 0
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
        handler?(true, message)
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

    func start(onFrame: @escaping @Sendable (CapturedFrame) -> Void,
               onPreview: @escaping @Sendable (PiPFrame) -> Void,
               onInterruption: @escaping @Sendable (Bool, String) -> Void,
               onFailure: @escaping @Sendable (String) -> Void) async throws -> CameraDiagnostics {
        try await requestAuthorization()
        return try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async { [self] in
                do {
                    if !configured { try configure() }
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
                    active = true
                    frameRequested = false
                    interrupted = false
                    frameHandler = onFrame
                    previewHandler = onPreview
                    interruptionHandler = onInterruption
                    failureHandler = onFailure
                    lock.unlock()
                    session.startRunning()
                    guard session.isRunning else { throw CameraFailure.configuration }
                    continuation.resume(returning: CameraDiagnostics(multitaskingSupported: supported,
                                                                     multitaskingEnabled: enabledAccess))
                } catch {
                    clearHandlers()
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

    func stop() {
        clearHandlers()
        sessionQueue.async { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }

    private func clearHandlers() {
        lock.lock()
        active = false
        frameRequested = false
        interrupted = false
        frameHandler = nil
        previewHandler = nil
        interruptionHandler = nil
        failureHandler = nil
        lock.unlock()
    }

    private func configure() throws {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            throw CameraFailure.unavailable
        }
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.setSampleBufferDelegate(self, queue: frameQueue)

        session.beginConfiguration()
        defer { session.commitConfiguration() }
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
        lock.lock()
        guard active else { lock.unlock(); return }
        let preview = previewHandler
        let wanted = frameRequested
        let handler = frameHandler
        if wanted { frameRequested = false }
        lock.unlock()

        // Every frame feeds the Picture in Picture window; only requested frames are uploaded.
        diagnosticFrames += 1
        if diagnosticFrames == 1 || diagnosticFrames % 150 == 0 {
            PiPDiagnostics.log("camera.frames", "captured=\(diagnosticFrames) previewHandler=\(preview != nil)")
        }
        preview?(PiPFrame(sampleBuffer: sampleBuffer))

        guard wanted, let handler else { return }

        let capturedAt = ProcessInfo.processInfo.systemUptime

        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            reportFailure(CameraFailure.encoding.localizedDescription)
            return
        }
        let source = CIImage(cvPixelBuffer: buffer)
        let scale = min(1, 640 / max(source.extent.width, source.extent.height))
        let image = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cgImage = context.createCGImage(image, from: image.extent),
              let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.65),
              jpeg.count <= 1_048_576 else {
            reportFailure(CameraFailure.encoding.localizedDescription)
            return
        }
        handler(CapturedFrame(jpeg: jpeg, size: CGSize(width: cgImage.width, height: cgImage.height), capturedAt: capturedAt))
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
