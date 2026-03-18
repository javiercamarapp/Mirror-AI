import SwiftUI
import AuthenticationServices

struct AuthView: View {
    @Environment(AppState.self) private var appState
    @State private var isAnimating = false
    @State private var showPrivacyPolicy = false

    var body: some View {
        ZStack {
            // Animated background
            AnimatedGradient()
                .ignoresSafeArea()

            // Dark overlay for readability
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo area
                logoSection
                    .opacity(isAnimating ? 1 : 0)
                    .offset(y: isAnimating ? 0 : 30)

                Spacer()

                // Auth buttons
                authButtons
                    .opacity(isAnimating ? 1 : 0)
                    .offset(y: isAnimating ? 0 : 40)

                // Privacy
                privacySection
                    .opacity(isAnimating ? 1 : 0)
                    .padding(.bottom, 16)
            }
            .padding(.horizontal, 32)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.0).delay(0.3)) {
                isAnimating = true
            }
        }
        .sheet(isPresented: $showPrivacyPolicy) {
            privacyPolicySheet
        }
    }

    // MARK: - Logo Section

    private var logoSection: some View {
        VStack(spacing: 16) {
            // Mirror icon
            ZStack {
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: 100, height: 100)

                Image(systemName: "sparkles")
                    .font(.system(size: 44))
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .symbolEffect(.pulse, options: .repeating)
            }

            // App name
            Text("Mirror AI")
                .font(.system(size: 42, weight: .bold, design: .rounded))
                .foregroundStyle(MirrorTheme.gradientPrimary)

            Text("Your AI Fashion Companion")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.white.opacity(0.7))

            // Feature highlights
            VStack(spacing: 12) {
                featureRow(icon: "wand.and.stars", text: "AI-Powered Styling")
                featureRow(icon: "person.fill.viewfinder", text: "Virtual Try-On")
                featureRow(icon: "chart.line.uptrend.xyaxis", text: "Track Your Style Score")
            }
            .padding(.top, 24)
        }
    }

    private func featureRow(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(MirrorTheme.pink)
                .frame(width: 24)

            Text(text)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))

            Spacer()
        }
        .padding(.horizontal, 8)
    }

    // MARK: - Auth Buttons

    private var authButtons: some View {
        VStack(spacing: 14) {
            // Sign in with Apple
            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = [.fullName, .email]
            } onCompletion: { result in
                handleAppleSignIn(result)
            }
            .signInWithAppleButtonStyle(.white)
            .frame(height: 54)
            .clipShape(RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius))

            // Continue with Google
            Button {
                handleGoogleSignIn()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "g.circle.fill")
                        .font(.system(size: 20))

                    Text("Continue with Google")
                        .font(.system(size: 17, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(Color.white.opacity(0.15))
                        .overlay(
                            RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                .strokeBorder(Color.white.opacity(0.25), lineWidth: 1)
                        )
                )
            }

            // Continue with Email (fallback)
            Button {
                handleEmailSignIn()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "envelope.fill")
                        .font(.system(size: 18))

                    Text("Continue with Email")
                        .font(.system(size: 17, weight: .semibold))
                }
                .foregroundStyle(.white.opacity(0.9))
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(Color.white.opacity(0.08))
                        .overlay(
                            RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
                        )
                )
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: - Privacy Section

    private var privacySection: some View {
        VStack(spacing: 8) {
            Text("By continuing, you agree to our")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.5))

            HStack(spacing: 4) {
                Button("Terms of Service") {
                    showPrivacyPolicy = true
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(MirrorTheme.purple)

                Text("and")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.5))

                Button("Privacy Policy") {
                    showPrivacyPolicy = true
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(MirrorTheme.purple)
            }
        }
    }

    private var privacyPolicySheet: some View {
        NavigationStack {
            ScrollView {
                Text("Privacy Policy content goes here.")
                    .padding()
            }
            .navigationTitle("Privacy Policy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { showPrivacyPolicy = false }
                }
            }
        }
    }

    // MARK: - Auth Handlers

    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let identityToken = appleIDCredential.identityToken,
                  let tokenString = String(data: identityToken, encoding: .utf8) else {
                return
            }

            Task {
                await appState.setAuthToken(tokenString)
            }

        case .failure(let error):
            print("[AuthView] Apple Sign In failed: \(error.localizedDescription)")
        }
    }

    private func handleGoogleSignIn() {
        // Google Sign-In integration placeholder
        // In production, use GoogleSignIn SDK
        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
        impactFeedback.impactOccurred()
    }

    private func handleEmailSignIn() {
        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
        impactFeedback.impactOccurred()
    }
}
