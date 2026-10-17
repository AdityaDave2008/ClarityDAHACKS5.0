import AVFoundation
import SwiftUI

@main
struct MyEyesApp: App {
    @StateObject private var model = ScanModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        PiPDiagnostics.log("app.launch", "backgroundModes=\(Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") ?? [])")
        // Video-call Picture in Picture requires an audio session that permits background
        // playback. The same session is reused for beeps and spoken alerts.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            PiPDiagnostics.log("audio.category.success")
        } catch { PiPDiagnostics.error("audio.category.failure", error) }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            PiPDiagnostics.log("audio.activate.success")
        } catch { PiPDiagnostics.error("audio.activate.failure", error) }
    }

    var body: some Scene {
        WindowGroup {
            ScannerView(model: model)
                .task { await NotificationService.shared.refresh() }
                .preferredColorScheme(.dark)
                .tint(.senseTeal)
                .onChange(of: scenePhase) { phase in
                    PiPDiagnostics.log("scene.phase", "value=\(phase)")
                    switch phase {
                    case .background: model.pauseForBackground()
                    case .active: model.returnedToForeground()
                    default: break
                    }
                }
        }
    }
}

extension Color {
    static let senseTeal = Color(red: 0.29, green: 0.91, blue: 0.79)
    static let senseSurface = Color(red: 0.055, green: 0.075, blue: 0.075)
    static let senseMuted = Color(red: 0.56, green: 0.64, blue: 0.62)
}
