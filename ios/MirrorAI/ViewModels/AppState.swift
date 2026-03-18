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
    var styleTier: String = "Bronze"

    // ─── Feed Pagination ─────────────────────────────────────────────────
    var feedPage: Int = 1
    var feedHasMore: Bool = true

    // ─── Notifications ───────────────────────────────────────────────────
    var notifications: [NotificationModel] = []
    var unreadNotificationCount = 0

    // ─── VTON ────────────────────────────────────────────────────────────
    var vtonCredits = 0
    var vtonHistory: [VTONHistoryModel] = []

    // ─── Loading States ──────────────────────────────────────────────────
    var isLoading = false
    var errorMessage: String?

    // ─── Services ────────────────────────────────────────────────────────
    private let network = NetworkService.shared
    private let wardrobeService = WardrobeService.shared
    private let socialService = SocialService.shared
    private let aiService = AIService.shared
    private let vtonService = FashnService.shared
    private let tokenKey = "mirror_ai_auth_token"

    // MARK: - Initialization

    /// Called on app launch -- checks persisted token, loads profile if available.
    func initialize() async {
        if let savedToken = KeychainManager.retrieve(forKey: tokenKey) {
            await setAuthToken(savedToken)
        }
    }

    /// Set token, persist it, configure NetworkService, and load all user data.
    func setAuthToken(_ token: String) async {
        authToken = token
        isLoggedIn = true
        _ = KeychainManager.save(token, forKey: tokenKey)
        await network.setAuthToken(token)

        isLoading = true
        defer { isLoading = false }

        // Load profile first so we know subscription plan, then parallel-load the rest
        await loadProfile()

        async let w: () = loadWardrobe()
        async let s: () = loadStreak()
        async let n: () = loadNotifications()
        async let vc: () = loadVTONCredits()
        _ = await (w, s, n, vc)
    }

    /// Clear all state and remove persisted token.
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
        styleTier = "Bronze"
        feedPage = 1
        feedHasMore = true
        notifications = []
        unreadNotificationCount = 0
        vtonCredits = 0
        vtonHistory = []
        errorMessage = nil

        _ = KeychainManager.delete(forKey: tokenKey)
        _ = KeychainManager.delete(forKey: "mirror_ai_refresh_token")
        Task {
            await network.setAuthToken(nil)
        }
    }

    // MARK: - App Lifecycle

    /// Refresh the auth token if needed (called when app becomes active).
    func refreshTokenIfNeeded() async {
        guard authToken != nil else { return }
        guard let refreshToken = KeychainManager.retrieve(forKey: "mirror_ai_refresh_token") else {
            // No refresh token, just re-apply existing token
            await network.setAuthToken(authToken)
            await loadProfile()
            return
        }

        do {
            guard let url = URL(string: APIConfig.baseURL + "/api/auth/refresh") else { return }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                // Refresh failed - logout
                logout()
                return
            }

            struct RefreshResponse: Decodable {
                let accessToken: String
                let refreshToken: String
                let expiresAt: Int?

                enum CodingKeys: String, CodingKey {
                    case accessToken = "access_token"
                    case refreshToken = "refresh_token"
                    case expiresAt = "expires_at"
                }
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let apiResponse = try decoder.decode(APIResponse<RefreshResponse>.self, from: data)

            guard apiResponse.success, let refreshData = apiResponse.data else {
                logout()
                return
            }

            // Update tokens
            _ = KeychainManager.save(refreshData.refreshToken, forKey: "mirror_ai_refresh_token")
            authToken = refreshData.accessToken
            _ = KeychainManager.save(refreshData.accessToken, forKey: tokenKey)
            await network.setAuthToken(refreshData.accessToken)

        } catch {
            // On any error, try to keep going with existing token
            await network.setAuthToken(authToken)
            await loadProfile()
        }
    }

    /// Persist any transient state before the app goes to the background.
    func saveState() {
        // Token is already stored in Keychain on set.
        // Persist lightweight UI state in UserDefaults.
        UserDefaults.standard.set(streakCount, forKey: "mirror_ai_streak_count")
        UserDefaults.standard.set(styleScore, forKey: "mirror_ai_style_score")
    }

    // MARK: - Authentication

    func signInWithApple(idToken: String, fullName: String?) async {
        isLoading = true
        defer { isLoading = false }

        do {
            struct AuthResponse: Decodable {
                let accessToken: String
                let refreshToken: String
                let expiresAt: Int?
                let user: AuthUser?

                enum CodingKeys: String, CodingKey {
                    case accessToken = "access_token"
                    case refreshToken = "refresh_token"
                    case expiresAt = "expires_at"
                    case user
                }
            }

            struct AuthUser: Decodable {
                let id: String
                let email: String?
                let name: String?
            }

            var body: [String: Any] = ["id_token": idToken]
            if let fullName = fullName { body["full_name"] = fullName }

            // Call backend without auth token (this is a login endpoint)
            guard let url = URL(string: APIConfig.baseURL + "/api/auth/apple") else {
                handleError(APIError.invalidURL, context: "Apple sign in")
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                throw APIError.httpError(statusCode: code, message: "Authentication failed")
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let apiResponse = try decoder.decode(APIResponse<AuthResponse>.self, from: data)

            guard apiResponse.success, let authData = apiResponse.data else {
                throw APIError.apiResponseError(apiResponse.error ?? "Authentication failed")
            }

            // Store refresh token separately in Keychain
            _ = KeychainManager.save(authData.refreshToken, forKey: "mirror_ai_refresh_token")

            // Set the access token (triggers profile load etc.)
            await setAuthToken(authData.accessToken)

        } catch {
            handleError(error, context: "Apple sign in")
        }
    }

    func signInWithEmail(email: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            guard let url = URL(string: APIConfig.baseURL + "/api/auth/magic-link") else {
                handleError(APIError.invalidURL, context: "email sign in")
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email])

            let (_, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                throw APIError.httpError(statusCode: code, message: "Failed to send magic link")
            }

            // Success - UI should show confirmation
        } catch {
            handleError(error, context: "email sign in")
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
            let bodyData = try JSONSerialization.data(withJSONObject: updates)
            guard let token = await network.getAuthToken() else {
                handleError(APIError.noAuthToken, context: "updating profile")
                return
            }
            guard let url = URL(string: APIConfig.baseURL + APIConfig.Endpoints.userProfile) else {
                handleError(APIError.invalidURL, context: "updating profile")
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = "PATCH"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.httpBody = bodyData

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                throw APIError.httpError(statusCode: code, message: "Failed to update profile")
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let apiResponse = try decoder.decode(APIResponse<UserProfileModel>.self, from: data)

            guard apiResponse.success, let updated = apiResponse.data else {
                throw APIError.apiResponseError(apiResponse.error ?? "Failed to update profile")
            }

            currentUser = updated
            subscriptionPlan = updated.subscriptionPlan
            isOnboardingComplete = updated.onboardingCompleted
        } catch {
            handleError(error, context: "updating profile")
        }
    }

    func saveOnboarding(_ data: [String: Any]) async {
        do {
            let bodyData = try JSONSerialization.data(withJSONObject: data)
            guard let token = await network.getAuthToken() else {
                handleError(APIError.noAuthToken, context: "saving onboarding")
                return
            }
            guard let url = URL(string: APIConfig.baseURL + APIConfig.Endpoints.userOnboarding) else {
                handleError(APIError.invalidURL, context: "saving onboarding")
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.httpBody = bodyData

            let (responseData, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                throw APIError.httpError(statusCode: code, message: "Failed to save onboarding")
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let apiResponse = try decoder.decode(APIResponse<UserProfileModel>.self, from: responseData)

            guard apiResponse.success, let profile = apiResponse.data else {
                throw APIError.apiResponseError(apiResponse.error ?? "Failed to save onboarding")
            }

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
            let items = try await wardrobeService.getItems()
            wardrobeItems = items.map { $0.toModel() }
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
            let item = try await wardrobeService.addItem(image: image, name: name, category: category)
            let model = item.toModel()
            wardrobeItems.insert(model, at: 0)
            return model
        } catch {
            handleError(error, context: "adding wardrobe item")
            return nil
        }
    }

    func removeWardrobeItem(_ id: String) async {
        let backup = wardrobeItems
        wardrobeItems.removeAll { $0.id == id }

        do {
            try await wardrobeService.deleteItem(id: id)
        } catch {
            wardrobeItems = backup
            handleError(error, context: "removing wardrobe item")
        }
    }

    func toggleFavorite(_ id: String) async {
        guard let index = wardrobeItems.firstIndex(where: { $0.id == id }) else { return }
        let previousValue = wardrobeItems[index].isFavorite
        wardrobeItems[index].isFavorite = !previousValue

        do {
            let updated = try await wardrobeService.toggleFavorite(id: id)
            if let idx = wardrobeItems.firstIndex(where: { $0.id == id }) {
                wardrobeItems[idx] = updated.toModel()
            }
        } catch {
            if let idx = wardrobeItems.firstIndex(where: { $0.id == id }) {
                wardrobeItems[idx].isFavorite = previousValue
            }
            handleError(error, context: "toggling favorite")
        }
    }

    func logWear(_ id: String) async {
        do {
            try await wardrobeService.logWear(id: id)
            // Increment wear count locally
            if let index = wardrobeItems.firstIndex(where: { $0.id == id }) {
                wardrobeItems[index].wearCount += 1
                let formatter = DateFormatter()
                formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
                wardrobeItems[index].lastWorn = formatter.string(from: Date())
            }
        } catch {
            handleError(error, context: "logging wear")
        }
    }

    // MARK: - Outfits

    func generateOutfit(occasion: String, weather: String?, mood: String?) async -> OutfitSuggestionModel? {
        do {
            let suggestion = try await aiService.generateOutfit(
                occasion: occasion,
                weather: weather,
                mood: mood
            )
            // Map OutfitSuggestion -> OutfitSuggestionModel
            let model = OutfitSuggestionModel(
                name: suggestion.vibe,
                itemIds: suggestion.itemIds,
                stylingTips: suggestion.styleTips.joined(separator: "\n"),
                score: suggestion.score,
                reasoning: suggestion.reasoning,
                items: wardrobeItems.filter { suggestion.itemIds.contains($0.id) }
            )
            return model
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

            let bodyData = try JSONSerialization.data(withJSONObject: body)
            guard let token = await network.getAuthToken() else {
                handleError(APIError.noAuthToken, context: "saving outfit of the day")
                return
            }
            guard let url = URL(string: APIConfig.baseURL + APIConfig.Endpoints.outfitDaily) else {
                handleError(APIError.invalidURL, context: "saving outfit of the day")
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.httpBody = bodyData

            let (responseData, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                throw APIError.httpError(statusCode: code, message: "Failed to save outfit")
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let apiResponse = try decoder.decode(APIResponse<DailyOutfitModel>.self, from: responseData)

            guard apiResponse.success, let daily = apiResponse.data else {
                throw APIError.apiResponseError(apiResponse.error ?? "Failed to save outfit")
            }

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

    func loadFeed(append: Bool = false) async {
        feedLoading = true
        defer { feedLoading = false }

        do {
            let page = append ? feedPage : 1
            let posts = try await socialService.getFeed(page: page)
            let models = posts.map { $0.toModel() }

            if append {
                feedPosts.append(contentsOf: models)
            } else {
                feedPosts = models
            }

            feedPage = (append ? feedPage : 1) + (models.isEmpty ? 0 : 1)
            feedHasMore = !models.isEmpty
        } catch {
            handleError(error, context: "loading feed")
        }
    }

    func loadStories() async {
        do {
            let groups = try await socialService.getStories()
            stories = groups.map { $0.toModel() }
        } catch {
            handleError(error, context: "loading stories")
        }
    }

    func createPost(type: String, imageUrl: String, caption: String, occasion: String?) async {
        do {
            let post = try await socialService.createPost(
                type: type,
                imageUrl: imageUrl,
                caption: caption,
                occasion: occasion
            )
            feedPosts.insert(post.toModel(), at: 0)
        } catch {
            handleError(error, context: "creating post")
        }
    }

    func toggleLike(postId: String) async {
        guard let index = feedPosts.firstIndex(where: { $0.id == postId }) else { return }

        // Optimistic update
        let wasLiked = feedPosts[index].isLiked
        feedPosts[index].isLiked = !wasLiked
        feedPosts[index].likesCount += wasLiked ? -1 : 1

        do {
            let liked = try await socialService.likePost(id: postId)
            // Reconcile with server truth
            if let idx = feedPosts.firstIndex(where: { $0.id == postId }) {
                feedPosts[idx].isLiked = liked
            }
        } catch {
            // Revert on failure
            if let idx = feedPosts.firstIndex(where: { $0.id == postId }) {
                feedPosts[idx].isLiked = wasLiked
                feedPosts[idx].likesCount += wasLiked ? 1 : -1
            }
            handleError(error, context: "toggling like")
        }
    }

    func createStory(imageUrl: String, caption: String?) async {
        do {
            let _ = try await socialService.createStory(imageUrl: imageUrl, caption: caption)
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
            guard let token = await network.getAuthToken() else {
                throw APIError.noAuthToken
            }
            guard let url = URL(string: APIConfig.baseURL + "\(APIConfig.Endpoints.userNotifications)/\(id)") else {
                throw APIError.invalidURL
            }

            var request = URLRequest(url: url)
            request.httpMethod = "PATCH"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["read": true])

            let (_, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                throw APIError.httpError(
                    statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0,
                    message: "Failed to mark notification as read"
                )
            }
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
            let credits = try await vtonService.getCredits()
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
            let result = try await vtonService.generateTryOn(
                garmentImageUrl: garmentUrl,
                category: category
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
            if case .noAuthToken = apiError {
                logout()
                return
            }
            if case .httpError(let statusCode, _) = apiError, statusCode == 401 {
                errorMessage = "Your session has expired. Please sign in again."
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
        case 0..<200: styleTier = "Bronze"
        case 200..<500: styleTier = "Silver"
        case 500..<1000: styleTier = "Gold"
        case 1000..<2000: styleTier = "Platinum"
        default: styleTier = "Diamond"
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

// MARK: - Service-to-Model Mapping Extensions

extension WardrobeItemResponse {
    func toModel() -> WardrobeItemModel {
        WardrobeItemModel(
            id: id,
            userId: userId,
            name: name,
            category: category,
            subcategory: subcategory,
            color: color,
            brand: brand,
            imageUrl: imageUrl,
            imageNoBgUrl: imageNoBgUrl,
            season: season,
            occasions: occasions,
            wearCount: wearCount,
            isFavorite: isFavorite,
            lastWorn: lastWorn,
            createdAt: createdAt
        )
    }
}

extension SocialPostResponse {
    func toModel() -> SocialPostModel {
        SocialPostModel(
            id: id,
            userId: userId,
            type: type,
            imageUrl: imageUrl,
            caption: caption,
            outfitData: outfitData,
            outfitId: outfitId,
            occasion: occasion,
            score: score,
            likesCount: likesCount,
            commentsCount: commentsCount,
            isLiked: isLiked,
            user: user?.toModel(),
            createdAt: createdAt
        )
    }
}

extension SocialUserInfo {
    func toModel() -> PostUserInfo {
        PostUserInfo(fullName: fullName, username: username, avatarUrl: avatarUrl)
    }
}

extension StoryGroup {
    func toModel() -> StoryGroupModel {
        StoryGroupModel(
            user: user?.toModel(),
            stories: stories.map { $0.toModel() },
            hasUnviewed: hasUnviewed
        )
    }
}

extension StoryResponse {
    func toModel() -> StoryModel {
        StoryModel(
            id: id,
            userId: userId,
            imageUrl: imageUrl,
            caption: caption,
            outfitData: outfitData,
            viewsCount: viewsCount,
            expiresAt: expiresAt,
            isViewed: isViewed,
            user: user?.toModel(),
            createdAt: createdAt
        )
    }
}

/// Empty placeholder for responses with no meaningful data payload.
struct EmptyData: Codable {}
