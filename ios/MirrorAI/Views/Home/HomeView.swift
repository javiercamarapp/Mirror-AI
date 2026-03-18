import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var appState

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
                        withAnimation(.easeOut(duration: 0.6)) {
                            greetingOffset = 0
                            greetingOpacity = 1
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
    }

    // MARK: - Greeting

    private var greetingSection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Hey \(appState.currentUser?.name ?? "there")!")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(MirrorTheme.gradientPrimary)

                Text(greetingSubtitle)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            StyleScoreBadge(score: appState.styleScore, tier: appState.styleTier)
        }
    }

    private var greetingSubtitle: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return "Good morning! Ready to slay?"
        case 12..<17: return "Looking good this afternoon!"
        case 17..<21: return "Evening vibes loading..."
        default: return "Night owl fashion mode"
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
                        } else {
                            Image(systemName: "person.fill")
                                .font(.system(size: 32))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Your Avatar")
                            .font(.system(size: 18, weight: .bold))

                        Text("Tap to customize your look")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)

                        HStack(spacing: 4) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 11))
                            Text("AI-generated")
                                .font(.system(size: 11, weight: .medium))
                        }
                        .foregroundStyle(MirrorTheme.purple)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.tertiary)
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

                            PremiumBadge()
                        }
                    }
                }
            }
        }
    }

    // MARK: - Today's Outfit

    private var todaysOutfitCard: some View {
        GlassCard {
            VStack(spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Today's Look")
                            .font(.system(size: 18, weight: .bold))

                        Text(formattedDate)
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    if appState.todaysOutfit != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.green)
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
                                } else {
                                    Image(systemName: "tshirt.fill")
                                        .font(.system(size: 28))
                                        .foregroundStyle(.tertiary)
                                }
                            }
                    }

                    Button {
                        showDailyOutfit = true
                    } label: {
                        Text("View Details")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(MirrorTheme.purple)
                    }
                } else {
                    Button {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                        impactFeedback.impactOccurred()
                        showDailyOutfit = true
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "wand.and.stars")
                                .font(.system(size: 18))

                            Text("Generate Today's Look")
                                .font(.system(size: 16, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(MirrorTheme.gradientPrimary)
                        )
                    }
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

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("\(appState.streakCount)")
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .foregroundStyle(MirrorTheme.gradientPrimary)

                        Text("day streak")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.secondary)
                    }

                    Text("Keep logging daily outfits!")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                VStack(spacing: 2) {
                    Text("Best")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    Text("\(appState.longestStreak)")
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    // MARK: - Quick Actions

    private var quickActionsRow: some View {
        HStack(spacing: 12) {
            quickAction(icon: "plus.circle.fill", label: "Add Clothes", color: MirrorTheme.purple) {
                showAddItem = true
            }

            quickAction(icon: "person.fill.viewfinder", label: "Try On", color: MirrorTheme.pink) {
                // Navigate to try-on
            }

            quickAction(icon: "bubble.left.and.bubble.right.fill", label: "AI Chat", color: MirrorTheme.indigo) {
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

                Text(label)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
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

                VStack(alignment: .leading, spacing: 2) {
                    Text("Unlock Full Potential")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)

                    Text("Avatar, unlimited VTON, AI styling & more")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.7))
                }

                Spacer()

                Text("PRO")
                    .font(.system(size: 13, weight: .black))
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
                }
            }
        }
    }

    // MARK: - Refresh

    private func refreshData() async {
        async let streak: () = appState.loadStreak()
        async let wardrobe: () = appState.loadWardrobe()
        async let notifications: () = appState.loadNotifications()
        _ = await (streak, wardrobe, notifications)
    }
}
