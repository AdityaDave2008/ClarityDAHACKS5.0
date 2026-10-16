import AVFoundation
import Foundation
import SwiftUI

@MainActor
final class ScanModel: ObservableObject {
    enum Phase: Equatable { case idle, connecting, previewing, scanning, paused, failed }

    let camera = CameraCapture()
    let pip = PictureInPictureController()
    private let alerts = AlertPlayer()
    @Published private(set) var cameraRunning = false
    /// True while capture is interrupted but expected to resume on its own.
    @Published private(set) var cameraPaused = false
    @Published var phase: Phase = .idle
    @Published var detail = "Point the rear camera forward and slightly down."
    @Published private(set) var preferences: ScanPreferences
    @Published private(set) var zone: [NormalizedPoint] = []
    @Published private(set) var detections: [Detection] = []
    @Published private(set) var imageSize = CGSize(width: 480, height: 640)
    @Published private(set) var modelStatus = "Bundled COCO-SSD · offline"
    @Published private(set) var multitaskingSupported: Bool?
    /// True once the capture session actually grants camera access while backgrounded.
    @Published private(set) var multitaskingEnabled: Bool?
    /// User switch for keeping the scanner in a floating window.
    @Published var pictureInPictureRequested: Bool {
        didSet {
            UserDefaults.standard.set(pictureInPictureRequested, forKey: "stepsense.pip")
            pip.setEnabled(pictureInPictureRequested && cameraRunning)
            if !pictureInPictureRequested { pip.stop() }
        }
    }
    @Published private(set) var processingMs: Int?
    @Published private(set) var roundTripMs: Int?
    @Published private(set) var alertReason = "idle"
    @Published private(set) var alertCount = 0
    @Published private(set) var checkedFrames = 0

    private var generation = UUID()
    private var sequence = 0
    private let detector = OfflineDetector()
    private var preferencesRevision = UUID()
    private var startTask: Task<Void, Never>?
    private var frameTask: Task<Void, Never>?
    private var overlayExpirationTask: Task<Void, Never>?
    private var watchdogTask: Task<Void, Never>?
    private var displayedSequence: Int?
    private let maxResultAge: TimeInterval = 2.5

    init() {
        pictureInPictureRequested = UserDefaults.standard.object(forKey: "stepsense.pip") as? Bool ?? true
        if let data = UserDefaults.standard.data(forKey: "stepsense.preferences"),
           let saved = try? JSONDecoder().decode(ScanPreferences.self, from: data) {
            preferences = saved
        } else {
            preferences = ScanPreferences()
        }
    }

    var isBusy: Bool { phase == .connecting || phase == .scanning || phase == .previewing }
    var hasCandidate: Bool { detections.contains(where: \.inZone) }

    func start() {
        guard !isBusy else { return }
        generation = UUID()
        let current = generation
        phase = .connecting
        detail = "Checking camera permission…"
        detections = []
        processingMs = nil
        roundTripMs = nil
        alertReason = "idle"
        alertCount = 0
        checkedFrames = 0

        startTask = Task { [weak self] in
            guard let self else { return }
            do {
                // Permission must not depend on a reachable model server.
                // Local preview must also work when the detector cannot be reached.
                try await camera.requestAuthorization()
                try Task.checkCancellation()
                guard generation == current else { return }
                detail = "Starting the rear camera…"
                let diagnostics = try await camera.start(onFrame: { [weak self] frame in
                    Task { @MainActor in self?.analyze(frame, generation: current) }
                }, onPreview: { [weak self] preview in
                    Task { @MainActor in
                        guard let self, self.generation == current else { return }
                        self.pip.enqueue(preview)
                    }
                }, onInterruption: { [weak self] paused, message in
                    Task { @MainActor in
                        guard let self, self.generation == current else { return }
                        self.handleCameraInterruption(paused: paused, message: message, generation: current)
                    }
                }, onFailure: { [weak self] message in
                    Task { @MainActor in
                        guard let self, self.generation == current else { return }
                        self.stop(nextPhase: .failed, message: message)
                    }
                })
                guard generation == current, !Task.isCancelled else { return }
                multitaskingSupported = diagnostics.multitaskingSupported
                multitaskingEnabled = diagnostics.multitaskingEnabled
                cameraRunning = true
                detail = "Camera preview only. Loading the bundled offline detector…"
                // The floating window can show the camera before the local model is ready.
                pip.setEnabled(pictureInPictureRequested)
                refreshPiPOverlay()
                zone = try await detector.start()
                try Task.checkCancellation()
                guard generation == current else { return }
                modelStatus = "COCO-SSD lite_mobilenet_v2 · offline \(detector.backend.uppercased())"
                sequence = 0
                phase = .scanning
                detail = "Scanning the marked image zone offline."
                pip.setEnabled(pictureInPictureRequested)
                refreshPiPOverlay()
                camera.requestFrame()
            } catch {
                guard generation == current else { return }
                if cameraRunning {
                    phase = .previewing
                    alertReason = "unavailable"
                    modelStatus = "Detection unavailable"
                    detail = "Preview only. No detection or obstacle alerts. \(readable(error)) Stop and Start to retry."
                    refreshPiPOverlay()
                } else {
                    stop(nextPhase: .failed, message: readable(error))
                }
            }
        }
    }

    func stop() {
        stop(nextPhase: .idle, message: "Stopped. Camera released.")
    }

    /// Called when the app leaves the foreground.
    ///
    /// With an active video-call Picture in Picture window and multitasking camera access,
    /// scanning continues and the floating window keeps showing live detections. Otherwise the
    /// previous behavior applies: release the camera and require an explicit restart.
    func pauseForBackground() {
        guard isBusy else { alerts.stop(); return }
        // Preview-only sessions keep the window too: the camera is what the window shows.
        if cameraRunning, pip.isActive, multitaskingEnabled == true {
            detail = phase == .scanning ? "Floating camera active. Offline analysis may pause in background." : "Camera preview in the floating window."
            refreshPiPOverlay()
            return
        }
        if pip.isActive {
            // The window stays up, but without camera access it must not imply a live feed.
            pip.update { $0.live = false }
        }
        stop(nextPhase: .paused, message: "Paused when the app left the foreground. Tap Start to resume.")
    }

    func returnedToForeground() {
        // The display layer's decoder does not survive backgrounding.
        pip.resetDisplay()
        if cameraRunning { refreshPiPOverlay() }
    }

    func startPictureInPicture() {
        pictureInPictureRequested = true
        pip.setEnabled(cameraRunning)
        pip.start()
    }

    /// Camera pauses are routine while the floating window moves, resizes, or hides.
    ///
    /// These are recoverable, so scanning keeps its session and simply resumes the frame loop
    /// once capture comes back, instead of ending the scan and demanding a manual restart.
    private func handleCameraInterruption(paused: Bool, message: String, generation current: UUID) {
        guard cameraRunning else { return }
        cameraPaused = paused
        if paused {
            clearDisplayedResult()
            alertReason = "unavailable"
            detail = message
            pip.update { $0.live = false }
            return
        }
        // Capture restarting produces a new format description; the layer must be rebuilt.
        pip.resetDisplay()
        detail = phase == .scanning ? "Scanning the marked image zone offline." : "Camera preview resumed."
        pip.update { $0.live = true }
        refreshPiPOverlay()
        // The previous request may have completed while capture was paused, which would leave
        // the loop with no pending frame to continue from.
        if phase == .scanning, frameTask == nil { camera.requestFrame() }
        if phase == .scanning { startFrameWatchdog(generation: current) }
    }

    private func refreshPiPOverlay() {
        let alerting = hasCandidate
        let message = detail
        let currentZone = zone
        let currentDetections = detections
        let size = imageSize
        pip.update { state in
            state.zone = currentZone
            state.detections = currentDetections
            state.imageSize = size
            state.alerting = alerting
            state.live = true
            state.title = alerting ? "Object in zone" : message
        }
    }

    func testAlert() {
        alerts.deliver(preferences.alertModes, message: "This is a StepSense test alert.")
        if preferences.alertModes.isEmpty { detail = "Visual-only mode. Object warnings appear on this screen." }
    }

    func applyPreferences(_ updated: ScanPreferences) async throws {
        preferences = updated
        preferencesRevision = UUID()
        clearDisplayedResult()
        refreshPiPOverlay()
        if let encoded = try? JSONEncoder().encode(preferences) {
            UserDefaults.standard.set(encoded, forKey: "stepsense.preferences")
        }
        alerts.stop()
    }

    private func analyze(_ frame: CapturedFrame, generation current: UUID) {
        guard phase == .scanning, generation == current, frameTask == nil else { return }
        sequence += 1
        let frameSequence = sequence
        let revision = preferencesRevision
        imageSize = frame.size
        frameTask = Task { [weak self] in
            guard let self else { return }
            var retryDelay: Double = 0
            do {
                let result = try await detector.analyze(jpeg: frame.jpeg, sequence: frameSequence, preferences: preferences, capturedAt: frame.capturedAt)
                guard generation == current, phase == .scanning, !Task.isCancelled else { return }
                guard preferencesRevision == revision else {
                    frameTask = nil
                    camera.requestFrame()
                    return
                }
                imageSize = CGSize(width: result.frame.width, height: result.frame.height)
                processingMs = result.processingMs
                let age = ProcessInfo.processInfo.systemUptime - frame.capturedAt
                roundTripMs = Int(age * 1000)
                checkedFrames += 1
                if age > maxResultAge {
                    clearDisplayedResult()
                    alertReason = "stale"
                    detail = "Result arrived late. Alert skipped; checking a fresh frame."
                } else {
                    detections = result.detections
                    expireDisplayedResult(sequence: frameSequence, capturedAt: frame.capturedAt, generation: current)
                    alertReason = result.alert.reason
                    switch result.alert.reason {
                    case "triggered": detail = result.alert.message ?? "Object in camera zone. Check your surroundings."
                    case "confirming": detail = "Object in image zone. Confirming another frame…"
                    case "cooldown": detail = "Object remains in zone. Alert cooldown active."
                    default: detail = "No supported object in the image zone in the last frame."
                    }
                    if result.alert.triggered {
                        alertCount += 1
                        let enabled = result.alert.modalities.filter { self.preferences.alertModes.contains($0) }
                        alerts.deliver(enabled, message: result.alert.message ?? "Object in camera zone. Check your surroundings.")
                    }
                }
                refreshPiPOverlay()
            } catch {
                guard generation == current, phase == .scanning, !Task.isCancelled else { return }
                clearDisplayedResult()
                alertReason = "unavailable"
                detail = "Analysis unavailable. \(readable(error))"
                refreshPiPOverlay()
                if detector.webView == nil {
                    phase = .previewing
                    modelStatus = "Detection unavailable"
                    detail = "Preview only. No detection or obstacle alerts. Stop and Start to retry."
                    frameTask = nil
                    refreshPiPOverlay()
                    return
                }
                retryDelay = 1
            }
            // Capture only after the last local inference, with a maximum rate of about three frames/sec.
            let delay = max(retryDelay, max(0, 1.0 / 3 - (ProcessInfo.processInfo.systemUptime - frame.capturedAt)))
            do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
            guard generation == current, phase == .scanning, !Task.isCancelled else { return }
            frameTask = nil
            camera.requestFrame()
            startFrameWatchdog(generation: current)
        }
    }

    /// Restarts the frame loop if a requested frame never arrives.
    ///
    /// A capture interruption can swallow the pending request, which would otherwise leave
    /// scanning silently idle until the user stopped and started again.
    private func startFrameWatchdog(generation current: UUID) {
        watchdogTask?.cancel()
        let waitingFor = sequence
        watchdogTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { return }
            guard let self, generation == current, phase == .scanning, !Task.isCancelled,
                  frameTask == nil, sequence == waitingFor, !cameraPaused else { return }
            camera.requestFrame()
            startFrameWatchdog(generation: current)
        }
    }

    private func expireDisplayedResult(sequence: Int, capturedAt: TimeInterval, generation current: UUID) {
        overlayExpirationTask?.cancel()
        displayedSequence = sequence
        let remaining = max(0, maxResultAge - (ProcessInfo.processInfo.systemUptime - capturedAt))
        overlayExpirationTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) } catch { return }
            guard let self, generation == current, phase == .scanning,
                  displayedSequence == sequence, !Task.isCancelled else { return }
            detections = []
            displayedSequence = nil
            alertReason = "unavailable"
            detail = "Waiting for a fresh analysis result. Previous boxes cleared."
            refreshPiPOverlay()
        }
    }

    private func clearDisplayedResult() {
        overlayExpirationTask?.cancel()
        overlayExpirationTask = nil
        displayedSequence = nil
        detections = []
    }

    private func stop(nextPhase: Phase, message: String) {
        generation = UUID()
        startTask?.cancel()
        frameTask?.cancel()
        watchdogTask?.cancel()
        startTask = nil
        frameTask = nil
        watchdogTask = nil
        camera.stop()
        cameraRunning = false
        cameraPaused = false
        alerts.stop()
        pip.setEnabled(false)
        detector.stop()
        clearDisplayedResult()
        alertReason = "idle"
        phase = nextPhase
        detail = message
    }

    private func readable(_ error: Error) -> String {
        return error.localizedDescription
    }
}
