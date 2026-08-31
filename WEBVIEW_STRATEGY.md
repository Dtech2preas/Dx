# Native WebView Strategy Recommendation

## Executive Summary
For the "Berserker" project, moving to a **Native Android Wrapper (WebView)** is strongly recommended over a pure web approach or PWA.

While the content will still be served "Live" from `student.dtech-services.co.za` (ensuring instant updates without user downloads), the Native Shell provides critical "Controls" that are impossible in a standard browser.

---

## Architecture Overview

*   **App Shell:** Native Android (Kotlin/Java).
*   **Content Source:** Live URL (`https://student.dtech-services.co.za`).
*   **Offline Strategy:** Local Fallback (`file:///android_asset/offline.html`).
*   **Bridge:** `JavascriptInterface` to expose Native capabilities to the Web App.

---

## Key Advantages ("The Controls")

### 1. Persistent Authentication (Solved)
*   **Problem:** Currently, `sessionStorage` is cleared when the browser tab/window is closed, forcing users to login repeatedly.
*   **Native Control:** The app can store the login token in **Encrypted SharedPreferences**. When the WebView loads, the Native App can inject the token back into the session, keeping the user logged in forever until they explicitly logout.

### 2. "Round Ready" Notifications (Engagement)
*   **Problem:** Browser timers (for the 60m/20m cooldowns) stop when the phone screen turns off to save battery.
*   **Native Control:** The Native App can schedule an **AlarmManager** event. Even if the app is closed, the phone will wake up and send a push notification: *"Round 1 is Ready - High Yield Available!"*. This massively increases daily user activity.

### 3. Hardware-Level Identity (Security)
*   **Problem:** Users can clear cookies or use Incognito mode to bypass "One Account Per Person" rules.
*   **Native Control:** You can access the **Android_ID** or **Advertising ID**. You can pass this ID to your backend during login.
    *   *Benefit:* If a user tries to create a 2nd account on the same phone, you can detect the duplicate Hardware ID and block it immediately. This is far superior to IP-based blocking.

### 4. Direct WhatsApp Sharing
*   **Problem:** `profile.html` currently asks users to "Copy Link" and manually paste it.
*   **Native Control:** You can add a JavaScript Bridge `Android.shareText(link)`. When clicked, it opens the native Android "Share Sheet" (WhatsApp, Telegram, SMS) directly.

### 5. Immersive "Game" Mode
*   **Problem:** Browser address bars and UI clutter the "Berserker" game experience.
*   **Native Control:** The app runs in **Full Screen**. It feels like a high-end game, not a website. You can also force the screen to **Stay Awake** during the "Grind Mode" (Round 3) so the phone doesn't sleep while they are waiting for ads.

---

## Offline Strategy (The "No Internet" Handling)

Since the app loads from a live URL, we must handle cases where the user has no data/wifi.

**The Solution:**
1.  Create a file `src/main/assets/offline.html` in the Android project.
2.  Implement a `WebViewClient` that checks for error `ERROR_HOST_LOOKUP`.
3.  If an error occurs, load the local file.

**`offline.html` Concept:**
> "You are offline. Check your internet connection and tap 'Retry' to resume earning."

**Android Code Snippet (Concept):**
```java
webView.setWebViewClient(new WebViewClient() {
    @Override
    public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
        view.loadUrl("file:///android_asset/offline.html");
    }
});
```

---

## Distribution Strategy

Since you are **not** publishing to the Play Store:
1.  **APK Hosting:** Host the `app-release.apk` file directly on your website (e.g., `student.dtech-services.co.za/download`).
2.  **Auto-Update Logic:**
    *   The Native App can check a simple JSON endpoint on startup: `GET /version.json`.
    *   If the app version is lower than the server version, show a popup: *"New App Version Available - Download Now"* that links to the APK.

---

## Recommendation

**Proceed with the Native Wrapper.**
It offers the "Controls" you asked for (Notifications, Hardware ID, Persistent Login) while keeping the "Live Update" flexibility you need.

### Next Steps (If you approve):
1.  **Scaffold Android Project:** I can create the folder structure and main Java files for you to copy into Android Studio.
2.  **Update Web Code:** We need to add small checks in your JS (like `if (window.Android) ...`) to use the new features.
