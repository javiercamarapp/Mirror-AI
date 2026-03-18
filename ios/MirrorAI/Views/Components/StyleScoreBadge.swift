import SwiftUI

struct StyleScoreBadge: View {
    let score: Double
    let tier: String

    @State private var sparklePhase = false

    var body: some View {
        HStack(spacing: 8) {
            // Tier icon
            ZStack {
                Circle()
                    .fill(tierGradient)
                    .frame(width: 36, height: 36)

                Image(systemName: tierIcon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)

                if tier == "Diamante" {
                    Image(systemName: "sparkle")
                        .font(.system(size: 8))
                        .foregroundStyle(.white)
                        .offset(x: 12, y: -12)
                        .scaleEffect(sparklePhase ? 1.3 : 0.7)
                        .opacity(sparklePhase ? 1 : 0.3)
                }
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(tier)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(tierColor)

                Text(String(format: "%.0f", score))
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            Capsule()
                .fill(tierColor.opacity(0.1))
                .overlay(
                    Capsule()
                        .strokeBorder(tierColor.opacity(0.25), lineWidth: 1)
                )
        )
        .onAppear {
            if tier == "Diamante" {
                withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                    sparklePhase = true
                }
            }
        }
    }

    private var tierColor: Color {
        switch tier {
        case "Bronce": return Color(hex: "CD7F32")
        case "Plata": return Color(hex: "C0C0C0")
        case "Oro": return Color(hex: "FFD700")
        case "Platino": return Color(hex: "E5E4E2")
        case "Diamante": return Color(hex: "B9F2FF")
        default: return .gray
        }
    }

    private var tierGradient: LinearGradient {
        switch tier {
        case "Bronce":
            return LinearGradient(colors: [Color(hex: "CD7F32"), Color(hex: "8B5A2B")], startPoint: .topLeading, endPoint: .bottomTrailing)
        case "Plata":
            return LinearGradient(colors: [Color(hex: "C0C0C0"), Color(hex: "808080")], startPoint: .topLeading, endPoint: .bottomTrailing)
        case "Oro":
            return LinearGradient(colors: [Color(hex: "FFD700"), Color(hex: "FFA500")], startPoint: .topLeading, endPoint: .bottomTrailing)
        case "Platino":
            return LinearGradient(colors: [Color(hex: "E5E4E2"), Color(hex: "BCC6CC")], startPoint: .topLeading, endPoint: .bottomTrailing)
        case "Diamante":
            return LinearGradient(colors: [Color(hex: "B9F2FF"), Color(hex: "7DF9FF"), Color(hex: "E0FFFF")], startPoint: .topLeading, endPoint: .bottomTrailing)
        default:
            return LinearGradient(colors: [.gray], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    private var tierIcon: String {
        switch tier {
        case "Bronce": return "shield.fill"
        case "Plata": return "shield.fill"
        case "Oro": return "star.fill"
        case "Platino": return "crown.fill"
        case "Diamante": return "diamond.fill"
        default: return "shield.fill"
        }
    }
}
