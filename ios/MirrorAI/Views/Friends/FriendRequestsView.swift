import SwiftUI

struct FriendRequestsView: View {
    @Environment(\.dismiss) private var dismiss
    var friendsVM: FriendsViewModel
    @State private var appearAnimation = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                if friendsVM.pendingRequests.isEmpty && !friendsVM.isLoading {
                    EmptyStateView(
                        icon: "person.badge.clock",
                        title: "No Pending Requests",
                        description: "When someone sends you a friend request, it will appear here."
                    )
                } else {
                    ScrollView(showsIndicators: false) {
                        LazyVStack(spacing: 12) {
                            ForEach(Array(friendsVM.pendingRequests.enumerated()), id: \.element.id) { index, request in
                                requestRow(request)
                                    .opacity(appearAnimation ? 1 : 0)
                                    .offset(y: appearAnimation ? 0 : 20)
                                    .animation(
                                        .spring(response: 0.5, dampingFraction: 0.8)
                                            .delay(Double(index) * 0.06),
                                        value: appearAnimation
                                    )
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .padding(.bottom, 40)
                    }
                }

                if friendsVM.isLoading {
                    LoadingOverlay(message: "Loading requests...")
                }
            }
            .navigationTitle("Friend Requests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .task {
                await friendsVM.loadPendingRequests()
                withAnimation { appearAnimation = true }
            }
        }
    }

    // MARK: - Request Row

    private func requestRow(_ request: FriendRequestModel) -> some View {
        GlassCard {
            HStack(spacing: 14) {
                // Avatar
                ZStack {
                    Circle()
                        .fill(MirrorTheme.surfaceColor)
                        .frame(width: 52, height: 52)

                    if let avatarUrl = request.requester?.avatarUrl, !avatarUrl.isEmpty {
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
                    Text(request.requester?.fullName ?? "Unknown")
                        .font(.system(size: 16, weight: .semibold))

                    if let username = request.requester?.username {
                        Text("@\(username)")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }

                    Text(timeAgo(from: request.createdAt))
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                // Action buttons
                HStack(spacing: 8) {
                    Button {
                        Task {
                            await friendsVM.rejectRequest(request.id)
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred()
                        }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.secondary)
                            .frame(width: 40, height: 40)
                            .background(
                                Circle()
                                    .fill(MirrorTheme.surfaceColor)
                                    .overlay(
                                        Circle()
                                            .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                                    )
                            )
                    }
                    .accessibilityLabel("Reject request from \(request.requester?.fullName ?? "unknown")")
                    .accessibilityHint("Declines this friend request")

                    Button {
                        Task {
                            await friendsVM.acceptRequest(request.id)
                            let notification = UINotificationFeedbackGenerator()
                            notification.notificationOccurred(.success)
                        }
                    } label: {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(
                                Circle()
                                    .fill(MirrorTheme.gradientPrimary)
                            )
                    }
                    .accessibilityLabel("Accept request from \(request.requester?.fullName ?? "unknown")")
                    .accessibilityHint("Accepts this friend request")
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Helpers

    private func timeAgo(from dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else { return "" }
        let interval = Date().timeIntervalSince(date)

        if interval < 60 { return "Just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86400))d ago"
    }
}
