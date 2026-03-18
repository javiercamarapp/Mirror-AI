import SwiftUI
import StoreKit

struct CreditsShopView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var storeKit = StoreKitManager.shared

    @State private var isPurchasing = false
    @State private var purchasingPackId: String?
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var animateCredits = false
    @State private var appearAnimation = false

    private struct CreditPack: Identifiable {
        let id: String
        let credits: Int
        let price: String
        let pricePerCredit: String
        let productId: String
        let isBestValue: Bool
        let color: Color
        let icon: String
    }

    private let packs: [CreditPack] = [
        CreditPack(
            id: "small",
            credits: 5,
            price: "$1.99",
            pricePerCredit: "$0.40",
            productId: "com.mirrorai.credits.5",
            isBestValue: false,
            color: Color(hex: "8B5CF6"),
            icon: "bolt.fill"
        ),
        CreditPack(
            id: "medium",
            credits: 15,
            price: "$4.99",
            pricePerCredit: "$0.33",
            productId: "com.mirrorai.credits.15",
            isBestValue: false,
            color: Color(hex: "6366F1"),
            icon: "bolt.circle.fill"
        ),
        CreditPack(
            id: "large",
            credits: 50,
            price: "$14.99",
            pricePerCredit: "$0.30",
            productId: "com.mirrorai.credits.50",
            isBestValue: true,
            color: Color(hex: "EC4899"),
            icon: "bolt.shield.fill"
        )
    ]

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    // Current credits
                    creditsDisplay

                    // Credit packs
                    ForEach(Array(packs.enumerated()), id: \.element.id) { index, pack in
                        creditPackCard(pack)
                            .opacity(appearAnimation ? 1 : 0)
                            .offset(y: appearAnimation ? 0 : 25)
                            .animation(
                                .spring(response: 0.5, dampingFraction: 0.8)
                                    .delay(Double(index) * 0.08),
                                value: appearAnimation
                            )
                    }

                    // Info text
                    infoText
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Credits Shop")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .onAppear {
                withAnimation { appearAnimation = true }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
        }
    }

    // MARK: - Credits Display

    private var creditsDisplay: some View {
        GlassCard {
            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(MirrorTheme.purple.opacity(0.12))
                        .frame(width: 72, height: 72)

                    Image(systemName: "bolt.circle.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(MirrorTheme.gradientPrimary)
                        .symbolEffect(.bounce, value: animateCredits)
                }

                Text("\(appState.vtonCredits)")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .contentTransition(.numericText())

                Text("Credits Available")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.secondary)

                Text("Use credits for virtual try-on sessions")
                    .font(.system(size: 13))
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
    }

    // MARK: - Credit Pack Card

    private func creditPackCard(_ pack: CreditPack) -> some View {
        Button {
            Task { await purchasePack(pack) }
        } label: {
            ZStack(alignment: .topTrailing) {
                HStack(spacing: 16) {
                    // Icon
                    ZStack {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(pack.color.opacity(0.12))
                            .frame(width: 64, height: 64)

                        Image(systemName: pack.icon)
                            .font(.system(size: 28))
                            .foregroundStyle(pack.color)
                    }

                    // Details
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(pack.credits) Credits")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.primary)

                        Text("\(pack.pricePerCredit) per credit")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    // Price button
                    VStack(spacing: 4) {
                        if isPurchasing && purchasingPackId == pack.id {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                                .frame(width: 80, height: 38)
                                .background(
                                    RoundedRectangle(cornerRadius: 12)
                                        .fill(pack.color.opacity(0.5))
                                )
                        } else {
                            Text(pack.price)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 80, height: 38)
                                .background(
                                    RoundedRectangle(cornerRadius: 12)
                                        .fill(
                                            LinearGradient(
                                                colors: [pack.color, pack.color.opacity(0.8)],
                                                startPoint: .topLeading,
                                                endPoint: .bottomTrailing
                                            )
                                        )
                                )
                        }
                    }
                }
                .padding(18)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                                .strokeBorder(
                                    pack.isBestValue ? pack.color.opacity(0.4) : MirrorTheme.borderColor,
                                    lineWidth: pack.isBestValue ? 2 : 1
                                )
                        )
                        .shadow(
                            color: pack.isBestValue ? pack.color.opacity(0.15) : .clear,
                            radius: 10, y: 4
                        )
                )

                // Best Value badge
                if pack.isBestValue {
                    Text("BEST VALUE")
                        .font(.system(size: 10, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [pack.color, pack.color.opacity(0.8)],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                        )
                        .offset(x: -8, y: -8)
                }
            }
        }
        .disabled(isPurchasing)
    }

    // MARK: - Info Text

    private var infoText: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "info.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                Text("Credits never expire")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 6) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                Text("Pro & Premium plans include monthly credits")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Purchase

    private func purchasePack(_ pack: CreditPack) async {
        isPurchasing = true
        purchasingPackId = pack.id
        defer {
            isPurchasing = false
            purchasingPackId = nil
        }

        guard let product = storeKit.creditPacks.first(where: { $0.id == pack.productId }) else {
            errorMessage = "Product not available. Please try again later."
            showError = true
            return
        }

        do {
            let transaction = try await storeKit.purchase(product)
            if transaction != nil {
                // Update credits locally
                withAnimation {
                    animateCredits.toggle()
                }
                let success = UINotificationFeedbackGenerator()
                success.notificationOccurred(.success)

                // Reload credits from server
                await appState.loadVTONCredits()
            }
        } catch {
            errorMessage = error.localizedDescription
            showError = true
            let feedback = UINotificationFeedbackGenerator()
            feedback.notificationOccurred(.error)
        }
    }
}
