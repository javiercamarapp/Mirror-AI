import Foundation

// MARK: - Localization Helper
// Provides type-safe access to all localized strings in the app.

enum L10n {
    // MARK: - Common
    static let ok = NSLocalizedString("common.ok", comment: "OK button")
    static let cancel = NSLocalizedString("common.cancel", comment: "Cancel button")
    static let done = NSLocalizedString("common.done", comment: "Done button")
    static let save = NSLocalizedString("common.save", comment: "Save button")
    static let close = NSLocalizedString("common.close", comment: "Close button")
    static let delete = NSLocalizedString("common.delete", comment: "Delete button")
    static let retry = NSLocalizedString("common.retry", comment: "Retry button")
    static let next = NSLocalizedString("common.next", comment: "Next button")
    static let back = NSLocalizedString("common.back", comment: "Back button")
    static let error = NSLocalizedString("common.error", comment: "Error title")
    static let loading = NSLocalizedString("common.loading", comment: "Loading text")
    static let search = NSLocalizedString("common.search", comment: "Search")

    // MARK: - Tab Bar
    static let tabHome = NSLocalizedString("tab.home", comment: "Home tab")
    static let tabWardrobe = NSLocalizedString("tab.wardrobe", comment: "Wardrobe tab")
    static let tabCreate = NSLocalizedString("tab.create", comment: "Create tab")
    static let tabSocial = NSLocalizedString("tab.social", comment: "Social tab")
    static let tabProfile = NSLocalizedString("tab.profile", comment: "Profile tab")

    // MARK: - Home
    static let homeGreetingMorning = NSLocalizedString("home.greeting.morning", comment: "Morning greeting")
    static let homeGreetingAfternoon = NSLocalizedString("home.greeting.afternoon", comment: "Afternoon greeting")
    static let homeGreetingEvening = NSLocalizedString("home.greeting.evening", comment: "Evening greeting")
    static let homeGreetingNight = NSLocalizedString("home.greeting.night", comment: "Night greeting")
    static let homeAvatarTitle = NSLocalizedString("home.avatar.title", comment: "Avatar section title")
    static let homeAvatarSubtitle = NSLocalizedString("home.avatar.subtitle", comment: "Avatar section subtitle")
    static let homeAvatarAIGenerated = NSLocalizedString("home.avatar.aiGenerated", comment: "AI-generated label")
    static let homeTodaysLook = NSLocalizedString("home.todaysLook", comment: "Today's Look title")
    static let homeGenerateLook = NSLocalizedString("home.generateLook", comment: "Generate Today's Look button")
    static let homeViewDetails = NSLocalizedString("home.viewDetails", comment: "View Details button")
    static let homeDayStreak = NSLocalizedString("home.dayStreak", comment: "day streak label")
    static let homeKeepLogging = NSLocalizedString("home.keepLogging", comment: "Keep logging message")
    static let homeBest = NSLocalizedString("home.best", comment: "Best streak label")
    static let homeAddClothes = NSLocalizedString("home.addClothes", comment: "Add Clothes action")
    static let homeTryOn = NSLocalizedString("home.tryOn", comment: "Try On action")
    static let homeAIChat = NSLocalizedString("home.aiChat", comment: "AI Chat action")
    static let homeUnlockPotential = NSLocalizedString("home.unlockPotential", comment: "Unlock subscription title")
    static let homeUnlockSubtitle = NSLocalizedString("home.unlockSubtitle", comment: "Unlock subscription subtitle")
    static let homePro = NSLocalizedString("home.pro", comment: "PRO badge")

    // MARK: - Auth
    static let authAppName = NSLocalizedString("auth.appName", comment: "App name")
    static let authTagline = NSLocalizedString("auth.tagline", comment: "App tagline")
    static let authFeatureStyling = NSLocalizedString("auth.feature.styling", comment: "Feature: AI Styling")
    static let authFeatureTryOn = NSLocalizedString("auth.feature.tryOn", comment: "Feature: Virtual Try-On")
    static let authFeatureScore = NSLocalizedString("auth.feature.score", comment: "Feature: Style Score")
    static let authContinueGoogle = NSLocalizedString("auth.continueGoogle", comment: "Continue with Google")
    static let authContinueEmail = NSLocalizedString("auth.continueEmail", comment: "Continue with Email")
    static let authTermsPrefix = NSLocalizedString("auth.termsPrefix", comment: "Terms prefix text")
    static let authTermsOfService = NSLocalizedString("auth.termsOfService", comment: "Terms of Service link")
    static let authPrivacyPolicy = NSLocalizedString("auth.privacyPolicy", comment: "Privacy Policy link")
    static let authAnd = NSLocalizedString("auth.and", comment: "and conjunction")
    static let authSendMagicLink = NSLocalizedString("auth.sendMagicLink", comment: "Send Magic Link button")
    static let authSignInEmail = NSLocalizedString("auth.signInEmail", comment: "Sign in with Email title")
    static let authMagicLinkDescription = NSLocalizedString("auth.magicLinkDescription", comment: "Magic link description")
    static let authCheckEmail = NSLocalizedString("auth.checkEmail", comment: "Check Your Email title")
    static let authEmailPlaceholder = NSLocalizedString("auth.emailPlaceholder", comment: "Email placeholder")

    // MARK: - Wardrobe
    static let wardrobeTitle = NSLocalizedString("wardrobe.title", comment: "Wardrobe screen title")
    static let wardrobeSearchPlaceholder = NSLocalizedString("wardrobe.searchPlaceholder", comment: "Search placeholder")
    static let wardrobeEmptyTitle = NSLocalizedString("wardrobe.emptyTitle", comment: "Empty wardrobe title")
    static let wardrobeEmptyDescription = NSLocalizedString("wardrobe.emptyDescription", comment: "Empty wardrobe description")
    static let wardrobeAddFirstItem = NSLocalizedString("wardrobe.addFirstItem", comment: "Add First Item button")
    static let wardrobeLoading = NSLocalizedString("wardrobe.loading", comment: "Loading wardrobe")

    // MARK: - Social Feed
    static let feedTitle = NSLocalizedString("feed.title", comment: "Feed screen title")
    static let feedReportPost = NSLocalizedString("feed.reportPost", comment: "Report Post option")
    static let feedBlockUser = NSLocalizedString("feed.blockUser", comment: "Block User option")
    static let feedSubmitReport = NSLocalizedString("feed.submitReport", comment: "Submit Report button")

    // MARK: - Profile
    static let profileTitle = NSLocalizedString("profile.title", comment: "Profile screen title")
    static let profileYourPosts = NSLocalizedString("profile.yourPosts", comment: "Your Posts section")
    static let profileNoPosts = NSLocalizedString("profile.noPosts", comment: "No posts yet")
    static let profileShareOutfits = NSLocalizedString("profile.shareOutfits", comment: "Share outfits prompt")
    static let profileFriends = NSLocalizedString("profile.friends", comment: "Friends link")
    static let profileNotifications = NSLocalizedString("profile.notifications", comment: "Notifications link")

    // MARK: - Settings
    static let settingsTitle = NSLocalizedString("settings.title", comment: "Settings screen title")
    static let settingsLogOut = NSLocalizedString("settings.logOut", comment: "Log Out button")
    static let settingsDeleteAccount = NSLocalizedString("settings.deleteAccount", comment: "Delete Account button")

    // MARK: - Create
    static let createTitle = NSLocalizedString("create.title", comment: "Create screen title")
    static let createGenerateOutfit = NSLocalizedString("create.generateOutfit", comment: "Generate Outfit option")
    static let createGenerateOutfitSubtitle = NSLocalizedString("create.generateOutfitSubtitle", comment: "Generate Outfit subtitle")
    static let createAddToWardrobe = NSLocalizedString("create.addToWardrobe", comment: "Add to Wardrobe option")
    static let createAddToWardrobeSubtitle = NSLocalizedString("create.addToWardrobeSubtitle", comment: "Add to Wardrobe subtitle")
    static let createVirtualTryOn = NSLocalizedString("create.virtualTryOn", comment: "Virtual Try-On option")
    static let createVirtualTryOnSubtitle = NSLocalizedString("create.virtualTryOnSubtitle", comment: "Virtual Try-On subtitle")
    static let createShareOutfit = NSLocalizedString("create.shareOutfit", comment: "Share Outfit option")
    static let createShareOutfitSubtitle = NSLocalizedString("create.shareOutfitSubtitle", comment: "Share Outfit subtitle")

    // MARK: - Offline
    static let offlineNoConnection = NSLocalizedString("offline.noConnection", comment: "No internet connection")

    // MARK: - Content Loading
    static let loadingStyle = NSLocalizedString("loading.style", comment: "Loading style")
    static let loadingOops = NSLocalizedString("loading.oops", comment: "Oops error title")

    // MARK: - Accessibility
    static let a11yNotificationBell = NSLocalizedString("a11y.notificationBell", comment: "Notifications button")
    static let a11yLikeButton = NSLocalizedString("a11y.likeButton", comment: "Like button")
    static let a11yLiked = NSLocalizedString("a11y.liked", comment: "Liked state")
    static let a11yUnliked = NSLocalizedString("a11y.unliked", comment: "Not liked state")
    static let a11yCommentButton = NSLocalizedString("a11y.commentButton", comment: "Comment button")
    static let a11yShareButton = NSLocalizedString("a11y.shareButton", comment: "Share button")
    static let a11yBookmarkButton = NSLocalizedString("a11y.bookmarkButton", comment: "Bookmark button")
    static let a11yMoreOptions = NSLocalizedString("a11y.moreOptions", comment: "More options menu")
    static let a11yCloseButton = NSLocalizedString("a11y.closeButton", comment: "Close button")
    static let a11yBackButton = NSLocalizedString("a11y.backButton", comment: "Go back button")
    static let a11yAddButton = NSLocalizedString("a11y.addButton", comment: "Add new item button")
    static let a11yCreateButton = NSLocalizedString("a11y.createButton", comment: "Create new content button")
    static let a11yFavoriteButton = NSLocalizedString("a11y.favoriteButton", comment: "Toggle favorite button")
    static let a11yFavorited = NSLocalizedString("a11y.favorited", comment: "Favorited state")
    static let a11yNotFavorited = NSLocalizedString("a11y.notFavorited", comment: "Not favorited state")
    static let a11yPostImage = NSLocalizedString("a11y.postImage", comment: "Post image")
    static let a11yOutfitImage = NSLocalizedString("a11y.outfitImage", comment: "Outfit image")
    static let a11yDecorativeIcon = NSLocalizedString("a11y.decorativeIcon", comment: "Decorative icon")
    static let a11yHeightSlider = NSLocalizedString("a11y.heightSlider", comment: "Height slider")
    static let a11ySendMessage = NSLocalizedString("a11y.sendMessage", comment: "Send message button")
    static let a11yClearSearch = NSLocalizedString("a11y.clearSearch", comment: "Clear search button")
    static let a11yDeleteChat = NSLocalizedString("a11y.deleteChat", comment: "Delete chat history")
    static let a11yEditProfile = NSLocalizedString("a11y.editProfile", comment: "Edit profile photo")
    static let a11yRetakePhoto = NSLocalizedString("a11y.retakePhoto", comment: "Retake photo button")
    static let a11yPremiumBadge = NSLocalizedString("a11y.premiumBadge", comment: "Premium badge")
    static let a11yDoubleTapToLike = NSLocalizedString("a11y.doubleTapToLike", comment: "Double tap to like hint")
    static let a11yUnreadIndicator = NSLocalizedString("a11y.unreadIndicator", comment: "Unread indicator")

    // MARK: - Format Helpers

    static func notificationCount(_ count: Int) -> String {
        String(format: NSLocalizedString("a11y.notificationCount", comment: "Unread notifications count"), count)
    }

    static func styleScore(_ score: String, tier: String) -> String {
        String(format: NSLocalizedString("a11y.styleScore", comment: "Style score accessibility"), score, tier)
    }

    static func userAvatar(_ name: String) -> String {
        String(format: NSLocalizedString("a11y.userAvatar", comment: "User avatar"), name)
    }

    static func clothingImage(_ name: String) -> String {
        String(format: NSLocalizedString("a11y.clothingImage", comment: "Clothing item image"), name)
    }

    static func streakFlame(_ count: Int) -> String {
        String(format: NSLocalizedString("a11y.streakFlame", comment: "Streak flame"), count)
    }

    static func heightValue(_ cm: Int) -> String {
        String(format: NSLocalizedString("a11y.heightValue", comment: "Height value"), cm)
    }

    static func wardrobeItems(_ count: Int) -> String {
        String(format: NSLocalizedString("wardrobe.items", comment: "Items count"), count)
    }
}
