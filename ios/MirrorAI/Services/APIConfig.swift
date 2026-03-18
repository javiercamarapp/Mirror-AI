import Foundation

enum APIConfig {
    // Change this to your deployed backend URL
    static let baseURL = "https://mirror-ai-backend.fly.dev"

    // Supabase
    static let supabaseURL = "YOUR_SUPABASE_URL"
    static let supabaseAnonKey = "YOUR_SUPABASE_ANON_KEY"

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

        // Friends
        static let friends = "/api/friends"
        static let friendsRequest = "/api/friends/request"
        static let friendsRequests = "/api/friends/requests"
        static let friendsSearch = "/api/friends/search"
    }
}
