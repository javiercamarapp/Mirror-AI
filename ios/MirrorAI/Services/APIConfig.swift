import Foundation

enum APIConfig {
    #if DEBUG
    static let baseURL = "https://mirror-ai-backend-staging.fly.dev"
    #else
    static let baseURL = "https://mirror-ai-backend.fly.dev"
    #endif

    // Supabase – values are read from the build environment / Info.plist at runtime.
    static var supabaseURL: String {
        Bundle.main.infoDictionary?["SUPABASE_URL"] as? String
            ?? ProcessInfo.processInfo.environment["SUPABASE_URL"]
            ?? "https://your-project.supabase.co"
    }

    static var supabaseAnonKey: String {
        Bundle.main.infoDictionary?["SUPABASE_ANON_KEY"] as? String
            ?? ProcessInfo.processInfo.environment["SUPABASE_ANON_KEY"]
            ?? ""
    }

    // Endpoints
    enum Endpoints {
        static let health = "/api/health"

        // Auth
        static let authSignup = "/api/auth/signup"
        static let authCallback = "/api/auth/callback"

        // User
        static let userProfile = "/api/user/profile"
        static let userOnboarding = "/api/user/onboarding"
        static let userSubscription = "/api/user/subscription"
        static let userAvatar = "/api/user/avatar"
        static let userStats = "/api/user/stats"
        static let userNotifications = "/api/user/notifications"

        // Wardrobe
        static let wardrobe = "/api/wardrobe"
        static let wardrobeStats = "/api/wardrobe/stats"

        // Outfits
        static let outfitGenerate = "/api/outfits/generate"
        static let outfitDaily = "/api/outfits/daily"
        static let outfitHistory = "/api/outfits/history"
        static let outfitStreak = "/api/outfits/streak"
        static let outfitSave = "/api/outfits/save"
        static let outfitRate = "/api/outfits/rate"

        // AI
        static let aiChat = "/api/ai/chat"
        static let aiAnalyzeOutfit = "/api/ai/analyze-outfit"
        static let aiAnalyzeColors = "/api/ai/analyze-colors"
        static let aiIdentifyGarment = "/api/ai/identify-garment"
        static let aiShoppingRecs = "/api/ai/shopping-recs"

        // VTON
        static let vtonGenerate = "/api/vton/generate"
        static let vtonCredits = "/api/vton/credits"
        static let vtonHistory = "/api/vton/history"

        // Images
        static let imageRemoveBg = "/api/images/remove-bg"
        static let imageCollage = "/api/images/collage"

        // Social
        static let socialFeed = "/api/social/feed"
        static let socialPosts = "/api/social/posts"
        static let socialStories = "/api/social/stories"
        static let socialRankings = "/api/social/rankings"

        // Avatar
        static let avatar = "/api/avatar"

        // Subscriptions
        static let subscriptions = "/api/subscriptions"

        // Friends
        static let friends = "/api/friends"
        static let friendsRequest = "/api/friends/request"
        static let friendsRequests = "/api/friends/requests"
        static let friendsSearch = "/api/friends/search"
    }
}
