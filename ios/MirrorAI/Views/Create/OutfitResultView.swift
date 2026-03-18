import SwiftUI

struct OutfitResultView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let outfit: OutfitSuggestionModel

    @State private var animateIn = false
    @State private var showShareSheet = false
    @State private var showPostCreator = false
    @State private var isSaving = false
    @State private var isTryingOn = false
    @State private var tryOnResultUrl: String?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 24) {
                // Score hero
                scoreSection
                    .opacity(animateIn ? 1 : 0)
                    .offset(y: animateIn ? 0 : 20)

                // Outfit name
                VStack(spacing: 6) {
                    Text(outfit.name)
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(MirrorTheme.gradientPrimary)
                        .multilineTextAlignment(.center)

                    Text(outfit.reasoning)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                .padding(.horizontal, 20)
                .opacity(animateIn ? 1 : 0)
                .animation(.easeOut(duration: 0.5).delay(0.15), value: animateIn)

                // Items grid
                itemsGrid
                    .opacity(animateIn ? 1 : 0)
                    .animation(.easeOut(duration: 0.5).delay(0.25), value: animateIn)

                // Styling tips
                stylingTipsSection
                    .opacity(animateIn ? 1 : 0)
                    .animation(.easeOut(duration: 0.5).delay(0.35), value: animateIn)

                // Try-on result
                if let resultUrl = tryOnResultUrl {
                    tryOnResultSection(resultUrl)
                }

                // Action buttons
                actionButtons
                    .padding(.horizontal, 20)
                    .opacity(animateIn ? 1 : 0)
                    .animation(.easeOut(duration: 0.5).delay(0.45), value: animateIn)
            }
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .background(Color(UIColor.systemBackground))
        .navigationTitle("Your Outfit")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPostCreator) {
            PostCreatorView(
                prefilledImageUrl: outfit.items?.first?.imageUrl,
                prefilledOccasion: outfit.name
            )
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) {
                animateIn = true
            }
        }
    }

    // MARK: - Score Section

    private var scoreSection: some View {
        ZStack {
            // Background glow
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            scoreColor.opacity(0.3),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 20,
                        endRadius: 100
                    )
                )
                .frame(width: 200, height: 200)

            VStack(spacing: 8) {
                // Score ring
                ZStack {
                    Circle()
                        .stroke(MirrorTheme.surfaceColor, lineWidth: 8)
                        .frame(width: 110, height: 110)

                    Circle()
                        .trim(from: 0, to: animateIn ? outfit.score / 10.0 : 0)
                        .stroke(
                            scoreGradient,
                            style: StrokeStyle(lineWidth: 8, lineCap: .round)
                        )
                        .frame(width: 110, height: 110)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 1.0).delay(0.3), value: animateIn)

                    VStack(spacing: 2) {
                        Text(String(format: "%.1f", outfit.score))
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .foregroundStyle(MirrorTheme.gradientPrimary)

                        Text("/10")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }

                Text("Style Score")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Items Grid

    private var itemsGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "tshirt.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(MirrorTheme.purple)

                Text("Outfit Items")
                    .font(.system(size: 16, weight: .bold))

                Spacer()

                Text("\(outfit.items?.count ?? outfit.itemIds.count) pieces")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    if let items = outfit.items {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            outfitItemCard(item, index: index)
                        }
                    } else {
                        // Placeholder cards for items not yet resolved
                        ForEach(0..<outfit.itemIds.count, id: \.self) { index in
                            placeholderItemCard(index: index)
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private func outfitItemCard(_ item: WardrobeItemModel, index: Int) -> some View {
        VStack(spacing: 8) {
            // Item image
            CachedAsyncImage(url: URL(string: item.imageNoBgUrl ?? item.imageUrl)) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(MirrorTheme.surfaceColor)
                    .overlay {
                        Image(systemName: "tshirt")
                            .font(.system(size: 24))
                            .foregroundStyle(.tertiary)
                    }
            }
            .frame(width: 130, height: 160)
            .clipShape(RoundedRectangle(cornerRadius: 14))

            // Item info
            VStack(spacing: 2) {
                Text(item.name)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)

                Text(item.category)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)

                // Color dot
                HStack(spacing: 4) {
                    Circle()
                        .fill(colorFromName(item.color))
                        .frame(width: 8, height: 8)
                    Text(item.color)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .frame(width: 130)
        .opacity(animateIn ? 1 : 0)
        .offset(y: animateIn ? 0 : 20)
        .animation(.spring(response: 0.5).delay(0.3 + Double(index) * 0.1), value: animateIn)
    }

    private func placeholderItemCard(index: Int) -> some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 14)
                .fill(MirrorTheme.surfaceColor)
                .frame(width: 130, height: 160)
                .overlay {
                    Image(systemName: "tshirt")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                }

            RoundedRectangle(cornerRadius: 4)
                .fill(MirrorTheme.surfaceColor)
                .frame(width: 80, height: 12)
        }
        .frame(width: 130)
    }

    // MARK: - Styling Tips

    private var stylingTipsSection: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "lightbulb.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(.yellow)

                    Text("Styling Tips")
                        .font(.system(size: 16, weight: .bold))
                }

                let tips = outfit.stylingTips.components(separatedBy: "\n").filter { !$0.isEmpty }
                ForEach(Array(tips.enumerated()), id: \.offset) { _, tip in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "sparkle")
                            .font(.system(size: 10))
                            .foregroundStyle(MirrorTheme.purple)
                            .padding(.top, 3)

                        Text(tip)
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Try On Result

    private func tryOnResultSection(_ url: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "person.fill.viewfinder")
                    .font(.system(size: 14))
                    .foregroundStyle(MirrorTheme.pink)

                Text("Virtual Try-On")
                    .font(.system(size: 16, weight: .bold))
            }
            .padding(.horizontal, 20)

            CachedAsyncImage(url: URL(string: url)) {
                RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                    .fill(MirrorTheme.surfaceColor)
                    .frame(height: 400)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 400)
            .clipShape(RoundedRectangle(cornerRadius: MirrorTheme.cardRadius))
            .padding(.horizontal, 20)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 12) {
            // Primary row
            HStack(spacing: 12) {
                // Try On
                Button {
                    tryOnOutfit()
                } label: {
                    HStack(spacing: 8) {
                        if isTryingOn {
                            ProgressView()
                                .tint(.white)
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "person.fill.viewfinder")
                                .font(.system(size: 16))
                        }
                        Text("Try On")
                            .font(.system(size: 15, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.gradientPrimary)
                    )
                }
                .disabled(isTryingOn)

                // Save
                Button {
                    saveOutfit()
                } label: {
                    HStack(spacing: 8) {
                        if isSaving {
                            ProgressView()
                                .tint(MirrorTheme.purple)
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "bookmark.fill")
                                .font(.system(size: 16))
                        }
                        Text("Save")
                            .font(.system(size: 15, weight: .bold))
                    }
                    .foregroundStyle(MirrorTheme.purple)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.purple.opacity(0.12))
                            .overlay(
                                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                    .strokeBorder(MirrorTheme.purple.opacity(0.3), lineWidth: 1)
                            )
                    )
                }
                .disabled(isSaving)
            }

            // Share button
            Button {
                let impact = UIImpactFeedbackGenerator(style: .medium)
                impact.impactOccurred()
                showPostCreator = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 16))
                    Text("Share to Feed")
                        .font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(MirrorTheme.surfaceColor)
                        .overlay(
                            RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                        )
                )
            }
        }
    }

    // MARK: - Actions

    private func saveOutfit() {
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.impactOccurred()
        isSaving = true

        Task {
            await appState.saveOutfitOfDay(outfit, image: nil)
            isSaving = false

            let notification = UINotificationFeedbackGenerator()
            notification.notificationOccurred(.success)
        }
    }

    private func tryOnOutfit() {
        guard let firstItem = outfit.items?.first else { return }

        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()
        isTryingOn = true

        Task {
            let result = await appState.tryVirtualTryOn(
                garmentUrl: firstItem.imageUrl,
                category: firstItem.category
            )
            withAnimation(.spring(response: 0.4)) {
                tryOnResultUrl = result
                isTryingOn = false
            }

            if result != nil {
                let notification = UINotificationFeedbackGenerator()
                notification.notificationOccurred(.success)
            } else {
                let notification = UINotificationFeedbackGenerator()
                notification.notificationOccurred(.error)
            }
        }
    }

    // MARK: - Helpers

    private var scoreColor: Color {
        switch outfit.score {
        case 8...10: return .green
        case 6..<8: return .yellow
        case 4..<6: return .orange
        default: return .red
        }
    }

    private var scoreGradient: LinearGradient {
        switch outfit.score {
        case 8...10:
            return LinearGradient(
                colors: [.green, .mint],
                startPoint: .leading,
                endPoint: .trailing
            )
        case 6..<8:
            return LinearGradient(
                colors: [.yellow, .orange],
                startPoint: .leading,
                endPoint: .trailing
            )
        default:
            return MirrorTheme.gradientPrimary
        }
    }

    private func colorFromName(_ name: String) -> Color {
        switch name.lowercased() {
        case "black": return .primary
        case "white": return .white
        case "red": return .red
        case "blue": return .blue
        case "green": return .green
        case "yellow": return .yellow
        case "orange": return .orange
        case "purple": return .purple
        case "pink": return .pink
        case "brown": return .brown
        case "gray", "grey": return .gray
        case "navy": return Color(hex: "001F3F")
        case "beige", "cream": return Color(hex: "F5F5DC")
        default: return .secondary
        }
    }
}
