import SwiftUI

struct MainTabView: View {
    @Environment(AppState.self) private var appState
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
                    NavigationStack { socialPlaceholder }
                case .profile:
                    NavigationStack { profilePlaceholder }
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
    }

    // MARK: - Custom Tab Bar

    private var customTabBar: some View {
        HStack(spacing: 0) {
            tabBarItem(tab: .home, icon: "house.fill", label: "Home")
            tabBarItem(tab: .wardrobe, icon: "tshirt.fill", label: "Wardrobe")
            createButton
            tabBarItem(tab: .social, icon: "person.2.fill", label: "Social")
            tabBarItem(tab: .profile, icon: "person.crop.circle.fill", label: "Profile")
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
        }
    }

    private func tabBarItem(tab: Tab, icon: String, label: String) -> some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                selectedTab = tab
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .symbolEffect(.bounce, value: selectedTab == tab)

                Text(label)
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(selectedTab == tab ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.gray.opacity(0.6)))
            .frame(maxWidth: .infinity)
        }
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
    }

    // MARK: - Create Action Sheet

    private var createActionSheet: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Create")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .padding(.top, 8)

                VStack(spacing: 12) {
                    createOption(icon: "sparkles", title: "Generate Outfit", subtitle: "AI-powered outfit suggestion", color: MirrorTheme.purple) {
                        showCreateSheet = false
                    }

                    createOption(icon: "camera.fill", title: "Add to Wardrobe", subtitle: "Photograph a clothing item", color: MirrorTheme.pink) {
                        showCreateSheet = false
                        selectedTab = .wardrobe
                    }

                    createOption(icon: "person.fill.viewfinder", title: "Virtual Try-On", subtitle: "See clothes on your avatar", color: MirrorTheme.indigo) {
                        showCreateSheet = false
                    }

                    createOption(icon: "square.and.arrow.up", title: "Share Outfit", subtitle: "Post your look to the feed", color: Color(hex: "10B981")) {
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

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.primary)

                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(UIColor.secondarySystemBackground))
            )
        }
    }

    // MARK: - Placeholders for future batches

    private var socialPlaceholder: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.2.fill")
                .font(.system(size: 48))
                .foregroundStyle(MirrorTheme.gradientPrimary)
            Text("Social")
                .font(.title2.bold())
            Text("Coming in batch 2")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(UIColor.systemBackground))
    }

    private var profilePlaceholder: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(MirrorTheme.gradientPrimary)
            Text("Profile")
                .font(.title2.bold())
            Text("Coming in batch 2")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(UIColor.systemBackground))
    }
}
