import SwiftUI
import Foundation

@Observable
@MainActor
class FriendsViewModel {
    // ─── State ───────────────────────────────────────────────────────────
    var friends: [FriendProfileModel] = []
    var pendingRequests: [FriendRequestModel] = []
    var searchResults: [UserSearchResultModel] = []
    var isLoading = false
    var searchQuery = ""
    var errorMessage: String?

    // ─── Private ─────────────────────────────────────────────────────────
    private let network = NetworkService.shared
    private var searchTask: Task<Void, Never>?

    // MARK: - Load Friends

    func loadFriends() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let result: [FriendProfileModel] = try await network.apiRequest(
                APIConfig.Endpoints.friends
            )
            friends = result
        } catch {
            handleError(error, context: "loading friends")
        }
    }

    // MARK: - Pending Requests

    func loadPendingRequests() async {
        do {
            let result: [FriendRequestModel] = try await network.apiRequest(
                APIConfig.Endpoints.friendsRequests
            )
            pendingRequests = result
        } catch {
            handleError(error, context: "loading pending requests")
        }
    }

    // MARK: - Search Users

    /// Search for users by username or name with debounce
    func searchUsers(_ query: String) async {
        // Cancel any in-flight search
        searchTask?.cancel()

        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            searchResults = []
            return
        }

        searchTask = Task {
            // Debounce: wait 300ms before firing request
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }

            do {
                let results: [UserSearchResultModel] = try await network.apiRequest(
                    APIConfig.Endpoints.friendsSearch,
                    queryParams: ["q": trimmed]
                )
                guard !Task.isCancelled else { return }
                searchResults = results
            } catch {
                guard !Task.isCancelled else { return }
                handleError(error, context: "searching users")
            }
        }

        await searchTask?.value
    }

    // MARK: - Send Friend Request (by user ID)

    func sendRequest(userId: String) async {
        do {
            let _: FriendshipResponse = try await network.apiRequest(
                APIConfig.Endpoints.friendsRequest,
                method: "POST",
                body: FriendRequestBody(userId: userId, username: nil)
            )
            // Update the search result to reflect pending status
            if let index = searchResults.firstIndex(where: { $0.id == userId }) {
                searchResults[index].friendshipStatus = "pending"
            }
        } catch {
            handleError(error, context: "sending friend request")
        }
    }

    // MARK: - Send Friend Request (by username)

    func sendRequestByUsername(_ username: String) async {
        do {
            let _: FriendshipResponse = try await network.apiRequest(
                APIConfig.Endpoints.friendsRequest,
                method: "POST",
                body: FriendRequestBody(userId: nil, username: username)
            )
            // Update the search result to reflect pending status
            if let index = searchResults.firstIndex(where: { $0.username == username }) {
                searchResults[index].friendshipStatus = "pending"
            }
        } catch {
            handleError(error, context: "sending friend request by username")
        }
    }

    // MARK: - Accept Friend Request

    func acceptRequest(_ id: String) async {
        do {
            let _: FriendshipResponse = try await network.apiRequest(
                "\(APIConfig.Endpoints.friendsRequests)/\(id)/accept",
                method: "POST"
            )
            // Move from pending to friends
            if let index = pendingRequests.firstIndex(where: { $0.id == id }),
               let requester = pendingRequests[index].requester {
                pendingRequests.remove(at: index)
                friends.append(requester)
            } else {
                pendingRequests.removeAll { $0.id == id }
                // Reload friends to get the updated list
                await loadFriends()
            }
        } catch {
            handleError(error, context: "accepting friend request")
        }
    }

    // MARK: - Reject Friend Request

    func rejectRequest(_ id: String) async {
        do {
            let _: APIResponse<EmptyData> = try await network.request(
                "\(APIConfig.Endpoints.friendsRequests)/\(id)/reject",
                method: "POST"
            )
            pendingRequests.removeAll { $0.id == id }
        } catch {
            handleError(error, context: "rejecting friend request")
        }
    }

    // MARK: - Remove Friend

    func removeFriend(_ id: String) async {
        // Optimistic removal
        let removed = friends.first(where: { $0.id == id })
        friends.removeAll { $0.id == id }

        do {
            let _: APIResponse<EmptyData> = try await network.request(
                "\(APIConfig.Endpoints.friends)/\(id)",
                method: "DELETE"
            )
        } catch {
            // Revert on failure
            if let removed {
                friends.append(removed)
            }
            handleError(error, context: "removing friend")
        }
    }

    // MARK: - Load Friend's Closet

    func loadFriendCloset(_ friendId: String) async -> [WardrobeItemModel] {
        do {
            let items: [WardrobeItemModel] = try await network.apiRequest(
                "\(APIConfig.Endpoints.friends)/\(friendId)/closet"
            )
            return items
        } catch {
            handleError(error, context: "loading friend's closet")
            return []
        }
    }

    // MARK: - Refresh All

    /// Convenience to reload both friends and pending requests in parallel
    func refreshAll() async {
        isLoading = true
        defer { isLoading = false }

        async let f: () = loadFriends()
        async let p: () = loadPendingRequests()
        _ = await (f, p)
    }

    // MARK: - Private Helpers

    private func handleError(_ error: Error, context: String) {
        let message: String
        if let apiError = error as? APIError {
            message = apiError.errorDescription ?? "Unknown error"
        } else {
            message = error.localizedDescription
        }
        errorMessage = "Error \(context): \(message)"
        print("[FriendsViewModel] Error \(context): \(message)")
    }
}

// MARK: - Request Body

private struct FriendRequestBody: Encodable {
    let userId: String?
    let username: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case username
    }
}
