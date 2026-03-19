import SwiftUI

struct SearchUsersView: View {
    @Environment(\.dismiss) private var dismiss
    var friendsVM: FriendsViewModel
    @State private var searchText = ""
    @State private var debounceTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                VStack(spacing: 0) {
                    // Search field
                    HStack(spacing: 12) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 16))
                            .foregroundStyle(.secondary)

                        TextField("Search by name or username", text: $searchText)
                            .font(.system(size: 16))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .onChange(of: searchText) { _, newValue in
                                debounceSearch(newValue)
                            }

                        if !searchText.isEmpty {
                            Button {
                                searchText = ""
                                friendsVM.searchResults = []
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 16))
                                    .foregroundStyle(.tertiary)
                            }
                            .accessibilityLabel("Clear search")
                        }
                    }
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(MirrorTheme.surfaceColor)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                            )
                    )
                    .padding(.horizontal, 20)
                    .padding(.top, 8)

                    if searchText.isEmpty {
                        // Prompt state
                        VStack(spacing: 16) {
                            Spacer()

                            Image(systemName: "person.2.badge.gearshape")
                                .font(.system(size: 48))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                                .symbolEffect(.pulse, options: .repeating.speed(0.5))

                            Text("Find People")
                                .font(.system(size: 20, weight: .bold))

                            Text("Search for friends by their name or username")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 40)

                            Spacer()
                        }
                    } else if friendsVM.searchResults.isEmpty && !friendsVM.isLoading {
                        VStack(spacing: 16) {
                            Spacer()

                            Image(systemName: "person.slash")
                                .font(.system(size: 40))
                                .foregroundStyle(.secondary)

                            Text("No results found")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(.secondary)

                            Spacer()
                        }
                    } else {
                        ScrollView(showsIndicators: false) {
                            LazyVStack(spacing: 10) {
                                ForEach(friendsVM.searchResults) { user in
                                    searchResultRow(user)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.top, 16)
                            .padding(.bottom, 40)
                        }
                    }
                }

                if friendsVM.isLoading {
                    ProgressView()
                        .controlSize(.large)
                        .tint(MirrorTheme.purple)
                }
            }
            .navigationTitle("Find Friends")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    // MARK: - Search Result Row

    private func searchResultRow(_ user: UserSearchResultModel) -> some View {
        GlassCard {
            HStack(spacing: 14) {
                // Avatar
                ZStack {
                    Circle()
                        .fill(MirrorTheme.surfaceColor)
                        .frame(width: 48, height: 48)

                    if let avatarUrl = user.avatarUrl, !avatarUrl.isEmpty {
                        CachedAsyncImage(url: URL(string: avatarUrl)) {
                            Image(systemName: "person.fill")
                                .font(.system(size: 18))
                                .foregroundStyle(.tertiary)
                        }
                        .frame(width: 48, height: 48)
                        .clipShape(Circle())
                    } else {
                        Image(systemName: "person.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(MirrorTheme.gradientPrimary)
                    }
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(user.fullName ?? "User")
                        .font(.system(size: 15, weight: .semibold))

                    if let username = user.username {
                        Text("@\(username)")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                statusButton(for: user)
            }
        }
        .transition(.opacity.combined(with: .move(edge: .trailing)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(user.fullName ?? "User")\(user.username != nil ? ", @\(user.username!)" : "")")
    }

    @ViewBuilder
    private func statusButton(for user: UserSearchResultModel) -> some View {
        let status = user.friendshipStatus ?? "none"

        switch status {
        case "accepted", "friends":
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 13))
                Text("Friends")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.green)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule()
                    .fill(Color.green.opacity(0.12))
            )

        case "pending":
            HStack(spacing: 4) {
                Image(systemName: "clock.fill")
                    .font(.system(size: 13))
                Text("Pending")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.orange)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule()
                    .fill(Color.orange.opacity(0.12))
            )

        default:
            Button {
                Task {
                    await friendsVM.sendRequest(userId: user.id)
                    let impact = UIImpactFeedbackGenerator(style: .medium)
                    impact.impactOccurred()
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 13))
                    Text("Add")
                        .font(.system(size: 13, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    Capsule()
                        .fill(MirrorTheme.gradientPrimary)
                )
            }
            .accessibilityLabel("Send friend request")
            .accessibilityHint("Sends a friend request to \(user.fullName ?? "this user")")
        }
    }

    // MARK: - Debounce

    private func debounceSearch(_ query: String) {
        debounceTask?.cancel()
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await friendsVM.searchUsers(query)
        }
    }
}
