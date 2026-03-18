import Foundation

// MARK: - Social Service

class SocialService {
    static let shared = SocialService()
    private let network = NetworkService.shared

    private init() {}

    // MARK: - Feed

    func getFeed(limit: Int = 20, offset: Int = 0) async throws -> [SocialPostResponse] {
        let queryParams = [
            "limit": String(limit),
            "offset": String(offset)
        ]

        let posts: [SocialPostResponse] = try await network.apiRequest(
            APIConfig.Endpoints.socialFeed,
            queryParams: queryParams
        )

        return posts
    }

    // MARK: - Create Post

    func createPost(
        type: String,
        imageUrl: String? = nil,
        caption: String? = nil,
        occasion: String? = nil,
        outfitData: [String: Any]? = nil
    ) async throws -> SocialPostResponse {
        var bodyDict: [String: Any] = ["type": type]

        if let imageUrl = imageUrl {
            bodyDict["image_url"] = imageUrl
        }
        if let caption = caption {
            bodyDict["caption"] = caption
        }
        if let occasion = occasion {
            bodyDict["occasion"] = occasion
        }
        if let outfitData = outfitData {
            bodyDict["outfit_data"] = outfitData
        }

        guard let token = await network.getAuthToken() else {
            throw APIError.noAuthToken
        }

        guard let url = URL(string: APIConfig.baseURL + APIConfig.Endpoints.socialPosts) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: bodyDict)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.httpError(statusCode: statusCode, message: "Failed to create post")
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let apiResponse = try decoder.decode(APIResponse<SocialPostResponse>.self, from: data)

        guard apiResponse.success, let post = apiResponse.data else {
            throw APIError.apiResponseError(apiResponse.error ?? "Failed to create post")
        }

        return post
    }

    // MARK: - Like / Unlike Post

    func likePost(id: String) async throws -> Bool {
        let endpoint = "\(APIConfig.Endpoints.socialPosts)/\(id)/like"

        let response: LikeToggleResponse = try await network.apiRequest(
            endpoint,
            method: "POST"
        )

        return response.liked
    }

    // MARK: - Get Comments

    func getComments(postId: String) async throws -> [CommentResponse] {
        let endpoint = "\(APIConfig.Endpoints.socialPosts)/\(postId)/comments"

        let comments: [CommentResponse] = try await network.apiRequest(endpoint)

        return comments
    }

    // MARK: - Add Comment

    func addComment(postId: String, content: String) async throws -> CommentResponse {
        let endpoint = "\(APIConfig.Endpoints.socialPosts)/\(postId)/comments"

        struct CommentRequest: Encodable {
            let content: String
        }

        let body = CommentRequest(content: content)

        let comment: CommentResponse = try await network.apiRequest(
            endpoint,
            method: "POST",
            body: body
        )

        return comment
    }

    // MARK: - Delete Post

    func deletePost(id: String) async throws {
        let endpoint = "\(APIConfig.Endpoints.socialPosts)/\(id)"

        struct EmptyResponse: Decodable {}

        let _: EmptyResponse = try await network.request(
            endpoint,
            method: "DELETE"
        )
    }

    // MARK: - Create Story

    func createStory(
        imageUrl: String,
        caption: String? = nil,
        outfitData: [String: Any]? = nil
    ) async throws -> StoryResponse {
        var bodyDict: [String: Any] = ["image_url": imageUrl]

        if let caption = caption {
            bodyDict["caption"] = caption
        }
        if let outfitData = outfitData {
            bodyDict["outfit_data"] = outfitData
        }

        guard let token = await network.getAuthToken() else {
            throw APIError.noAuthToken
        }

        guard let url = URL(string: APIConfig.baseURL + APIConfig.Endpoints.socialStories) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: bodyDict)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.httpError(statusCode: statusCode, message: "Failed to create story")
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let apiResponse = try decoder.decode(APIResponse<StoryResponse>.self, from: data)

        guard apiResponse.success, let story = apiResponse.data else {
            throw APIError.apiResponseError(apiResponse.error ?? "Failed to create story")
        }

        return story
    }

    // MARK: - Get Stories

    func getStories() async throws -> [StoryGroup] {
        let groups: [StoryGroup] = try await network.apiRequest(
            APIConfig.Endpoints.socialStories
        )

        return groups
    }

    // MARK: - View Story

    func viewStory(id: String) async throws {
        let endpoint = "\(APIConfig.Endpoints.socialStories)/\(id)/view"

        struct EmptyResponse: Decodable {}

        let _: EmptyResponse = try await network.request(
            endpoint,
            method: "POST"
        )
    }

    // MARK: - Get Rankings

    func getRankings() async throws -> [RankingEntry] {
        let rankings: [RankingEntry] = try await network.apiRequest(
            APIConfig.Endpoints.socialRankings
        )

        return rankings
    }
}

// MARK: - Social Response Models

struct SocialPostResponse: Codable, Identifiable {
    let id: String
    let userId: String
    var type: String
    var imageUrl: String?
    var caption: String?
    var outfitData: [String: AnyCodable]?
    var outfitId: String?
    var occasion: String?
    var score: Double?
    var likesCount: Int
    var commentsCount: Int
    var isLiked: Bool
    var user: SocialUserInfo?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, type, caption, occasion, score, user
        case userId = "user_id"
        case imageUrl = "image_url"
        case outfitData = "outfit_data"
        case outfitId = "outfit_id"
        case likesCount = "likes_count"
        case commentsCount = "comments_count"
        case isLiked = "is_liked"
        case createdAt = "created_at"
    }
}

struct SocialUserInfo: Codable {
    let fullName: String?
    let username: String?
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case username
        case avatarUrl = "avatar_url"
    }
}

struct CommentResponse: Codable, Identifiable {
    let id: String
    let postId: String
    let userId: String
    var content: String
    var user: SocialUserInfo?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, content, user
        case postId = "post_id"
        case userId = "user_id"
        case createdAt = "created_at"
    }
}

struct StoryResponse: Codable, Identifiable {
    let id: String
    let userId: String
    var imageUrl: String
    var caption: String?
    var outfitData: [String: AnyCodable]?
    var viewsCount: Int
    var expiresAt: String?
    var isViewed: Bool
    var user: SocialUserInfo?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, caption, user
        case userId = "user_id"
        case imageUrl = "image_url"
        case outfitData = "outfit_data"
        case viewsCount = "views_count"
        case expiresAt = "expires_at"
        case isViewed = "is_viewed"
        case createdAt = "created_at"
    }
}

struct StoryGroup: Codable, Identifiable {
    var id: String { user?.username ?? UUID().uuidString }
    let user: SocialUserInfo?
    let stories: [StoryResponse]
    let hasUnviewed: Bool

    enum CodingKeys: String, CodingKey {
        case user, stories
        case hasUnviewed = "has_unviewed"
    }
}

struct RankingEntry: Codable, Identifiable {
    let id: String
    var rank: Int
    var fullName: String?
    var username: String?
    var avatarUrl: String?
    var styleScore: Double?
    var streakCount: Int?
    var isCurrentUser: Bool

    enum CodingKeys: String, CodingKey {
        case id, rank
        case fullName = "full_name"
        case username
        case avatarUrl = "avatar_url"
        case styleScore = "style_score"
        case streakCount = "streak_count"
        case isCurrentUser = "is_current_user"
    }
}
