import AVFoundation
import AVKit
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
    let floatingCamera = FloatingCameraController()
    private let sessionQueue = DispatchQueue(label: "stepsense.camera.session", qos: .userInitiated)
    private let frameQueue = DispatchQueue(label: "stepsense.camera.frames", qos: .userInitiated)
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let lock = NSLock()
    private var configured = false
    private var active = false
    private var frameRequested = false
    private var frameHandler: (@Sendable (CapturedFrame) -> Void)?
    private var failureHandler: (@Sendable (String) -> Void)?
    private var observers: [NSObjectProtocol] = []

    override init() {
        super.init()
        for name in [AVCaptureSession.wasInterruptedNotification, AVCaptureSession.runtimeErrorNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: session, queue: nil) { [weak self] _ in
                self?.reportFailure("Camera interrupted. Stop and try again when the camera is available.")
            })
        }
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    func start(onFrame: @escaping @Sendable (CapturedFrame) -> Void,
               onFailure: @escaping @Sendable (String) -> Void) async throws -> CameraDiagnostics {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else { throw CameraFailure.permission }
        default: throw CameraFailure.permission
        }
        try Task.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async { [self] in
                do {
                    if !configured { try configure() }
                    let supported = session.isMultitaskingCameraAccessSupported
                    if supported { session.isMultitaskingCameraAccessEnabled = true }
                    lock.lock()
                    active = true
                    frameRequested = false
                    frameHandler = onFrame
                    failureHandler = onFailure
                    lock.unlock()
                    session.startRunning()
                    guard session.isRunning else { throw CameraFailure.configuration }
                    continuation.resume(returning: CameraDiagnostics(multitaskingSupported: supported))
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
        DispatchQueue.main.async { [self] in floatingCamera.stop() }
        sessionQueue.async { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }

    private func clearHandlers() {
        lock.lock()
        active = false
        frameRequested = false
        frameHandler = nil
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
        let isCapturing = active
        lock.unlock()
        guard isCapturing else { return }
        // Display every delivered frame; inference remains independently rate limited.
        // Enqueue directly on the serial capture queue to avoid retaining a backlog on main.
        if floatingCamera.layer.status == .failed { floatingCamera.layer.flush() }
        if floatingCamera.layer.isReadyForMoreMediaData { floatingCamera.layer.enqueue(sampleBuffer) }
        lock.lock()
        guard active, frameRequested, let handler = frameHandler else { lock.unlock(); return }
        frameRequested = false
        lock.unlock()

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

/// Native live-video PiP. Camera eligibility is checked separately from PiP availability.
/// No VoIP mode or video-call impersonation is used to obtain camera access.
final class FloatingCameraController: NSObject, AVPictureInPictureSampleBufferPlaybackDelegate, AVPictureInPictureControllerDelegate {
    let layer = AVSampleBufferDisplayLayer()
    private var controller: AVPictureInPictureController?
    var onEnd: (() -> Void)?
    var onFailure: ((String) -> Void)?
    var isActive: Bool { controller?.isPictureInPictureActive == true }

    func prepare() {
        guard controller == nil, AVPictureInPictureController.isPictureInPictureSupported() else { return }
        layer.videoGravity = .resizeAspect
        var timebase: CMTimebase?
        CMTimebaseCreateWithSourceClock(allocator: kCFAllocatorDefault, sourceClock: CMClockGetHostTimeClock(), timebaseOut: &timebase)
        if let timebase {
            CMTimebaseSetTime(timebase, time: CMClockGetTime(CMClockGetHostTimeClock()))
            CMTimebaseSetRate(timebase, rate: 1)
            layer.controlTimebase = timebase
        }
        controller = AVPictureInPictureController(contentSource: .init(sampleBufferDisplayLayer: layer, playbackDelegate: self))
        controller?.delegate = self
        controller?.requiresLinearPlayback = true
        // Explicit user action is required; leaving the app alone does not start PiP.
        controller?.canStartPictureInPictureAutomaticallyFromInline = false
    }

    func start() throws {
        prepare()
        guard let controller, controller.isPictureInPicturePossible else {
            throw NSError(domain: "StepSense.PiP", code: 1, userInfo: [NSLocalizedDescriptionKey: "Floating camera is not ready on this device. Keep StepSense open."])
        }
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try AVAudioSession.sharedInstance().setActive(true)
        controller.startPictureInPicture()
    }

    func stop() {
        controller?.stopPictureInPicture()
        layer.flushAndRemoveImage()
    }
    func pictureInPictureController(_ controller: AVPictureInPictureController, setPlaying playing: Bool) {
        if !playing { onEnd?() }
    }
    func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange {
        CMTimeRange(start: .zero, duration: .positiveInfinity)
    }
    func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool { false }
    func pictureInPictureController(_ controller: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}
    func pictureInPictureController(_ controller: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completionHandler: @escaping () -> Void) { completionHandler() }
    func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) { onEnd?() }
    func pictureInPictureController(_ controller: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) { onFailure?(error.localizedDescription) }
    func pictureInPictureController(_ controller: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) { completionHandler(true) }
}

struct FloatingCameraPreview: UIViewRepresentable {
    let camera: FloatingCameraController
    func makeUIView(context: Context) -> UIView {
        let view = FloatingCameraUIView()
        view.displayLayer = camera.layer
        view.layer.addSublayer(camera.layer)
        camera.prepare()
        return view
    }
    func updateUIView(_ view: UIView, context: Context) { view.setNeedsLayout() }
}
private final class FloatingCameraUIView: UIView {
    var displayLayer: AVSampleBufferDisplayLayer?
    override func layoutSubviews() { super.layoutSubviews(); displayLayer?.frame = bounds }
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
