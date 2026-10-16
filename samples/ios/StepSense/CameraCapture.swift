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
               onPreview: @escaping @Sendable (PiPFrame) -> Void,
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
                    frameHandler = onFrame
                    previewHandler = onPreview
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
        frameHandler = nil
        previewHandler = nil
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
