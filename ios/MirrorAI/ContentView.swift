import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var animateTransition = false

    var body: some View {
        ZStack {
            if !appState.isLoggedIn {
                AuthView()
                    .transition(reduceMotion ? .opacity : .asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 1.05)),
                        removal: .opacity.combined(with: .scale(scale: 0.95))
                    ))
            } else if !appState.isOnboardingComplete {
                OnboardingView()
                    .transition(reduceMotion ? .opacity : .asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            } else {
                MainTabView()
                    .transition(reduceMotion ? .opacity : .asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.95)),
                        removal: .opacity
                    ))
            }
        }
        .animation(reduceMotion ? .none : .smooth(duration: 0.5), value: appState.isLoggedIn)
        .animation(reduceMotion ? .none : .smooth(duration: 0.5), value: appState.isOnboardingComplete)
        .task {
            await appState.initialize()
        }
        .overlay {
            if appState.isLoading && !appState.isLoggedIn {
                LoadingOverlay(message: L10n.loadingStyle)
            }
        }
        .alert(L10n.loadingOops, isPresented: .init(
            get: { appState.errorMessage != nil },
            set: { if !$0 { appState.errorMessage = nil } }
        )) {
            Button(L10n.ok) { appState.errorMessage = nil }
        } message: {
            Text(appState.errorMessage ?? "")
        }
    }
}
