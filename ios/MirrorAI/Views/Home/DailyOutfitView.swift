import SwiftUI

struct DailyOutfitView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var suggestion: OutfitSuggestionModel?
    @State private var isGenerating = false
    @State private var isSaving = false
    @State private var selectedOccasion = "Casual"
    @State private var showShareSheet = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animateItems = false

    private let occasions = ["Casual", "Work", "Date Night", "Party", "Formal", "Gym", "Weekend"]

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    // Occasion picker
                    occasionPicker

                    if isGenerating {
                        generatingState
                    } else if let suggestion {
                        outfitDisplay(suggestion)
                    } else {
                        emptyState
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Daily Outfit")
            .navigationBarTitleDisplayMode(.inline)
            .dynamicTypeSize(...DynamicTypeSize.accessibility5)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    // MARK: - Occasion Picker

    private var occasionPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(occasions, id: \.self) { occasion in
                    Button {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
                        impactFeedback.impactOccurred()
                        withAnimation(.spring(response: 0.3)) {
                            selectedOccasion = occasion
                        }
                    } label: {
                        Text(occasion)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(selectedOccasion == occasion ? .white : .primary)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                            .background(
                                Capsule()
                                    .fill(selectedOccasion == occasion ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(MirrorTheme.surfaceColor))
                                    .overlay(
                                        Capsule()
                                            .strokeBorder(selectedOccasion == occasion ? Color.clear : MirrorTheme.borderColor, lineWidth: 1)
                                    )
                            )
                    }
                    .accessibilityLabel("\(occasion) occasion")
                    .accessibilityValue(selectedOccasion == occasion ? "Selected" : "")
                    .accessibilityAddTraits(selectedOccasion == occasion ? [.isButton, .isSelected] : .isButton)
                }
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 24) {
            Spacer().frame(height: 40)

            Image(systemName: "wand.and.stars")
                .font(.system(size: 56))
                .foregroundStyle(MirrorTheme.gradientPrimary)
                .symbolEffect(.pulse, options: .repeating)

            VStack(spacing: 8) {
                Text("Ready to get styled?")
                    .font(.system(size: 22, weight: .bold))

                Text("AI will create the perfect outfit\nfrom your wardrobe")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                generateOutfit()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 18))

                    Text("Generate Outfit")
                        .font(.system(size: 17, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(MirrorTheme.gradientPrimary)
                )
            }
            .accessibilityLabel("Generate Outfit")
            .accessibilityHint("AI will create a \(selectedOccasion) outfit from your wardrobe")
        }
    }

    // MARK: - Generating State

    private var generatingState: some View {
        VStack(spacing: 20) {
            Spacer().frame(height: 60)

            ProgressView()
                .controlSize(.large)
                .tint(MirrorTheme.purple)

            Text("Crafting your look...")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.secondary)

            Text("Analyzing your wardrobe, color palette,\nand style preferences")
                .font(.system(size: 14))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Outfit Display

    private func outfitDisplay(_ outfit: OutfitSuggestionModel) -> some View {
        VStack(spacing: 20) {
            // Score
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(outfit.name)
                        .font(.system(size: 22, weight: .bold))

                    Text("Style Score")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                HStack(spacing: 4) {
                    ForEach(0..<5) { index in
                        Image(systemName: index < Int(outfit.score / 2) ? "star.fill" : "star")
                            .font(.system(size: 16))
                            .foregroundStyle(.yellow)
                    }

                    Text(String(format: "%.1f", outfit.score))
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(MirrorTheme.purple)
                }
            }

            // Items collage
            if let items = outfit.items, !items.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        itemCard(item)
                            .opacity(animateItems ? 1 : 0)
                            .offset(y: animateItems ? 0 : 20)
                            .animation(.spring(response: 0.5).delay(Double(index) * 0.1), value: animateItems)
                    }
                }
                .onAppear {
                    withAnimation { animateItems = true }
                }
            }

            // Styling tips
            GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "lightbulb.fill")
                            .foregroundStyle(.yellow)
                        Text("Styling Tips")
                            .font(.system(size: 15, weight: .semibold))
                    }

                    Text(outfit.stylingTips)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            // Action buttons
            VStack(spacing: 12) {
                Button {
                    let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                    impactFeedback.impactOccurred()
                    saveOutfit(outfit)
                } label: {
                    HStack(spacing: 8) {
                        if isSaving {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "checkmark.circle.fill")
                        }
                        Text("Save as Today's Outfit")
                            .font(.system(size: 16, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(MirrorTheme.gradientPrimary)
                    )
                }
                .disabled(isSaving)
                .accessibilityLabel(isSaving ? "Saving outfit" : "Save as today's outfit")
                .accessibilityHint("Saves this outfit as your outfit of the day")

                HStack(spacing: 12) {
                    Button {
                        generateOutfit()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.clockwise")
                            Text("New")
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(MirrorTheme.purple)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(MirrorTheme.purple.opacity(0.12))
                        )
                    }
                    .accessibilityLabel("Generate new outfit")
                    .accessibilityHint("Creates a different outfit suggestion")

                    Button {
                        // Navigate to VTON
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "person.fill.viewfinder")
                            Text("Try It On")
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(MirrorTheme.pink)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(MirrorTheme.pink.opacity(0.12))
                        )
                    }
                    .accessibilityLabel("Try it on")
                    .accessibilityHint("Opens virtual try-on for this outfit")

                    Button {
                        showShareSheet = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "square.and.arrow.up")
                            Text("Share")
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(MirrorTheme.indigo)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(MirrorTheme.indigo.opacity(0.12))
                        )
                    }
                    .accessibilityLabel("Share outfit")
                    .accessibilityHint("Opens sharing options for this outfit")
                }
            }
        }
    }

    private func itemCard(_ item: WardrobeItemModel) -> some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(MirrorTheme.surfaceColor)
                    .frame(height: 140)

                CachedAsyncImage(url: URL(string: item.imageNoBgUrl ?? item.imageUrl)) {
                    Image(systemName: "tshirt.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                }
                .frame(height: 140)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            VStack(spacing: 2) {
                Text(item.name)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)

                Text(item.category)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.name), \(item.category)")
    }

    // MARK: - Actions

    private func generateOutfit() {
        isGenerating = true
        animateItems = false
        suggestion = nil

        Task {
            let result = await appState.generateOutfit(
                occasion: selectedOccasion,
                weather: nil,
                mood: nil
            )
            withAnimation(.spring) {
                suggestion = result
                isGenerating = false
            }
        }
    }

    private func saveOutfit(_ outfit: OutfitSuggestionModel) {
        isSaving = true
        Task {
            await appState.saveOutfitOfDay(outfit, image: nil)
            isSaving = false
            let notificationFeedback = UINotificationFeedbackGenerator()
            notificationFeedback.notificationOccurred(.success)
            dismiss()
        }
    }
}
