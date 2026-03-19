import UIKit
import ImageIO
import UniformTypeIdentifiers

// MARK: - EXIF Metadata Stripper
// Removes ALL EXIF metadata (including GPS location data) from images before upload.

enum EXIFStripper {

    /// Strips all EXIF metadata from a UIImage, returning clean image data.
    /// - Parameters:
    ///   - image: The source UIImage
    ///   - compressionQuality: JPEG compression quality (0.0 to 1.0)
    /// - Returns: Clean JPEG data without any EXIF metadata, or nil if stripping fails
    static func stripMetadata(from image: UIImage, compressionQuality: CGFloat = 0.85) -> Data? {
        guard let imageData = image.jpegData(compressionQuality: compressionQuality) else {
            return nil
        }
        return stripMetadata(from: imageData)
    }

    /// Strips all EXIF metadata from raw image data.
    /// - Parameter data: The source image data (JPEG, PNG, etc.)
    /// - Returns: Clean image data without any EXIF metadata, or nil if stripping fails
    static func stripMetadata(from data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let type = CGImageSourceGetType(source),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return nil
        }

        let mutableData = NSMutableData()

        guard let destination = CGImageDestinationCreateWithData(
            mutableData as CFMutableData,
            type,
            1,
            nil
        ) else {
            return nil
        }

        // Create properties that explicitly exclude all metadata
        let cleanProperties: [CFString: Any] = [
            kCGImagePropertyExifDictionary: kCFNull as Any,
            kCGImagePropertyGPSDictionary: kCFNull as Any,
            kCGImagePropertyIPTCDictionary: kCFNull as Any,
            kCGImagePropertyTIFFDictionary: kCFNull as Any,
            kCGImagePropertyJFIFDictionary: kCFNull as Any,
            kCGImagePropertyMakerAppleDictionary: kCFNull as Any,
            kCGImageDestinationMetadata: kCFNull as Any,
        ]

        CGImageDestinationAddImage(destination, cgImage, cleanProperties as CFDictionary)

        guard CGImageDestinationFinalize(destination) else {
            return nil
        }

        return mutableData as Data
    }

    /// Strips metadata and returns a clean UIImage.
    /// - Parameter image: The source UIImage
    /// - Returns: A new UIImage without EXIF metadata
    static func cleanImage(_ image: UIImage) -> UIImage {
        guard let cleanData = stripMetadata(from: image),
              let cleanImage = UIImage(data: cleanData) else {
            return image
        }
        return cleanImage
    }
}
