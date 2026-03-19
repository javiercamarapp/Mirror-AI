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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showReportSheet = false
    @State private var showBlockAlert = false
    @State private var reportTargetPostId: String?
    @State private var reportTargetUserId: String?
    @State private var selectedReportReason: ReportReason = .spam
    @State private var isSubmittingReport = false

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
                            },
                            onReport: {
                                reportTargetPostId = post.id
                                reportTargetUserId = post.userId
                                showReportSheet = true
                            },
                            onBlock: {
                                reportTargetPostId = post.id
                                reportTargetUserId = post.userId
                                showBlockAlert = true
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
                            .accessibilityLabel("Loading more posts")
                    }
                }
                .padding(.bottom, 100)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle(L10n.feedTitle)
            .navigationBarTitleDisplayMode(.inline)
            .dynamicTypeSize(...DynamicTypeSize.accessibility5)
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
                    .accessibilityLabel("Create new post")
                    .accessibilityHint("Opens the post creator")
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
            .sheet(isPresented: $showReportSheet) {
                reportSheet
            }
            .alert("Block User", isPresented: $showBlockAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Block", role: .destructive) {
                    blockUser()
                }
            } message: {
                Text("You will no longer see posts from this user. They will not be notified.")
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

    // MARK: - Report Sheet

    private var reportSheet: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text("Why are you reporting this post?")
                    .font(.system(size: 18, weight: .bold))
                    .padding(.top, 8)

                VStack(spacing: 0) {
                    ForEach(ReportReason.allCases, id: \.self) { reason in
                        Button {
                            selectedReportReason = reason
                        } label: {
                            HStack {
                                Text(reason.displayName)
                                    .font(.system(size: 15))
                                    .foregroundStyle(.primary)
                                Spacer()
                                if selectedReportReason == reason {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(MirrorTheme.purple)
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                        }
                        .accessibilityLabel(reason.displayName)
                        .accessibilityValue(selectedReportReason == reason ? "Selected" : "")
                        .accessibilityAddTraits(selectedReportReason == reason ? [.isButton, .isSelected] : .isButton)

                        if reason != ReportReason.allCases.last {
                            Divider().padding(.leading, 16)
                        }
                    }
                }
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )

                Button {
                    submitReport()
                } label: {
                    HStack {
                        if isSubmittingReport {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Text(isSubmittingReport ? "Submitting..." : "Submit Report")
                            .font(.system(size: 17, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(Color.red)
                    )
                }
                .disabled(isSubmittingReport)
                .accessibilityLabel(isSubmittingReport ? "Submitting report" : "Submit report")
                .accessibilityHint("Sends the report for this post")

                Spacer()
            }
            .padding(.horizontal, 20)
            .navigationTitle("Report Post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { showReportSheet = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func submitReport() {
        guard let postId = reportTargetPostId else { return }
        isSubmittingReport = true

        Task {
            do {
                let url = URL(string: "\(APIConfig.baseURL)/api/social/report")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                if let token = appState.authToken {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }
                let body: [String: String] = ["postId": postId, "reason": selectedReportReason.rawValue]
                request.httpBody = try JSONSerialization.data(withJSONObject: body)

                let (_, response) = try await URLSession.shared.data(for: request)
                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    throw URLError(.badServerResponse)
                }

                await MainActor.run {
                    isSubmittingReport = false
                    showReportSheet = false
                    let impact = UINotificationFeedbackGenerator()
                    impact.notificationOccurred(.success)
                }
            } catch {
                await MainActor.run {
                    isSubmittingReport = false
                    showReportSheet = false
                    errorMessage = "Failed to submit report. Please try again."
                    showError = true
                }
            }
        }
    }

    private func blockUser() {
        guard let userId = reportTargetUserId else { return }
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        Task {
            do {
                let url = URL(string: "\(APIConfig.baseURL)/api/social/block")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                if let token = appState.authToken {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }
                let body: [String: String] = ["userId": userId]
                request.httpBody = try JSONSerialization.data(withJSONObject: body)

                let (_, response) = try await URLSession.shared.data(for: request)
                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    throw URLError(.badServerResponse)
                }

                await MainActor.run {
                    let notification = UINotificationFeedbackGenerator()
                    notification.notificationOccurred(.success)
                    // Remove blocked user's posts from feed
                    appState.feedPosts.removeAll { $0.userId == userId }
                }
            } catch {
                await MainActor.run {
                    errorMessage = "Failed to block user. Please try again."
                    showError = true
                }
            }
        }
    }
}

// MARK: - Report Reason

enum ReportReason: String, CaseIterable {
    case sexualContent = "sexual_content"
    case harassment = "harassment"
    case spam = "spam"
    case hateSpeech = "hate_speech"
    case other = "other"

    var displayName: String {
        switch self {
        case .sexualContent: return "Sexual Content"
        case .harassment: return "Harassment"
        case .spam: return "Spam"
        case .hateSpeech: return "Hate Speech"
        case .other: return "Other"
        }
    }
}

// MARK: - Feed Post Card

private struct FeedPostCard: View {
    let post: SocialPostModel
    let onLike: () -> Void
    let onComment: () -> Void
    let onTap: () -> Void
    var onReport: (() -> Void)? = nil
    var onBlock: (() -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
                .accessibilityLabel("View all \(commentsCount) comments")
                .accessibilityHint("Opens the comments sheet")
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
                .accessibilityHidden(true)

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
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Style score \(String(format: "%.1f", score))")
            }

            Menu {
                Button(role: .destructive) {
                    onReport?()
                } label: {
                    Label(L10n.feedReportPost, systemImage: "exclamationmark.triangle")
                }

                Button(role: .destructive) {
                    onBlock?()
                } label: {
                    Label(L10n.feedBlockUser, systemImage: "hand.raised")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(L10n.a11yMoreOptions)
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
        .accessibilityLabel(L10n.a11yPostImage)
        .accessibilityHint(L10n.a11yDoubleTapToLike)
        .accessibilityAddTraits(.isImage)
    }

    // MARK: - Action Bar

    private var actionBar: some View {
        HStack(spacing: 18) {
            Button {
                let impact = UIImpactFeedbackGenerator(style: .medium)
                impact.impactOccurred()
                if !reduceMotion {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) {
                        likeButtonScale = 1.3
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) {
                            likeButtonScale = 1.0
                        }
                    }
                }
                onLike()
            } label: {
                Image(systemName: post.isLiked == true ? "heart.fill" : "heart")
                    .font(.system(size: 22))
                    .foregroundStyle(post.isLiked == true ? MirrorTheme.pink : .primary)
                    .scaleEffect(likeButtonScale)
            }
            .accessibilityLabel(L10n.a11yLikeButton)
            .accessibilityValue(post.isLiked == true ? L10n.a11yLiked : L10n.a11yUnliked)

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
                onComment()
            } label: {
                Image(systemName: "bubble.right")
                    .font(.system(size: 21))
                    .foregroundStyle(.primary)
            }
            .accessibilityLabel(L10n.a11yCommentButton)

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
            } label: {
                Image(systemName: "paperplane")
                    .font(.system(size: 20))
                    .foregroundStyle(.primary)
            }
            .accessibilityLabel(L10n.a11yShareButton)

            Spacer()

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
            } label: {
                Image(systemName: "bookmark")
                    .font(.system(size: 20))
                    .foregroundStyle(.primary)
            }
            .accessibilityLabel(L10n.a11yBookmarkButton)
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
