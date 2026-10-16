import AVFoundation
import SwiftUI

@main
struct StepSenseApp: App {
    @StateObject private var model = ScanModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Video-call Picture in Picture requires an audio session that permits background
        // playback. The same session is reused for beeps and spoken alerts.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    var body: some Scene {
        WindowGroup {
            ScannerView(model: model)
                .preferredColorScheme(.dark)
                .tint(.senseTeal)
                .onChange(of: scenePhase) { phase in
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
