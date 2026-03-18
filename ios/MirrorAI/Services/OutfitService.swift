import Foundation

// MARK: - Outfit Service

class OutfitService {
    static let shared = OutfitService()
    private let network = NetworkService.shared

    private init() {}

    // MARK: - Generate Outfit

    func generateOutfit(
        itemIds: [String],
        occasion: String,
        weather: String? = nil,
        preferences: [String: Any]? = nil
    ) async throws -> OutfitSuggestionModel {
        var body: [String: Any] = [
            "item_ids": itemIds,
            "occasion": occasion
        ]

        if let weather = weather {
            body["weather"] = weather
        }
        if let preferences = preferences {
            body["preferences"] = preferences
        }

        let suggestion: OutfitSuggestionModel = try await network.post(
            APIConfig.Endpoints.outfitGenerate,
            body: body
        )

        return suggestion
    }

    // MARK: - Save Outfit of the Day

    func saveOutfitOfDay(outfitData: [String: Any]) async throws -> DailyOutfitModel {
        let dailyOutfit: DailyOutfitModel = try await network.post(
            APIConfig.Endpoints.outfitDaily,
            body: outfitData
        )

        return dailyOutfit
    }

    // MARK: - Rate Outfit

    func rateOutfit(imageBase64: String, outfitData: [String: Any]? = nil) async throws -> OutfitRatingModel {
        var body: [String: Any] = ["image": imageBase64]

        if let outfitData = outfitData {
            body["outfit_data"] = outfitData
        }

        let rating: OutfitRatingModel = try await network.post(
            APIConfig.Endpoints.outfitRate,
            body: body
        )

        return rating
    }

    // MARK: - Get Streak

    func getStreak() async throws -> StreakInfoModel {
        let streak: StreakInfoModel = try await network.get(
            APIConfig.Endpoints.outfitStreak
        )

        return streak
    }

    // MARK: - Save Outfit

    func saveOutfit(outfitData: [String: Any]) async throws -> OutfitModel {
        let outfit: OutfitModel = try await network.post(
            APIConfig.Endpoints.outfitSave,
            body: outfitData
        )

        return outfit
    }

    // MARK: - Get Saved Outfits

    func getSavedOutfits(page: Int = 1, limit: Int = 20) async throws -> [OutfitModel] {
        let outfits: [OutfitModel] = try await network.get(
            APIConfig.Endpoints.outfitSave,
            queryParams: [
                "page": String(page),
                "limit": String(limit)
            ]
        )

        return outfits
    }

    // MARK: - Get Outfit History

    func getOutfitHistory(month: Int, year: Int) async throws -> [DailyOutfitModel] {
        let history: [DailyOutfitModel] = try await network.get(
            APIConfig.Endpoints.outfitHistory,
            queryParams: [
                "month": String(month),
                "year": String(year)
            ]
        )

        return history
    }

    // MARK: - Delete Outfit

    func deleteOutfit(id: String) async throws {
        struct EmptyResponse: Decodable {}

        let _: EmptyResponse = try await network.delete(
            "\(APIConfig.Endpoints.outfitSave)/\(id)"
        )
    }
}
