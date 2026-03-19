import SwiftUI

struct AnimatedGradient: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animatePhase: CGFloat = 0

    var body: some View {
        if reduceMotion {
            // Static gradient for reduced motion
            staticGradientView
        } else if #available(iOS 18.0, *) {
            meshGradientView
        } else {
            fallbackGradientView
        }
    }

    // MARK: - Static Gradient (Reduced Motion)

    private var staticGradientView: some View {
        LinearGradient(
            colors: [
                Color(hex: "1a0533"),
                Color(hex: "2d1b69"),
                Color(hex: "4c1d95"),
                Color(hex: "1a0533")
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .accessibilityHidden(true)
    }

    // MARK: - iOS 18+ Mesh Gradient

    @available(iOS 18.0, *)
    private var meshGradientView: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate * 0.3

            MeshGradient(
                width: 3,
                height: 3,
                points: [
                    [0.0, 0.0],
                    [0.5, 0.0],
                    [1.0, 0.0],

                    [0.0, 0.5],
                    [Float(0.5 + 0.15 * sin(phase)), Float(0.5 + 0.15 * cos(phase))],
                    [1.0, 0.5],

                    [0.0, 1.0],
                    [0.5, 1.0],
                    [1.0, 1.0]
                ],
                colors: [
                    Color(hex: "1a0533"),
                    Color(hex: "2d1b69"),
                    Color(hex: "1a0533"),

                    Color(hex: "4c1d95"),
                    Color(hex: "7c3aed"),
                    Color(hex: "831843"),

                    Color(hex: "1e1b4b"),
                    Color(hex: "4c1d95"),
                    Color(hex: "1a0533")
                ]
            )
        }
        .accessibilityHidden(true)
    }

    // MARK: - Fallback Gradient (iOS 17)

    private var fallbackGradientView: some View {
        ZStack {
            // Base gradient
            LinearGradient(
                colors: [
                    Color(hex: "1a0533"),
                    Color(hex: "2d1b69"),
                    Color(hex: "1a0533")
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            // Animated floating orbs
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(hex: "7c3aed").opacity(0.5),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 200
                    )
                )
                .frame(width: 400, height: 400)
                .offset(
                    x: 50 * sin(animatePhase),
                    y: 30 * cos(animatePhase * 0.7)
                )

            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(hex: "ec4899").opacity(0.4),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 180
                    )
                )
                .frame(width: 350, height: 350)
                .offset(
                    x: -40 * cos(animatePhase * 0.8),
                    y: 60 * sin(animatePhase * 0.6)
                )

            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(hex: "6366f1").opacity(0.35),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 160
                    )
                )
                .frame(width: 300, height: 300)
                .offset(
                    x: 30 * sin(animatePhase * 1.2),
                    y: -40 * cos(animatePhase * 0.9)
                )
        }
        .onAppear {
            withAnimation(.linear(duration: 10).repeatForever(autoreverses: false)) {
                animatePhase = .pi * 2
            }
        }
        .accessibilityHidden(true)
    }
}
