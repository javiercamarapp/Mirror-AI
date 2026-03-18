import Foundation

class SubscriptionService {
    static let shared = SubscriptionService()
    private let network = NetworkService.shared

    func verifyReceipt(receiptData: String, productId: String) async throws -> APIResponse<SubscriptionStatusModel> {
        return try await network.post(
            "\(APIConfig.Endpoints.subscriptions)/verify",
            body: ["receipt_data": receiptData, "product_id": productId]
        )
    }

    func getStatus() async throws -> APIResponse<SubscriptionStatusModel> {
        return try await network.get("\(APIConfig.Endpoints.subscriptions)/status")
    }

    func restorePurchases(receiptData: String) async throws -> APIResponse<SubscriptionStatusModel> {
        return try await network.post(
            "\(APIConfig.Endpoints.subscriptions)/restore",
            body: ["receipt_data": receiptData]
        )
    }

    func purchaseCredits(productId: String, receiptData: String, transactionId: String) async throws -> APIResponse<CreditPurchaseResponse> {
        return try await network.post(
            "\(APIConfig.Endpoints.subscriptions)/purchases/credits",
            body: [
                "product_id": productId,
                "receipt_data": receiptData,
                "transaction_id": transactionId
            ]
        )
    }

    func getCreditPacks() async throws -> APIResponse<[CreditPackModel]> {
        return try await network.get("\(APIConfig.Endpoints.subscriptions)/purchases/packs")
    }
}
