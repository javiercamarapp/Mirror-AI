import Foundation

// MARK: - API Response Wrapper

struct APIResponse<T: Decodable>: Decodable {
    let success: Bool
    let data: T?
    let error: String?
    let pagination: PaginationInfo?
}

struct PaginationInfo: Decodable {
    let page: Int?
    let limit: Int
    let total: Int
    let hasMore: Bool?
    let offset: Int?

    enum CodingKeys: String, CodingKey {
        case page, limit, total, offset
        case hasMore = "has_more"
    }
}

// MARK: - User Profile

struct UserProfileModel: Identifiable, Codable {
    let id: String
    var name: String
    var email: String
    var avatarUrl: String?
    var gender: String?
    var ageRange: String?
    var bodyShape: String?
    var height: Double?
    var weight: Double?
    var skinTone: String?
    var stylePreferences: [String]?
    var subscriptionPlan: String
    var onboardingCompleted: Bool
    var bodyPhotoUrl: String?
    var colorSeason: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, email, gender, height, weight
        case avatarUrl = "avatar_url"
        case ageRange = "age_range"
        case bodyShape = "body_shape"
        case skinTone = "skin_tone"
        case stylePreferences = "style_preferences"
        case subscriptionPlan = "subscription_plan"
        case onboardingCompleted = "onboarding_completed"
        case bodyPhotoUrl = "body_photo_url"
        case colorSeason = "color_season"
        case createdAt = "created_at"
    }
}

// MARK: - Wardrobe Item

struct WardrobeItemModel: Identifiable, Codable, Hashable {
    let id: String
    let userId: String
    var name: String
    var category: String
    var subcategory: String?
    var color: String
    var brand: String?
    var imageUrl: String
    var imageNoBgUrl: String?
    var season: [String]?
    var occasions: [String]?
    var wearCount: Int
    var isFavorite: Bool
    var lastWorn: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, category, subcategory, color, brand, season, occasions
        case userId = "user_id"
        case imageUrl = "image_url"
        case imageNoBgUrl = "image_no_bg_url"
        case wearCount = "wear_count"
        case isFavorite = "is_favorite"
        case lastWorn = "last_worn"
        case createdAt = "created_at"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: WardrobeItemModel, rhs: WardrobeItemModel) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Outfit (Saved)

struct OutfitModel: Identifiable, Codable {
    let id: String
    let userId: String
    var name: String
    var itemIds: [String]?
    var items: [WardrobeItemModel]?
    var occasion: String
    var score: Double?
    var aiFeedback: String?
    var imageUrl: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, items, occasion, score
        case userId = "user_id"
        case itemIds = "item_ids"
        case aiFeedback = "ai_feedback"
        case imageUrl = "image_url"
        case createdAt = "created_at"
    }
}

// MARK: - Daily Outfit

struct DailyOutfitModel: Identifiable, Codable {
    let id: String
    let userId: String
    let date: String
    var outfitData: [String: AnyCodable]?
    var imageUrl: String?
    var score: Double?
    var occasion: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, date, score, occasion
        case userId = "user_id"
        case outfitData = "outfit_data"
        case imageUrl = "image_url"
        case createdAt = "created_at"
    }
}

// MARK: - Outfit Suggestion (from AI generation)

struct OutfitSuggestionModel: Identifiable, Codable {
    var id: String { name }
    let name: String
    let itemIds: [String]
    let stylingTips: String
    let score: Double
    let reasoning: String
    var items: [WardrobeItemModel]?

    enum CodingKeys: String, CodingKey {
        case name, score, reasoning, items
        case itemIds = "item_ids"
        case stylingTips = "styling_tips"
    }
}

// MARK: - Social Post

struct SocialPostModel: Identifiable, Codable {
    let id: String
    let userId: String
    var type: String
    var imageUrl: String?
    var caption: String?
    var outfitData: [String: AnyCodable]?
    var outfitId: String?
    var occasion: String?
    var score: Double?
    var likesCount: Int = 0
    var commentsCount: Int = 0
    var isLiked: Bool = false
    var user: PostUserInfo?
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

struct PostUserInfo: Codable {
    let fullName: String?
    let username: String?
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case username
        case avatarUrl = "avatar_url"
    }
}

// MARK: - Story

struct StoryModel: Identifiable, Codable {
    let id: String
    let userId: String
    var imageUrl: String
    var caption: String?
    var outfitData: [String: AnyCodable]?
    var viewsCount: Int = 0
    var expiresAt: String?
    var isViewed: Bool = false
    var user: PostUserInfo?
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

struct StoryGroupModel: Identifiable, Codable {
    var id: String { user?.username ?? UUID().uuidString }
    let user: PostUserInfo?
    let stories: [StoryModel]
    let hasUnviewed: Bool

    enum CodingKeys: String, CodingKey {
        case user, stories
        case hasUnviewed = "has_unviewed"
    }
}

// MARK: - Comment

struct CommentModel: Identifiable, Codable {
    let id: String
    let postId: String
    let userId: String
    var content: String
    var user: PostUserInfo?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, content, user
        case postId = "post_id"
        case userId = "user_id"
        case createdAt = "created_at"
    }
}

// MARK: - Notification

struct NotificationModel: Identifiable, Codable {
    let id: String
    let userId: String
    var type: String
    var title: String
    var body: String?
    var data: [String: AnyCodable]?
    var read: Bool
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, type, title, body, data, read
        case userId = "user_id"
        case createdAt = "created_at"
    }
}

// MARK: - Friend Profile

struct FriendProfileModel: Identifiable, Codable {
    let id: String
    var fullName: String?
    var username: String?
    var avatarUrl: String?
    var styleScore: Double?
    var streakCount: Int?
    var stylePreferences: [String]?
    var friendshipId: String?
    var friendsSince: String?

    enum CodingKeys: String, CodingKey {
        case id
        case fullName = "full_name"
        case username
        case avatarUrl = "avatar_url"
        case styleScore = "style_score"
        case streakCount = "streak_count"
        case stylePreferences = "style_preferences"
        case friendshipId = "friendship_id"
        case friendsSince = "friends_since"
    }
}

// MARK: - Friend Request

struct FriendRequestModel: Identifiable, Codable {
    let id: String
    let requesterId: String
    var requester: FriendProfileModel?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, requester
        case requesterId = "requester_id"
        case createdAt = "created_at"
    }
}

// MARK: - User Search Result

struct UserSearchResultModel: Identifiable, Codable {
    let id: String
    var fullName: String?
    var username: String?
    var avatarUrl: String?
    var styleScore: Double?
    var friendshipStatus: String?
    var friendshipId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case fullName = "full_name"
        case username
        case avatarUrl = "avatar_url"
        case styleScore = "style_score"
        case friendshipStatus = "friendship_status"
        case friendshipId = "friendship_id"
    }
}

// MARK: - VTON

struct VTONHistoryModel: Identifiable, Codable {
    let id: String
    let userId: String
    var resultImageUrl: String
    var creditsUsed: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case resultImageUrl = "result_image_url"
        case creditsUsed = "credits_used"
        case createdAt = "created_at"
    }
}

struct VTONCreditsModel: Codable {
    let creditsRemaining: Int
    let creditsTotal: Int
    let plan: String

    enum CodingKeys: String, CodingKey {
        case plan
        case creditsRemaining = "credits_remaining"
        case creditsTotal = "credits_total"
    }
}

struct VTONGenerateResponse: Codable {
    let resultImageUrl: String
    let creditsRemaining: Int

    enum CodingKeys: String, CodingKey {
        case resultImageUrl = "result_image_url"
        case creditsRemaining = "credits_remaining"
    }
}

// MARK: - Wardrobe Stats

struct WardrobeStats: Codable {
    let totalItems: Int
    let byCategory: [String: Int]
    let byColor: [String: Int]
    let bySeason: [String: Int]
    let mostWorn: [WardrobeStatItem]
    let leastWorn: [WardrobeStatItem]
    let neverWornCount: Int
    let favoritesCount: Int

    enum CodingKeys: String, CodingKey {
        case totalItems = "total_items"
        case byCategory = "by_category"
        case byColor = "by_color"
        case bySeason = "by_season"
        case mostWorn = "most_worn"
        case leastWorn = "least_worn"
        case neverWornCount = "never_worn_count"
        case favoritesCount = "favorites_count"
    }
}

struct WardrobeStatItem: Codable, Identifiable {
    let id: String
    let name: String
    let category: String
    let wearCount: Int
    let imageUrl: String

    enum CodingKeys: String, CodingKey {
        case id, name, category
        case wearCount = "wear_count"
        case imageUrl = "image_url"
    }
}

// MARK: - Ranking Entry

struct RankingEntryModel: Identifiable, Codable {
    let id: String
    var rank: Int
    var fullName: String?
    var username: String?
    var avatarUrl: String?
    var styleScore: Double?
    var streakCount: Int?
    var isCurrentUser: Bool?

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

// MARK: - User Stats

struct UserStatsModel: Codable {
    let wardrobeCount: Int
    let outfitsCount: Int
    let postsCount: Int
    let streak: Int
    let averageScore: Double

    enum CodingKeys: String, CodingKey {
        case streak
        case wardrobeCount = "wardrobe_count"
        case outfitsCount = "outfits_count"
        case postsCount = "posts_count"
        case averageScore = "average_score"
    }
}

// MARK: - Streak Info

struct StreakInfoModel: Codable {
    let currentStreak: Int
    let longestStreak: Int
    let totalOutfits: Int
    let hasToday: Bool

    enum CodingKeys: String, CodingKey {
        case currentStreak = "current_streak"
        case longestStreak = "longest_streak"
        case totalOutfits = "total_outfits"
        case hasToday = "has_today"
    }
}

// MARK: - Subscription Info

struct SubscriptionInfoModel: Codable {
    let plan: String
    let limits: PlanLimits
    let vtonCreditsRemaining: Int

    enum CodingKeys: String, CodingKey {
        case plan, limits
        case vtonCreditsRemaining = "vton_credits_remaining"
    }
}

struct PlanLimits: Codable {
    let wardrobeLimit: Int
    let vtonCreditsMonthly: Int
    let aiChatsDaily: Int

    enum CodingKeys: String, CodingKey {
        case wardrobeLimit = "wardrobe_limit"
        case vtonCreditsMonthly = "vton_credits_monthly"
        case aiChatsDaily = "ai_chats_daily"
    }
}

// MARK: - Outfit Rating

struct OutfitRatingModel: Codable {
    let score: Double
    let overallFeedback: String
    let strengths: [String]
    let improvements: [String]
    let colorHarmony: Double
    let fitAssessment: String
    let styleCoherence: Double
    let occasionAppropriateness: Double

    enum CodingKeys: String, CodingKey {
        case score, strengths, improvements
        case overallFeedback = "overall_feedback"
        case colorHarmony = "color_harmony"
        case fitAssessment = "fit_assessment"
        case styleCoherence = "style_coherence"
        case occasionAppropriateness = "occasion_appropriateness"
    }
}

// MARK: - Like Toggle Response

struct LikeToggleResponse: Codable {
    let liked: Bool
}

// MARK: - Friendship Response

struct FriendshipResponse: Codable {
    let id: String
    let requesterId: String
    let addresseeId: String
    let status: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, status
        case requesterId = "requester_id"
        case addresseeId = "addressee_id"
        case createdAt = "created_at"
    }
}

// MARK: - Avatar

struct AvatarModel: Identifiable, Codable {
    let id: String
    let userId: String
    var baseImageUrl: String?
    var style: String
    var skinTone: String?
    var hairStyle: String?
    var bodyType: String?
    var customizations: [String: AnyCodable]?
    var isPremium: Bool
    let createdAt: String
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, style
        case userId = "user_id"
        case baseImageUrl = "base_image_url"
        case skinTone = "skin_tone"
        case hairStyle = "hair_style"
        case bodyType = "body_type"
        case customizations
        case isPremium = "is_premium"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct AvatarRenderModel: Identifiable, Codable {
    let id: String
    let userId: String
    let avatarId: String?
    var outfitItemIds: [String]?
    var renderUrl: String
    var style: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, style
        case userId = "user_id"
        case avatarId = "avatar_id"
        case outfitItemIds = "outfit_item_ids"
        case renderUrl = "render_url"
        case createdAt = "created_at"
    }
}

// MARK: - Credit Packs

struct CreditPackModel: Identifiable, Codable {
    let id: String
    let name: String
    let credits: Int
    let priceUsd: Double
    let productId: String
    let isActive: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, credits
        case priceUsd = "price_usd"
        case productId = "product_id"
        case isActive = "is_active"
    }
}

struct CreditPurchaseResponse: Codable {
    let creditsAdded: Int
    let newBalance: Int

    enum CodingKeys: String, CodingKey {
        case creditsAdded = "credits_added"
        case newBalance = "new_balance"
    }
}

// MARK: - Subscription Status

struct SubscriptionStatusModel: Codable {
    let plan: String
    let isActive: Bool
    let expiresAt: String?
    let limits: PlanLimits?
    let vtonCreditsRemaining: Int?

    enum CodingKeys: String, CodingKey {
        case plan
        case isActive = "is_active"
        case expiresAt = "expires_at"
        case limits
        case vtonCreditsRemaining = "vton_credits_remaining"
    }
}

// MARK: - AnyCodable (for arbitrary JSON fields)

struct AnyCodable: Codable, Hashable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dictionary = try? container.decode([String: AnyCodable].self) {
            value = dictionary.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if value is NSNull {
            try container.encodeNil()
        } else if let bool = value as? Bool {
            try container.encode(bool)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let string = value as? String {
            try container.encode(string)
        } else if let array = value as? [Any] {
            try container.encode(array.map { AnyCodable($0) })
        } else if let dictionary = value as? [String: Any] {
            try container.encode(dictionary.mapValues { AnyCodable($0) })
        } else {
            try container.encodeNil()
        }
    }

    static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        String(describing: lhs.value) == String(describing: rhs.value)
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(String(describing: value))
    }
}
