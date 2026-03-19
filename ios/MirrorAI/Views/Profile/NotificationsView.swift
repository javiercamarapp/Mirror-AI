import SwiftUI

struct NotificationsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = true
    @State private var appearAnimation = false

    private var todayNotifications: [NotificationModel] {
        appState.notifications.filter { isToday($0.createdAt) }
    }

    private var earlierNotifications: [NotificationModel] {
        appState.notifications.filter { !isToday($0.createdAt) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                if isLoading {
                    VStack {
                        Spacer()
                        ProgressView()
                            .tint(MirrorTheme.purple)
                            .scaleEffect(1.2)
                        Spacer()
                    }
                } else if appState.notifications.isEmpty {
                    EmptyStateView(
                        icon: "bell.slash",
                        title: "No Notifications",
                        description: "You're all caught up! New notifications will appear here."
                    )
                } else {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 20) {
                            if !todayNotifications.isEmpty {
                                notificationSection(title: "Today", notifications: todayNotifications)
                            }

                            if !earlierNotifications.isEmpty {
                                notificationSection(title: "Earlier", notifications: earlierNotifications)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .padding(.bottom, 40)
                    }
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if appState.unreadNotificationCount > 0 {
                        Button {
                            markAllRead()
                        } label: {
                            Text("Mark All Read")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(MirrorTheme.purple)
                        }
                        .accessibilityLabel("Mark all as read")
                        .accessibilityHint("Marks all notifications as read")
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .task {
                await appState.loadNotifications()
                isLoading = false
                withAnimation(.easeOut(duration: 0.3)) { appearAnimation = true }
            }
        }
    }

    // MARK: - Notification Section

    private func notificationSection(title: String, notifications: [NotificationModel]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)

            ForEach(Array(notifications.enumerated()), id: \.element.id) { index, notification in
                notificationRow(notification)
                    .opacity(appearAnimation ? 1 : 0)
                    .offset(y: appearAnimation ? 0 : 15)
                    .animation(
                        .spring(response: 0.5, dampingFraction: 0.8)
                            .delay(Double(index) * 0.04),
                        value: appearAnimation
                    )
            }
        }
    }

    // MARK: - Notification Row

    private func notificationRow(_ notification: NotificationModel) -> some View {
        Button {
            if !notification.read {
                Task {
                    await appState.markNotificationRead(notification.id)
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                }
            }
        } label: {
            HStack(spacing: 14) {
                // Icon
                ZStack {
                    Circle()
                        .fill(iconColor(for: notification.type).opacity(0.12))
                        .frame(width: 44, height: 44)

                    Image(systemName: iconName(for: notification.type))
                        .font(.system(size: 18))
                        .foregroundStyle(iconColor(for: notification.type))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(notification.title)
                        .font(.system(size: 15, weight: notification.read ? .medium : .bold))
                        .foregroundStyle(.primary)

                    if let body = notification.body {
                        Text(body)
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }

                    Text(timeAgo(from: notification.createdAt))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                // Unread indicator
                if !notification.read {
                    Circle()
                        .fill(MirrorTheme.purple)
                        .frame(width: 10, height: 10)
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(notification.read ? .clear : MirrorTheme.purple.opacity(0.04))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(
                                notification.read ? MirrorTheme.borderColor : MirrorTheme.purple.opacity(0.2),
                                lineWidth: 1
                            )
                    )
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(notification.title)\(notification.body.map { ". \($0)" } ?? ""). \(timeAgo(from: notification.createdAt))")
        .accessibilityValue(notification.read ? "Read" : "Unread")
        .accessibilityHint(notification.read ? "" : "Double tap to mark as read")
    }

    // MARK: - Helpers

    private func iconName(for type: String) -> String {
        switch type {
        case "like": return "heart.fill"
        case "comment": return "bubble.left.fill"
        case "friend_request": return "person.badge.plus"
        case "friend_accepted": return "person.2.fill"
        case "outfit": return "tshirt.fill"
        case "streak": return "flame.fill"
        case "achievement": return "trophy.fill"
        case "vton": return "person.fill.viewfinder"
        default: return "bell.fill"
        }
    }

    private func iconColor(for type: String) -> Color {
        switch type {
        case "like": return .red
        case "comment": return .blue
        case "friend_request", "friend_accepted": return MirrorTheme.purple
        case "outfit": return MirrorTheme.pink
        case "streak": return .orange
        case "achievement": return Color(hex: "FFD700")
        case "vton": return MirrorTheme.indigo
        default: return .gray
        }
    }

    private func isToday(_ dateString: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else { return false }
        return Calendar.current.isDateInToday(date)
    }

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

    private func markAllRead() {
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.impactOccurred()
        for notification in appState.notifications where !notification.read {
            Task {
                await appState.markNotificationRead(notification.id)
            }
        }
    }
}
