import AVFoundation
import AVKit
import SwiftUI
import UIKit

/// Video-call Picture in Picture.
///
/// This is the mechanism FaceTime-style apps use to stay visible over other apps:
/// `AVPictureInPictureController` with an `activeVideoCallSourceView` content source and an
/// `AVPictureInPictureVideoCallViewController`. Unlike `AVPlayer` Picture in Picture, the
/// content view controller renders real UIKit views, so camera frames and detection overlays
/// are both drawn by this app.
///
/// Three separate conditions must hold for the floating window to keep showing live camera:
/// the `voip` background mode (`Info.plist`), an active video-call Picture in Picture
/// controller, and `AVCaptureSession.isMultitaskingCameraAccessEnabled` on supported hardware.
/// When multitasking camera access is unavailable, Picture in Picture still presents, and the
/// window shows the last frame with a clearly marked paused state rather than implying a live feed.

/// Camera frames cross queues before reaching the main actor for display.
struct PiPFrame: @unchecked Sendable {
    let sampleBuffer: CMSampleBuffer
}

/// Snapshot of what the floating window should draw.
struct PiPOverlayState: Equatable {
    var zone: [NormalizedPoint] = []
    var detections: [Detection] = []
    var imageSize: CGSize = CGSize(width: 480, height: 640)
    var title: String = "StepSense"
    var alerting: Bool = false
    var live: Bool = true
}

// MARK: - Rendering view

/// Draws camera frames plus the zone, detection boxes, and alert banner.
final class PiPContentView: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
    var displayLayer: AVSampleBufferDisplayLayer { layer as! AVSampleBufferDisplayLayer }

    private let overlayLayer = CAShapeLayer()
    private let zoneLayer = CAShapeLayer()
    private let bannerLayer = CALayer()
    private let bannerText = CATextLayer()
    private var state = PiPOverlayState()
    private var needsFlush = false
    private var notReady = 0
    private var shown = 0
    private var received = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        displayLayer.videoGravity = .resizeAspect

        zoneLayer.fillColor = UIColor(red: 0.29, green: 0.91, blue: 0.79, alpha: 0.12).cgColor
        zoneLayer.strokeColor = UIColor(red: 0.29, green: 0.91, blue: 0.79, alpha: 0.85).cgColor
        zoneLayer.lineWidth = 1.5
        zoneLayer.lineDashPattern = [5, 4]
        layer.addSublayer(zoneLayer)

        overlayLayer.fillColor = UIColor.clear.cgColor
        layer.addSublayer(overlayLayer)

        bannerLayer.backgroundColor = UIColor.black.withAlphaComponent(0.62).cgColor
        bannerLayer.cornerRadius = 5
        bannerText.alignmentMode = .center
        bannerText.truncationMode = .end
        bannerText.fontSize = 11
        bannerText.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        bannerLayer.addSublayer(bannerText)
        layer.addSublayer(bannerLayer)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        PiPDiagnostics.log("display.window", "attached=\(newWindow != nil) bounds=\(bounds)")
        // Moving between the app and the floating window invalidates the decoder's state.
        needsFlush = true
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // Becoming visible again must rebuild the decoder before the next frame arrives.
        if window != nil { needsFlush = true }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        bannerText.contentsScale = UIScreen.main.scale
        redraw()
    }

    /// Displays a camera frame.
    ///
    /// Two things otherwise freeze the window. Without the display-immediately attachment the
    /// layer honors each buffer's presentation timestamp against a timebase that is never
    /// running, so frames queue without being shown. Separately, the layer's decoder fails when
    /// the window is stashed off screen or the app is backgrounded, and it refuses every later
    /// frame until it is flushed.
    func enqueue(_ sampleBuffer: CMSampleBuffer) {
        received += 1
        if received == 1 || received % 150 == 0 {
            PiPDiagnostics.log("display.frames", "received=\(received) enqueued=\(shown) ready=\(displayLayer.isReadyForMoreMediaData) status=\(displayLayer.status.rawValue) window=\(window != nil) bounds=\(bounds)")
        }
        if displayLayer.status == .failed || needsFlush {
            PiPDiagnostics.log("display.flush", "status=\(displayLayer.status.rawValue) requested=\(needsFlush)")
            if let error = displayLayer.error { PiPDiagnostics.error("display.error", error) }
            displayLayer.flush()
            needsFlush = false
        }
        guard displayLayer.isReadyForMoreMediaData else {
            // A layer that stays unready is wedged, which a flush clears. Without this the feed
            // never recovers after a long spell off screen.
            notReady += 1
            if notReady >= 10 {
                PiPDiagnostics.log("display.unwedge", "notReady=\(notReady) status=\(displayLayer.status.rawValue)")
                displayLayer.flush()
                notReady = 0
            }
            return
        }
        notReady = 0
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: true),
           CFArrayGetCount(attachments) > 0 {
            let raw = CFArrayGetValueAtIndex(attachments, 0)
            let dictionary = unsafeBitCast(raw, to: CFMutableDictionary.self)
            CFDictionarySetValue(dictionary,
                                 Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                                 Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        displayLayer.enqueue(sampleBuffer)
        shown += 1
        // A live counter distinguishes "frames stopped arriving" from "frames stopped drawing".
        if shown % 10 == 0 { redraw() }
    }

    /// Requests a flush before the next frame, after a decode failure or a visibility change.
    func markNeedsFlush() {
        needsFlush = true
    }

    func apply(_ next: PiPOverlayState) {
        guard next != state else { return }
        state = next
        redraw()
    }

    /// Camera frames use aspect-fit, so overlays are placed inside the displayed image rectangle.
    private func videoRect() -> CGRect {
        let size = bounds.size
        guard state.imageSize.width > 0, state.imageSize.height > 0, size.width > 0, size.height > 0 else { return bounds }
        let scale = min(size.width / state.imageSize.width, size.height / state.imageSize.height)
        let fitted = CGSize(width: state.imageSize.width * scale, height: state.imageSize.height * scale)
        return CGRect(x: (size.width - fitted.width) / 2, y: (size.height - fitted.height) / 2,
                      width: fitted.width, height: fitted.height)
    }

    private func redraw() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }

        let rect = videoRect()

        let zonePath = UIBezierPath()
        if let first = state.zone.first {
            zonePath.move(to: CGPoint(x: rect.minX + CGFloat(first.x) * rect.width,
                                      y: rect.minY + CGFloat(first.y) * rect.height))
            for vertex in state.zone.dropFirst() {
                zonePath.addLine(to: CGPoint(x: rect.minX + CGFloat(vertex.x) * rect.width,
                                             y: rect.minY + CGFloat(vertex.y) * rect.height))
            }
            zonePath.close()
        }
        zoneLayer.path = zonePath.cgPath

        overlayLayer.sublayers?.forEach { $0.removeFromSuperlayer() }
        for detection in state.detections {
            let box = CGRect(x: rect.minX + CGFloat(detection.bbox.x) * rect.width,
                             y: rect.minY + CGFloat(detection.bbox.y) * rect.height,
                             width: CGFloat(detection.bbox.width) * rect.width,
                             height: CGFloat(detection.bbox.height) * rect.height)
            let shape = CAShapeLayer()
            shape.path = UIBezierPath(roundedRect: box, cornerRadius: 4).cgPath
            shape.fillColor = UIColor.clear.cgColor
            shape.lineWidth = 2
            shape.strokeColor = detection.inZone
                ? UIColor.systemYellow.cgColor
                : UIColor(red: 0.29, green: 0.91, blue: 0.79, alpha: 0.9).cgColor
            overlayLayer.addSublayer(shape)
            if let depthLabel = detection.depthLabel {
                let label = CATextLayer()
                label.string = depthLabel
                label.fontSize = 9
                label.contentsScale = window?.screen.scale ?? 2
                label.foregroundColor = UIColor.black.cgColor
                label.backgroundColor = shape.strokeColor
                label.alignmentMode = .center
                let width = min(rect.width, 130)
                label.frame = CGRect(x: min(max(box.midX - width / 2, rect.minX), rect.maxX - width),
                                     y: max(rect.minY, box.minY - 14), width: width, height: 13)
                overlayLayer.addSublayer(label)
            }
        }

        let banner = CGRect(x: 4, y: bounds.height - 22, width: max(0, bounds.width - 8), height: 18)
        bannerLayer.frame = banner
        bannerText.frame = CGRect(x: 4, y: 3, width: max(0, banner.width - 8), height: 13)
        let accent: UIColor = state.alerting
            ? .systemYellow
            : (state.live ? UIColor(red: 0.29, green: 0.91, blue: 0.79, alpha: 1) : .systemOrange)
        bannerText.foregroundColor = accent.cgColor
        bannerText.string = state.live ? "\(state.title)  ·  \(shown)" : "Paused · open StepSense"
        bannerLayer.borderWidth = state.alerting ? 1 : 0
        bannerLayer.borderColor = accent.cgColor
    }
}

/// The view controller presented inside the floating window.
final class PiPCallViewController: AVPictureInPictureVideoCallViewController {
    let content = PiPContentView()

    override func viewDidLoad() {
        super.viewDidLoad()
        // Portrait camera frames: match the scanner's 3:4 aspect ratio.
        preferredContentSize = CGSize(width: 3, height: 4)
        view.backgroundColor = .black
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: view.topAnchor),
            content.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }
}

// MARK: - Controller

@MainActor
final class PictureInPictureController: NSObject, ObservableObject, AVPictureInPictureControllerDelegate {
    /// Whether this device can present Picture in Picture at all.
    let isSupported = AVPictureInPictureController.isPictureInPictureSupported()

    @Published private(set) var isActive = false
    @Published private(set) var isPossible = false
    /// Last Picture in Picture failure, shown in the app rather than silently dropped.
    @Published private(set) var failureMessage: String?
    /// Why the floating window cannot be opened right now, or nil when it can.
    var unavailableReason: String? {
        if !isSupported { return "This device does not support Picture in Picture." }
        if controller == nil { return "The floating window is still being prepared." }
        return nil
    }

    private let callViewController = PiPCallViewController()
    private var controller: AVPictureInPictureController?
    private weak var sourceView: UIView?
    private var state = PiPOverlayState()
    private var possibleObservation: NSKeyValueObservation?
    private var startAttempt: Task<Void, Never>?
    /// Set by the scan model. The controller is still built ahead of time so the system can
    /// report readiness before a scan begins.
    private var enabled = false

    private func diagnose(_ event: String) {
        PiPDiagnostics.log(event, "supported=\(isSupported) enabled=\(enabled) possible=\(controller?.isPictureInPicturePossible ?? false) active=\(controller?.isPictureInPictureActive ?? false) suspended=\(controller?.isPictureInPictureSuspended ?? false) sourceWindow=\(sourceView?.window != nil) sourceBounds=\(sourceView?.bounds ?? .zero) sourceHidden=\(sourceView?.isHidden ?? true) sourceAlpha=\(sourceView?.alpha ?? 0) appState=\(UIApplication.shared.applicationState.rawValue) audioCategory=\(AVAudioSession.sharedInstance().category.rawValue) audioMode=\(AVAudioSession.sharedInstance().mode.rawValue)")
    }

    /// Connects the on-screen anchor that the floating window animates from.
    func attach(sourceView view: UIView) {
        guard isSupported, sourceView !== view else { return }
        sourceView = view
        diagnose("pip.attach")
        rebuildController()
    }

    /// Turns automatic entry on or off. The controller itself stays built.
    func setEnabled(_ newValue: Bool) {
        enabled = newValue
        diagnose("pip.enabled")
        controller?.canStartPictureInPictureAutomaticallyFromInline = newValue
        if !newValue { stop() }
    }

    /// Builds the controller as soon as an anchor exists.
    ///
    /// `isPictureInPicturePossible` only becomes true after the system inspects a real content
    /// source, so deferring this until a scan starts left the control permanently unavailable.
    private func rebuildController() {
        guard isSupported, let sourceView else {
            possibleObservation = nil
            controller = nil
            isPossible = false
            return
        }
        let source = AVPictureInPictureController.ContentSource(
            activeVideoCallSourceView: sourceView,
            contentViewController: callViewController
        )
        let created = AVPictureInPictureController(contentSource: source)
        created.delegate = self
        // Matches the behavior people expect from video-call apps: swiping away keeps the window.
        created.canStartPictureInPictureAutomaticallyFromInline = enabled
        controller = created
        diagnose("pip.built")
        possibleObservation = created.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] controller, _ in
            let possible = controller.isPictureInPicturePossible
            Task { @MainActor [weak self] in
                self?.isPossible = possible
                self?.diagnose("pip.possible.\(possible)")
            }
        }
    }

    /// Starts the floating window, waiting briefly for a freshly built controller to become ready.
    func start() {
        diagnose("pip.start.request")
        failureMessage = nil
        guard isSupported else {
            failureMessage = "This device does not support Picture in Picture."
            return
        }
        guard let controller else {
            failureMessage = "The floating window is still being prepared. Try again in a moment."
            return
        }
        guard !controller.isPictureInPictureActive else { return }
        if controller.isPictureInPicturePossible {
            diagnose("pip.start.invoke")
            controller.startPictureInPicture()
            return
        }
        // A controller built moments ago reports possible only after its source view lays out.
        startAttempt?.cancel()
        startAttempt = Task { [weak self] in
            for _ in 0..<20 {
                try? await Task.sleep(nanoseconds: 100_000_000)
                guard let self, !Task.isCancelled, let controller = self.controller else { return }
                if controller.isPictureInPictureActive { return }
                if controller.isPictureInPicturePossible {
                    self.diagnose("pip.start.invokeAfterWait")
                    controller.startPictureInPicture()
                    return
                }
            }
            guard let self, !Task.isCancelled else { return }
            self.diagnose("pip.start.timeout")
            self.failureMessage = "The floating window is not ready yet. Keep this screen visible and try again."
        }
    }

    func stop() {
        diagnose("pip.stop.request")
        startAttempt?.cancel()
        startAttempt = nil
        guard let controller, controller.isPictureInPictureActive else { return }
        controller.stopPictureInPicture()
    }

    func enqueue(_ frame: PiPFrame) {
        callViewController.content.enqueue(frame.sampleBuffer)
    }

    /// Forces the next frame to rebuild the display layer's decoder.
    func resetDisplay() {
        callViewController.content.markNeedsFlush()
    }

    func update(_ transform: (inout PiPOverlayState) -> Void) {
        transform(&state)
        callViewController.content.apply(state)
    }

    // MARK: AVPictureInPictureControllerDelegate
    //
    // AVKit declares these as nonisolated, so each one hops to the main actor before touching
    // published state.

    nonisolated func pictureInPictureControllerWillStartPictureInPicture(_ controller: AVPictureInPictureController) {
        PiPDiagnostics.log("pip.delegate.willStart")
    }

    nonisolated func pictureInPictureControllerWillStopPictureInPicture(_ controller: AVPictureInPictureController) {
        PiPDiagnostics.log("pip.delegate.willStop")
    }

    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        PiPDiagnostics.log("pip.delegate.didStart")
        Task { @MainActor [weak self] in
            guard let self else { return }
            isActive = true
            // The content view just moved to the floating window's own window.
            resetDisplay()
        }
    }

    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        PiPDiagnostics.log("pip.delegate.didStop")
        Task { @MainActor [weak self] in
            guard let self else { return }
            isActive = false
            // Respect dismissal. Only a new scan or the explicit Open button may re-arm entry.
            setEnabled(false)
            resetDisplay()
        }
    }

    nonisolated func pictureInPictureController(_ controller: AVPictureInPictureController,
                                                failedToStartPictureInPictureWithError error: Error) {
        PiPDiagnostics.error("pip.delegate.failed", error)
        let description = error.localizedDescription
        Task { @MainActor [weak self] in
            guard let self else { return }
            isActive = false
            failureMessage = "Picture in Picture could not start. \(description)"
        }
    }
}

// MARK: - SwiftUI anchor

/// Anchor view that Picture in Picture animates from and returns to.
///
/// The system inspects this view, so it must be a real, laid-out view in the hierarchy rather
/// than a zero-sized placeholder.
struct PiPSourceAnchor: UIViewRepresentable {
    let controller: PictureInPictureController

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        let controller = self.controller
        // Attach after layout so the anchor has a real frame when the system inspects it.
        DispatchQueue.main.async { controller.attach(sourceView: uiView) }
    }
}
