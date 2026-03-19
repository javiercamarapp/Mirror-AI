import SwiftUI

struct AvatarView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedStyle = "realistic"
    @State private var showCustomizer = false
    @State private var showAvatarTryOn = false
    @State private var showPaywall = false
    @State private var isGenerating = false
    @State private var avatarImageUrl: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulseAnimation = false

    private let styles: [(id: String, name: String, icon: String)] = [
        ("realistic", "Realistic", "person.fill"),
        ("anime", "Anime", "sparkles"),
        ("cartoon", "Cartoon", "face.smiling.inverse"),
        ("3d", "3D", "cube.fill"),
        ("sketch", "Sketch", "pencil.and.outline")
    ]

    private var isPremium: Bool {
        appState.subscriptionPlan != "free"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 24) {
                        // Avatar display
                        avatarDisplay

                        // Style selector
                        styleSelector

                        // Action buttons
                        actionButtons
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 40)
                }

                // Locked overlay for free users
                if !isPremium {
                    lockedOverlay
                }

                if isGenerating {
                    LoadingOverlay(message: "Generating your avatar...")
                }
            }
            .navigationTitle("My Avatar")
            .navigationBarTitleDisplayMode(.large)
            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            .sheet(isPresented: $showCustomizer) {
                AvatarCustomizerView()
            }
            .sheet(isPresented: $showAvatarTryOn) {
                AvatarTryOnView()
            }
            .sheet(isPresented: $showPaywall) {
                PaywallView()
            }
        }
    }

    // MARK: - Avatar Display

    private var avatarDisplay: some View {
        ZStack {
            // Animated glow ring
            Circle()
                .fill(
                    RadialGradient(
                        colors: [MirrorTheme.purple.opacity(0.3), Color.clear],
                        center: .center,
                        startRadius: 80,
                        endRadius: 180
                    )
                )
                .frame(width: 360, height: 360)
                .scaleEffect(reduceMotion ? 1.0 : (pulseAnimation ? 1.05 : 0.95))
                .onAppear {
                    guard !reduceMotion else { return }
                    withAnimation(.easeInOut(duration: 3).repeatForever(autoreverses: true)) {
                        pulseAnimation = true
                    }
                }

            RoundedRectangle(cornerRadius: 28)
                .fill(MirrorTheme.surfaceColor)
                .frame(width: 280, height: 340)
                .overlay(
                    RoundedRectangle(cornerRadius: 28)
                        .strokeBorder(
                            LinearGradient(
                                colors: [MirrorTheme.purple.opacity(0.4), MirrorTheme.pink.opacity(0.2)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 2
                        )
                )

            if let avatarUrl = avatarImageUrl ?? appState.currentUser?.avatarUrl, !avatarUrl.isEmpty {
                CachedAsyncImage(url: URL(string: avatarUrl)) {
                    avatarPlaceholder
                }
                .frame(width: 272, height: 332)
                .clipShape(RoundedRectangle(cornerRadius: 24))
            } else {
                avatarPlaceholder
            }

            // Style label
            VStack {
                Spacer()
                HStack {
                    Text(styles.first(where: { $0.id == selectedStyle })?.name ?? "Realistic")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(
                            Capsule()
                                .fill(MirrorTheme.gradientPrimary)
                        )
                    Spacer()
                }
                .padding(16)
            }
            .frame(width: 280, height: 340)
        }
    }

    private var avatarPlaceholder: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.fill")
                .font(.system(size: 64))
                .foregroundStyle(MirrorTheme.gradientPrimary)

            Text("Generate your avatar")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Style Selector

    private var styleSelector: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Avatar Style")
                .font(.system(size: 16, weight: .bold))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(styles, id: \.id) { style in
                        let isSelected = selectedStyle == style.id

                        Button {
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred()
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                                selectedStyle = style.id
                            }
                        } label: {
                            VStack(spacing: 8) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 16)
                                        .fill(isSelected
                                              ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                              : AnyShapeStyle(MirrorTheme.surfaceColor))
                                        .frame(width: 64, height: 64)

                                    Image(systemName: style.icon)
                                        .font(.system(size: 24))
                                        .foregroundStyle(isSelected ? .white : .secondary)
                                }

                                Text(style.name)
                                    .font(.system(size: 12, weight: isSelected ? .bold : .medium))
                                    .foregroundStyle(isSelected ? .primary : .secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 12) {
            Button {
                let impact = UIImpactFeedbackGenerator(style: .heavy)
                impact.impactOccurred()
                if isPremium {
                    Task { await generateAvatar() }
                } else {
                    showPaywall = true
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "wand.and.stars")
                        .font(.system(size: 18))
                    Text("Generate Avatar")
                        .font(.system(size: 17, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(MirrorTheme.gradientPrimary)
                )
            }

            HStack(spacing: 12) {
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    if isPremium {
                        showCustomizer = true
                    } else {
                        showPaywall = true
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 15))
                        Text("Customize")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(MirrorTheme.purple)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.purple.opacity(0.12))
                            .overlay(
                                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                    .strokeBorder(MirrorTheme.purple.opacity(0.25), lineWidth: 1)
                            )
                    )
                }

                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    if isPremium {
                        showAvatarTryOn = true
                    } else {
                        showPaywall = true
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "tshirt.fill")
                            .font(.system(size: 15))
                        Text("Try Outfit")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(MirrorTheme.pink)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.pink.opacity(0.12))
                            .overlay(
                                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                    .strokeBorder(MirrorTheme.pink.opacity(0.25), lineWidth: 1)
                            )
                    )
                }
            }
        }
    }

    // MARK: - Locked Overlay

    private var lockedOverlay: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                ZStack {
                    Circle()
                        .fill(MirrorTheme.purple.opacity(0.1))
                        .frame(width: 100, height: 100)

                    Image(systemName: "lock.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(MirrorTheme.gradientPrimary)
                        .symbolEffect(.pulse, options: .repeating.speed(0.5))
                }

                VStack(spacing: 8) {
                    Text("Premium Feature")
                        .font(.system(size: 22, weight: .bold))

                    Text("Upgrade to create and customize your personal AI avatar")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }

                Button {
                    let impact = UIImpactFeedbackGenerator(style: .medium)
                    impact.impactOccurred()
                    showPaywall = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "crown.fill")
                            .font(.system(size: 16))
                        Text("Upgrade Now")
                            .font(.system(size: 17, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.gradientPrimary)
                    )
                }
                .padding(.horizontal, 40)
            }
        }
    }

    // MARK: - Generate Avatar

    private func generateAvatar() async {
        isGenerating = true
        defer { isGenerating = false }

        // Simulate generation -- in production would call AvatarService
        try? await Task.sleep(nanoseconds: 2_000_000_000)

        let success = UINotificationFeedbackGenerator()
        success.notificationOccurred(.success)
    }
}
