import SwiftUI
import os

struct RankingsView: View {
    @Environment(AppState.self) private var appState

    @State private var rankings: [RankingEntryModel] = []
    @State private var isLoading = false
    @State private var animateIn = false
    @State private var showError = false
    @State private var errorMessage = ""

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    // Header gradient area
                    headerSection

                    // Top 3 podium
                    if rankings.count >= 3 {
                        podiumSection
                            .padding(.top, -40)
                            .zIndex(1)
                    }

                    // Remaining rankings list
                    rankingsList
                        .padding(.top, 16)
                }
                .padding(.bottom, 100)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Rankings")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable {
                await loadRankings()
            }
            .task {
                if rankings.isEmpty {
                    await loadRankings()
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        ZStack {
            // Gradient background
            LinearGradient(
                colors: [
                    MirrorTheme.purple.opacity(0.4),
                    MirrorTheme.pink.opacity(0.2),
                    Color.clear
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 180)

            VStack(spacing: 8) {
                Image(systemName: "trophy.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.yellow, .orange],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .symbolEffect(.bounce, options: .repeating.speed(0.2))

                Text("Style Leaderboard")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .accessibilityAddTraits(.isHeader)

                Text("Top fashionistas this week")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 20)
        }
    }

    // MARK: - Podium Section (Top 3)

    private var podiumSection: some View {
        HStack(alignment: .bottom, spacing: 8) {
            // 2nd place
            if rankings.count > 1 {
                podiumItem(entry: rankings[1], rank: 2, height: 100)
                    .opacity(animateIn ? 1 : 0)
                    .offset(y: animateIn ? 0 : 30)
                    .animation(.spring(response: 0.6).delay(0.2), value: animateIn)
            }

            // 1st place
            if !rankings.isEmpty {
                podiumItem(entry: rankings[0], rank: 1, height: 130)
                    .opacity(animateIn ? 1 : 0)
                    .offset(y: animateIn ? 0 : 30)
                    .animation(.spring(response: 0.6).delay(0.1), value: animateIn)
            }

            // 3rd place
            if rankings.count > 2 {
                podiumItem(entry: rankings[2], rank: 3, height: 80)
                    .opacity(animateIn ? 1 : 0)
                    .offset(y: animateIn ? 0 : 30)
                    .animation(.spring(response: 0.6).delay(0.3), value: animateIn)
            }
        }
        .padding(.horizontal, 20)
    }

    private func podiumItem(entry: RankingEntryModel, rank: Int, height: CGFloat) -> some View {
        VStack(spacing: 8) {
            // Crown for 1st place
            if rank == 1 {
                Image(systemName: "crown.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(.yellow)
                    .shadow(color: .yellow.opacity(0.5), radius: 6)
            }

            // Avatar with ring
            ZStack {
                Circle()
                    .strokeBorder(
                        rankGradient(rank: rank),
                        lineWidth: 3
                    )
                    .frame(width: rank == 1 ? 76 : 64, height: rank == 1 ? 76 : 64)

                avatarImage(url: entry.avatarUrl, size: rank == 1 ? 68 : 56)

                // Rank badge
                ZStack {
                    Circle()
                        .fill(rankColor(rank: rank))
                        .frame(width: 24, height: 24)
                        .shadow(color: rankColor(rank: rank).opacity(0.5), radius: 4)

                    Text("\(rank)")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(.white)
                }
                .offset(y: (rank == 1 ? 38 : 32))
            }
            .padding(.bottom, 8)

            // Name
            Text(entry.username ?? entry.fullName ?? "User")
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)

            // Score
            Text(String(format: "%.0f", entry.styleScore ?? 0))
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(MirrorTheme.gradientPrimary)

            // Streak
            if let streak = entry.streakCount, streak > 0 {
                HStack(spacing: 2) {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(.orange)
                    Text("\(streak)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.orange)
                }
            }

            // Podium block
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        colors: [
                            rankColor(rank: rank).opacity(0.3),
                            rankColor(rank: rank).opacity(0.1)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: height)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(rankColor(rank: rank).opacity(0.4), lineWidth: 1)
                )
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Rank \(rank), \(entry.username ?? entry.fullName ?? "User"), score \(String(format: "%.0f", entry.styleScore ?? 0))\(entry.streakCount.map { $0 > 0 ? ", \($0) day streak" : "" } ?? "")")
    }

    // MARK: - Rankings List

    private var rankingsList: some View {
        LazyVStack(spacing: 0) {
            let remaining = rankings.count > 3 ? Array(rankings.dropFirst(3)) : []

            ForEach(Array(remaining.enumerated()), id: \.element.id) { index, entry in
                rankingRow(entry: entry, index: index)

                if index < remaining.count - 1 {
                    Rectangle()
                        .fill(MirrorTheme.borderColor)
                        .frame(height: 0.5)
                        .padding(.leading, 72)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func rankingRow(entry: RankingEntryModel, index: Int) -> some View {
        HStack(spacing: 14) {
            // Rank number
            Text("#\(entry.rank)")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.secondary)
                .frame(width: 36, alignment: .center)

            // Avatar
            avatarImage(url: entry.avatarUrl, size: 44)

            // Name and username
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.fullName ?? entry.username ?? "User")
                    .font(.system(size: 15, weight: .semibold))

                if let username = entry.username {
                    Text("@\(username)")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            // Score
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.0f", entry.styleScore ?? 0))
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(MirrorTheme.gradientPrimary)

                if let streak = entry.streakCount, streak > 0 {
                    HStack(spacing: 2) {
                        Image(systemName: "flame.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(.orange)
                        Text("\(streak)d")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 4)
        .background(
            entry.isCurrentUser == true
                ? AnyShapeStyle(MirrorTheme.purple.opacity(0.08))
                : AnyShapeStyle(Color.clear)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Rank \(entry.rank), \(entry.fullName ?? entry.username ?? "User"), score \(String(format: "%.0f", entry.styleScore ?? 0))\(entry.streakCount.map { $0 > 0 ? ", \($0) day streak" : "" } ?? "")\(entry.isCurrentUser == true ? ", this is you" : "")")
        .opacity(animateIn ? 1 : 0)
        .offset(x: animateIn ? 0 : 30)
        .animation(.spring(response: 0.5).delay(0.4 + Double(index) * 0.05), value: animateIn)
    }

    // MARK: - Data Loading

    private func loadRankings() async {
        isLoading = true
        defer {
            isLoading = false
            withAnimation {
                animateIn = true
            }
        }

        do {
            let response = try await SocialService.shared.getRankings()
            rankings = response.map { entry in
                RankingEntryModel(
                    id: entry.id,
                    rank: entry.rank,
                    fullName: entry.fullName,
                    username: entry.username,
                    avatarUrl: entry.avatarUrl,
                    styleScore: entry.styleScore,
                    streakCount: entry.streakCount,
                    isCurrentUser: entry.isCurrentUser
                )
            }
        } catch {
            errorMessage = "Failed to load rankings. Please try again."
            showError = true
            Logger(subsystem: "com.mirrorai", category: "RankingsView").error("Failed to load rankings: \(error.localizedDescription)")
        }
    }

    // MARK: - Helpers

    private func avatarImage(url: String?, size: CGFloat) -> some View {
        Group {
            if let urlStr = url, let imageUrl = URL(string: urlStr) {
                CachedAsyncImage(url: imageUrl) {
                    Circle()
                        .fill(MirrorTheme.surfaceColor)
                        .overlay {
                            Image(systemName: "person.fill")
                                .font(.system(size: size * 0.4))
                                .foregroundStyle(.tertiary)
                        }
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
            } else {
                Circle()
                    .fill(MirrorTheme.surfaceColor)
                    .frame(width: size, height: size)
                    .overlay {
                        Image(systemName: "person.fill")
                            .font(.system(size: size * 0.4))
                            .foregroundStyle(.tertiary)
                    }
            }
        }
    }

    private func rankColor(rank: Int) -> Color {
        switch rank {
        case 1: return Color(hex: "FFD700") // Gold
        case 2: return Color(hex: "C0C0C0") // Silver
        case 3: return Color(hex: "CD7F32") // Bronze
        default: return MirrorTheme.purple
        }
    }

    private func rankGradient(rank: Int) -> LinearGradient {
        switch rank {
        case 1:
            return LinearGradient(
                colors: [Color(hex: "FFD700"), Color(hex: "FFA500")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        case 2:
            return LinearGradient(
                colors: [Color(hex: "E8E8E8"), Color(hex: "A0A0A0")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        case 3:
            return LinearGradient(
                colors: [Color(hex: "CD7F32"), Color(hex: "8B4513")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        default:
            return MirrorTheme.gradientPrimary
        }
    }
}
