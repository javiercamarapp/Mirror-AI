import SwiftUI

struct EmptyStateView: View {
    let icon: String
    let title: String
    let description: String
    var actionTitle: String?
    var action: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isAnimating = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(MirrorTheme.purple.opacity(0.08))
                    .frame(width: 120, height: 120)
                    .scaleEffect(reduceMotion ? 1.0 : (isAnimating ? 1.1 : 1.0))

                Circle()
                    .fill(MirrorTheme.purple.opacity(0.06))
                    .frame(width: 90, height: 90)

                Image(systemName: icon)
                    .font(.system(size: 40))
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .symbolEffect(.pulse, options: .repeating.speed(0.5))
            }
            .accessibilityHidden(true)

            VStack(spacing: 8) {
                Text(title)
                    .font(.title3)
                    .fontWeight(.bold)
                    .accessibilityAddTraits(.isHeader)

                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .lineLimit(nil)
            }

            if let actionTitle, let action {
                Button {
                    let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                    impactFeedback.impactOccurred()
                    action()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus.circle.fill")
                            .accessibilityHidden(true)
                        Text(actionTitle)
                            .font(.callout)
                            .fontWeight(.bold)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 32)
                    .frame(height: 50)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.gradientPrimary)
                    )
                }
                .accessibilityLabel(actionTitle)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true)) {
                isAnimating = true
            }
        }
    }
}
