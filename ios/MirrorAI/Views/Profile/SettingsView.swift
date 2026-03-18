import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var showDeleteAlert = false
    @State private var showLogoutAlert = false
    @State private var notificationsEnabled = true
    @State private var hapticFeedback = true
    @State private var darkMode = true

    var body: some View {
        NavigationStack {
            List {
                // Account
                Section {
                    settingsRow(icon: "person.fill", color: MirrorTheme.purple, title: "Account Info") {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(appState.currentUser?.name ?? "")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                            Text(appState.currentUser?.email ?? "")
                                .font(.system(size: 12))
                                .foregroundStyle(.tertiary)
                        }
                    }

                    settingsRow(icon: "crown.fill", color: Color(hex: "FFD700"), title: "Subscription") {
                        Text(appState.subscriptionPlan.capitalized)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(MirrorTheme.purple)
                    }
                } header: {
                    Text("Account")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )

                // Preferences
                Section {
                    Toggle(isOn: $notificationsEnabled) {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "bell.fill", color: MirrorTheme.pink)
                            Text("Push Notifications")
                                .font(.system(size: 15))
                        }
                    }
                    .tint(MirrorTheme.purple)

                    Toggle(isOn: $hapticFeedback) {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "hand.tap.fill", color: MirrorTheme.indigo)
                            Text("Haptic Feedback")
                                .font(.system(size: 15))
                        }
                    }
                    .tint(MirrorTheme.purple)

                    Toggle(isOn: .constant(true)) {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "moon.fill", color: .purple)
                            Text("Dark Mode")
                                .font(.system(size: 15))
                        }
                    }
                    .tint(MirrorTheme.purple)
                    .disabled(true)
                } header: {
                    Text("App Preferences")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )

                // About
                Section {
                    settingsRow(icon: "info.circle.fill", color: .blue, title: "Version") {
                        Text("1.0.0")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    }

                    settingsRow(icon: "doc.text.fill", color: .gray, title: "Terms of Service") {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.tertiary)
                    }

                    settingsRow(icon: "lock.shield.fill", color: .green, title: "Privacy Policy") {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.tertiary)
                    }
                } header: {
                    Text("About")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )

                // Danger zone
                Section {
                    Button {
                        showLogoutAlert = true
                    } label: {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "rectangle.portrait.and.arrow.right", color: .orange)
                            Text("Log Out")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(.primary)
                            Spacer()
                        }
                    }

                    Button {
                        showDeleteAlert = true
                    } label: {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "trash.fill", color: .red)
                            Text("Delete Account")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(.red)
                            Spacer()
                        }
                    }
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .alert("Log Out", isPresented: $showLogoutAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Log Out", role: .destructive) {
                    let impact = UINotificationFeedbackGenerator()
                    impact.notificationOccurred(.warning)
                    appState.logout()
                    dismiss()
                }
            } message: {
                Text("Are you sure you want to log out?")
            }
            .alert("Delete Account", isPresented: $showDeleteAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    // Handle account deletion
                    let impact = UINotificationFeedbackGenerator()
                    impact.notificationOccurred(.error)
                }
            } message: {
                Text("This action cannot be undone. All your data will be permanently deleted.")
            }
        }
    }

    // MARK: - Helpers

    private func settingsRow<Trailing: View>(
        icon: String,
        color: Color,
        title: String,
        @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        HStack(spacing: 12) {
            settingsIcon(icon: icon, color: color)
            Text(title)
                .font(.system(size: 15))
            Spacer()
            trailing()
        }
    }

    private func settingsIcon(icon: String, color: Color) -> some View {
        Image(systemName: icon)
            .font(.system(size: 14))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(RoundedRectangle(cornerRadius: 8).fill(color))
    }
}
