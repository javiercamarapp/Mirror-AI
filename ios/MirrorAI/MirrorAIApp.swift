import SwiftUI

@main
struct MirrorAIApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .preferredColorScheme(.dark)
                .tint(Color("AccentPurple"))
        }
    }
}

// MARK: - Theme Constants

enum MirrorTheme {
    static let gradientPrimary = LinearGradient(
        colors: [Color(hex: "8B5CF6"), Color(hex: "EC4899")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let gradientSecondary = LinearGradient(
        colors: [Color(hex: "6366F1"), Color(hex: "8B5CF6")],
        startPoint: .leading,
        endPoint: .trailing
    )

    static let gradientGold = LinearGradient(
        colors: [Color(hex: "F59E0B"), Color(hex: "EF4444")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let surfaceColor = Color.white.opacity(0.06)
    static let borderColor = Color.white.opacity(0.12)
    static let cardRadius: CGFloat = 20
    static let buttonRadius: CGFloat = 16

    static let purple = Color(hex: "8B5CF6")
    static let pink = Color(hex: "EC4899")
    static let indigo = Color(hex: "6366F1")
}

// MARK: - Color Hex Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = ((int >> 24) & 0xFF, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
