import SwiftUI
import Foundation

@Observable
@MainActor
class AppState {
    // ─── User State ──────────────────────────────────────────────────────
    var isLoggedIn = false
    var isOnboardingComplete = false
    var currentUser: UserProfileModel?
    var authToken: String?

    // ─── Subscription ────────────────────────────────────────────────────
    var subscriptionPlan: String = "free"
    var isTrialActive = false
    var trialDaysRemaining = 0

    // ─── Wardrobe ────────────────────────────────────────────────────────
    var wardrobeItems: [WardrobeItemModel] = []
    var wardrobeLoading = false

    // ─── Outfits ─────────────────────────────────────────────────────────
    var todaysOutfit: DailyOutfitModel?
    var outfitHistory: [DailyOutfitModel] = []
    var savedOutfits: [OutfitModel] = []
    var streakCount = 0
    var longestStreak = 0

    // ─── Social ──────────────────────────────────────────────────────────
    var feedPosts: [SocialPostModel] = []
    var stories: [StoryGroupModel] = []
    var feedLoading = false

    // ─── Style Score ─────────────────────────────────────────────────────
    var styleScore: Double = 0
    var styleTier: String = "Bronce"

    // ─── Notifications ───────────────────────────────────────────────────
    var notifications: [NotificationModel] = []
    var unreadNotificationCount = 0

    // ─── VTON ────────────────────────────────────────────────────────────
    var vtonCredits = 0
    var vtonHistory: [VTONHistoryModel] = []

    // ─── Loading States ──────────────────────────────────────────────────
    var isLoading = false
    var errorMessage: String?

    // ─── Private ─────────────────────────────────────────────────────────
    private let network = NetworkService.shared
    private let tokenKey = "mirror_ai_auth_token"

    // MARK: - Initialization

    /// Called on app launch -- checks persisted token, loads profile if available
    func initialize() async {
        if let savedToken = UserDefaults.standard.string(forKey: tokenKey) {
            await setAuthToken(savedToken)
        }
    }

    /// Set token, persist it, configure NetworkService, and load all user data
    func setAuthToken(_ token: String) async {
        authToken = token
        isLoggedIn = true
        UserDefaults.standard.set(token, forKey: tokenKey)
        await network.setAuthToken(token)

        isLoading = true
        defer { isLoading = false }

        // Load profile first, then parallel-load everything else
        await loadProfile()

        async let w: () = loadWardrobe()
        async let s: () = loadStreak()
        async let n: () = loadNotifications()
        async let vc: () = loadVTONCredits()
        _ = await (w, s, n, vc)
    }

    /// Clear all state and remove persisted token
    func logout() {
        authToken = nil
        isLoggedIn = false
        isOnboardingComplete = false
        currentUser = nil
        subscriptionPlan = "free"
        isTrialActive = false
        trialDaysRemaining = 0
        wardrobeItems = []
        todaysOutfit = nil
        outfitHistory = []
        savedOutfits = []
        streakCount = 0
        longestStreak = 0
        feedPosts = []
        stories = []
        feedLoading = false
        styleScore = 0
        styleTier = "Bronce"
        notifications = []
        unreadNotificationCount = 0
        vtonCredits = 0
        vtonHistory = []
        errorMessage = nil

        UserDefaults.standard.removeObject(forKey: tokenKey)
        Task {
            await network.setAuthToken(nil)
        }
    }

    // MARK: - Profile

    func loadProfile() async {
        do {
            let profile: UserProfileModel = try await network.apiRequest(
                APIConfig.Endpoints.userProfile
            )
            currentUser = profile
            isOnboardingComplete = profile.onboardingCompleted
            subscriptionPlan = profile.subscriptionPlan
            updateStyleTier()
        } catch {
            handleError(error, context: "loading profile")
        }
    }

    func updateProfile(_ updates: [String: Any]) async {
        do {
            let updated: UserProfileModel = try await network.apiRequest(
                APIConfig.Endpoints.userProfile,
                method: "PATCH",
                body: DictionaryEncodable(updates)
            )
            currentUser = updated
            subscriptionPlan = updated.subscriptionPlan
            isOnboardingComplete = updated.onboardingCompleted
        } catch {
            handleError(error, context: "updating profile")
        }
    }

    func saveOnboarding(_ data: [String: Any]) async {
        do {
            let profile: UserProfileModel = try await network.apiRequest(
                APIConfig.Endpoints.userOnboarding,
                method: "POST",
                body: DictionaryEncodable(data)
            )
            currentUser = profile
            isOnboardingComplete = true
        } catch {
            handleError(error, context: "saving onboarding")
        }
    }

    // MARK: - Wardrobe

    func loadWardrobe() async {
        wardrobeLoading = true
        defer { wardrobeLoading = false }

        do {
            let items: [WardrobeItemModel] = try await network.apiRequest(
                APIConfig.Endpoints.wardrobe
            )
            wardrobeItems = items
        } catch {
            handleError(error, context: "loading wardrobe")
        }
    }

    func addWardrobeItem(image: UIImage, name: String?, category: String?) async -> WardrobeItemModel? {
        guard checkWardrobeLimit() else {
            errorMessage = "Wardrobe limit reached for your \(subscriptionPlan) plan. Upgrade to add more items."
            return nil
        }

        do {
            guard let imageData = image.jpegData(compressionQuality: 0.8) else {
                errorMessage = "Failed to process image"
                return nil
            }

            var fields: [String: String] = [:]
            if let name { fields["name"] = name }
            if let category { fields["category"] = category }

            let response: APIResponse<WardrobeItemModel> = try await network.uploadMultipart(
                APIConfig.Endpoints.wardrobe,
                imageData: imageData,
                additionalFields: fields.isEmpty ? nil : fields
            )

            guard response.success, let item = response.data else {
                errorMessage = response.error ?? "Failed to add wardrobe item"
                return nil
            }

            wardrobeItems.insert(item, at: 0)
            return item
        } catch {
            handleError(error, context: "adding wardrobe item")
            return nil
        }
    }

    func removeWardrobeItem(_ id: String) async {
        do {
            let _: APIResponse<EmptyData> = try await network.request(
                "\(APIConfig.Endpoints.wardrobe)/\(id)",
                method: "DELETE"
            )
            wardrobeItems.removeAll { $0.id == id }
        } catch {
            handleError(error, context: "removing wardrobe item")
        }
    }

    func toggleFavorite(_ id: String) async {
        guard let index = wardrobeItems.firstIndex(where: { $0.id == id }) else { return }
        let newValue = !wardrobeItems[index].isFavorite

        // Optimistic update
        wardrobeItems[index].isFavorite = newValue

        do {
            let _: APIResponse<WardrobeItemModel> = try await network.request(
                "\(APIConfig.Endpoints.wardrobe)/\(id)",
                method: "PATCH",
                body: FavoriteUpdate(isFavorite: newValue)
            )
        } catch {
            // Revert on failure
            if let idx = wardrobeItems.firstIndex(where: { $0.id == id }) {
                wardrobeItems[idx].isFavorite = !newValue
            }
            handleError(error, context: "toggling favorite")
        }
    }

    func logWear(_ id: String) async {
        do {
            let updated: WardrobeItemModel = try await network.apiRequest(
                "\(APIConfig.Endpoints.wardrobe)/\(id)/wear",
                method: "POST"
            )
            if let index = wardrobeItems.firstIndex(where: { $0.id == id }) {
                wardrobeItems[index] = updated
            }
        } catch {
            handleError(error, context: "logging wear")
        }
    }

    // MARK: - Outfits

    func generateOutfit(occasion: String, weather: String?, mood: String?) async -> OutfitSuggestionModel? {
        do {
            var body: [String: Any] = ["occasion": occasion]
            if let weather { body["weather"] = weather }
            if let mood { body["mood"] = mood }

            let suggestions: [OutfitSuggestionModel] = try await network.apiRequest(
                APIConfig.Endpoints.outfitGenerate,
                method: "POST",
                body: DictionaryEncodable(body)
            )

            // Return the top suggestion (highest score)
            return suggestions.max(by: { $0.score < $1.score })
        } catch {
            handleError(error, context: "generating outfit")
            return nil
        }
    }

    func saveOutfitOfDay(_ outfit: OutfitSuggestionModel, image: UIImage?) async {
        do {
            var body: [String: Any] = [
                "outfit_data": [
                    "name": outfit.name,
                    "item_ids": outfit.itemIds,
                    "styling_tips": outfit.stylingTips,
                    "score": outfit.score,
                    "reasoning": outfit.reasoning
                ],
                "occasion": outfit.name
            ]

            if let image, let imageData = image.jpegData(compressionQuality: 0.8) {
                body["image"] = imageData.base64EncodedString()
            }

            let daily: DailyOutfitModel = try await network.apiRequest(
                APIConfig.Endpoints.outfitDaily,
                method: "POST",
                body: DictionaryEncodable(body)
            )
            todaysOutfit = daily
            streakCount += 1
        } catch {
            handleError(error, context: "saving outfit of the day")
        }
    }

    func loadOutfitHistory(month: Int, year: Int) async {
        do {
            let history: [DailyOutfitModel] = try await network.apiRequest(
                APIConfig.Endpoints.outfitHistory,
                queryParams: [
                    "month": String(month),
                    "year": String(year)
                ]
            )
            outfitHistory = history

            // Check if today's outfit exists
            let todayStr = formatDate(Date())
            todaysOutfit = history.first(where: { $0.date == todayStr })
        } catch {
            handleError(error, context: "loading outfit history")
        }
    }

    func loadStreak() async {
        do {
            let streak: StreakInfoModel = try await network.apiRequest(
                APIConfig.Endpoints.outfitStreak
            )
            streakCount = streak.currentStreak
            longestStreak = streak.longestStreak
        } catch {
            handleError(error, context: "loading streak")
        }
    }

    // MARK: - Social

    func loadFeed() async {
        feedLoading = true
        defer { feedLoading = false }

        do {
            let posts: [SocialPostModel] = try await network.apiRequest(
                APIConfig.Endpoints.socialFeed
            )
            feedPosts = posts
        } catch {
            handleError(error, context: "loading feed")
        }
    }

    func loadStories() async {
        do {
            let groups: [StoryGroupModel] = try await network.apiRequest(
                APIConfig.Endpoints.socialStories
            )
            stories = groups
        } catch {
            handleError(error, context: "loading stories")
        }
    }

    func createPost(type: String, imageUrl: String, caption: String, occasion: String?) async {
        do {
            var body: [String: Any] = [
                "type": type,
                "image_url": imageUrl,
                "caption": caption
            ]
            if let occasion { body["occasion"] = occasion }

            let post: SocialPostModel = try await network.apiRequest(
                APIConfig.Endpoints.socialPosts,
                method: "POST",
                body: DictionaryEncodable(body)
            )
            feedPosts.insert(post, at: 0)
        } catch {
            handleError(error, context: "creating post")
        }
    }

    func toggleLike(postId: String) async {
        guard let index = feedPosts.firstIndex(where: { $0.id == postId }) else { return }

        // Optimistic update
        let wasLiked = feedPosts[index].isLiked ?? false
        feedPosts[index].isLiked = !wasLiked
        feedPosts[index].likesCount = (feedPosts[index].likesCount ?? 0) + (wasLiked ? -1 : 1)

        do {
            let _: LikeToggleResponse = try await network.apiRequest(
                "\(APIConfig.Endpoints.socialPosts)/\(postId)/like",
                method: "POST"
            )
        } catch {
            // Revert on failure
            if let idx = feedPosts.firstIndex(where: { $0.id == postId }) {
                feedPosts[idx].isLiked = wasLiked
                feedPosts[idx].likesCount = (feedPosts[idx].likesCount ?? 0) + (wasLiked ? 1 : -1)
            }
            handleError(error, context: "toggling like")
        }
    }

    func createStory(imageUrl: String, caption: String?) async {
        do {
            var body: [String: Any] = ["image_url": imageUrl]
            if let caption { body["caption"] = caption }

            let _: StoryModel = try await network.apiRequest(
                APIConfig.Endpoints.socialStories,
                method: "POST",
                body: DictionaryEncodable(body)
            )
            // Reload stories to get updated groups
            await loadStories()
        } catch {
            handleError(error, context: "creating story")
        }
    }

    // MARK: - Notifications

    func loadNotifications() async {
        do {
            let notifs: [NotificationModel] = try await network.apiRequest(
                APIConfig.Endpoints.userNotifications
            )
            notifications = notifs
            unreadNotificationCount = notifs.filter { !$0.read }.count
        } catch {
            handleError(error, context: "loading notifications")
        }
    }

    func markNotificationRead(_ id: String) async {
        // Optimistic update
        if let index = notifications.firstIndex(where: { $0.id == id }) {
            notifications[index].read = true
            unreadNotificationCount = notifications.filter { !$0.read }.count
        }

        do {
            let _: APIResponse<EmptyData> = try await network.request(
                "\(APIConfig.Endpoints.userNotifications)/\(id)",
                method: "PATCH",
                body: ReadUpdate(read: true)
            )
        } catch {
            // Revert on failure
            if let index = notifications.firstIndex(where: { $0.id == id }) {
                notifications[index].read = false
                unreadNotificationCount = notifications.filter { !$0.read }.count
            }
            handleError(error, context: "marking notification read")
        }
    }

    // MARK: - VTON (Virtual Try-On)

    func loadVTONCredits() async {
        do {
            let credits: VTONCreditsModel = try await network.apiRequest(
                APIConfig.Endpoints.vtonCredits
            )
            vtonCredits = credits.creditsRemaining
        } catch {
            handleError(error, context: "loading VTON credits")
        }
    }

    func tryVirtualTryOn(garmentUrl: String, category: String) async -> String? {
        guard vtonCredits > 0 else {
            errorMessage = "No virtual try-on credits remaining. Upgrade your plan for more."
            return nil
        }

        do {
            let body: [String: Any] = [
                "garment_url": garmentUrl,
                "category": category
            ]

            let result: VTONGenerateResponse = try await network.apiRequest(
                APIConfig.Endpoints.vtonGenerate,
                method: "POST",
                body: DictionaryEncodable(body)
            )

            vtonCredits = result.creditsRemaining
            return result.resultImageUrl
        } catch {
            handleError(error, context: "virtual try-on")
            return nil
        }
    }

    // MARK: - Computed Properties

    var wardrobeByCategory: [String: [WardrobeItemModel]] {
        Dictionary(grouping: wardrobeItems, by: { $0.category })
    }

    func checkWardrobeLimit() -> Bool {
        switch subscriptionPlan {
        case "free": return wardrobeItems.count < 50
        case "basic": return wardrobeItems.count < 200
        default: return true // premium = unlimited
        }
    }

    // MARK: - Private Helpers

    private func handleError(_ error: Error, context: String) {
        let message: String
        if let apiError = error as? APIError {
            message = apiError.errorDescription ?? "Unknown error"
            // If unauthorized, force logout
            if case .noAuthToken = apiError {
                logout()
                return
            }
        } else {
            message = error.localizedDescription
        }
        errorMessage = "Error \(context): \(message)"
        print("[AppState] Error \(context): \(message)")
    }

    private func updateStyleTier() {
        switch styleScore {
        case 0..<200: styleTier = "Bronce"
        case 200..<500: styleTier = "Plata"
        case 500..<1000: styleTier = "Oro"
        case 1000..<2000: styleTier = "Platino"
        default: styleTier = "Diamante"
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

// MARK: - Helper Encodable Types

/// Wraps a [String: Any] dictionary to conform to Encodable for use with NetworkService
private struct DictionaryEncodable: Encodable {
    let dictionary: [String: Any]

    init(_ dictionary: [String: Any]) {
        self.dictionary = dictionary
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        let data = try JSONSerialization.data(withJSONObject: dictionary)
        let json = try JSONSerialization.jsonObject(with: data)
        try container.encode(AnyCodable(json))
    }
}

private struct FavoriteUpdate: Encodable {
    let isFavorite: Bool

    enum CodingKeys: String, CodingKey {
        case isFavorite = "is_favorite"
    }
}

private struct ReadUpdate: Encodable {
    let read: Bool
}

/// Empty placeholder for responses with no meaningful data payload
struct EmptyData: Codable {}
