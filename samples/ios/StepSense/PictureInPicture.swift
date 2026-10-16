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

    override func layoutSubviews() {
        super.layoutSubviews()
        bannerText.contentsScale = UIScreen.main.scale
        redraw()
    }

    func enqueue(_ sampleBuffer: CMSampleBuffer) {
        if displayLayer.status == .failed { displayLayer.flush() }
        guard displayLayer.isReadyForMoreMediaData else { return }
        displayLayer.enqueue(sampleBuffer)
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
        }

        let banner = CGRect(x: 4, y: bounds.height - 22, width: max(0, bounds.width - 8), height: 18)
        bannerLayer.frame = banner
        bannerText.frame = CGRect(x: 4, y: 3, width: max(0, banner.width - 8), height: 13)
        let accent: UIColor = state.alerting
            ? .systemYellow
            : (state.live ? UIColor(red: 0.29, green: 0.91, blue: 0.79, alpha: 1) : .systemOrange)
        bannerText.foregroundColor = accent.cgColor
        bannerText.string = state.live ? state.title : "Paused · open StepSense"
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

    private let callViewController = PiPCallViewController()
    private var controller: AVPictureInPictureController?
    private weak var sourceView: UIView?
    private var state = PiPOverlayState()
    private var possibleObservation: NSKeyValueObservation?
    /// Set by the scan model: Picture in Picture is only offered while a scan owns the camera.
    private var enabled = false

    /// Connects the on-screen anchor that the floating window animates from.
    func attach(sourceView view: UIView) {
        guard isSupported, sourceView !== view else { return }
        sourceView = view
        rebuildController()
    }

    /// Turns the feature on or off without tearing down the camera.
    func setEnabled(_ newValue: Bool) {
        guard enabled != newValue else { return }
        enabled = newValue
        if !newValue { stop() }
        rebuildController()
    }

    private func rebuildController() {
        guard isSupported, enabled, let sourceView else {
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
        created.canStartPictureInPictureAutomaticallyFromInline = true
        controller = created
        possibleObservation = created.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] controller, _ in
            let possible = controller.isPictureInPicturePossible
            Task { @MainActor [weak self] in self?.isPossible = possible }
        }
    }

    func start() {
        failureMessage = nil
        guard let controller else { return }
        guard !controller.isPictureInPictureActive else { return }
        controller.startPictureInPicture()
    }

    func stop() {
        guard let controller, controller.isPictureInPictureActive else { return }
        controller.stopPictureInPicture()
    }

    func enqueue(_ frame: PiPFrame) {
        callViewController.content.enqueue(frame.sampleBuffer)
    }

    func update(_ transform: (inout PiPOverlayState) -> Void) {
        transform(&state)
        callViewController.content.apply(state)
    }

    // MARK: AVPictureInPictureControllerDelegate
    //
    // AVKit declares these as nonisolated, so each one hops to the main actor before touching
    // published state.

    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor [weak self] in self?.isActive = true }
    }

    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor [weak self] in self?.isActive = false }
    }

    nonisolated func pictureInPictureController(_ controller: AVPictureInPictureController,
                                                failedToStartPictureInPictureWithError error: Error) {
        let description = error.localizedDescription
        Task { @MainActor [weak self] in
            guard let self else { return }
            isActive = false
            failureMessage = "Picture in Picture could not start. \(description)"
        }
    }
}

// MARK: - SwiftUI anchor

/// Invisible anchor view that Picture in Picture animates from and returns to.
struct PiPSourceAnchor: UIViewRepresentable {
    let controller: PictureInPictureController

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        controller.attach(sourceView: uiView)
    }
}
