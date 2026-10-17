import SwiftUI

@main
struct MyEyesApp: App {
    @StateObject private var model = ScanModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ScannerView(model: model)
                .preferredColorScheme(.dark)
                .tint(.senseTeal)
                .onChange(of: scenePhase) { phase in
                    if phase == .background { model.pauseForBackground() }
                }
        }
    }
}

extension Color {
    static let senseTeal = Color(red: 0.29, green: 0.91, blue: 0.79)
    static let senseSurface = Color(red: 0.055, green: 0.075, blue: 0.075)
    static let senseMuted = Color(red: 0.56, green: 0.64, blue: 0.62)
}
