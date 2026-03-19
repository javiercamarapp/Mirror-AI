import SwiftUI

struct PremiumBadge: View {
    var style: BadgeStyle = .standard

    enum BadgeStyle {
        case standard
        case compact
        case large
    }

    var body: some View {
        switch style {
        case .standard:
            standardBadge
        case .compact:
            compactBadge
        case .large:
            largeBadge
        }
    }

    private var standardBadge: some View {
        HStack(spacing: 5) {
            Image(systemName: "crown.fill")
                .font(.caption2)
                .accessibilityHidden(true)

            Text("PRO")
                .font(.caption2)
                .fontWeight(.black)
        }
        .foregroundStyle(Color(hex: "1a0533"))
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [Color(hex: "FFD700"), Color(hex: "FFA500")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.a11yPremiumBadge)
    }

    private var compactBadge: some View {
        HStack(spacing: 3) {
            Image(systemName: "crown.fill")
                .font(.system(size: 9))
                .accessibilityHidden(true)

            Text("PRO")
                .font(.system(size: 9, weight: .black))
        }
        .foregroundStyle(Color(hex: "1a0533"))
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [Color(hex: "FFD700"), Color(hex: "FFA500")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.a11yPremiumBadge)
    }

    private var largeBadge: some View {
        HStack(spacing: 8) {
            Image(systemName: "crown.fill")
                .font(.system(size: 16))
                .accessibilityHidden(true)

            Text("PREMIUM")
                .font(.system(size: 14, weight: .black))
        }
        .foregroundStyle(Color(hex: "1a0533"))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [Color(hex: "FFD700"), Color(hex: "FFA500"), Color(hex: "FFD700")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .shadow(color: Color(hex: "FFD700").opacity(0.4), radius: 8, y: 2)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.a11yPremiumBadge)
    }
}
