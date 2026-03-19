import SwiftUI
import AuthenticationServices
import os

struct AuthView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isAnimating = false
    @State private var showPrivacyPolicy = false
    @State private var showTermsOfService = false
    @State private var showEmailAuth = false
    @State private var emailInput = ""
    @State private var emailAuthSent = false

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
            if reduceMotion {
                isAnimating = true
            } else {
                withAnimation(.easeOut(duration: 1.0).delay(0.3)) {
                    isAnimating = true
                }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .sheet(isPresented: $showPrivacyPolicy) {
            privacyPolicySheet
        }
        .sheet(isPresented: $showTermsOfService) {
            termsOfServiceSheet
        }
        .sheet(isPresented: $showEmailAuth) {
            emailAuthSheet
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
            Text(L10n.authAppName)
                .font(.largeTitle)
                .fontWeight(.bold)
                .fontDesign(.rounded)
                .foregroundStyle(MirrorTheme.gradientPrimary)
                .minimumScaleFactor(0.7)
                .accessibilityAddTraits(.isHeader)

            Text(L10n.authTagline)
                .font(.body)
                .fontWeight(.medium)
                .foregroundStyle(.white.opacity(0.7))

            // Feature highlights
            VStack(spacing: 12) {
                featureRow(icon: "wand.and.stars", text: L10n.authFeatureStyling)
                featureRow(icon: "person.fill.viewfinder", text: L10n.authFeatureTryOn)
                featureRow(icon: "chart.line.uptrend.xyaxis", text: L10n.authFeatureScore)
            }
            .padding(.top, 24)
        }
    }

    private func featureRow(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(MirrorTheme.pink)
                .frame(width: 24)
                .accessibilityHidden(true)

            Text(text)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.white.opacity(0.85))

            Spacer()
        }
        .padding(.horizontal, 8)
        .accessibilityElement(children: .combine)
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

                    Text(L10n.authContinueGoogle)
                        .font(.body)
                        .fontWeight(.semibold)
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

                    Text(L10n.authContinueEmail)
                        .font(.body)
                        .fontWeight(.semibold)
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
            Text(L10n.authTermsPrefix)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.5))

            HStack(spacing: 4) {
                Button(L10n.authTermsOfService) {
                    showTermsOfService = true
                }
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(MirrorTheme.purple)

                Text(L10n.authAnd)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))

                Button(L10n.authPrivacyPolicy) {
                    showPrivacyPolicy = true
                }
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(MirrorTheme.purple)
            }
        }
    }

    private var privacyPolicySheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Group {
                        Text("Last Updated: March 2026")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)

                        Text("Mirror AI (\"we\", \"our\", or \"us\") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application.")

                        sectionHeader("1. Information We Collect")
                        Text("""
                        We collect the following types of information:

                        - Camera & Photos: We access your device camera and photo library to enable virtual try-on features, selfie-based color analysis, outfit photography, and wardrobe cataloging. Images may be processed by our AI systems to provide styling recommendations.

                        - Personal Information: When you create an account, we collect your name, email address, and authentication credentials. If you sign in via Apple or Google, we receive the information you authorize those services to share.

                        - Style Preferences: We collect information about your fashion preferences, body measurements (height, body shape), gender identity, and style selections to personalize your experience.

                        - Usage Data: We collect information about how you interact with the app, including features used, content viewed, and actions taken within the social feed.
                        """)

                        sectionHeader("2. How We Use Your Information")
                        Text("""
                        We use the information we collect to:

                        - Provide AI-powered styling recommendations and virtual try-on experiences.
                        - Enable social features including posting outfits, commenting, liking, and following other users.
                        - Personalize your experience based on your style preferences, body information, and usage patterns.
                        - Generate AI avatars and style analysis reports.
                        - Improve our AI models and app functionality.
                        - Communicate with you about your account, updates, and promotions (with your consent).
                        """)
                    }

                    Group {
                        sectionHeader("3. Third-Party Services")
                        Text("""
                        We use the following third-party services:

                        - Google OAuth: For account authentication. Google's privacy policy applies to data processed by Google during sign-in. See: https://policies.google.com/privacy

                        - Supabase: For secure cloud storage of your account data, wardrobe images, and app content. Data is stored in encrypted databases with row-level security. See: https://supabase.com/privacy

                        - Apple Sign-In: For account authentication via Apple ID. Apple's privacy policy governs data shared during sign-in.

                        - StoreKit / Apple In-App Purchases: For subscription management. Payment information is handled entirely by Apple and is never shared with us.

                        We do not sell your personal information to third parties.
                        """)

                        sectionHeader("4. Your Rights")
                        Text("""
                        You have the right to:

                        - Access: Request a copy of the personal data we hold about you.
                        - Correction: Request correction of inaccurate personal data.
                        - Deletion: Request deletion of your account and all associated data through the app's Settings > Delete Account feature.
                        - Data Portability: Request your data in a structured, machine-readable format.
                        - Withdraw Consent: Withdraw consent for optional data processing at any time.

                        To exercise these rights, contact us at privacy@mirrorai.app.
                        """)

                        sectionHeader("5. Data Retention & Security")
                        Text("""
                        We retain your personal data for as long as your account is active or as needed to provide services. When you delete your account, we permanently remove your personal data within 30 days, except where retention is required by law.

                        We implement industry-standard security measures including encryption in transit (TLS) and at rest, access controls, and regular security audits to protect your data.
                        """)

                        sectionHeader("6. Children's Privacy (COPPA Compliance)")
                        Text("""
                        Mirror AI is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal data from a child under 13 without parental consent, we will take steps to delete that information immediately.

                        Users between 13 and 17 years of age may use the app with parental or guardian consent.
                        """)

                        sectionHeader("7. Contact Us")
                        Text("""
                        If you have questions or concerns about this Privacy Policy or our data practices, please contact us at:

                        Email: privacy@mirrorai.app
                        """)
                    }
                }
                .font(.system(size: 14))
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

    private var termsOfServiceSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Group {
                        Text("Last Updated: March 2026")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)

                        sectionHeader("1. Acceptance of Terms")
                        Text("""
                        By accessing or using Mirror AI, you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the app. We reserve the right to update these terms at any time, and your continued use constitutes acceptance of any changes.
                        """)

                        sectionHeader("2. Subscription Terms")
                        Text("""
                        - Mirror AI offers auto-renewing subscription plans (Pro and Premium) billed monthly through your Apple ID.
                        - Payment will be charged to your iTunes Account at confirmation of purchase.
                        - Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current billing period.
                        - Your account will be charged for renewal within 24 hours prior to the end of the current period at the rate of the selected plan.
                        - To cancel your subscription: Open Settings on your device > Tap your Apple ID > Tap Subscriptions > Select Mirror AI > Tap Cancel Subscription.
                        - You may manage your subscriptions and turn off auto-renewal in your Apple ID Account Settings after purchase.
                        - No refunds will be provided for the unused portion of any subscription period, in accordance with Apple's refund policies.
                        """)

                        sectionHeader("3. User Content & Conduct")
                        Text("""
                        You retain ownership of content you post on Mirror AI. By posting content, you grant us a non-exclusive, worldwide, royalty-free license to use, display, and distribute your content within the app's social features.

                        You agree not to:
                        - Post content that is illegal, harmful, threatening, abusive, harassing, defamatory, vulgar, obscene, or sexually explicit.
                        - Impersonate any person or entity or misrepresent your affiliation.
                        - Upload malicious code, spam, or unauthorized advertising.
                        - Harass, bully, or intimidate other users.
                        - Use the app for any unlawful purpose.
                        - Attempt to reverse-engineer the app or its AI models.

                        We reserve the right to remove content and suspend accounts that violate these rules.
                        """)
                    }

                    Group {
                        sectionHeader("4. Intellectual Property")
                        Text("""
                        Mirror AI, including its AI models, algorithms, design, graphics, and software, is owned by Mirror AI and protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works from any part of the app without our written consent.

                        AI-generated content (styling recommendations, avatars, analyses) is provided for personal use only and may not be used commercially without permission.
                        """)

                        sectionHeader("5. Limitation of Liability")
                        Text("""
                        Mirror AI is provided on an "as is" and "as available" basis. To the fullest extent permitted by law:

                        - We disclaim all warranties, express or implied, including fitness for a particular purpose.
                        - We are not liable for any indirect, incidental, special, consequential, or punitive damages.
                        - Our total liability shall not exceed the amount you paid for the app in the 12 months preceding the claim.
                        - AI-generated styling recommendations are for informational purposes only and do not constitute professional fashion advice.
                        """)

                        sectionHeader("6. Account Termination")
                        Text("""
                        We may suspend or terminate your account at our discretion if you violate these terms, engage in abusive behavior, or for any reason with reasonable notice. You may delete your account at any time through Settings > Delete Account.

                        Upon termination, your right to use the app ceases immediately. Data deletion follows our Privacy Policy retention schedule.
                        """)

                        sectionHeader("7. Governing Law")
                        Text("""
                        These Terms shall be governed by and construed in accordance with the laws of the State of California, United States, without regard to its conflict of law provisions. Any disputes arising from these terms shall be resolved in the courts of San Francisco County, California.
                        """)

                        sectionHeader("8. Contact")
                        Text("""
                        For questions about these Terms of Service, contact us at:

                        Email: privacy@mirrorai.app
                        """)
                    }
                }
                .font(.system(size: 14))
                .padding()
            }
            .navigationTitle("Terms of Service")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { showTermsOfService = false }
                }
            }
        }
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 16, weight: .bold))
            .padding(.top, 4)
    }

    // MARK: - Auth Handlers

    private var emailAuthSheet: some View {
        NavigationStack {
            VStack(spacing: 24) {
                if emailAuthSent {
                    // Confirmation state
                    VStack(spacing: 16) {
                        Image(systemName: "envelope.badge.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(MirrorTheme.gradientPrimary)

                        Text("Check Your Email")
                            .font(.system(size: 22, weight: .bold))

                        Text("We sent a magic link to **\(emailInput)**. Tap the link in the email to sign in.")
                            .font(.system(size: 15))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                    .padding(.top, 40)
                } else {
                    // Email input state
                    VStack(spacing: 16) {
                        Image(systemName: "envelope.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(MirrorTheme.gradientPrimary)

                        Text("Sign in with Email")
                            .font(.system(size: 22, weight: .bold))

                        Text("We'll send you a magic link to sign in — no password needed.")
                            .font(.system(size: 15))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                    .padding(.top, 40)

                    TextField("your@email.com", text: $emailInput)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .font(.system(size: 17))
                        .padding(16)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color(UIColor.secondarySystemBackground))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14)
                                        .strokeBorder(Color(UIColor.separator), lineWidth: 1)
                                )
                        )
                        .padding(.horizontal, 24)

                    Button {
                        Task {
                            await appState.signInWithEmail(email: emailInput)
                            emailAuthSent = true
                        }
                    } label: {
                        Text("Send Magic Link")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                            .background(
                                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                    .fill(
                                        emailInput.contains("@")
                                            ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                            : AnyShapeStyle(Color.gray.opacity(0.3))
                                    )
                            )
                    }
                    .disabled(!emailInput.contains("@") || appState.isLoading)
                    .padding(.horizontal, 24)
                }

                Spacer()
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        showEmailAuth = false
                        emailAuthSent = false
                        emailInput = ""
                    }
                }
            }
        }
    }

    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let identityToken = appleIDCredential.identityToken,
                  let tokenString = String(data: identityToken, encoding: .utf8) else {
                return
            }

            // Capture full name (Apple only sends it on first sign-in)
            var fullName: String? = nil
            if let nameComponents = appleIDCredential.fullName {
                let given = nameComponents.givenName ?? ""
                let family = nameComponents.familyName ?? ""
                let name = "\(given) \(family)".trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { fullName = name }
            }

            Task {
                await appState.signInWithApple(idToken: tokenString, fullName: fullName)
            }

        case .failure(let error):
            Logger(subsystem: "com.mirrorai", category: "AuthView").error("Apple Sign In failed: \(error.localizedDescription)")
        }
    }

    private func handleGoogleSignIn() {
        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
        impactFeedback.impactOccurred()
        // Google Sign-In requires GoogleSignIn SDK - will be enabled in a future update
        appState.errorMessage = "Google Sign-In will be available in a future update. Please use Apple Sign-In or Email."
    }

    private func handleEmailSignIn() {
        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
        impactFeedback.impactOccurred()
        showEmailAuth = true
    }
}
