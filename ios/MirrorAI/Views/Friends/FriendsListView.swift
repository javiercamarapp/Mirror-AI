import SwiftUI

struct FriendsListView: View {
    @Environment(AppState.self) private var appState
    @State private var friendsVM = FriendsViewModel()
    @State private var searchText = ""
    @State private var showRequests = false
    @State private var showSearch = false
    @State private var selectedFriend: FriendProfileModel?
    @State private var appearAnimation = false

    private var filteredFriends: [FriendProfileModel] {
        if searchText.isEmpty {
            return friendsVM.friends
        }
        return friendsVM.friends.filter {
            ($0.fullName ?? "").localizedCaseInsensitiveContains(searchText) ||
            ($0.username ?? "").localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                if friendsVM.friends.isEmpty && !friendsVM.isLoading {
                    EmptyStateView(
                        icon: "person.2.fill",
                        title: "No Friends Yet",
                        description: "Find and add friends to share your style journey together.",
                        actionTitle: "Find Friends"
                    ) {
                        showSearch = true
                    }
                } else {
                    ScrollView(showsIndicators: false) {
                        LazyVStack(spacing: 12) {
                            ForEach(Array(filteredFriends.enumerated()), id: \.element.id) { index, friend in
                                friendRow(friend)
                                    .opacity(appearAnimation ? 1 : 0)
                                    .offset(y: appearAnimation ? 0 : 20)
                                    .animation(
                                        .spring(response: 0.5, dampingFraction: 0.8)
                                            .delay(Double(index) * 0.05),
                                        value: appearAnimation
                                    )
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .padding(.bottom, 100)
                    }
                    .searchable(text: $searchText, prompt: "Search friends")
                }

                if friendsVM.isLoading {
                    LoadingOverlay(message: "Loading friends...")
                }
            }
            .navigationTitle("Friends")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showRequests = true
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "person.badge.clock.fill")
                                .font(.system(size: 17))

                            if !friendsVM.pendingRequests.isEmpty {
                                Text("\(friendsVM.pendingRequests.count)")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(3)
                                    .background(Circle().fill(.red))
                                    .offset(x: 8, y: -6)
                            }
                        }
                    }
                    .accessibilityLabel("Friend requests")
                    .accessibilityValue(friendsVM.pendingRequests.isEmpty ? "No pending requests" : "\(friendsVM.pendingRequests.count) pending")
                    .accessibilityHint("View pending friend requests")
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSearch = true
                    } label: {
                        Image(systemName: "person.badge.plus")
                            .font(.system(size: 17))
                    }
                    .accessibilityLabel("Find friends")
                    .accessibilityHint("Search for new friends to add")
                }
            }
            .sheet(isPresented: $showRequests) {
                FriendRequestsView(friendsVM: friendsVM)
            }
            .sheet(isPresented: $showSearch) {
                SearchUsersView(friendsVM: friendsVM)
            }
            .sheet(item: $selectedFriend) { friend in
                FriendProfileView(friend: friend, friendsVM: friendsVM)
            }
            .refreshable {
                await friendsVM.refreshAll()
            }
            .task {
                await friendsVM.refreshAll()
                withAnimation { appearAnimation = true }
            }
        }
    }

    // MARK: - Friend Row

    private func friendRow(_ friend: FriendProfileModel) -> some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            selectedFriend = friend
        } label: {
            GlassCard {
                HStack(spacing: 14) {
                    // Avatar
                    ZStack {
                        Circle()
                            .fill(MirrorTheme.surfaceColor)
                            .frame(width: 52, height: 52)

                        if let avatarUrl = friend.avatarUrl, !avatarUrl.isEmpty {
                            CachedAsyncImage(url: URL(string: avatarUrl)) {
                                Image(systemName: "person.fill")
                                    .font(.system(size: 20))
                                    .foregroundStyle(.tertiary)
                            }
                            .frame(width: 52, height: 52)
                            .clipShape(Circle())
                        } else {
                            Image(systemName: "person.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(friend.fullName ?? "Friend")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.primary)

                        if let username = friend.username {
                            Text("@\(username)")
                                .font(.system(size: 13))
                                .foregroundStyle(.secondary)
                        }
                    }

                    Spacer()

                    if let score = friend.styleScore, score > 0 {
                        VStack(spacing: 2) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 12))
                                .foregroundStyle(MirrorTheme.purple)

                            Text(String(format: "%.0f", score))
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(friend.fullName ?? "Friend")\(friend.username != nil ? ", @\(friend.username!)" : "")")
        .accessibilityHint("Opens friend's profile")
        .accessibilityAddTraits(.isButton)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                Task {
                    await friendsVM.removeFriend(friend.id)
                    let notification = UINotificationFeedbackGenerator()
                    notification.notificationOccurred(.success)
                }
            } label: {
                Label("Unfriend", systemImage: "person.badge.minus")
            }
        }
    }
}
