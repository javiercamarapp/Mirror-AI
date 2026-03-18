import SwiftUI

struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var showSubscription = false
    @State private var scaleEffect: CGFloat = 0.85
    @State private var bgOpacity: Double = 0
    @State private var contentOpacity: Double = 0
    @State private var pulseAnimation = false

    private let features = [
        ("wand.and.stars", "AI Avatar Generation"),
        ("person.fill.viewfinder", "Unlimited Virtual Try-On"),
        ("sparkles", "Advanced Style Analysis"),
        ("tshirt.fill", "Unlimited Wardrobe"),
        ("bolt.circle.fill", "Monthly VTON Credits")
    ]

    var body: some View {
        ZStack {
            // Blurred background
            Color.black.opacity(bgOpacity * 0.6)
                .ignoresSafeArea()
                .onTapGesture { dismissWithAnimation() }

            // Content card
            VStack(spacing: 24) {
                // Dismiss handle
                Capsule()
                    .fill(Color.white.opacity(0.3))
                    .frame(width: 36, height: 5)
                    .padding(.top, 12)

                // Lock icon
                ZStack {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [MirrorTheme.purple.opacity(0.25), Color.clear],
                                center: .center,
                                startRadius: 20,
                                endRadius: 70
                            )
                        )
                        .frame(width: 120, height: 120)
                        .scaleEffect(pulseAnimation ? 1.1 : 0.9)

                    ZStack {
                        Circle()
                            .fill(MirrorTheme.gradientPrimary)
                            .frame(width: 72, height: 72)

                        Image(systemName: "lock.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(.white)
                            .symbolEffect(.bounce, options: .repeating.speed(0.4))
                    }
                }

                // Title
                VStack(spacing: 8) {
                    Text("Premium Feature")
                        .font(.system(size: 24, weight: .bold))

                    Text("Unlock the full potential of Mirror AI")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                // Features list
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(features, id: \.0) { icon, text in
                        HStack(spacing: 14) {
                            Image(systemName: icon)
                                .font(.system(size: 17))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                                .frame(width: 24)

                            Text(text)
                                .font(.system(size: 15, weight: .medium))
                        }
                    }
                }
                .padding(.horizontal, 8)

                // Upgrade button
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .heavy)
                    impact.impactOccurred()
                    showSubscription = true
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "crown.fill")
                            .font(.system(size: 16))
                        Text("Upgrade Now")
                            .font(.system(size: 17, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.gradientPrimary)
                            .shadow(color: MirrorTheme.purple.opacity(0.4), radius: 12, y: 4)
                    )
                }

                // Pricing hint
                HStack(spacing: 4) {
                    Text("Starting at")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                    Text("$4.99/month")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(MirrorTheme.purple)
                }

                // Maybe later
                Button {
                    dismissWithAnimation()
                } label: {
                    Text("Maybe Later")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 8)
                }

                Spacer().frame(height: 8)
            }
            .padding(.horizontal, 24)
            .background(
                RoundedRectangle(cornerRadius: 28)
                    .fill(.ultraThickMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 28)
                            .strokeBorder(
                                LinearGradient(
                                    colors: [
                                        MirrorTheme.purple.opacity(0.3),
                                        MirrorTheme.pink.opacity(0.15),
                                        Color.clear
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 1.5
                            )
                    )
                    .shadow(color: .black.opacity(0.3), radius: 30, y: 10)
            )
            .padding(.horizontal, 16)
            .scaleEffect(scaleEffect)
            .opacity(contentOpacity)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.25)) {
                bgOpacity = 1
            }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.75)) {
                scaleEffect = 1.0
                contentOpacity = 1.0
            }
            withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true)) {
                pulseAnimation = true
            }
        }
        .sheet(isPresented: $showSubscription) {
            SubscriptionView()
        }
    }

    private func dismissWithAnimation() {
        withAnimation(.easeIn(duration: 0.2)) {
            scaleEffect = 0.85
            contentOpacity = 0
            bgOpacity = 0
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            dismiss()
        }
    }
}
