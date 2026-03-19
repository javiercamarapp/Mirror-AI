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

    /// Upload image to backend, which stores in Supabase Storage.
    /// All EXIF metadata (including GPS location) is stripped before upload.
    /// Returns the public URL of the uploaded image.
    func uploadImage(_ image: UIImage, bucket: String, quality: CGFloat = 0.8) async throws -> String {
        // Strip all EXIF metadata (especially GPS location) before uploading
        guard let imageData = EXIFStripper.stripMetadata(from: image, compressionQuality: quality) else {
            // Fallback to standard JPEG conversion if stripping fails
            guard let fallbackData = image.jpegData(compressionQuality: quality) else {
                throw APIError.encodingFailed
            }
            let base64 = fallbackData.base64EncodedString()
            let result: UploadResponse = try await network.post(
                APIConfig.Endpoints.imageUpload,
                body: ["image": base64, "bucket": bucket]
            )
            return result.imageUrl
        }

        let base64 = imageData.base64EncodedString()

        let result: UploadResponse = try await network.post(
            APIConfig.Endpoints.imageUpload,
            body: ["image": base64, "bucket": bucket]
        )

        return result.imageUrl
    }
}
