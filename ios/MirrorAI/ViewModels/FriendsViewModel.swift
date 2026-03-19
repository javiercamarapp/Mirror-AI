import SwiftUI
import Foundation
import os

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
    private let friendsService = FriendsService.shared
    private var searchTask: Task<Void, Never>?

    // MARK: - Load Friends

    func loadFriends() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await friendsService.getFriends()
            friends = result.map { $0.toProfileModel() }
        } catch {
            handleError(error, context: "loading friends")
        }
    }

    // MARK: - Pending Requests

    func loadPendingRequests() async {
        do {
            let result = try await friendsService.getPendingRequests()
            pendingRequests = result.map { $0.toRequestModel() }
        } catch {
            handleError(error, context: "loading pending requests")
        }
    }

    // MARK: - Search Users

    /// Search for users by username or name with debounce.
    func searchUsers(_ query: String) async {
        searchTask?.cancel()

        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            searchResults = []
            return
        }

        searchTask = Task {
            // Debounce 300ms
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }

            do {
                let results = try await friendsService.searchUsers(query: trimmed)
                guard !Task.isCancelled else { return }
                searchResults = results.map { $0.toSearchResultModel() }
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
            try await friendsService.sendRequest(userId: userId)
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
            try await friendsService.sendRequest(username: username)
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
            try await friendsService.acceptRequest(id: id)
            // Move from pending to friends
            if let index = pendingRequests.firstIndex(where: { $0.id == id }),
               let requester = pendingRequests[index].requester {
                pendingRequests.remove(at: index)
                friends.append(requester)
            } else {
                pendingRequests.removeAll { $0.id == id }
                await loadFriends()
            }
        } catch {
            handleError(error, context: "accepting friend request")
        }
    }

    // MARK: - Reject Friend Request

    func rejectRequest(_ id: String) async {
        do {
            try await friendsService.rejectRequest(id: id)
            pendingRequests.removeAll { $0.id == id }
        } catch {
            handleError(error, context: "rejecting friend request")
        }
    }

    // MARK: - Remove Friend

    func removeFriend(_ id: String) async {
        let removed = friends.first(where: { $0.id == id })
        friends.removeAll { $0.id == id }

        do {
            try await friendsService.removeFriend(id: id)
        } catch {
            if let removed {
                friends.append(removed)
            }
            handleError(error, context: "removing friend")
        }
    }

    // MARK: - Load Friend's Closet

    func loadFriendCloset(_ friendId: String) async -> [WardrobeItemModel] {
        do {
            let items = try await friendsService.getFriendCloset(friendId: friendId)
            return items.map { $0.toModel() }
        } catch {
            handleError(error, context: "loading friend's closet")
            return []
        }
    }

    // MARK: - Refresh All

    /// Reload both friends and pending requests in parallel.
    func refreshAll() async {
        isLoading = true
        defer { isLoading = false }

        async let f: () = loadFriends()
        async let p: () = loadPendingRequests()
        _ = await (f, p)
    }

    // MARK: - Private Helpers

    private static let logger = Logger(subsystem: "com.mirrorai", category: "FriendsViewModel")

    private func handleError(_ error: Error, context: String) {
        let message: String
        if let apiError = error as? APIError {
            message = apiError.errorDescription ?? "Unknown error"
        } else {
            message = error.localizedDescription
        }
        errorMessage = "Error \(context): \(message)"
        Self.logger.error("Error \(context): \(message)")
    }
}

// MARK: - FriendsService-to-AppModels Mapping

extension FriendProfile {
    func toProfileModel() -> FriendProfileModel {
        FriendProfileModel(
            id: id,
            fullName: fullName,
            username: username,
            avatarUrl: avatarUrl,
            styleScore: styleScore,
            streakCount: streakCount,
            stylePreferences: nil,
            friendshipId: nil,
            friendsSince: nil
        )
    }
}

extension FriendRequest {
    func toRequestModel() -> FriendRequestModel {
        FriendRequestModel(
            id: id,
            requesterId: requesterId,
            requester: requester?.toProfileModel(),
            createdAt: createdAt
        )
    }
}

extension UserSearchResult {
    func toSearchResultModel() -> UserSearchResultModel {
        UserSearchResultModel(
            id: id,
            fullName: fullName,
            username: username,
            avatarUrl: avatarUrl,
            styleScore: styleScore,
            friendshipStatus: friendshipStatus,
            friendshipId: nil
        )
    }
}
