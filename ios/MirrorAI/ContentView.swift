import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState

    @State private var animateTransition = false

    var body: some View {
        ZStack {
            if !appState.isLoggedIn {
                AuthView()
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 1.05)),
                        removal: .opacity.combined(with: .scale(scale: 0.95))
                    ))
            } else if !appState.isOnboardingComplete {
                OnboardingView()
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            } else {
                MainTabView()
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.95)),
                        removal: .opacity
                    ))
            }
        }
        .animation(.smooth(duration: 0.5), value: appState.isLoggedIn)
        .animation(.smooth(duration: 0.5), value: appState.isOnboardingComplete)
        .task {
            await appState.initialize()
        }
        .overlay {
            if appState.isLoading && !appState.isLoggedIn {
                LoadingOverlay(message: "Loading your style...")
            }
        }
        .alert("Oops", isPresented: .init(
            get: { appState.errorMessage != nil },
            set: { if !$0 { appState.errorMessage = nil } }
        )) {
            Button("OK") { appState.errorMessage = nil }
        } message: {
            Text(appState.errorMessage ?? "")
        }
    }
}
