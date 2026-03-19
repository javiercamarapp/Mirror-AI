import SwiftUI

struct LoadingOverlay: View {
    let message: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isAnimating = false

    init(message: String? = nil) {
        self.message = message
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                ZStack {
                    // Outer pulsing ring (skip if reduce motion)
                    if !reduceMotion {
                        Circle()
                            .strokeBorder(
                                MirrorTheme.gradientPrimary,
                                lineWidth: 3
                            )
                            .frame(width: 60, height: 60)
                            .scaleEffect(isAnimating ? 1.2 : 0.8)
                            .opacity(isAnimating ? 0 : 0.8)
                    }

                    // Inner spinner
                    ProgressView()
                        .controlSize(.large)
                        .tint(MirrorTheme.purple)
                }

                if let message {
                    Text(message)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(.white.opacity(0.9))
                        .multilineTextAlignment(.center)
                        .lineLimit(nil)
                        .minimumScaleFactor(0.8)
                }
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 24)
                            .strokeBorder(Color.white.opacity(0.4), lineWidth: 1)
                    )
            )
            .scaleEffect(reduceMotion ? 1.0 : (isAnimating ? 1.0 : 0.9))
        }
        .onAppear {
            if reduceMotion {
                isAnimating = true
            } else {
                withAnimation(.easeOut(duration: 0.3)) {
                    isAnimating = true
                }
                withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: false)) {
                    isAnimating = true
                }
            }
        }
        .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.95)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message ?? L10n.loading)
        .accessibilityAddTraits(.updatesFrequently)
    }
}
