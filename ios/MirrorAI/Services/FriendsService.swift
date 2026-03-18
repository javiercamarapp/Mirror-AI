import Foundation

// MARK: - Friends Service

class FriendsService {
    static let shared = FriendsService()
    private let network = NetworkService.shared

    private init() {}

    // MARK: - Get Friends List

    func getFriends() async throws -> [FriendProfile] {
        let friends: [FriendProfile] = try await network.apiRequest(
            APIConfig.Endpoints.friends
        )
        return friends
    }

    // MARK: - Send Friend Request

    func sendRequest(userId: String? = nil, username: String? = nil) async throws {
        struct FriendRequestBody: Encodable {
            let userId: String?
            let username: String?
        }

        let body = FriendRequestBody(userId: userId, username: username)

        struct RequestResponse: Decodable {
            let id: String
            let status: String
        }

        let _: RequestResponse = try await network.apiRequest(
            APIConfig.Endpoints.friendsRequest,
            method: "POST",
            body: body
        )
    }

    // MARK: - Get Pending Requests

    func getPendingRequests() async throws -> [FriendRequest] {
        let requests: [FriendRequest] = try await network.apiRequest(
            APIConfig.Endpoints.friendsRequests
        )
        return requests
    }

    // MARK: - Accept Friend Request

    func acceptRequest(id: String) async throws {
        let endpoint = "\(APIConfig.Endpoints.friendsRequests)/\(id)/accept"

        struct EmptyResponse: Decodable {}

        let _: EmptyResponse = try await network.request(
            endpoint,
            method: "POST"
        )
    }

    // MARK: - Reject Friend Request

    func rejectRequest(id: String) async throws {
        let endpoint = "\(APIConfig.Endpoints.friendsRequests)/\(id)/reject"

        struct EmptyResponse: Decodable {}

        let _: EmptyResponse = try await network.request(
            endpoint,
            method: "POST"
        )
    }

    // MARK: - Remove Friend

    func removeFriend(id: String) async throws {
        let endpoint = "\(APIConfig.Endpoints.friends)/\(id)"

        struct EmptyResponse: Decodable {}

        let _: EmptyResponse = try await network.request(
            endpoint,
            method: "DELETE"
        )
    }

    // MARK: - Search Users

    func searchUsers(query: String) async throws -> [UserSearchResult] {
        let queryParams = ["q": query]

        let results: [UserSearchResult] = try await network.apiRequest(
            APIConfig.Endpoints.friendsSearch,
            queryParams: queryParams
        )

        return results
    }

    // MARK: - Get Friend's Closet

    func getFriendCloset(friendId: String) async throws -> [WardrobeItemResponse] {
        let endpoint = "\(APIConfig.Endpoints.friends)/\(friendId)/closet"

        let items: [WardrobeItemResponse] = try await network.apiRequest(endpoint)

        return items
    }

    // MARK: - Get Friend's Outfits

    func getFriendOutfits(friendId: String) async throws -> [SocialPostResponse] {
        let endpoint = "\(APIConfig.Endpoints.friends)/\(friendId)/outfits"

        let posts: [SocialPostResponse] = try await network.apiRequest(endpoint)

        return posts
    }
}

// MARK: - Friend Response Models

struct FriendProfile: Codable, Identifiable {
    let id: String
    var fullName: String?
    var username: String?
    var avatarUrl: String?
    var styleScore: Double?
    var streakCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case fullName = "full_name"
        case username
        case avatarUrl = "avatar_url"
        case styleScore = "style_score"
        case streakCount = "streak_count"
    }
}

struct FriendRequest: Codable, Identifiable {
    let id: String
    let requesterId: String
    var requester: FriendProfile?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, requester
        case requesterId = "requester_id"
        case createdAt = "created_at"
    }
}

struct UserSearchResult: Codable, Identifiable {
    let id: String
    var fullName: String?
    var username: String?
    var avatarUrl: String?
    var styleScore: Double?
    var friendshipStatus: String?

    enum CodingKeys: String, CodingKey {
        case id
        case fullName = "full_name"
        case username
        case avatarUrl = "avatar_url"
        case styleScore = "style_score"
        case friendshipStatus = "friendship_status"
    }
}
