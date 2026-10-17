import AVFoundation
import Foundation
import SwiftUI

@MainActor
final class ScanModel: ObservableObject {
    enum Phase: Equatable { case idle, connecting, previewing, scanning, paused, failed }

    lazy var camera = CameraCapture()
    private var cameraInitialized = false
    let pip = PictureInPictureController()
    private let alerts = AlertPlayer()
    @Published private(set) var cameraRunning = false
    @Published private(set) var cameraStopping = false
    /// True while capture is interrupted but expected to resume on its own.
    @Published private(set) var cameraPaused = false
    @Published var phase: Phase = .idle
    @Published var detail = "Point the rear camera forward and slightly down."
    @Published private(set) var preferences: ScanPreferences
    @Published private(set) var zone: [NormalizedPoint] = []
    @Published private(set) var detections: [Detection] = []
    @Published private(set) var imageSize = CGSize(width: 480, height: 640)
    @Published private(set) var modelStatus = "Experimental YOLOX-Nano · offline"
    @Published private(set) var multitaskingSupported: Bool?
    /// True once the capture session actually grants camera access while backgrounded.
    @Published private(set) var multitaskingEnabled: Bool?
    @Published private(set) var processingMs: Int?
    @Published private(set) var roundTripMs: Int?
    @Published private(set) var alertReason = "idle"
    @Published private(set) var alertCount = 0
    @Published private(set) var checkedFrames = 0
    @Published private(set) var depthStatus = "Not started"
    @Published private(set) var centerSurfaceMeasurement: (meters: Double, capturedAt: TimeInterval)?
    @Published private(set) var centerSurfaceUnavailableReason = "waiting for depth"
    var centerSurfaceText: String {
        guard preferences.isLidarEnabled, cameraRunning, !cameraPaused else { return "unavailable" }
        guard let measurement = centerSurfaceMeasurement else { return "unavailable · " + centerSurfaceUnavailableReason }
        let age = ProcessInfo.processInfo.systemUptime - measurement.capturedAt
        guard age >= 0, age < DepthSnapshot.maximumAge else { return "unavailable · stale" }
        return String(format: "≈%.2f m axial", measurement.meters)
    }

    private var generation = UUID()
    private var centerDepthNotBefore = ProcessInfo.processInfo.systemUptime
    private var sequence = 0
    private let detector = OfflineDetector()
    private let detectorRecovery = DetectorRecovery()
    private var detectorRecoveryDeferred = false
    private var appInForeground = true
    private var preferencesRevision = UUID()
    private var startTask: Task<Void, Never>?
    private var frameTask: Task<Void, Never>?
    private var overlayExpirationTask: Task<Void, Never>?
    private var depthExpirationTask: Task<Void, Never>?
    private var watchdogTask: Task<Void, Never>?
    private var displayedSequence: Int?
    private let maxResultAge: TimeInterval = 2.5

    init() {
        if let data = UserDefaults.standard.data(forKey: "myeyes.preferences"),
           let saved = try? JSONDecoder().decode(ScanPreferences.self, from: data) {
            preferences = saved
        } else {
            preferences = ScanPreferences()
        }
    }

    var isBusy: Bool { phase == .connecting || phase == .scanning || phase == .previewing }
    var hasCandidate: Bool { detections.contains(where: \.inZone) }

    func start() {
        PiPDiagnostics.log("scan.start", "phase=\(phase)")
        guard !isBusy, !cameraStopping, appInForeground else { return }
        generation = UUID()
        let current = generation
        clearCenterDepth()
        phase = .connecting
        detail = "Loading the bundled detection model. Camera is off…"
        detections = []
        processingMs = nil
        roundTripMs = nil
        alertReason = "idle"
        alertCount = 0
        checkedFrames = 0
        detectorRecovery.reset()
        detectorRecoveryDeferred = false

        startTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await ModelFirstStartup.run(loadModel: {
                    let loadedZone = try await detector.start()
                    try Task.checkCancellation()
                    guard generation == current, appInForeground else { throw CancellationError() }
                    zone = loadedZone
                }, authorizeCamera: {
                    detail = "Model ready. Checking camera permission…"
                    cameraInitialized = true
                    try await camera.requestAuthorization()
                }, startCamera: {
                    detail = "Starting the rear camera…"
                    let diagnostics = try await camera.start(lidarEnabled: preferences.isLidarEnabled, onFrame: { [weak self] frame in
                        Task { @MainActor in self?.analyze(frame, generation: current) }
                    }, onPreview: { [weak self] preview in
                        Task { @MainActor in
                            guard let self, self.generation == current else { return }
                            self.pip.enqueue(preview)
                        }
                    }, onDepthSample: { [weak self] sample in
                        await MainActor.run {
                            guard let self, self.generation == current, self.cameraRunning,
                                  !self.cameraPaused, self.preferences.isLidarEnabled else { return }
                            self.centerSurfaceMeasurement = sample.measurement(now: ProcessInfo.processInfo.systemUptime,
                                                                               notBefore: self.centerDepthNotBefore)
                            self.centerSurfaceUnavailableReason = self.centerSurfaceMeasurement == nil && sample.meters != nil
                                ? "stale or interrupted sensor delivery" : sample.diagnostic
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
                    depthStatus = diagnostics.depthStatus
                    multitaskingSupported = diagnostics.multitaskingSupported
                    multitaskingEnabled = diagnostics.multitaskingEnabled
                    cameraRunning = true
                    PiPDiagnostics.log("camera.started", "multitaskingSupported=\(diagnostics.multitaskingSupported) multitaskingEnabled=\(diagnostics.multitaskingEnabled)")
                    pip.setEnabled(true)
                    modelStatus = "Experimental YOLOX-Nano · offline \(detector.backend.uppercased())"
                    sequence = 0
                    phase = .scanning
                    detail = "Scanning the marked image zone offline."
                    refreshPiPOverlay()
                    camera.requestFrame()
                    startFrameWatchdog(generation: current)
                }, isCurrent: { self.generation == current && self.appInForeground })
            } catch {
                guard generation == current else { return }
                stop(nextPhase: .failed, message: readable(error))
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
        appInForeground = false
        PiPDiagnostics.log("scan.background", "phase=\(phase) camera=\(cameraRunning) pipActive=\(pip.isActive) multitasking=\(multitaskingEnabled == true) checked=\(checkedFrames)")
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
        appInForeground = true
        PiPDiagnostics.log("scan.foreground", "camera=\(cameraRunning) checked=\(checkedFrames)")
        // The display layer's decoder does not survive backgrounding.
        pip.resetDisplay()
        if cameraRunning { refreshPiPOverlay() }
        resumeDeferredDetection()
    }

    private func resumeDeferredDetection() {
        guard detectorRecoveryDeferred, appInForeground, cameraRunning, !cameraPaused,
              !cameraStopping, frameTask == nil else { return }
        detectorRecoveryDeferred = false
        let current = generation
        phase = .scanning
        frameTask = Task { [weak self] in
            guard let self else { return }
            let recovered = await reloadDetector(generation: current)
            guard generation == current, !Task.isCancelled else { return }
            frameTask = nil
            if recovered, !cameraPaused {
                camera.requestFrame()
                startFrameWatchdog(generation: current)
            }
        }
    }

    func startPictureInPicture() {
        PiPDiagnostics.log("scan.pipButton", "camera=\(cameraRunning) checked=\(checkedFrames)")
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
        clearCenterDepth()
        if paused {
            preferencesRevision = UUID() // In-flight pre-interruption depth cannot reappear.
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
        resumeDeferredDetection()
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
        alerts.deliver(preferences.alertModes, message: "This is a Clarity test alert.")
        if preferences.alertModes.isEmpty { detail = "Visual-only mode. Object warnings appear on this screen." }
    }

    func applyPreferences(_ updated: ScanPreferences) async throws {
        if updated.isLidarEnabled != preferences.isLidarEnabled, isBusy || cameraRunning || cameraStopping {
            throw OfflineDetectorError.unavailable("Stop scanning to change LiDAR, then apply settings.")
        }
        preferences = updated
        if !isBusy { depthStatus = updated.isLidarEnabled ? "Enabled · starts with next scan" : "Off" }
        preferencesRevision = UUID()
        if !updated.isLidarEnabled { clearCenterDepth() }
        clearDisplayedResult()
        refreshPiPOverlay()
        if let encoded = try? JSONEncoder().encode(preferences) {
            UserDefaults.standard.set(encoded, forKey: "myeyes.preferences")
        }
        alerts.stop()
    }

    private func analyze(_ frame: CapturedFrame, generation current: UUID) {
        guard phase == .scanning, !cameraPaused, generation == current, frameTask == nil else { return }
        depthStatus = frame.depthDiagnostic
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
                if checkedFrames == 1 || checkedFrames % 30 == 0 {
                    PiPDiagnostics.log("scan.inference", "checked=\(checkedFrames) processingMs=\(result.processingMs) ageMs=\(Int(age * 1000))")
                }
                if age > maxResultAge {
                    clearDisplayedResult()
                    alertReason = "stale"
                    detail = "Result arrived late. Alert skipped; checking a fresh frame."
                } else {
                    detectorRecovery.recordHealthyFrame()
                    let matchingFrame = result.frame.sequence == frameSequence
                        && result.frame.width == Int(frame.size.width) && result.frame.height == Int(frame.size.height)
                    var depthRejections: [String: Int] = [:]
                    detections = result.detections.map { detection in
                        detection.addingDepth(from: frame.depth, enabled: self.preferences.isLidarEnabled,
                                              matchingFrame: matchingFrame, now: ProcessInfo.processInfo.systemUptime) { reason in
                            depthRejections[reason, default: 0] += 1
                        }
                    }
                    if preferences.isLidarEnabled, frame.depth != nil {
                        let accepted = detections.filter { $0.depthMeters != nil }.count
                        let reasons = depthRejections.keys.sorted().map { "\($0): \(depthRejections[$0]!)" }.joined(separator: ", ")
                        depthStatus = "LiDAR · \(accepted) object estimates" + (reasons.isEmpty ? "" : " · " + reasons)
                        if checkedFrames == 1 || checkedFrames % 30 == 0 {
                            PiPDiagnostics.log("lidar.roi", "accepted=\(accepted) rejected=\(reasons) matchingFrame=\(matchingFrame)")
                        }
                    }
                    expireDepth(sequence: frameSequence, capturedAt: frame.capturedAt, generation: current)
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
                    guard await reloadDetector(generation: current) else {
                        guard generation == current, !Task.isCancelled else { return }
                        frameTask = nil
                        return
                    }
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

    private func reloadDetector(generation current: UUID) async -> Bool {
        func deferRecovery() {
            detectorRecoveryDeferred = true
            phase = .previewing
            modelStatus = "Detection paused"
            detail = "Preview only. Detection will recover when this app and camera are active. No obstacle alerts while paused."
            refreshPiPOverlay()
        }
        guard appInForeground else { deferRecovery(); return false }
        guard !cameraPaused else { deferRecovery(); return false }
        detail = "Camera preview active. Recovering the offline detector…"
        modelStatus = "Restarting offline detector"
        refreshPiPOverlay()
        do {
            try await detectorRecovery.reload(canLoad: { self.appInForeground && !self.cameraPaused }) {
                let recoveredZone = try await self.detector.start()
                try Task.checkCancellation()
                guard self.generation == current else { throw CancellationError() }
                self.zone = recoveredZone
            }
            guard generation == current, !Task.isCancelled else { return false }
            guard appInForeground, !cameraPaused else { deferRecovery(); return false }
            modelStatus = "Experimental YOLOX-Nano · offline \(detector.backend.uppercased())"
            detail = "Detector recovered. Checking a fresh frame…"
            return true
        } catch {
            guard generation == current, !Task.isCancelled else { return false }
            if case DetectorRecoveryError.deferred = error { deferRecovery(); return false }
            phase = .previewing
            modelStatus = "Detection unavailable"
            detail = "Preview only. Automatic recovery failed. No obstacle alerts. Stop and Start to retry."
            refreshPiPOverlay()
            return false
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

    private func expireDepth(sequence: Int, capturedAt: TimeInterval, generation current: UUID) {
        depthExpirationTask?.cancel()
        guard detections.contains(where: { $0.depthMeters != nil }) else { return }
        let remaining = max(0, DepthSnapshot.maximumAge - (ProcessInfo.processInfo.systemUptime - capturedAt))
        depthExpirationTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) } catch { return }
            guard let self, generation == current, displayedSequence == sequence, !Task.isCancelled else { return }
            detections = detections.map { detection in
                var expired = detection
                expired.depthMeters = nil
                expired.depthExpiresAt = nil
                return expired
            }
            refreshPiPOverlay()
        }
    }

    private func clearCenterDepth() {
        centerDepthNotBefore = ProcessInfo.processInfo.systemUptime
        centerSurfaceMeasurement = nil
        centerSurfaceUnavailableReason = "waiting for depth"
    }

    private func clearDisplayedResult() {
        depthExpirationTask?.cancel()
        depthExpirationTask = nil
        overlayExpirationTask?.cancel()
        overlayExpirationTask = nil
        displayedSequence = nil
        detections = []
    }

    private func stop(nextPhase: Phase, message: String) {
        PiPDiagnostics.log("scan.stop", "phase=\(phase) next=\(nextPhase)")
        generation = UUID()
        startTask?.cancel()
        frameTask?.cancel()
        watchdogTask?.cancel()
        startTask = nil
        frameTask = nil
        watchdogTask = nil
        detectorRecoveryDeferred = false
        cameraStopping = cameraInitialized
        let stoppedGeneration = generation
        if cameraInitialized {
            camera.stop { [weak self] in
                Task { @MainActor in
                    guard let self, self.generation == stoppedGeneration else { return }
                    self.cameraStopping = false
                }
            }
        }
        cameraRunning = false
        cameraPaused = false
        alerts.stop()
        pip.setEnabled(false)
        detector.stop(keepingReadyModel: nextPhase != .failed)
        clearCenterDepth()
        clearDisplayedResult()
        alertReason = "idle"
        phase = nextPhase
        detail = message
    }

    private func readable(_ error: Error) -> String {
        return error.localizedDescription
    }
}
