import AVFoundation
import Foundation
import SwiftUI
import UIKit

@MainActor
final class ScanModel: ObservableObject {
    enum Phase: Equatable { case idle, connecting, scanning, paused, failed }

    let camera = CameraCapture()
    private let alerts = AlertPlayer()
    @Published var phase: Phase = .idle
    @Published var detail = "Point the rear camera forward and slightly down."
    @Published var backendAddress: String {
        didSet { UserDefaults.standard.set(backendAddress, forKey: "stepsense.backend") }
    }
    @Published private(set) var preferences: ScanPreferences
    @Published private(set) var zone: [NormalizedPoint] = []
    @Published private(set) var detections: [Detection] = []
    @Published private(set) var imageSize = CGSize(width: 480, height: 640)
    @Published private(set) var modelStatus = "Not connected"
    @Published private(set) var multitaskingSupported: Bool?
    @Published private(set) var processingMs: Int?
    @Published private(set) var roundTripMs: Int?
    @Published private(set) var alertReason = "idle"
    @Published private(set) var alertCount = 0
    @Published private(set) var checkedFrames = 0
    @Published private(set) var checkingConnection = false

    private var generation = UUID()
    private var sequence = 0
    private var client: BackendClient?
    private var sessionID: String?
    private var startTask: Task<Void, Never>?
    private var frameTask: Task<Void, Never>?
    private var overlayExpirationTask: Task<Void, Never>?
    private var displayedSequence: Int?
    private let maxResultAge: TimeInterval = 2.5

    init() {
        backendAddress = UserDefaults.standard.string(forKey: "stepsense.backend") ?? "http://127.0.0.1:3001"
        if let data = UserDefaults.standard.data(forKey: "stepsense.preferences"),
           let saved = try? JSONDecoder().decode(ScanPreferences.self, from: data) {
            preferences = saved
        } else {
            preferences = ScanPreferences()
        }
    }

    var isBusy: Bool { phase == .connecting || phase == .scanning }
    var hasCandidate: Bool { detections.contains(where: \.inZone) }

    func checkConnection() async {
        guard !checkingConnection else { return }
        checkingConnection = true
        defer { checkingConnection = false }
        do {
            let candidate = try BackendClient(address: backendAddress)
            let metadata = try await candidate.metadata()
            zone = metadata.zone
            modelStatus = "\(metadata.name.uppercased()) · \(metadata.state)"
            try await candidate.checkReady()
            if !isBusy { detail = "Backend ready. Start scanning to enable the camera." }
        } catch {
            modelStatus = "Connection unavailable"
            if !isBusy { detail = readable(error) }
        }
    }

    func start() {
        guard !isBusy else { return }
        generation = UUID()
        let current = generation
        phase = .connecting
        detail = "Connecting to the detection model…"
        detections = []
        processingMs = nil
        roundTripMs = nil
        alertReason = "idle"
        alertCount = 0
        checkedFrames = 0

        startTask = Task { [weak self] in
            guard let self else { return }
            do {
                let api = try BackendClient(address: backendAddress)
                let metadata = try await api.metadata()
                try Task.checkCancellation()
                guard generation == current else { return }
                zone = metadata.zone
                modelStatus = "\(metadata.name.uppercased()) · \(metadata.state)"
                try await api.checkReady()
                let created = try await api.createSession(preferences: preferences)
                guard generation == current, !Task.isCancelled else {
                    await api.deleteSession(created.sessionId)
                    return
                }
                client = api
                sessionID = created.sessionId
                sequence = 0
                detail = "Starting the rear camera…"
                let diagnostics = try await camera.start(onFrame: { [weak self] frame in
                    Task { @MainActor in self?.analyze(frame, generation: current) }
                }, onFailure: { [weak self] message in
                    Task { @MainActor in
                        guard let self, self.generation == current else { return }
                        self.stop(nextPhase: .failed, message: message)
                    }
                })
                guard generation == current, !Task.isCancelled else { camera.stop(); return }
                multitaskingSupported = diagnostics.multitaskingSupported
                phase = .scanning
                detail = "Scanning the marked image zone."
                camera.requestFrame()
            } catch {
                guard generation == current else { return }
                stop(nextPhase: .failed, message: readable(error))
            }
        }
    }

    func stop() {
        stop(nextPhase: .idle, message: "Stopped. Camera released.")
    }

    func pauseForBackground() {
        if phase == .scanning, multitaskingSupported == true, camera.floatingCamera.isActive { return }
        guard isBusy else { alerts.stop(); return }
        stop(nextPhase: .paused, message: "Paused when the app left the foreground. Tap Start to resume.")
    }

    func startFloatingCamera() {
        guard phase == .scanning else { detail = "Start scanning before opening the floating camera."; return }
        guard multitaskingSupported == true else {
            detail = "iOS has not enabled background camera access for this installation. Keep StepSense open to scan."
            return
        }
        camera.floatingCamera.onEnd = { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                if UIApplication.shared.applicationState == .background { self.pauseForBackground() }
                self.alerts.keepsAudioSessionActive = false
                self.alerts.stop()
            }
        }
        camera.floatingCamera.onFailure = { [weak self] message in
            Task { @MainActor in
                guard let self else { return }
                self.alerts.keepsAudioSessionActive = false
                self.alerts.stop()
                self.detail = "Floating camera could not start. \(message)"
                if UIApplication.shared.applicationState == .background { self.pauseForBackground() }
            }
        }
        do {
            try camera.floatingCamera.start()
            alerts.keepsAudioSessionActive = true
            detail = "Wait for the floating camera to appear before switching apps. Closing it pauses background scanning."
        } catch { detail = error.localizedDescription }
    }

    func testAlert() {
        alerts.deliver(preferences.alertModes, message: "This is a StepSense test alert.")
        if preferences.alertModes.isEmpty { detail = "Visual-only mode. Object warnings appear on this screen." }
    }

    func applyPreferences(_ updated: ScanPreferences) async throws {
        if let client, let sessionID, phase == .scanning {
            let current = generation
            let updatedSession = try await client.updatePreferences(updated, sessionID: sessionID)
            guard generation == current, self.sessionID == sessionID else {
                throw BackendError(status: 0, code: "SESSION_CHANGED", message: "The scanning session changed. Apply your settings again.")
            }
            preferences = updatedSession.preferences
        } else {
            preferences = updated
        }
        if let encoded = try? JSONEncoder().encode(preferences) {
            UserDefaults.standard.set(encoded, forKey: "stepsense.preferences")
        }
        alerts.stop()
    }

    private func analyze(_ frame: CapturedFrame, generation current: UUID) {
        guard phase == .scanning, generation == current, frameTask == nil,
              let client, let sessionID else { return }
        sequence += 1
        let frameSequence = sequence
        imageSize = frame.size
        frameTask = Task { [weak self] in
            guard let self else { return }
            var retryDelay: Double = 0
            do {
                let result = try await client.analyze(jpeg: frame.jpeg, sessionID: sessionID, sequence: frameSequence)
                guard generation == current, phase == .scanning, !Task.isCancelled else { return }
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
            } catch {
                guard generation == current, phase == .scanning, !Task.isCancelled else { return }
                clearDisplayedResult()
                alertReason = "unavailable"
                if let backend = error as? BackendError, backend.status == 404 {
                    stop(nextPhase: .failed, message: "This session ended. Tap Start to create a fresh session.")
                    return
                }
                if let backend = error as? BackendError, backend.code == "SESSION_CHANGED" {
                    detail = "Settings updated. Checking a fresh frame…"
                } else if let backend = error as? BackendError, backend.status == 429 {
                    detail = "Detector busy. Retrying with a fresh frame…"
                } else {
                    detail = "Analysis unavailable. \(readable(error))"
                }
                retryDelay = 1
            }
            // Capture only after the last response, with a maximum rate of about three frames/sec.
            let delay = max(retryDelay, max(0, 1.0 / 3 - (ProcessInfo.processInfo.systemUptime - frame.capturedAt)))
            do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
            guard generation == current, phase == .scanning, !Task.isCancelled else { return }
            frameTask = nil
            camera.requestFrame()
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
        startTask = nil
        frameTask = nil
        camera.stop()
        alerts.keepsAudioSessionActive = false
        alerts.stop()
        let previousClient = client
        let previousID = sessionID
        client = nil
        sessionID = nil
        clearDisplayedResult()
        alertReason = "idle"
        phase = nextPhase
        detail = message
        if let previousClient, let previousID {
            Task { await previousClient.deleteSession(previousID) }
        }
    }

    private func readable(_ error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotConnectToHost, .cannotFindHost:
                return "Cannot reach the backend. On iPhone, enter your laptop's LAN address and allow local network access."
            case .notConnectedToInternet: return "Network connection unavailable."
            case .timedOut: return "The backend request timed out. Check the server and network."
            default: return urlError.localizedDescription
            }
        }
        return error.localizedDescription
    }
}
