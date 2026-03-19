import SwiftUI

struct ProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var showEditProfile = false
    @State private var showSettings = false
    @State private var showFriends = false
    @State private var showNotifications = false
    @State private var showSubscription = false
    @State private var headerScale: CGFloat = 0.92
    @State private var headerOpacity: Double = 0

    private var subscriptionLabel: String {
        switch appState.subscriptionPlan {
        case "basic": return "Pro"
        case "premium": return "Premium"
        default: return "Free"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    // Profile header
                    profileHeader
                        .scaleEffect(headerScale)
                        .opacity(headerOpacity)
                        .onAppear {
                            if reduceMotion {
                                headerScale = 1.0
                                headerOpacity = 1.0
                            } else {
                                withAnimation(.spring(response: 0.6, dampingFraction: 0.75)) {
                                    headerScale = 1.0
                                    headerOpacity = 1.0
                                }
                            }
                        }

                    // Stats
                    statsGrid

                    // Style tier & subscription
                    tierAndSubCard

                    // Quick links
                    quickLinks

                    // Posts grid
                    postsGrid
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 100)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle(L10n.profileTitle)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showNotifications = true
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "bell.fill")
                                .font(.system(size: 17))

                            if appState.unreadNotificationCount > 0 {
                                Text("\(appState.unreadNotificationCount)")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(3)
                                    .background(Circle().fill(.red))
                                    .offset(x: 8, y: -6)
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                    .accessibilityLabel(L10n.a11yNotificationBell)
                    .accessibilityValue(appState.unreadNotificationCount > 0 ? L10n.notificationCount(appState.unreadNotificationCount) : "No unread notifications")
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 17))
                    }
                    .accessibilityLabel(L10n.settingsTitle)
                }
            }
            .sheet(isPresented: $showEditProfile) {
                EditProfileView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .sheet(isPresented: $showFriends) {
                FriendsListView()
            }
            .sheet(isPresented: $showNotifications) {
                NotificationsView()
            }
            .sheet(isPresented: $showSubscription) {
                SubscriptionView()
            }
            .refreshable {
                await appState.loadProfile()
                await appState.loadNotifications()
            }
            .dynamicTypeSize(...DynamicTypeSize.accessibility5)
        }
    }

    // MARK: - Profile Header

    private var profileHeader: some View {
        VStack(spacing: 16) {
            // Avatar with gradient ring
            ZStack {
                Circle()
                    .fill(MirrorTheme.gradientPrimary)
                    .frame(width: 108, height: 108)

                Circle()
                    .fill(Color(UIColor.systemBackground))
                    .frame(width: 102, height: 102)

                if let avatarUrl = appState.currentUser?.avatarUrl, !avatarUrl.isEmpty {
                    CachedAsyncImage(url: URL(string: avatarUrl)) {
                        Image(systemName: "person.fill")
                            .font(.system(size: 36))
                            .foregroundStyle(.tertiary)
                    }
                    .frame(width: 96, height: 96)
                    .clipShape(Circle())
                    .accessibilityLabel(L10n.userAvatar(appState.currentUser?.name ?? "User"))
                } else {
                    Image(systemName: "person.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(MirrorTheme.gradientPrimary)
                        .accessibilityHidden(true)
                }

                // Edit button overlay
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    showEditProfile = true
                } label: {
                    Image(systemName: "pencil.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(MirrorTheme.purple)
                        .background(Circle().fill(Color(UIColor.systemBackground)).frame(width: 24, height: 24))
                }
                .offset(x: 38, y: 38)
                .accessibilityLabel(L10n.a11yEditProfile)
                .accessibilityHint("Opens profile editor")
            }

            VStack(spacing: 4) {
                Text(appState.currentUser?.name ?? L10n.profileYourPosts)
                    .font(.title2)
                    .fontWeight(.bold)

                if let email = appState.currentUser?.email {
                    Text(email)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Stats Grid

    private var statsGrid: some View {
        HStack(spacing: 12) {
            statCard(value: "\(appState.wardrobeItems.count)", label: L10n.tabWardrobe, icon: "tshirt.fill", color: MirrorTheme.purple)
            statCard(value: "\(appState.savedOutfits.count)", label: "Outfits", icon: "rectangle.stack.fill", color: MirrorTheme.pink)
            statCard(value: "\(appState.streakCount)", label: "Streak", icon: "flame.fill", color: .orange)
            statCard(value: String(format: "%.0f", appState.styleScore), label: "Score", icon: "sparkles", color: MirrorTheme.indigo)
        }
    }

    private func statCard(value: String, label: String, icon: String, color: Color) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(color)
                .accessibilityHidden(true)

            Text(value)
                .font(.title3)
                .fontWeight(.bold)
                .fontDesign(.rounded)

            Text(label)
                .font(.caption2)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }

    // MARK: - Tier & Subscription

    private var tierAndSubCard: some View {
        GlassCard {
            HStack(spacing: 16) {
                StyleScoreBadge(score: appState.styleScore, tier: appState.styleTier)

                Spacer()

                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    showSubscription = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: appState.subscriptionPlan == "free" ? "crown" : "crown.fill")
                            .font(.system(size: 13))
                            .accessibilityHidden(true)
                        Text(subscriptionLabel)
                            .font(.caption)
                            .fontWeight(.bold)
                    }
                    .foregroundStyle(appState.subscriptionPlan == "free" ? .secondary : Color(hex: "FFD700"))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(
                        Capsule()
                            .fill(appState.subscriptionPlan == "free"
                                  ? MirrorTheme.surfaceColor
                                  : Color(hex: "FFD700").opacity(0.15))
                            .overlay(
                                Capsule()
                                    .strokeBorder(
                                        appState.subscriptionPlan == "free"
                                            ? MirrorTheme.borderColor
                                            : Color(hex: "FFD700").opacity(0.3),
                                        lineWidth: 1
                                    )
                            )
                    )
                }
                .accessibilityLabel("Subscription: \(subscriptionLabel)")
                .accessibilityHint("Opens subscription management")
            }
        }
    }

    // MARK: - Quick Links

    private var quickLinks: some View {
        HStack(spacing: 12) {
            quickLinkButton(icon: "person.2.fill", label: L10n.profileFriends, color: MirrorTheme.purple) {
                showFriends = true
            }

            quickLinkButton(icon: "bell.fill", label: L10n.profileNotifications, color: MirrorTheme.pink, badge: appState.unreadNotificationCount) {
                showNotifications = true
            }
        }
    }

    private func quickLinkButton(icon: String, label: String, color: Color, badge: Int = 0, action: @escaping () -> Void) -> some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            action()
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(color.opacity(0.12))
                        .frame(width: 36, height: 36)

                    Image(systemName: icon)
                        .font(.system(size: 15))
                        .foregroundStyle(color)
                }
                .accessibilityHidden(true)

                Text(label)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)

                Spacer()

                if badge > 0 {
                    Text("\(badge)")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(.red))
                        .accessibilityLabel("\(badge) unread")
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                    )
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Posts Grid

    private var postsGrid: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L10n.profileYourPosts)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)

            if appState.feedPosts.filter({ $0.userId == appState.currentUser?.id }).isEmpty {
                GlassCard {
                    VStack(spacing: 12) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)

                        Text(L10n.profileNoPosts)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Text(L10n.profileShareOutfits)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                }
            } else {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 4),
                        GridItem(.flexible(), spacing: 4),
                        GridItem(.flexible(), spacing: 4)
                    ],
                    spacing: 4
                ) {
                    ForEach(appState.feedPosts.filter { $0.userId == appState.currentUser?.id }) { post in
                        ZStack {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(MirrorTheme.surfaceColor)
                                .aspectRatio(1, contentMode: .fit)

                            if let imageUrl = post.imageUrl {
                                CachedAsyncImage(url: URL(string: imageUrl)) {
                                    Color.clear
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                        }
                        .accessibilityLabel(L10n.a11yPostImage)
                        .accessibilityAddTraits(.isImage)
                    }
                }
            }
        }
    }
}
