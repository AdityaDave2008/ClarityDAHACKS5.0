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
    // Web identity tokens. Keep the shared proximity band colors independent.
    static let senseBackground = Color(red: 16 / 255, green: 24 / 255, blue: 32 / 255)
    static let senseTeal = Color(red: 243 / 255, green: 139 / 255, blue: 104 / 255)
    static let senseSurface = Color(red: 28 / 255, green: 42 / 255, blue: 53 / 255)
    static let senseSurfaceBottom = Color(red: 22 / 255, green: 34 / 255, blue: 44 / 255)
    static let senseMuted = Color(red: 169 / 255, green: 181 / 255, blue: 191 / 255)
    static let senseNavigation = Color(red: 18 / 255, green: 29 / 255, blue: 39 / 255)
}
