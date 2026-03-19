import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var showDailyOutfit = false
    @State private var showAIChat = false
    @State private var showAddItem = false
    @State private var greetingOffset: CGFloat = 20
    @State private var greetingOpacity: Double = 0

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                // Greeting
                greetingSection
                    .offset(y: greetingOffset)
                    .opacity(greetingOpacity)
                    .onAppear {
                        if reduceMotion {
                            greetingOffset = 0
                            greetingOpacity = 1
                        } else {
                            withAnimation(.easeOut(duration: 0.6)) {
                                greetingOffset = 0
                                greetingOpacity = 1
                            }
                        }
                    }

                // Avatar card
                avatarCard

                // Today's outfit
                todaysOutfitCard

                // Streak card
                streakCard

                // Quick actions
                quickActionsRow

                // Subscription banner
                if appState.subscriptionPlan == "free" {
                    subscriptionBanner
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 100)
        }
        .background(Color(UIColor.systemBackground))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                notificationButton
            }
        }
        .sheet(isPresented: $showDailyOutfit) {
            DailyOutfitView()
        }
        .sheet(isPresented: $showAIChat) {
            AIStylistChatView()
        }
        .sheet(isPresented: $showAddItem) {
            AddItemView()
        }
        .refreshable {
            await refreshData()
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility5)
    }

    // MARK: - Greeting

    private var greetingSection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Hey \(appState.currentUser?.name ?? "there")!")
                    .font(.title)
                    .fontWeight(.bold)
                    .fontDesign(.rounded)
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Text(greetingSubtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)

            Spacer()

            StyleScoreBadge(score: appState.styleScore, tier: appState.styleTier)
        }
    }

    private var greetingSubtitle: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return L10n.homeGreetingMorning
        case 12..<17: return L10n.homeGreetingAfternoon
        case 17..<21: return L10n.homeGreetingEvening
        default: return L10n.homeGreetingNight
        }
    }

    // MARK: - Avatar Card

    private var avatarCard: some View {
        GlassCard {
            ZStack {
                HStack(spacing: 16) {
                    // Avatar image
                    ZStack {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(MirrorTheme.surfaceColor)
                            .frame(width: 80, height: 80)

                        if let avatarUrl = appState.currentUser?.avatarUrl, !avatarUrl.isEmpty {
                            CachedAsyncImage(url: URL(string: avatarUrl)) {
                                Image(systemName: "person.fill")
                                    .font(.system(size: 32))
                                    .foregroundStyle(.tertiary)
                            }
                            .frame(width: 80, height: 80)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .accessibilityHidden(true)
                        } else {
                            Image(systemName: "person.fill")
                                .font(.system(size: 32))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                                .accessibilityHidden(true)
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text(L10n.homeAvatarTitle)
                            .font(.headline)

                        Text(L10n.homeAvatarSubtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 4) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 11))
                                .accessibilityHidden(true)
                            Text(L10n.homeAvatarAIGenerated)
                                .font(.caption2)
                                .fontWeight(.medium)
                        }
                        .foregroundStyle(MirrorTheme.purple)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .padding(4)

                // Locked overlay for free plan
                if appState.subscriptionPlan == "free" {
                    ZStack {
                        RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                            .fill(.ultraThinMaterial)

                        VStack(spacing: 8) {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 24))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                                .accessibilityHidden(true)

                            PremiumBadge()
                        }
                    }
                    .accessibilityLabel(L10n.a11yPremiumBadge)
                    .accessibilityHint("Upgrade to unlock avatar features")
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Today's Outfit

    private var todaysOutfitCard: some View {
        GlassCard {
            VStack(spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L10n.homeTodaysLook)
                            .font(.headline)
                            .accessibilityAddTraits(.isHeader)

                        Text(formattedDate)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    if appState.todaysOutfit != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.green)
                            .accessibilityLabel("Outfit logged for today")
                    }
                }

                if appState.todaysOutfit != nil {
                    // Show today's outfit preview
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(MirrorTheme.surfaceColor)
                            .frame(height: 100)
                            .overlay {
                                if let imageUrl = appState.todaysOutfit?.imageUrl {
                                    CachedAsyncImage(url: URL(string: imageUrl)) {
                                        Image(systemName: "tshirt.fill")
                                            .foregroundStyle(.tertiary)
                                    }
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                                    .accessibilityLabel(L10n.a11yOutfitImage)
                                } else {
                                    Image(systemName: "tshirt.fill")
                                        .font(.system(size: 28))
                                        .foregroundStyle(.tertiary)
                                        .accessibilityHidden(true)
                                }
                            }
                    }

                    Button {
                        showDailyOutfit = true
                    } label: {
                        Text(L10n.homeViewDetails)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundStyle(MirrorTheme.purple)
                    }
                    .accessibilityHint("Opens your daily outfit details")
                } else {
                    Button {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                        impactFeedback.impactOccurred()
                        showDailyOutfit = true
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "wand.and.stars")
                                .font(.system(size: 18))
                                .accessibilityHidden(true)

                            Text(L10n.homeGenerateLook)
                                .font(.callout)
                                .fontWeight(.bold)
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(MirrorTheme.gradientPrimary)
                        )
                    }
                    .accessibilityLabel(L10n.homeGenerateLook)
                    .accessibilityHint("Uses AI to suggest an outfit from your wardrobe")
                }
            }
        }
    }

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d"
        return formatter.string(from: Date())
    }

    // MARK: - Streak Card

    private var streakCard: some View {
        GlassCard {
            HStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(Color.orange.opacity(0.15))
                        .frame(width: 56, height: 56)

                    Image(systemName: "flame.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(.orange)
                        .symbolEffect(.bounce, options: .repeating.speed(0.3))
                }
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("\(appState.streakCount)")
                            .font(.title)
                            .fontWeight(.bold)
                            .fontDesign(.rounded)
                            .foregroundStyle(MirrorTheme.gradientPrimary)

                        Text(L10n.homeDayStreak)
                            .font(.callout)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)
                    }

                    Text(L10n.homeKeepLogging)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                VStack(spacing: 2) {
                    Text(L10n.homeBest)
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    Text("\(appState.longestStreak)")
                        .font(.title3)
                        .fontWeight(.bold)
                        .fontDesign(.rounded)
                        .foregroundStyle(.orange)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.streakFlame(appState.streakCount))
    }

    // MARK: - Quick Actions

    private var quickActionsRow: some View {
        HStack(spacing: 12) {
            quickAction(icon: "plus.circle.fill", label: L10n.homeAddClothes, color: MirrorTheme.purple) {
                showAddItem = true
            }

            quickAction(icon: "person.fill.viewfinder", label: L10n.homeTryOn, color: MirrorTheme.pink) {
                // Navigate to try-on
            }

            quickAction(icon: "bubble.left.and.bubble.right.fill", label: L10n.homeAIChat, color: MirrorTheme.indigo) {
                showAIChat = true
            }
        }
    }

    private func quickAction(icon: String, label: String, color: Color, action: @escaping () -> Void) -> some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            action()
        } label: {
            VStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(color.opacity(0.12))
                        .frame(width: 52, height: 52)

                    Image(systemName: icon)
                        .font(.system(size: 24))
                        .foregroundStyle(color)
                }
                .accessibilityHidden(true)

                Text(label)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                            .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                    )
            )
        }
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Subscription Banner

    private var subscriptionBanner: some View {
        Button {
            // Show subscription view
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "crown.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(.yellow)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(L10n.homeUnlockPotential)
                        .font(.callout)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)

                    Text(L10n.homeUnlockSubtitle)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.85))
                }

                Spacer()

                Text(L10n.homePro)
                    .font(.caption)
                    .fontWeight(.black)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        Capsule()
                            .fill(.yellow)
                    )
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                    .fill(MirrorTheme.gradientPrimary)
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.homeUnlockPotential)
        .accessibilityHint("Opens subscription plans")
    }

    // MARK: - Notification Button

    private var notificationButton: some View {
        Button {
            // Show notifications
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(.primary)

                if appState.unreadNotificationCount > 0 {
                    Text("\(appState.unreadNotificationCount)")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(3)
                        .background(Circle().fill(.red))
                        .offset(x: 6, y: -4)
                        .accessibilityHidden(true)
                }
            }
        }
        .accessibilityLabel(L10n.a11yNotificationBell)
        .accessibilityValue(appState.unreadNotificationCount > 0 ? L10n.notificationCount(appState.unreadNotificationCount) : "No unread notifications")
    }

    // MARK: - Refresh

    private func refreshData() async {
        async let streak: () = appState.loadStreak()
        async let wardrobe: () = appState.loadWardrobe()
        async let notifications: () = appState.loadNotifications()
        _ = await (streak, wardrobe, notifications)
    }
}
