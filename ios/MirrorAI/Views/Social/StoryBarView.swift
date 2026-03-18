import SwiftUI

struct StoryBarView: View {
    @Environment(AppState.self) private var appState

    var onStoryTapped: (StoryGroupModel) -> Void
    var onCreateTapped: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 14) {
                // Create story button
                createStoryButton
                    .padding(.leading, 16)

                // Story groups
                ForEach(appState.stories) { group in
                    storyAvatar(group: group)
                        .onTapGesture {
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred()
                            onStoryTapped(group)
                        }
                }
            }
            .padding(.trailing, 16)
            .padding(.vertical, 10)
        }
    }

    // MARK: - Create Story Button

    private var createStoryButton: some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            onCreateTapped()
        } label: {
            VStack(spacing: 6) {
                ZStack {
                    Circle()
                        .fill(MirrorTheme.surfaceColor)
                        .frame(width: 68, height: 68)
                        .overlay(
                            Circle()
                                .strokeBorder(
                                    MirrorTheme.borderColor,
                                    lineWidth: 2
                                )
                        )

                    // User avatar in background
                    if let avatarUrl = appState.currentUser?.avatarUrl,
                       let url = URL(string: avatarUrl) {
                        CachedAsyncImage(url: url) {
                            Image(systemName: "person.fill")
                                .font(.system(size: 24))
                                .foregroundStyle(.tertiary)
                        }
                        .frame(width: 68, height: 68)
                        .clipShape(Circle())
                    }

                    // Plus badge
                    ZStack {
                        Circle()
                            .fill(MirrorTheme.purple)
                            .frame(width: 24, height: 24)

                        Image(systemName: "plus")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .offset(x: 24, y: 24)
                }

                Text("Your Story")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: 76)
        }
    }

    // MARK: - Story Avatar

    private func storyAvatar(group: StoryGroupModel) -> some View {
        VStack(spacing: 6) {
            ZStack {
                // Gradient ring for unviewed
                Circle()
                    .strokeBorder(
                        group.hasUnviewed
                            ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                            : AnyShapeStyle(Color.gray.opacity(0.3)),
                        lineWidth: group.hasUnviewed ? 3 : 2
                    )
                    .frame(width: 72, height: 72)

                // Avatar image
                if let avatarUrl = group.user?.avatarUrl,
                   let url = URL(string: avatarUrl) {
                    CachedAsyncImage(url: url) {
                        Circle()
                            .fill(MirrorTheme.surfaceColor)
                            .overlay {
                                Image(systemName: "person.fill")
                                    .font(.system(size: 22))
                                    .foregroundStyle(.tertiary)
                            }
                    }
                    .frame(width: 64, height: 64)
                    .clipShape(Circle())
                } else {
                    Circle()
                        .fill(MirrorTheme.surfaceColor)
                        .frame(width: 64, height: 64)
                        .overlay {
                            Image(systemName: "person.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(.tertiary)
                        }
                }
            }

            Text(group.user?.username ?? group.user?.fullName ?? "User")
                .font(.system(size: 11))
                .foregroundStyle(group.hasUnviewed ? .primary : .secondary)
                .lineLimit(1)
        }
        .frame(width: 76)
    }
}
