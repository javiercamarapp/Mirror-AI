import Foundation

// MARK: - Virtual Try-On Service

class FashnService {
    static let shared = FashnService()
    private let network = NetworkService.shared

    private init() {}

    // MARK: - Generate Try-On

    func generateTryOn(garmentImageUrl: String, category: String) async throws -> TryOnResult {
        let result: TryOnResult = try await network.post(
            APIConfig.Endpoints.vtonGenerate,
            body: [
                "garment_image_url": garmentImageUrl,
                "category": category
            ]
        )

        return result
    }

    // MARK: - Get Credits

    func getCredits() async throws -> VTONCredits {
        let credits: VTONCredits = try await network.get(
            APIConfig.Endpoints.vtonCredits
        )
        return credits
    }

    // MARK: - Get History

    func getHistory() async throws -> [VTONHistoryItem] {
        let history: [VTONHistoryItem] = try await network.get(
            APIConfig.Endpoints.vtonHistory
        )
        return history
    }
}

// MARK: - VTON Response Models

struct TryOnResult: Codable {
    let resultImageUrl: String
    let creditsRemaining: Int

    enum CodingKeys: String, CodingKey {
        case resultImageUrl = "result_image_url"
        case creditsRemaining = "credits_remaining"
    }
}

struct VTONCredits: Codable {
    let creditsRemaining: Int
    let creditsTotal: Int
    let plan: String

    enum CodingKeys: String, CodingKey {
        case plan
        case creditsRemaining = "credits_remaining"
        case creditsTotal = "credits_total"
    }
}

struct VTONHistoryItem: Codable, Identifiable {
    let id: String
    let resultImageUrl: String
    let creditsUsed: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case resultImageUrl = "result_image_url"
        case creditsUsed = "credits_used"
        case createdAt = "created_at"
    }
}
