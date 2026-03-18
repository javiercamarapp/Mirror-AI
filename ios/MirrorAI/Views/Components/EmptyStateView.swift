import SwiftUI

struct EmptyStateView: View {
    let icon: String
    let title: String
    let description: String
    var actionTitle: String?
    var action: (() -> Void)?

    @State private var isAnimating = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(MirrorTheme.purple.opacity(0.08))
                    .frame(width: 120, height: 120)
                    .scaleEffect(isAnimating ? 1.1 : 1.0)

                Circle()
                    .fill(MirrorTheme.purple.opacity(0.06))
                    .frame(width: 90, height: 90)

                Image(systemName: icon)
                    .font(.system(size: 40))
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .symbolEffect(.pulse, options: .repeating.speed(0.5))
            }

            VStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 22, weight: .bold))

                Text(description)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            if let actionTitle, let action {
                Button {
                    let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                    impactFeedback.impactOccurred()
                    action()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus.circle.fill")
                        Text(actionTitle)
                            .font(.system(size: 16, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 32)
                    .frame(height: 50)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.gradientPrimary)
                    )
                }
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true)) {
                isAnimating = true
            }
        }
    }
}
