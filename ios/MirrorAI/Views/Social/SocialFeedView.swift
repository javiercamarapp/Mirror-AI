import SwiftUI

struct SocialFeedView: View {
    @Environment(AppState.self) private var appState

    @State private var currentPage = 0
    @State private var isLoadingMore = false
    @State private var hasMorePages = true
    @State private var showComments = false
    @State private var selectedPostId: String?
    @State private var showStoryViewer = false
    @State private var selectedStoryGroup: StoryGroupModel?
    @State private var showStoryCreator = false
    @State private var showPostCreator = false
    @State private var showError = false
    @State private var errorMessage = ""

    private let pageSize = 20

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    // Story bar
                    StoryBarView(
                        onStoryTapped: { group in
                            selectedStoryGroup = group
                            showStoryViewer = true
                        },
                        onCreateTapped: {
                            showStoryCreator = true
                        }
                    )
                    .padding(.bottom, 8)

                    // Divider
                    Rectangle()
                        .fill(MirrorTheme.borderColor)
                        .frame(height: 0.5)
                        .padding(.bottom, 4)

                    // Feed posts
                    ForEach(appState.feedPosts) { post in
                        FeedPostCard(
                            post: post,
                            onLike: {
                                Task { await appState.toggleLike(postId: post.id) }
                            },
                            onComment: {
                                selectedPostId = post.id
                                showComments = true
                            },
                            onTap: {
                                selectedPostId = post.id
                            }
                        )

                        Rectangle()
                            .fill(MirrorTheme.borderColor)
                            .frame(height: 0.5)
                    }

                    // Pagination loader
                    if hasMorePages {
                        ProgressView()
                            .tint(MirrorTheme.purple)
                            .padding(32)
                            .onAppear {
                                loadMore()
                            }
                    }
                }
                .padding(.bottom, 100)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Feed")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        let impact = UIImpactFeedbackGenerator(style: .light)
                        impact.impactOccurred()
                        showPostCreator = true
                    } label: {
                        Image(systemName: "plus.square")
                            .font(.system(size: 20))
                            .foregroundStyle(MirrorTheme.gradientPrimary)
                    }
                }
            }
            .refreshable {
                await refreshFeed()
            }
            .sheet(isPresented: $showComments) {
                if let postId = selectedPostId {
                    CommentsSheetView(postId: postId)
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                }
            }
            .fullScreenCover(isPresented: $showStoryViewer) {
                if let group = selectedStoryGroup {
                    StoryViewerView(storyGroup: group)
                }
            }
            .sheet(isPresented: $showStoryCreator) {
                StoryCreatorView()
            }
            .sheet(isPresented: $showPostCreator) {
                PostCreatorView()
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
            .navigationDestination(item: $selectedPostId) { postId in
                if let post = appState.feedPosts.first(where: { $0.id == postId }) {
                    PostDetailView(post: post)
                }
            }
            .task {
                if appState.feedPosts.isEmpty {
                    await refreshFeed()
                }
            }
        }
    }

    // MARK: - Data Loading

    private func refreshFeed() async {
        currentPage = 0
        hasMorePages = true
        await appState.loadFeed()
        await appState.loadStories()
    }

    private func loadMore() {
        guard !isLoadingMore, hasMorePages else { return }
        isLoadingMore = true
        currentPage += 1

        Task {
            await appState.loadFeed()
            isLoadingMore = false
            // If no new posts were added, we've reached the end
            if appState.feedPosts.count < (currentPage + 1) * pageSize {
                hasMorePages = false
            }
        }
    }
}

// MARK: - Feed Post Card

private struct FeedPostCard: View {
    let post: SocialPostModel
    let onLike: () -> Void
    let onComment: () -> Void
    let onTap: () -> Void

    @State private var showHeartAnimation = false
    @State private var heartScale: CGFloat = 0
    @State private var heartOpacity: Double = 0
    @State private var likeButtonScale: CGFloat = 1.0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // User header
            userHeader
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

            // Post image
            postImage

            // Action buttons
            actionBar
                .padding(.horizontal, 16)
                .padding(.top, 10)

            // Likes count
            if let likesCount = post.likesCount, likesCount > 0 {
                Text("\(likesCount) like\(likesCount == 1 ? "" : "s")")
                    .font(.system(size: 14, weight: .bold))
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
            }

            // Caption
            if let caption = post.caption, !caption.isEmpty {
                captionView(caption)
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
            }

            // Comments count
            if let commentsCount = post.commentsCount, commentsCount > 0 {
                Button {
                    onComment()
                } label: {
                    Text("View all \(commentsCount) comment\(commentsCount == 1 ? "" : "s")")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
            }

            // Timestamp
            Text(relativeTime(from: post.createdAt))
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 12)
        }
    }

    // MARK: - User Header

    private var userHeader: some View {
        HStack(spacing: 10) {
            // Avatar
            userAvatar(url: post.user?.avatarUrl, size: 34)

            VStack(alignment: .leading, spacing: 1) {
                Text(post.user?.username ?? post.user?.fullName ?? "User")
                    .font(.system(size: 14, weight: .semibold))

                if let occasion = post.occasion {
                    Text(occasion)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if let score = post.score {
                HStack(spacing: 3) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(.yellow)
                    Text(String(format: "%.1f", score))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    Capsule()
                        .fill(MirrorTheme.surfaceColor)
                )
            }
        }
    }

    // MARK: - Post Image

    private var postImage: some View {
        ZStack {
            if let imageUrl = post.imageUrl {
                CachedAsyncImage(url: URL(string: imageUrl)) {
                    Rectangle()
                        .fill(MirrorTheme.surfaceColor)
                        .overlay {
                            Image(systemName: "photo")
                                .font(.system(size: 32))
                                .foregroundStyle(.tertiary)
                        }
                }
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .clipped()
            } else {
                Rectangle()
                    .fill(MirrorTheme.surfaceColor)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay {
                        Image(systemName: "tshirt.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(.tertiary)
                    }
            }

            // Heart animation overlay
            if showHeartAnimation {
                Image(systemName: "heart.fill")
                    .font(.system(size: 80))
                    .foregroundStyle(.white)
                    .shadow(color: MirrorTheme.pink.opacity(0.6), radius: 20)
                    .scaleEffect(heartScale)
                    .opacity(heartOpacity)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) {
            triggerLikeAnimation()
        }
        .onTapGesture(count: 1) {
            onTap()
        }
    }

    // MARK: - Action Bar

    private var actionBar: some View {
        HStack(spacing: 18) {
            Button {
                let impact = UIImpactFeedbackGenerator(style: .medium)
                impact.impactOccurred()
                withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) {
                    likeButtonScale = 1.3
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) {
                        likeButtonScale = 1.0
                    }
                }
                onLike()
            } label: {
                Image(systemName: post.isLiked == true ? "heart.fill" : "heart")
                    .font(.system(size: 22))
                    .foregroundStyle(post.isLiked == true ? MirrorTheme.pink : .primary)
                    .scaleEffect(likeButtonScale)
            }

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
                onComment()
            } label: {
                Image(systemName: "bubble.right")
                    .font(.system(size: 21))
                    .foregroundStyle(.primary)
            }

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
            } label: {
                Image(systemName: "paperplane")
                    .font(.system(size: 20))
                    .foregroundStyle(.primary)
            }

            Spacer()

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
            } label: {
                Image(systemName: "bookmark")
                    .font(.system(size: 20))
                    .foregroundStyle(.primary)
            }
        }
    }

    // MARK: - Caption

    private func captionView(_ caption: String) -> some View {
        HStack(alignment: .top, spacing: 4) {
            Text(post.user?.username ?? "user")
                .font(.system(size: 14, weight: .bold)) +
            Text(" ") +
            Text(caption)
                .font(.system(size: 14))
        }
        .lineLimit(3)
    }

    // MARK: - Heart Animation

    private func triggerLikeAnimation() {
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        if post.isLiked != true {
            onLike()
        }

        showHeartAnimation = true
        heartScale = 0
        heartOpacity = 1

        withAnimation(.spring(response: 0.35, dampingFraction: 0.5)) {
            heartScale = 1.2
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            withAnimation(.spring(response: 0.2, dampingFraction: 0.7)) {
                heartScale = 1.0
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            withAnimation(.easeOut(duration: 0.3)) {
                heartOpacity = 0
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) {
            showHeartAnimation = false
        }
    }

    // MARK: - Helpers

    private func userAvatar(url: String?, size: CGFloat) -> some View {
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

    private func relativeTime(from dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else {
            // Try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: dateString) else { return "just now" }
            return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
        }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - NavigationDestination Item Binding

private extension Binding where Value == String? {
    // No-op helper: SwiftUI's native optional binding handles this
}
