import SwiftUI

struct CommentsSheetView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let postId: String

    @State private var comments: [CommentModel] = []
    @State private var newComment = ""
    @State private var isLoading = false
    @State private var isSending = false
    @FocusState private var isInputFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground)
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Comments list
                    commentsList

                    // Input bar
                    commentInputBar
                }
            }
            .navigationTitle("Comments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .task {
                await loadComments()
            }
        }
    }

    // MARK: - Comments List

    private var commentsList: some View {
        Group {
            if isLoading {
                VStack {
                    Spacer()
                    ProgressView()
                        .tint(MirrorTheme.purple)
                        .scaleEffect(1.2)
                    Spacer()
                }
            } else if comments.isEmpty {
                VStack(spacing: 16) {
                    Spacer()

                    ZStack {
                        Circle()
                            .fill(MirrorTheme.purple.opacity(0.1))
                            .frame(width: 80, height: 80)

                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.system(size: 32))
                            .foregroundStyle(MirrorTheme.gradientPrimary)
                    }

                    Text("No Comments Yet")
                        .font(.system(size: 18, weight: .bold))

                    Text("Start the conversation")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)

                    Spacer()
                }
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(comments.enumerated()), id: \.element.id) { index, comment in
                            commentCell(comment, index: index)

                            if index < comments.count - 1 {
                                Rectangle()
                                    .fill(MirrorTheme.borderColor)
                                    .frame(height: 0.5)
                                    .padding(.leading, 60)
                            }
                        }
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 16)
                }
            }
        }
    }

    // MARK: - Comment Cell

    private func commentCell(_ comment: CommentModel, index: Int) -> some View {
        HStack(alignment: .top, spacing: 12) {
            // Avatar
            avatarView(url: comment.user?.avatarUrl, size: 36)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(comment.user?.username ?? comment.user?.fullName ?? "User")
                        .font(.system(size: 14, weight: .bold))

                    Text(relativeTime(from: comment.createdAt))
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }

                Text(comment.content)
                    .font(.system(size: 14))
                    .fixedSize(horizontal: false, vertical: true)

                // Like button for comment
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                } label: {
                    Text("Reply")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 2)
            }

            Spacer(minLength: 0)

            // Heart icon
            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
            } label: {
                Image(systemName: "heart")
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .opacity(0)
        .animation(.easeOut(duration: 0.3).delay(Double(index) * 0.05), value: comments.count)
        .onAppear {
            // Trigger animation
        }
        .modifier(FadeInModifier(delay: Double(index) * 0.05))
    }

    // MARK: - Comment Input Bar

    private var commentInputBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(MirrorTheme.borderColor)
                .frame(height: 0.5)

            HStack(spacing: 12) {
                avatarView(url: appState.currentUser?.avatarUrl, size: 34)

                HStack(spacing: 8) {
                    TextField("Add a comment...", text: $newComment, axis: .vertical)
                        .font(.system(size: 15))
                        .lineLimit(4)
                        .focused($isInputFocused)

                    if !newComment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            sendComment()
                        } label: {
                            if isSending {
                                ProgressView()
                                    .tint(MirrorTheme.purple)
                                    .scaleEffect(0.7)
                            } else {
                                Image(systemName: "arrow.up.circle.fill")
                                    .font(.system(size: 28))
                                    .foregroundStyle(MirrorTheme.gradientPrimary)
                            }
                        }
                        .disabled(isSending)
                        .transition(.scale.combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    Capsule()
                        .fill(MirrorTheme.surfaceColor)
                        .overlay(
                            Capsule()
                                .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                        )
                )
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
        }
    }

    // MARK: - Actions

    private func loadComments() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await SocialService.shared.getComments(postId: postId)
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
            print("[CommentsSheet] Failed to load comments: \(error)")
        }
    }

    private func sendComment() {
        let content = newComment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()

        isSending = true
        let commentText = content
        newComment = ""

        Task {
            do {
                let response = try await SocialService.shared.addComment(
                    postId: postId,
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
                print("[CommentsSheet] Failed to add comment: \(error)")
            }
            isSending = false
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

// MARK: - Fade In Modifier

private struct FadeInModifier: ViewModifier {
    let delay: Double
    @State private var isVisible = false

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .offset(y: isVisible ? 0 : 10)
            .onAppear {
                withAnimation(.easeOut(duration: 0.3).delay(delay)) {
                    isVisible = true
                }
            }
    }
}
