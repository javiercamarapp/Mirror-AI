import Foundation
import UIKit

// MARK: - Background Removal Service

class BiRefNetService {
    static let shared = BiRefNetService()
    private let network = NetworkService.shared

    private init() {}

    // MARK: - Remove Background

    /// Sends an image to the backend for background removal.
    /// Returns a new UIImage with a transparent background.
    func removeBackground(image: UIImage) async throws -> UIImage {
        guard let imageData = image.jpegData(compressionQuality: 0.85) else {
            throw APIError.encodingFailed
        }

        // Send image as base64 to the remove-bg endpoint
        let json = try await network.uploadImageBase64(
            APIConfig.Endpoints.imageRemoveBg,
            imageData: imageData
        )

        // Extract the result image URL from response
        guard let data = json["data"] as? [String: Any],
              let resultUrlString = data["image_url"] as? String ?? data["url"] as? String else {
            throw APIError.noData
        }

        // Download the transparent PNG from the returned URL
        guard let resultUrl = URL(string: resultUrlString) else {
            throw APIError.invalidURL
        }

        let (downloadedData, response) = try await URLSession.pinned().data(from: resultUrl)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.httpError(statusCode: statusCode, message: "Failed to download processed image")
        }

        guard let resultImage = UIImage(data: downloadedData) else {
            throw APIError.decodingFailed(
                NSError(domain: "BiRefNetService", code: 0,
                        userInfo: [NSLocalizedDescriptionKey: "Could not create image from downloaded data"])
            )
        }

        return resultImage
    }

    // MARK: - Remove Background (Returns URL)

    /// Sends an image for background removal and returns the URL of the processed image
    /// instead of downloading it. Useful when you only need the URL (e.g., for wardrobe storage).
    func removeBackgroundURL(image: UIImage) async throws -> String {
        guard let imageData = image.jpegData(compressionQuality: 0.85) else {
            throw APIError.encodingFailed
        }

        let json = try await network.uploadImageBase64(
            APIConfig.Endpoints.imageRemoveBg,
            imageData: imageData
        )

        guard let data = json["data"] as? [String: Any],
              let resultUrlString = data["image_url"] as? String ?? data["url"] as? String else {
            throw APIError.noData
        }

        return resultUrlString
    }

    // MARK: - Generate Collage

    /// Generates a collage image from multiple wardrobe item image URLs.
    func generateCollage(imageUrls: [String], layout: String? = nil) async throws -> String {
        struct CollageRequest: Encodable {
            let imageUrls: [String]
            let layout: String?
        }

        let body = CollageRequest(imageUrls: imageUrls, layout: layout)

        struct CollageResponse: Decodable {
            let collageUrl: String

            enum CodingKeys: String, CodingKey {
                case collageUrl = "collage_url"
            }
        }

        let response: CollageResponse = try await network.apiRequest(
            APIConfig.Endpoints.imageCollage,
            method: "POST",
            body: body
        )

        return response.collageUrl
    }
}
