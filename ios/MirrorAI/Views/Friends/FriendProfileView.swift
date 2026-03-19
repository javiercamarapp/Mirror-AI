import SwiftUI

struct FriendProfileView: View {
    @Environment(\.dismiss) private var dismiss
    let friend: FriendProfileModel
    var friendsVM: FriendsViewModel

    @State private var closetItems: [WardrobeItemModel] = []
    @State private var showCloset = false
    @State private var showUnfriendAlert = false
    @State private var isLoadingCloset = false
    @State private var headerScale: CGFloat = 0.9
    @State private var headerOpacity: Double = 0

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    // Header
                    profileHeader
                        .scaleEffect(headerScale)
                        .opacity(headerOpacity)
                        .onAppear {
                            withAnimation(.spring(response: 0.6, dampingFraction: 0.75)) {
                                headerScale = 1.0
                                headerOpacity = 1.0
                            }
                        }

                    // Stats
                    statsSection

                    // Actions
                    actionButtons

                    // Recent Posts placeholder
                    recentPostsSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 40)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .alert("Unfriend", isPresented: $showUnfriendAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Unfriend", role: .destructive) {
                    Task {
                        await friendsVM.removeFriend(friend.id)
                        let notification = UINotificationFeedbackGenerator()
                        notification.notificationOccurred(.success)
                        dismiss()
                    }
                }
            } message: {
                Text("Are you sure you want to unfriend \(friend.fullName ?? "this person")?")
            }
            .sheet(isPresented: $showCloset) {
                friendClosetSheet
            }
        }
    }

    // MARK: - Profile Header

    private var profileHeader: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(MirrorTheme.gradientPrimary)
                    .frame(width: 104, height: 104)

                Circle()
                    .fill(Color(UIColor.systemBackground))
                    .frame(width: 100, height: 100)

                if let avatarUrl = friend.avatarUrl, !avatarUrl.isEmpty {
                    CachedAsyncImage(url: URL(string: avatarUrl)) {
                        Image(systemName: "person.fill")
                            .font(.system(size: 36))
                            .foregroundStyle(.tertiary)
                    }
                    .frame(width: 96, height: 96)
                    .clipShape(Circle())
                } else {
                    Image(systemName: "person.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(MirrorTheme.gradientPrimary)
                }
            }

            VStack(spacing: 6) {
                Text(friend.fullName ?? "Friend")
                    .font(.system(size: 24, weight: .bold))
                    .accessibilityAddTraits(.isHeader)

                if let username = friend.username {
                    Text("@\(username)")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Stats

    private var statsSection: some View {
        HStack(spacing: 0) {
            if let score = friend.styleScore {
                statItem(value: String(format: "%.0f", score), label: "Style Score", icon: "sparkles")
            }

            if let streak = friend.streakCount {
                statItem(value: "\(streak)", label: "Streak", icon: "flame.fill")
            }
        }
        .glassCard()
    }

    private func statItem(value: String, label: String, icon: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(MirrorTheme.gradientPrimary)

            Text(value)
                .font(.system(size: 22, weight: .bold, design: .rounded))

            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }

    // MARK: - Actions

    private var actionButtons: some View {
        VStack(spacing: 12) {
            Button {
                let impact = UIImpactFeedbackGenerator(style: .medium)
                impact.impactOccurred()
                showCloset = true
                Task {
                    isLoadingCloset = true
                    closetItems = await friendsVM.loadFriendCloset(friend.id)
                    isLoadingCloset = false
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "tshirt.fill")
                        .font(.system(size: 16))
                    Text("View Closet")
                        .font(.system(size: 16, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(MirrorTheme.gradientPrimary)
                )
            }
            .accessibilityLabel("View \(friend.fullName ?? "friend")'s closet")
            .accessibilityHint("Opens their wardrobe items")

            Button {
                showUnfriendAlert = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "person.badge.minus")
                        .font(.system(size: 15))
                    Text("Unfriend")
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(Color.red.opacity(0.1))
                        .overlay(
                            RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                .strokeBorder(Color.red.opacity(0.2), lineWidth: 1)
                        )
                )
            }
            .accessibilityLabel("Unfriend \(friend.fullName ?? "this person")")
            .accessibilityHint("Removes this person from your friends list")
        }
    }

    // MARK: - Recent Posts

    private var recentPostsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Recent Posts")
                .font(.system(size: 18, weight: .bold))
                .accessibilityAddTraits(.isHeader)

            GlassCard {
                VStack(spacing: 12) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 32))
                        .foregroundStyle(.tertiary)

                    Text("No recent posts")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            }
        }
    }

    // MARK: - Closet Sheet

    private var friendClosetSheet: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                if isLoadingCloset {
                    ProgressView()
                        .controlSize(.large)
                        .tint(MirrorTheme.purple)
                } else if closetItems.isEmpty {
                    EmptyStateView(
                        icon: "tshirt",
                        title: "Empty Closet",
                        description: "This friend hasn't added any items yet."
                    )
                } else {
                    ScrollView {
                        LazyVGrid(
                            columns: [
                                GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12)
                            ],
                            spacing: 12
                        ) {
                            ForEach(closetItems) { item in
                                closetItemCard(item)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .padding(.bottom, 40)
                    }
                }
            }
            .navigationTitle("\(friend.fullName ?? "Friend")'s Closet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { showCloset = false }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    private func closetItemCard(_ item: WardrobeItemModel) -> some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(MirrorTheme.surfaceColor)
                    .aspectRatio(1, contentMode: .fit)

                CachedAsyncImage(url: URL(string: item.imageUrl)) {
                    Image(systemName: "tshirt")
                        .font(.system(size: 24))
                        .foregroundStyle(.tertiary)
                }
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            Text(item.name)
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.name)")
    }
}
