import SwiftUI
import StoreKit

struct SubscriptionView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var storeKit = StoreKitManager.shared

    @State private var selectedPlan: String = "pro"
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var appearAnimation = false

    private struct PlanInfo: Identifiable {
        let id: String
        let name: String
        let price: String
        let color: Color
        let icon: String
        let features: [String]
        let highlighted: Bool
    }

    private let plans: [PlanInfo] = [
        PlanInfo(
            id: "free",
            name: "Free",
            price: "$0",
            color: .gray,
            icon: "person.fill",
            features: [
                "50 wardrobe items",
                "3 AI chats / day",
                "2 VTON credits / month",
                "Basic outfit suggestions",
                "Community feed access"
            ],
            highlighted: false
        ),
        PlanInfo(
            id: "pro",
            name: "Pro",
            price: "$4.99",
            color: Color(hex: "8B5CF6"),
            icon: "star.fill",
            features: [
                "200 wardrobe items",
                "Unlimited AI chats",
                "15 VTON credits / month",
                "Advanced style analysis",
                "AI Avatar generation",
                "Priority support"
            ],
            highlighted: true
        ),
        PlanInfo(
            id: "premium",
            name: "Premium",
            price: "$9.99",
            color: Color(hex: "FFD700"),
            icon: "crown.fill",
            features: [
                "Unlimited wardrobe",
                "Unlimited AI chats",
                "50 VTON credits / month",
                "All avatar styles",
                "Custom style reports",
                "Early access to features",
                "Priority support"
            ],
            highlighted: false
        )
    ]

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    // Header
                    headerSection

                    // Plan cards
                    ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                        planCard(plan)
                            .opacity(appearAnimation ? 1 : 0)
                            .offset(y: appearAnimation ? 0 : 30)
                            .animation(
                                .spring(response: 0.6, dampingFraction: 0.8)
                                    .delay(Double(index) * 0.1),
                                value: appearAnimation
                            )
                    }

                    // Subscribe button
                    if selectedPlan != "free" {
                        subscribeButton
                    }

                    // Restore
                    restoreButton

                    // Legal
                    legalText
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Subscription")
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

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(MirrorTheme.purple.opacity(0.1))
                    .frame(width: 80, height: 80)

                Image(systemName: "crown.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [Color(hex: "FFD700"), Color(hex: "FFA500")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .symbolEffect(.bounce, options: .repeating.speed(0.3))
            }

            Text("Choose Your Plan")
                .font(.system(size: 26, weight: .bold))

            Text("Unlock the full Mirror AI experience")
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
    }

    // MARK: - Plan Card

    private func planCard(_ plan: PlanInfo) -> some View {
        let isSelected = selectedPlan == plan.id
        let isCurrentPlan = appState.subscriptionPlan == plan.id ||
            (plan.id == "pro" && appState.subscriptionPlan == "basic")

        return Button {
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                selectedPlan = plan.id
            }
        } label: {
            VStack(spacing: 16) {
                // Plan header
                HStack {
                    HStack(spacing: 10) {
                        Image(systemName: plan.icon)
                            .font(.system(size: 18))
                            .foregroundStyle(plan.color)

                        Text(plan.name)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(.primary)
                    }

                    Spacer()

                    VStack(alignment: .trailing, spacing: 2) {
                        Text(plan.price)
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(.primary)

                        if plan.id != "free" {
                            Text("/month")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Divider()

                // Features
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(plan.features, id: \.self) { feature in
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 15))
                                .foregroundStyle(plan.color)

                            Text(feature)
                                .font(.system(size: 14))
                                .foregroundStyle(.primary)

                            Spacer()
                        }
                    }
                }

                // Current plan badge
                if isCurrentPlan {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 13))
                        Text("Current Plan")
                            .font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(.green)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(
                        Capsule()
                            .fill(Color.green.opacity(0.12))
                    )
                }
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                            .strokeBorder(
                                isSelected ? plan.color.opacity(0.6) : MirrorTheme.borderColor,
                                lineWidth: isSelected ? 2.5 : 1
                            )
                    )
                    .shadow(
                        color: isSelected ? plan.color.opacity(0.15) : .clear,
                        radius: 12, y: 4
                    )
            )
        }
        .scaleEffect(isSelected ? 1.01 : 1.0)

    }

    // MARK: - Subscribe Button

    private var subscribeButton: some View {
        Button {
            Task { await purchase() }
        } label: {
            HStack(spacing: 10) {
                if isPurchasing {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                } else {
                    Image(systemName: "crown.fill")
                        .font(.system(size: 16))
                }
                Text(isPurchasing ? "Processing..." : "Subscribe to \(selectedPlan == "pro" ? "Pro" : "Premium")")
                    .font(.system(size: 17, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                    .fill(MirrorTheme.gradientPrimary)
            )
        }
        .disabled(isPurchasing)
    }

    // MARK: - Restore

    private var restoreButton: some View {
        Button {
            Task {
                await storeKit.restorePurchases()
                let impact = UINotificationFeedbackGenerator()
                impact.notificationOccurred(.success)
            }
        } label: {
            Text("Restore Purchases")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(MirrorTheme.purple)
        }
    }

    // MARK: - Legal

    private var legalText: some View {
        Text("Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current period. Your account will be charged for renewal within 24 hours prior to the end of the current period.")
            .font(.system(size: 11))
            .foregroundStyle(.tertiary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
    }

    // MARK: - Purchase

    private func purchase() async {
        isPurchasing = true
        defer { isPurchasing = false }

        let productId = selectedPlan == "pro"
            ? "com.mirrorai.pro.monthly"
            : "com.mirrorai.premium.monthly"

        guard let product = storeKit.subscriptions.first(where: { $0.id == productId }) else {
            errorMessage = "Product not available. Please try again later."
            showError = true
            return
        }

        do {
            let transaction = try await storeKit.purchase(product)
            if transaction != nil {
                let success = UINotificationFeedbackGenerator()
                success.notificationOccurred(.success)
                dismiss()
            }
        } catch {
            errorMessage = error.localizedDescription
            showError = true
            let feedback = UINotificationFeedbackGenerator()
            feedback.notificationOccurred(.error)
        }
    }
}
