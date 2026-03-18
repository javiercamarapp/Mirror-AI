import Foundation
import UIKit

// MARK: - AI Service

class AIService {
    static let shared = AIService()
    private let network = NetworkService.shared

    private init() {}

    // MARK: - Chat with AI Stylist

    func chat(message: String, history: [(role: String, content: String)]) async throws -> String {
        struct ChatRequest: Encodable {
            let message: String
            let history: [ChatMessage]
        }

        struct ChatMessage: Encodable {
            let role: String
            let content: String
        }

        struct ChatResponse: Decodable {
            let reply: String
        }

        let historyMessages = history.map { ChatMessage(role: $0.role, content: $0.content) }
        let body = ChatRequest(message: message, history: historyMessages)

        let response: ChatResponse = try await network.apiRequest(
            APIConfig.Endpoints.aiChat,
            method: "POST",
            body: body
        )

        return response.reply
    }

    // MARK: - Analyze Outfit Photo

    func analyzeOutfit(image: UIImage, occasion: String?) async throws -> OutfitAnalysis {
        guard let imageData = image.jpegData(compressionQuality: 0.8) else {
            throw APIError.encodingFailed
        }

        var fields: [String: Any] = [:]
        if let occasion = occasion {
            fields["occasion"] = occasion
        }

        let json = try await network.uploadImageBase64(
            APIConfig.Endpoints.aiAnalyzeOutfit,
            imageData: imageData,
            additionalFields: fields
        )

        guard let dataDict = json["data"] else {
            throw APIError.noData
        }

        let data = try JSONSerialization.data(withJSONObject: dataDict)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(OutfitAnalysis.self, from: data)
    }

    // MARK: - Analyze Color Season from Selfie

    func analyzeColors(selfie: UIImage) async throws -> ColorAnalysis {
        guard let imageData = selfie.jpegData(compressionQuality: 0.8) else {
            throw APIError.encodingFailed
        }

        let json = try await network.uploadImageBase64(
            APIConfig.Endpoints.aiAnalyzeColors,
            imageData: imageData
        )

        guard let dataDict = json["data"] else {
            throw APIError.noData
        }

        let data = try JSONSerialization.data(withJSONObject: dataDict)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(ColorAnalysis.self, from: data)
    }

    // MARK: - Identify Garment from Photo

    func identifyGarment(image: UIImage) async throws -> GarmentIdentification {
        guard let imageData = image.jpegData(compressionQuality: 0.8) else {
            throw APIError.encodingFailed
        }

        let json = try await network.uploadImageBase64(
            APIConfig.Endpoints.aiIdentifyGarment,
            imageData: imageData
        )

        guard let dataDict = json["data"] else {
            throw APIError.noData
        }

        let data = try JSONSerialization.data(withJSONObject: dataDict)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(GarmentIdentification.self, from: data)
    }

    // MARK: - Get Shopping Recommendations

    func getShoppingRecs(gaps: [String]?) async throws -> ShoppingRecommendations {
        struct ShoppingRecsRequest: Encodable {
            let gaps: [String]?
        }

        let body = ShoppingRecsRequest(gaps: gaps)

        let response: ShoppingRecommendations = try await network.apiRequest(
            APIConfig.Endpoints.aiShoppingRecs,
            method: "POST",
            body: body
        )

        return response
    }

    // MARK: - Generate Outfit from Wardrobe

    func generateOutfit(occasion: String, weather: String?, mood: String?) async throws -> OutfitSuggestion {
        struct GenerateRequest: Encodable {
            let occasion: String
            let weather: String?
            let mood: String?
        }

        let body = GenerateRequest(occasion: occasion, weather: weather, mood: mood)

        let response: OutfitSuggestion = try await network.apiRequest(
            APIConfig.Endpoints.outfitGenerate,
            method: "POST",
            body: body
        )

        return response
    }

    // MARK: - Generate Multiple Outfit Options

    func generateOutfitOptions(occasion: String, count: Int = 3) async throws -> [OutfitSuggestion] {
        struct GenerateOptionsRequest: Encodable {
            let occasion: String
            let count: Int
        }

        let body = GenerateOptionsRequest(occasion: occasion, count: count)

        let response: [OutfitSuggestion] = try await network.apiRequest(
            APIConfig.Endpoints.outfitGenerate,
            method: "POST",
            body: body
        )

        return response
    }
}

// MARK: - AI Response Models

struct OutfitAnalysis: Codable {
    let score: Double
    let strengths: [String]
    let improvements: [String]
    let style: String
    let colorHarmony: String
    let occasionFit: String
    let overallFeedback: String

    enum CodingKeys: String, CodingKey {
        case score, strengths, improvements, style
        case colorHarmony = "color_harmony"
        case occasionFit = "occasion_fit"
        case overallFeedback = "overall_feedback"
    }
}

struct ColorAnalysis: Codable {
    let season: String
    let undertone: String
    let bestColors: [String]
    let avoidColors: [String]
    let description: String
    let styleTip: String

    enum CodingKeys: String, CodingKey {
        case season, undertone, description
        case bestColors = "best_colors"
        case avoidColors = "avoid_colors"
        case styleTip = "style_tip"
    }
}

struct GarmentIdentification: Codable {
    let category: String
    let subcategory: String
    let color: String
    let secondaryColors: [String]
    let brandGuess: String
    let styleTags: [String]
    let occasions: [String]
    let season: [String]
    let nameSuggestion: String

    enum CodingKeys: String, CodingKey {
        case category, subcategory, color, occasions, season
        case secondaryColors = "secondary_colors"
        case brandGuess = "brand_guess"
        case styleTags = "style_tags"
        case nameSuggestion = "name_suggestion"
    }
}

struct ShoppingRecommendations: Codable {
    let recommendations: [ShoppingRec]
    let wardrobeAnalysis: String
    let versatilityScore: Double

    enum CodingKeys: String, CodingKey {
        case recommendations
        case wardrobeAnalysis = "wardrobe_analysis"
        case versatilityScore = "versatility_score"
    }
}

struct ShoppingRec: Codable, Identifiable {
    var id: String { item }
    let item: String
    let reason: String
    let priority: String
    let priceRange: String
    let stores: [String]

    enum CodingKeys: String, CodingKey {
        case item, reason, priority, stores
        case priceRange = "price_range"
    }
}

struct OutfitSuggestion: Codable, Identifiable {
    var id: String { itemIds.joined(separator: "-") }
    let itemIds: [String]
    let reasoning: String
    let styleTips: [String]
    let score: Double
    let vibe: String

    enum CodingKeys: String, CodingKey {
        case reasoning, score, vibe
        case itemIds = "item_ids"
        case styleTips = "style_tips"
    }
}
