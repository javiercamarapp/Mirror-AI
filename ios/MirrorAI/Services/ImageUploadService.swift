import UIKit
import os

enum ImageUploadError: LocalizedError {
    case exifStrippingFailed
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .exifStrippingFailed:
            return "Failed to strip image metadata for privacy. Please try again."
        case .encodingFailed:
            return "Failed to encode image. Please try a different photo."
        }
    }
}

class ImageUploadService {
    static let shared = ImageUploadService()
    private static let logger = Logger(subsystem: "com.mirrorai", category: "ImageUploadService")
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
            // EXIF stripping failed - do NOT silently upload with metadata for user privacy
            Self.logger.error("EXIF metadata stripping failed. Refusing to upload image with potential location data.")
            throw ImageUploadError.exifStrippingFailed
        }

        let base64 = imageData.base64EncodedString()

        let result: UploadResponse = try await network.post(
            APIConfig.Endpoints.imageUpload,
            body: ["image": base64, "bucket": bucket]
        )

        return result.imageUrl
    }
}
