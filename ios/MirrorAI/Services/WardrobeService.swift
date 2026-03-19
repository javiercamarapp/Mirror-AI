import Foundation
import UIKit

// MARK: - Wardrobe Service

class WardrobeService {
    static let shared = WardrobeService()
    private let network = NetworkService.shared

    private init() {}

    // MARK: - Get Wardrobe Items

    func getItems(category: String? = nil, color: String? = nil) async throws -> [WardrobeItemResponse] {
        var queryParams: [String: String] = [:]
        if let category = category {
            queryParams["category"] = category
        }
        if let color = color {
            queryParams["color"] = color
        }

        let items: [WardrobeItemResponse] = try await network.apiRequest(
            APIConfig.Endpoints.wardrobe,
            queryParams: queryParams.isEmpty ? nil : queryParams
        )

        return items
    }

    // MARK: - Add Wardrobe Item

    func addItem(image: UIImage, name: String? = nil, category: String? = nil) async throws -> WardrobeItemResponse {
        guard let imageData = image.jpegData(compressionQuality: 0.8) else {
            throw APIError.encodingFailed
        }

        var fields: [String: Any] = [:]
        if let name = name {
            fields["name"] = name
        }
        if let category = category {
            fields["category"] = category
        }

        let json = try await network.uploadImageBase64(
            APIConfig.Endpoints.wardrobe,
            imageData: imageData,
            additionalFields: fields
        )

        guard let dataDict = json["data"] else {
            throw APIError.noData
        }

        let data = try JSONSerialization.data(withJSONObject: dataDict)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(WardrobeItemResponse.self, from: data)
    }

    // MARK: - Update Wardrobe Item

    func updateItem(id: String, updates: [String: Any]) async throws -> WardrobeItemResponse {
        let endpoint = "\(APIConfig.Endpoints.wardrobe)/\(id)"

        let bodyData = try JSONSerialization.data(withJSONObject: updates)

        guard let token = await network.getAuthToken() else {
            throw APIError.noAuthToken
        }

        guard let url = URL(string: APIConfig.baseURL + endpoint) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = bodyData

        let (data, response) = try await URLSession.pinned().data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.httpError(statusCode: statusCode, message: "Failed to update item")
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let apiResponse = try decoder.decode(APIResponse<WardrobeItemResponse>.self, from: data)

        guard apiResponse.success, let item = apiResponse.data else {
            throw APIError.apiResponseError(apiResponse.error ?? "Failed to update item")
        }

        return item
    }

    // MARK: - Delete Wardrobe Item

    func deleteItem(id: String) async throws {
        let endpoint = "\(APIConfig.Endpoints.wardrobe)/\(id)"

        struct EmptyResponse: Decodable {}

        let _: EmptyResponse = try await network.request(
            endpoint,
            method: "DELETE"
        )
    }

    // MARK: - Log Wear

    func logWear(id: String) async throws {
        let endpoint = "\(APIConfig.Endpoints.wardrobe)/\(id)/wear"

        struct EmptyResponse: Decodable {}

        let _: EmptyResponse = try await network.request(
            endpoint,
            method: "POST"
        )
    }

    // MARK: - Toggle Favorite

    func toggleFavorite(id: String) async throws -> WardrobeItemResponse {
        let endpoint = "\(APIConfig.Endpoints.wardrobe)/\(id)/favorite"

        let item: WardrobeItemResponse = try await network.apiRequest(
            endpoint,
            method: "POST"
        )

        return item
    }

    // MARK: - Get Wardrobe Stats

    func getStats() async throws -> WardrobeStats {
        let stats: WardrobeStats = try await network.apiRequest(
            APIConfig.Endpoints.wardrobeStats
        )
        return stats
    }
}

// MARK: - Wardrobe Response Model

struct WardrobeItemResponse: Codable, Identifiable, Hashable {
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

    static func == (lhs: WardrobeItemResponse, rhs: WardrobeItemResponse) -> Bool {
        lhs.id == rhs.id
    }
}
