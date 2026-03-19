import SwiftUI

struct MainTabView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedTab: Tab = .home
    @State private var showCreateSheet = false

    enum Tab: Int, CaseIterable {
        case home, wardrobe, create, social, profile
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Tab content
            Group {
                switch selectedTab {
                case .home:
                    NavigationStack { HomeView() }
                case .wardrobe:
                    NavigationStack { WardrobeView() }
                case .create:
                    NavigationStack { HomeView() } // placeholder, sheet handles create
                case .social:
                    NavigationStack { SocialFeedView() }
                case .profile:
                    NavigationStack { ProfileView() }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, 80)

            // Custom tab bar
            customTabBar
        }
        .ignoresSafeArea(.keyboard)
        .sheet(isPresented: $showCreateSheet) {
            createActionSheet
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility5)
    }

    // MARK: - Custom Tab Bar

    private var customTabBar: some View {
        HStack(spacing: 0) {
            tabBarItem(tab: .home, icon: "house.fill", label: L10n.tabHome)
            tabBarItem(tab: .wardrobe, icon: "tshirt.fill", label: L10n.tabWardrobe)
            createButton
            tabBarItem(tab: .social, icon: "person.2.fill", label: L10n.tabSocial)
            tabBarItem(tab: .profile, icon: "person.crop.circle.fill", label: L10n.tabProfile)
        }
        .padding(.horizontal, 8)
        .padding(.top, 12)
        .padding(.bottom, 28)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [Color.white.opacity(0.08), Color.clear],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                )
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Color.white.opacity(0.1))
                        .frame(height: 0.5)
                }
                .ignoresSafeArea()
                .accessibilityHidden(true)
        }
    }

    private func tabBarItem(tab: Tab, icon: String, label: String) -> some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            if reduceMotion {
                selectedTab = tab
            } else {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    selectedTab = tab
                }
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .symbolEffect(.bounce, value: selectedTab == tab)
                    .accessibilityHidden(true)

                Text(label)
                    .font(.caption2)
                    .fontWeight(.medium)
            }
            .foregroundStyle(selectedTab == tab ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.gray.opacity(0.6)))
            .frame(maxWidth: .infinity)
        }
        .accessibilityLabel(label)
        .accessibilityAddTraits(selectedTab == tab ? [.isSelected, .isButton] : .isButton)
    }

    private var createButton: some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
            impactFeedback.impactOccurred()
            showCreateSheet = true
        } label: {
            ZStack {
                Circle()
                    .fill(MirrorTheme.gradientPrimary)
                    .frame(width: 52, height: 52)
                    .shadow(color: MirrorTheme.purple.opacity(0.5), radius: 12, y: 4)

                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.white)
            }
            .offset(y: -16)
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(L10n.a11yCreateButton)
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Create Action Sheet

    private var createActionSheet: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text(L10n.createTitle)
                    .font(.title)
                    .fontWeight(.bold)
                    .fontDesign(.rounded)
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .padding(.top, 8)
                    .accessibilityAddTraits(.isHeader)

                VStack(spacing: 12) {
                    createOption(icon: "sparkles", title: L10n.createGenerateOutfit, subtitle: L10n.createGenerateOutfitSubtitle, color: MirrorTheme.purple) {
                        showCreateSheet = false
                    }

                    createOption(icon: "camera.fill", title: L10n.createAddToWardrobe, subtitle: L10n.createAddToWardrobeSubtitle, color: MirrorTheme.pink) {
                        showCreateSheet = false
                        selectedTab = .wardrobe
                    }

                    createOption(icon: "person.fill.viewfinder", title: L10n.createVirtualTryOn, subtitle: L10n.createVirtualTryOnSubtitle, color: MirrorTheme.indigo) {
                        showCreateSheet = false
                    }

                    createOption(icon: "square.and.arrow.up", title: L10n.createShareOutfit, subtitle: L10n.createShareOutfitSubtitle, color: Color(hex: "10B981")) {
                        showCreateSheet = false
                    }
                }
                .padding(.horizontal)

                Spacer()
            }
            .padding(.top)
            .background(Color(UIColor.systemBackground))
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(28)
        }
    }

    private func createOption(icon: String, title: String, subtitle: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(color.opacity(0.15))
                        .frame(width: 50, height: 50)

                    Image(systemName: icon)
                        .font(.system(size: 22))
                        .foregroundStyle(color)
                }
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.callout)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)

                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(UIColor.secondarySystemBackground))
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

}
