import SwiftUI
import os

@main
struct MirrorAIApp: App {
    @State private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ZStack(alignment: .top) {
                ContentView()
                    .environment(appState)

                OfflineBanner()
            }
            .preferredColorScheme(.dark)
            .tint(Color("AccentPurple"))
            .onOpenURL { url in
                handleDeepLink(url)
            }
            .onChange(of: scenePhase) { _, newPhase in
                    switch newPhase {
                    case .active:
                        Task {
                            if appState.authToken != nil {
                                await appState.refreshTokenIfNeeded()
                            }
                        }
                    case .background:
                        appState.saveState()
                    default:
                        break
                    }
                }
        }
    }

    // MARK: - Deep Link Handling

    private func handleDeepLink(_ url: URL) {
        // Handle magic link callbacks for email auth
        if url.scheme == "mirrorai" {
            if url.host == "auth" || url.host == "callback" {
                // Extract code from URL query params
                if let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                   let code = components.queryItems?.first(where: { $0.name == "code" })?.value {
                    Task {
                        await handleAuthCallback(code: code)
                    }
                }
            }
        }
    }

    private func handleAuthCallback(code: String) async {
        do {
            guard let url = URL(string: APIConfig.baseURL + "/api/auth/callback") else { return }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])

            let (data, response) = try await URLSession.pinned().data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else { return }

            struct CallbackResponse: Decodable {
                let accessToken: String
                let refreshToken: String
                enum CodingKeys: String, CodingKey {
                    case accessToken = "access_token"
                    case refreshToken = "refresh_token"
                }
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let apiResponse = try decoder.decode(APIResponse<CallbackResponse>.self, from: data)

            if let authData = apiResponse.data {
                _ = KeychainManager.save(authData.refreshToken, forKey: "mirror_ai_refresh_token")
                await appState.setAuthToken(authData.accessToken)
            }
        } catch {
            Logger(subsystem: "com.mirrorai", category: "MirrorAIApp").error("Auth callback failed: \(error.localizedDescription)")
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
    static let borderColor = Color.white.opacity(0.4)
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
