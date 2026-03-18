import Foundation

class AvatarService {
    static let shared = AvatarService()
    private let network = NetworkService.shared

    private init() {}

    func generateAvatar(selfieBase64: String, style: String = "realistic") async throws -> AvatarModel {
        return try await network.post(
            "\(APIConfig.Endpoints.avatar)/generate",
            body: ["selfie": selfieBase64, "style": style]
        )
    }

    func getAvatar() async throws -> AvatarModel {
        return try await network.get(APIConfig.Endpoints.avatar)
    }

    func customizeAvatar(updates: [String: Any]) async throws -> AvatarModel {
        return try await network.patch(
            "\(APIConfig.Endpoints.avatar)/customize",
            body: updates
        )
    }

    func tryOutfitOnAvatar(itemIds: [String]) async throws -> AvatarRenderModel {
        return try await network.post(
            "\(APIConfig.Endpoints.avatar)/try-outfit",
            body: ["item_ids": itemIds]
        )
    }

    func getRenders(page: Int = 1, limit: Int = 20) async throws -> [AvatarRenderModel] {
        return try await network.get(
            "\(APIConfig.Endpoints.avatar)/renders",
            queryParams: [
                "page": String(page),
                "limit": String(limit)
            ]
        )
    }

    func deleteRender(id: String) async throws {
        struct EmptyResponse: Decodable {}
        let _: EmptyResponse = try await network.delete(
            "\(APIConfig.Endpoints.avatar)/renders/\(id)"
        )
    }
}
