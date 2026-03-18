import StoreKit
import Foundation

@MainActor
class StoreKitManager: ObservableObject {
    static let shared = StoreKitManager()

    @Published var subscriptions: [Product] = []
    @Published var creditPacks: [Product] = []
    @Published var purchasedSubscription: Product?
    @Published var isLoading = false

    private let subscriptionProductIds = [
        "com.mirrorai.pro.monthly",
        "com.mirrorai.premium.monthly"
    ]

    private let creditPackProductIds = [
        "com.mirrorai.credits.5",
        "com.mirrorai.credits.15",
        "com.mirrorai.credits.50"
    ]

    private var transactionListener: Task<Void, Error>?

    init() {
        transactionListener = listenForTransactions()
        Task { await loadProducts() }
    }

    deinit {
        transactionListener?.cancel()
    }

    // Load products from App Store
    func loadProducts() async {
        do {
            let allIds = subscriptionProductIds + creditPackProductIds
            let products = try await Product.products(for: Set(allIds))
            subscriptions = products.filter { subscriptionProductIds.contains($0.id) }
                .sorted { $0.price < $1.price }
            creditPacks = products.filter { creditPackProductIds.contains($0.id) }
                .sorted { $0.price < $1.price }
        } catch {
            print("Failed to load products: \(error)")
        }
    }

    // Purchase subscription
    func purchase(_ product: Product) async throws -> Transaction? {
        isLoading = true
        defer { isLoading = false }

        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            let transaction = try checkVerified(verification)
            await transaction.finish()

            // Verify receipt with backend
            await verifyWithBackend(transaction: transaction, product: product)

            await updateSubscriptionStatus()
            return transaction
        case .userCancelled:
            return nil
        case .pending:
            return nil
        @unknown default:
            return nil
        }
    }

    // Verify transaction
    func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let safe):
            return safe
        }
    }

    // Listen for transactions
    func listenForTransactions() -> Task<Void, Error> {
        Task.detached {
            for await result in Transaction.updates {
                do {
                    let transaction = try await self.checkVerified(result)
                    await transaction.finish()
                    await self.updateSubscriptionStatus()
                } catch {
                    print("Transaction failed verification: \(error)")
                }
            }
        }
    }

    // Verify receipt with backend
    private func verifyWithBackend(transaction: Transaction, product: Product) async {
        do {
            let receiptData = transaction.jsonRepresentation.base64EncodedString()
            let productId = transaction.productID

            if subscriptionProductIds.contains(productId) {
                let _ = try await SubscriptionService.shared.verifyReceipt(
                    receiptData: receiptData,
                    productId: productId
                )
            } else if creditPackProductIds.contains(productId) {
                let _ = try await SubscriptionService.shared.purchaseCredits(
                    productId: productId,
                    receiptData: receiptData,
                    transactionId: String(transaction.id)
                )
            }
        } catch {
            print("Backend receipt verification failed: \(error.localizedDescription)")
        }
    }

    // Update subscription status
    func updateSubscriptionStatus() async {
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result {
                if subscriptionProductIds.contains(transaction.productID) {
                    purchasedSubscription = subscriptions.first { $0.id == transaction.productID }
                }
            }
        }
    }

    // Restore purchases
    func restorePurchases() async {
        try? await AppStore.sync()
        await updateSubscriptionStatus()
    }

    // Check if user has active subscription
    var hasActiveSubscription: Bool {
        purchasedSubscription != nil
    }

    var currentPlan: String {
        guard let sub = purchasedSubscription else { return "free" }
        if sub.id.contains("premium") { return "premium" }
        if sub.id.contains("pro") { return "basic" }
        return "free"
    }
}
