import SwiftUI
import os

struct PostDetailView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let post: SocialPostModel

    @State private var comments: [CommentModel] = []
    @State private var newComment = ""
    @State private var isLoadingComments = false
    @State private var isSendingComment = false
    @State private var showHeartAnimation = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var heartScale: CGFloat = 0
    @State private var heartOpacity: Double = 0
    @State private var showError = false
    @State private var errorMessage = ""
    @FocusState private var isCommentFieldFocused: Bool
    private static let logger = Logger(subsystem: "com.mirrorai", category: "PostDetailView")

    private var currentPost: SocialPostModel {
        appState.feedPosts.first(where: { $0.id == post.id }) ?? post
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // Post image
                    postImage

                    // User info and actions
                    VStack(alignment: .leading, spacing: 12) {
                        // User header
                        userHeader
                            .padding(.horizontal, 16)
                            .padding(.top, 12)

                        // Action bar
                        actionBar
                            .padding(.horizontal, 16)

                        // Likes
                        if let likesCount = currentPost.likesCount, likesCount > 0 {
                            Text("\(likesCount) like\(likesCount == 1 ? "" : "s")")
                                .font(.system(size: 15, weight: .bold))
                                .padding(.horizontal, 16)
                        }

                        // Caption
                        if let caption = currentPost.caption, !caption.isEmpty {
                            HStack(alignment: .top, spacing: 4) {
                                Text(currentPost.user?.username ?? "user")
                                    .font(.system(size: 15, weight: .bold)) +
                                Text(" ") +
                                Text(caption)
                                    .font(.system(size: 15))
                            }
                            .padding(.horizontal, 16)
                        }

                        // Score badge
                        if let score = currentPost.score {
                            HStack(spacing: 6) {
                                Image(systemName: "star.fill")
                                    .foregroundStyle(.yellow)
                                Text("Style Score: \(String(format: "%.1f", score))")
                                    .font(.system(size: 14, weight: .semibold))
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .fill(MirrorTheme.surfaceColor)
                            )
                            .padding(.horizontal, 16)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("Style score \(String(format: "%.1f", score))")
                        }

                        // Occasion tag
                        if let occasion = currentPost.occasion {
                            HStack(spacing: 6) {
                                Image(systemName: "tag.fill")
                                    .font(.system(size: 11))
                                Text(occasion)
                                    .font(.system(size: 13, weight: .medium))
                            }
                            .foregroundStyle(MirrorTheme.purple)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(
                                Capsule()
                                    .fill(MirrorTheme.purple.opacity(0.12))
                            )
                            .padding(.horizontal, 16)
                            .accessibilityLabel("Occasion: \(occasion)")
                        }

                        // Timestamp
                        Text(relativeTime(from: currentPost.createdAt))
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 16)

                        // Divider
                        Rectangle()
                            .fill(MirrorTheme.borderColor)
                            .frame(height: 0.5)
                            .padding(.top, 8)

                        // Comments section
                        commentsSection
                    }
                }
                .padding(.bottom, 80)
            }
            .background(Color(UIColor.systemBackground))

            // Comment input bar
            commentInputBar
        }
        .navigationBarTitleDisplayMode(.inline)
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
        .task {
            await loadComments()
        }
    }

    // MARK: - Post Image

    private var postImage: some View {
        ZStack {
            if let imageUrl = currentPost.imageUrl {
                CachedAsyncImage(url: URL(string: imageUrl)) {
                    Rectangle()
                        .fill(MirrorTheme.surfaceColor)
                        .overlay {
                            ProgressView()
                                .tint(MirrorTheme.purple)
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

            // Heart animation
            if showHeartAnimation {
                Image(systemName: "heart.fill")
                    .font(.system(size: 80))
                    .foregroundStyle(.white)
                    .shadow(color: MirrorTheme.pink.opacity(0.6), radius: 20)
                    .scaleEffect(heartScale)
                    .opacity(heartOpacity)
            }
        }
        .onTapGesture(count: 2) {
            triggerLikeAnimation()
        }
        .accessibilityLabel("Post image")
        .accessibilityHint("Double tap to like")
        .accessibilityAddTraits(.isImage)
    }

    // MARK: - User Header

    private var userHeader: some View {
        HStack(spacing: 12) {
            avatarView(url: currentPost.user?.avatarUrl, size: 40)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(currentPost.user?.username ?? currentPost.user?.fullName ?? "User")
                    .font(.system(size: 15, weight: .semibold))

                if let fullName = currentPost.user?.fullName,
                   currentPost.user?.username != nil {
                    Text(fullName)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
    }

    // MARK: - Action Bar

    private var actionBar: some View {
        HStack(spacing: 18) {
            Button {
                let impact = UIImpactFeedbackGenerator(style: .medium)
                impact.impactOccurred()
                Task { await appState.toggleLike(postId: currentPost.id) }
            } label: {
                Image(systemName: currentPost.isLiked == true ? "heart.fill" : "heart")
                    .font(.system(size: 24))
                    .foregroundStyle(currentPost.isLiked == true ? MirrorTheme.pink : .primary)
                    .contentTransition(.symbolEffect(.replace))
            }
            .accessibilityLabel(L10n.a11yLikeButton)
            .accessibilityValue(currentPost.isLiked == true ? L10n.a11yLiked : L10n.a11yUnliked)

            Button {
                isCommentFieldFocused = true
            } label: {
                Image(systemName: "bubble.right")
                    .font(.system(size: 22))
                    .foregroundStyle(.primary)
            }
            .accessibilityLabel(L10n.a11yCommentButton)

            Button {} label: {
                Image(systemName: "paperplane")
                    .font(.system(size: 21))
                    .foregroundStyle(.primary)
            }
            .accessibilityLabel(L10n.a11yShareButton)

            Spacer()

            Button {} label: {
                Image(systemName: "bookmark")
                    .font(.system(size: 21))
                    .foregroundStyle(.primary)
            }
            .accessibilityLabel(L10n.a11yBookmarkButton)
        }
    }

    // MARK: - Comments Section

    private var commentsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isLoadingComments {
                HStack {
                    Spacer()
                    ProgressView()
                        .tint(MirrorTheme.purple)
                        .padding(20)
                    Spacer()
                }
            } else if comments.isEmpty {
                VStack(spacing: 8) {
                    Text("No comments yet")
                        .font(.system(size: 15, weight: .medium))
                    Text("Be the first to comment")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            } else {
                ForEach(comments) { comment in
                    commentRow(comment)

                    if comment.id != comments.last?.id {
                        Rectangle()
                            .fill(MirrorTheme.borderColor)
                            .frame(height: 0.5)
                            .padding(.leading, 56)
                    }
                }
            }
        }
    }

    private func commentRow(_ comment: CommentModel) -> some View {
        HStack(alignment: .top, spacing: 10) {
            avatarView(url: comment.user?.avatarUrl, size: 32)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(comment.user?.username ?? "user")
                        .font(.system(size: 13, weight: .bold))

                    Text(relativeTime(from: comment.createdAt))
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }

                Text(comment.content)
                    .font(.system(size: 14))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Comment Input Bar

    private var commentInputBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(MirrorTheme.borderColor)
                .frame(height: 0.5)

            HStack(spacing: 12) {
                avatarView(url: appState.currentUser?.avatarUrl, size: 32)

                TextField("Add a comment...", text: $newComment)
                    .font(.system(size: 15))
                    .focused($isCommentFieldFocused)
                    .accessibilityLabel("Comment text field")
                    .accessibilityHint("Type your comment here")

                if !newComment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button {
                        sendComment()
                    } label: {
                        if isSendingComment {
                            ProgressView()
                                .tint(MirrorTheme.purple)
                                .scaleEffect(0.8)
                        } else {
                            Text("Post")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                        }
                    }
                    .disabled(isSendingComment)
                    .transition(.scale.combined(with: .opacity))
                    .accessibilityLabel("Post comment")
                    .accessibilityHint("Submits your comment")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
        }
    }

    // MARK: - Actions

    private func loadComments() async {
        isLoadingComments = true
        defer { isLoadingComments = false }

        do {
            let response = try await SocialService.shared.getComments(postId: currentPost.id)
            comments = response.map { resp in
                CommentModel(
                    id: resp.id,
                    postId: resp.postId,
                    userId: resp.userId,
                    content: resp.content,
                    user: resp.user.map {
                        PostUserInfo(fullName: $0.fullName, username: $0.username, avatarUrl: $0.avatarUrl)
                    },
                    createdAt: resp.createdAt
                )
            }
        } catch {
            Self.logger.error("Failed to load comments: \(error.localizedDescription)")
        }
    }

    private func sendComment() {
        let content = newComment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()

        isSendingComment = true
        let commentText = content
        newComment = ""

        Task {
            do {
                let response = try await SocialService.shared.addComment(
                    postId: currentPost.id,
                    content: commentText
                )
                let model = CommentModel(
                    id: response.id,
                    postId: response.postId,
                    userId: response.userId,
                    content: response.content,
                    user: response.user.map {
                        PostUserInfo(fullName: $0.fullName, username: $0.username, avatarUrl: $0.avatarUrl)
                    },
                    createdAt: response.createdAt
                )
                withAnimation(.spring(response: 0.3)) {
                    comments.append(model)
                }
                let notification = UINotificationFeedbackGenerator()
                notification.notificationOccurred(.success)
            } catch {
                newComment = commentText
                errorMessage = "Failed to post comment. Please try again."
                showError = true
                Self.logger.error("Failed to add comment: \(error.localizedDescription)")
            }
            isSendingComment = false
        }
    }

    private func triggerLikeAnimation() {
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        if currentPost.isLiked != true {
            Task { await appState.toggleLike(postId: currentPost.id) }
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

    private func avatarView(url: String?, size: CGFloat) -> some View {
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
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: dateString) else { return "" }
            return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
        }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: Date())
    }
}
