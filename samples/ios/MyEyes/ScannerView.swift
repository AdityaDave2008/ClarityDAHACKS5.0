import AVFoundation
import SwiftUI

struct ScannerView: View {
    @ObservedObject var model: ScanModel
    @State private var showingSettings = false

    private var statusColor: Color {
        if model.phase == .failed || ["unavailable", "stale"].contains(model.alertReason) { return .orange }
        return model.hasCandidate ? .yellow : .senseTeal
    }

    private var title: String {
        switch model.phase {
        case .idle: return "Ready when you are"
        case .connecting: return "Loading offline detector…"
        case .previewing: return "Camera preview only"
        case .paused: return "Scanning paused"
        case .failed: return "Unable to start"
        case .scanning:
            switch model.alertReason {
            case "unavailable": return "Analysis unavailable"
            case "stale": return "Result arrived late"
            case "confirming": return "Checking object"
            case "triggered", "cooldown": return "Object in camera zone"
            default: return "Scanning ahead"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                HStack(spacing: 7) {
                    Circle().fill(model.phase == .scanning ? Color.senseTeal : Color.senseMuted).frame(width: 6, height: 6)
                    Text(model.phase == .scanning ? "LIVE SCAN" : "CAMERA SCANNER")
                    Spacer()
                    Label("Floating window", systemImage: "pip")
                }
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(Color.senseMuted)

                cameraCard

                if model.preferences.isLidarEnabled {
                    VStack(alignment: .leading, spacing: 5) {
                        TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                            Text("Center-surface LiDAR test: \(model.centerSurfaceText)")
                                .font(.subheadline.monospacedDigit())
                        }
                        Text("Raw center pixel. Not object distance or a safety indication.")
                            .font(.caption)
                        Text(model.depthStatus).font(.caption)
                    }
                    .foregroundStyle(Color.senseMuted)
                }

                pictureInPictureCard

                VStack(alignment: .leading, spacing: 9) {
                    HStack(alignment: .top, spacing: 11) {
                        Image(systemName: model.hasCandidate ? "exclamationmark.triangle.fill" : "viewfinder")
                            .font(.title3)
                            .foregroundStyle(statusColor)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(title).font(.headline).foregroundStyle(statusColor)
                            Text(model.detail)
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.76))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    HStack {
                        Text("\(model.checkedFrames) frames checked")
                        Spacer()
                        Text("\(model.alertCount) alerts")
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Color.senseMuted)
                    .padding(.top, 6)
                }
                .padding(17)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.senseSurface, in: RoundedRectangle(cornerRadius: 18))

                HStack(spacing: 12) {
                    Button {
                        if model.isBusy { model.stop() } else { model.start() }
                    } label: {
                        Label(model.isBusy ? "Stop scanning" : "Start scanning", systemImage: model.isBusy ? "stop.fill" : "viewfinder")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.senseTeal)
                    .foregroundStyle(.black)
                    .disabled(model.cameraStopping)

                    Button { model.testAlert() } label: {
                        Image(systemName: "speaker.wave.2")
                            .font(.title3)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(.senseTeal)
                    .accessibilityLabel("Test selected alert modes")
                }

                HStack(spacing: 14) {
                    if model.preferences.alertModes.isEmpty {
                        Label("Visual only", systemImage: "eye")
                    } else {
                        ForEach(model.preferences.alertModes) { mode in
                            Label(mode.title, systemImage: mode.symbol)
                        }
                    }
                }
                .font(.caption)
                .foregroundStyle(Color.senseMuted)

                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("DETECTION MODEL").font(.system(size: 9, weight: .semibold, design: .monospaced))
                        Text(model.modelStatus).font(.caption)
                    }
                    Spacer()
                    if let processing = model.processingMs, let roundTrip = model.roundTripMs {
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("LAST RESPONSE").font(.system(size: 9, weight: .semibold, design: .monospaced))
                            Text("\(roundTrip) ms total · \(processing) ms inference").font(.caption.monospacedDigit())
                        }
                    }
                }
                .foregroundStyle(Color.senseMuted)
                .padding(.vertical, 4)

                Text("Prototype for selected objects. The image zone does not establish that a path is clear. Optional LiDAR labels estimate axial depth, not safety. Camera frames are processed on this iPhone and are not uploaded.")
                    .font(.caption)
                    .foregroundStyle(Color.senseMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(22)
        }
        .background(Color.black.ignoresSafeArea())
        .sheet(isPresented: $showingSettings) { SettingsView(model: model) }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "figure.walk")
                .font(.system(size: 25, weight: .medium))
                .foregroundStyle(Color.senseTeal)
                .frame(width: 47, height: 47)
                .background(Color.senseTeal.opacity(0.12), in: RoundedRectangle(cornerRadius: 15))
            VStack(alignment: .leading, spacing: 3) {
                Text("Clarity").font(.system(size: 27, weight: .semibold, design: .rounded))
                Text("A little more awareness.").font(.caption).foregroundStyle(Color.senseMuted)
            }
            Spacer()
            Button { showingSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.title3)
                    .frame(width: 42, height: 42)
                    .background(Color.senseSurface, in: Circle())
            }
            .foregroundStyle(Color.senseTeal)
            .accessibilityLabel("Offline detector and alert settings")
        }
    }

    private var pictureInPictureCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: model.pip.isActive ? "pip.fill" : "pip")
                    .font(.title3)
                    .foregroundStyle(model.pip.isActive ? Color.senseTeal : Color.senseMuted)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Keep scanning while you use other apps").font(.subheadline.weight(.semibold))
                    Text(pipDetail)
                        .font(.caption)
                        .foregroundStyle(Color.senseMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            LabeledContent("System reports ready", value: model.pip.isPossible ? "Yes" : "Not yet")
                .font(.caption)
                .foregroundStyle(Color.senseMuted)
            Button {
                model.startPictureInPicture()
            } label: {
                Label("Open floating window now", systemImage: "pip.enter")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.bordered)
            .tint(.senseTeal)
            // Only hard blockers disable this. Readiness is handled by start(), which waits and
            // then explains itself, so a stale isPossible cannot silently hide the feature.
            .disabled(model.pip.unavailableReason != nil || model.pip.isActive)
            if let failure = model.pip.failureMessage {
                Text(failure).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(17)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.senseSurface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(PiPSourceAnchor(controller: model.pip).allowsHitTesting(false))
    }

    private var pipDetail: String {
        if let reason = model.pip.unavailableReason { return reason }
        if model.pip.isActive {
            return model.multitaskingEnabled == true
                ? "Live camera continues in the floating window. Offline analysis may pause in the background; old boxes expire."
                : "Floating window is open. This device does not grant camera access outside the app, so the window pauses when Clarity is backgrounded."
        }
        if !model.cameraRunning { return "Camera and floating window stay closed until you choose to start. Tap Start scanning to prepare automatic floating-window entry, or open an empty window manually." }
        if model.phase == .previewing { return "Camera preview only. Swipe home, or open the window now." }
        return "Swipe home while scanning, or open the window now."
    }

    private var cameraCard: some View {
        ZStack {
            CameraPreview(session: model.camera.session)
            if model.cameraRunning {
                DetectionOverlay(zone: model.zone, detections: model.detections, imageSize: model.imageSize)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            if !model.cameraRunning {
                Color.senseSurface
                VStack(spacing: 14) {
                    Image(systemName: model.phase == .paused ? "pause.circle" : "viewfinder")
                        .font(.system(size: 52, weight: .ultraLight))
                    Text(model.phase == .connecting ? "Getting ready…" : "See what’s ahead")
                        .font(.title3.weight(.medium))
                    Text("Rear camera · floating window supported")
                        .font(.caption)
                        .foregroundStyle(Color.senseMuted)
                    if model.phase == .connecting { ProgressView().tint(.senseTeal) }
                }
                .foregroundStyle(Color.senseTeal)
            }
        }
        .aspectRatio(3.0 / 4, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color.senseTeal.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rear camera preview. \(model.detections.count) supported objects detected in the last frame.")
    }
}

private struct DetectionOverlay: View {
    let zone: [NormalizedPoint]
    let detections: [Detection]
    let imageSize: CGSize

    var body: some View {
        GeometryReader { geometry in
            let rect = containedImage(in: geometry.size)
            Path { path in
                guard let first = zone.first else { return }
                path.move(to: point(first, in: rect))
                for vertex in zone.dropFirst() { path.addLine(to: point(vertex, in: rect)) }
                path.closeSubpath()
            }
            .fill(Color.senseTeal.opacity(0.09))
            Path { path in
                guard let first = zone.first else { return }
                path.move(to: point(first, in: rect))
                for vertex in zone.dropFirst() { path.addLine(to: point(vertex, in: rect)) }
                path.closeSubpath()
            }
            .stroke(Color.senseTeal.opacity(0.8), style: StrokeStyle(lineWidth: 1.5, dash: [7, 6]))

            ForEach(Array(detections.enumerated()), id: \.offset) { _, detection in
                let box = CGRect(x: rect.minX + CGFloat(detection.bbox.x) * rect.width,
                                 y: rect.minY + CGFloat(detection.bbox.y) * rect.height,
                                 width: CGFloat(detection.bbox.width) * rect.width,
                                 height: CGFloat(detection.bbox.height) * rect.height)
                let color: Color = detection.inZone ? .yellow : .senseTeal
                RoundedRectangle(cornerRadius: 7)
                    .stroke(color, lineWidth: 2)
                    .frame(width: box.width, height: box.height)
                    .position(x: box.midX, y: box.midY)
                Text("\(detection.label)  \(Int(detection.confidence * 100))%" + (detection.depthLabel.map { " · " + $0 } ?? ""))
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                    .background(color, in: RoundedRectangle(cornerRadius: 4))
                    .position(x: min(max(box.midX, rect.minX + 65), rect.maxX - 65), y: max(rect.minY + 12, box.minY - 13))
                Circle().fill(color).frame(width: 6, height: 6).position(point(detection.anchor, in: rect))
            }
        }
    }

    private func containedImage(in size: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return .zero }
        let scale = min(size.width / imageSize.width, size.height / imageSize.height)
        let fitted = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(x: (size.width - fitted.width) / 2, y: (size.height - fitted.height) / 2, width: fitted.width, height: fitted.height)
    }

    private func point(_ point: NormalizedPoint, in rect: CGRect) -> CGPoint {
        CGPoint(x: rect.minX + CGFloat(point.x) * rect.width, y: rect.minY + CGFloat(point.y) * rect.height)
    }
}

private struct SettingsView: View {
    @ObservedObject var model: ScanModel
    @Environment(\.dismiss) private var dismiss
    @State private var preferences: ScanPreferences
    @State private var saving = false
    @State private var errorMessage: String?

    init(model: ScanModel) {
        self.model = model
        _preferences = State(initialValue: model.preferences)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Experimental YOLOX-Nano · fine-tuned candidate")
                    Text(model.modelStatus).font(.caption).foregroundStyle(.secondary)
                    Text("Testing only. Candidate mAP is worse than baseline. Not safety-certified. 80 model classes, limited to the existing 16-label alert policy. iPhone image decoding differs from offline evaluation and can change threshold decisions. The 78.75% default may give sparse results; lowering it changes the evaluated operating point.").font(.caption).foregroundStyle(.secondary)
                } header: { Text("Offline detector") } footer: {
                    Text("Fine-tuned model and runtime are bundled on this iPhone. No server, Wi-Fi, or mobile data is needed. Start scanning to load the model.")
                }

                Section {
                    HStack {
                        Button("Standard preset") { preferences.alertModes = [.sound] }
                        Spacer()
                        Button("Spoken preset") { preferences.alertModes = [.speech] }
                    }
                    .font(.caption)
                    .buttonStyle(.borderless)
                    ForEach(AlertMode.allCases) { mode in
                        Toggle(isOn: Binding(get: { preferences.alertModes.contains(mode) }, set: { enabled in
                            if enabled { preferences.alertModes.append(mode) }
                            else { preferences.alertModes.removeAll { $0 == mode } }
                            preferences.alertModes = AlertMode.allCases.filter { preferences.alertModes.contains($0) }
                        })) {
                            Label(mode.title, systemImage: mode.symbol)
                        }
                    }
                } header: { Text("Your alerts") } footer: {
                    Text("All options are editable. With every channel off, warnings stay visual. Haptics require supported hardware; test your selected channels before scanning.")
                }

                Section {
                    Toggle("Automatic hardware depth", isOn: $preferences.isLidarEnabled)
                        .disabled(model.isBusy || model.cameraRunning || model.cameraStopping || saving)
                    LabeledContent("Capture status", value: model.depthStatus)
                    TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                        LabeledContent("Center-surface test", value: model.centerSurfaceText)
                    }
                    Text("Raw center pixel, not object distance. Requires fresh absolute LiDAR depth.")
                        .font(.caption).foregroundStyle(.secondary)
                } header: { Text("Hardware depth") } footer: {
                    Text("Automatic by default when no choice is saved. Your saved opt-out is preserved. Stop scanning to change hardware depth, then tap Apply. On supported rear cameras, labels show approximate axial depth in meters along the camera's forward axis, not radial distance to an object. Missing, mixed, unreliable, or stale depth is unavailable. Detection continues without LiDAR. Depth does not establish a clear or safe path.")
                }

                Section("Detection preferences") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Confidence threshold · \(Int(preferences.confidenceThreshold * 100))%")
                        Slider(value: $preferences.confidenceThreshold, in: 0.4...0.95, step: 0.05)
                            .accessibilityLabel("Object classification confidence threshold")
                    }
                    Stepper("Repeat after \(preferences.cooldownMs / 1000) seconds", value: $preferences.cooldownMs, in: 1000...10000, step: 1000)
                    Text("Confidence is a classification score, not a distance or safety estimate.")
                        .font(.caption).foregroundStyle(.secondary)
                }

                Section("Camera diagnostics") {
                    LabeledContent("Multitasking API support", value: model.multitaskingSupported.map { $0 ? "Yes" : "No" } ?? "Not queried")
                    LabeledContent("Background camera access", value: model.multitaskingEnabled.map { $0 ? "Enabled" : "Not enabled" } ?? "Not queried")
                    LabeledContent("Picture in Picture", value: model.pip.isSupported ? (model.pip.isActive ? "Active" : "Available") : "Unsupported")
                    Text("Queried from AVCaptureSession after starting the camera. The app requests video-call Picture in Picture with the voip background mode. Where background camera access is unavailable, the floating window shows a paused state instead of a live feed.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.orange) }
                }
            }
            .navigationTitle("Scan settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Applying…" : "Apply") {
                        saving = true
                        errorMessage = nil
                        Task {
                            do {
                                try await model.applyPreferences(preferences)
                                dismiss()
                            } catch { errorMessage = error.localizedDescription }
                            saving = false
                        }
                    }
                    .disabled(saving || model.phase == .connecting || model.cameraStopping)
                }
            }
            .disabled(saving)
        }
        .preferredColorScheme(.dark)
        .tint(.senseTeal)
    }
}
