import UIKit

class ImageUploadService {
    static let shared = ImageUploadService()
    private let network = NetworkService.shared

    private init() {}

    struct UploadResponse: Decodable {
        let imageUrl: String
        let thumbnailUrl: String?

        enum CodingKeys: String, CodingKey {
            case imageUrl = "image_url"
            case thumbnailUrl = "thumbnail_url"
        }
    }

    /// Upload image to backend, which stores in Supabase Storage
    /// Returns the public URL of the uploaded image
    func uploadImage(_ image: UIImage, bucket: String, quality: CGFloat = 0.8) async throws -> String {
        guard let imageData = image.jpegData(compressionQuality: quality) else {
            throw APIError.encodingFailed
        }

        let base64 = imageData.base64EncodedString()

        let result: UploadResponse = try await network.post(
            APIConfig.Endpoints.imageUpload,
            body: ["image": base64, "bucket": bucket]
        )

        return result.imageUrl
    }
}
