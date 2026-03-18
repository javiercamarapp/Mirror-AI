// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MirrorAI",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "MirrorAI",
            targets: ["MirrorAI"]
        ),
    ],
    dependencies: [
        // Google Sign-In SDK
        .package(url: "https://github.com/google/GoogleSignIn-iOS", from: "7.0.0"),
    ],
    targets: [
        .target(
            name: "MirrorAI",
            dependencies: [
                .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
            ],
            path: "MirrorAI"
        ),
    ]
)
