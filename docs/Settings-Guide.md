# ⚙️ ZKZZK Settings Guide

The **Settings** tab in ZKZZK allows you to activate powerful additional features of the system. We explain in detail what role each setting plays and how to obtain its value.

---

## 1. Chzzk (Naver) Cookie Settings (`NID_AUT`, `NID_SES`)

Certain broadcasts on Chzzk require a Naver login. Providing your login information (cookies) to ZKZZK gives you the following benefits.

- **1080p (Source Resolution) Viewing and Recording**: 1080p quality for some streamers is only provided to logged-in users.
- **Age-Restricted Broadcast Recording**: By entering the cookies of an adult-verified Naver account, you can record age-restricted broadcasts without any issues.

### 📌 How to Extract Cookies
1. Open a web browser (Chrome, Edge, etc.) and log in to [Chzzk](https://chzzk.naver.com).
2. Press the `F12` key to open **Developer Tools**.
3. Click on the **Application** (or Storage) tab at the top.
4. Click on `https://chzzk.naver.com` under **Cookies** in the left menu.
5. In the list on the right, find the items where the Name is **`NID_AUT`** and **`NID_SES`**.
6. Copy the Value of each and paste it into the corresponding field in the ZKZZK settings screen, then click **[Save]**.

---

## 2. YouTube API Settings (Auto Upload)

This setting is for **automatically uploading** finished recordings or downloaded VODs to your YouTube channel. To do this, you need a YouTube OAuth client issued from Google Cloud.

In the Settings screen, you can also configure:
- **Auto upload completed recordings**: Automatically uploads live recordings once MP4 conversion finishes.
- **Delete file from server after successful upload**: Deletes the local recording file automatically after a successful upload to save disk space.
- **Upload Visibility**: Choose the default visibility for uploaded videos—**Public (`public`)**, **Unlisted (`unlisted`, default)**, or **Private (`private`)**.

### 📌 Issuance and Integration Method

#### 1. Access Google Cloud Console and Create a Project
1. Visit the [Google Cloud Console](https://console.cloud.google.com/) website and log in with your Google account.
2. Click on **[Select a project]** or **[New Project]** at the top.
3. Enter a project name (e.g., `zkzzk-youtube-uploader`) and click the **Create** button.

#### 2. Enable YouTube Data API v3
1. Click the hamburger icon (☰) on the left menu and go to **[APIs & Services] -> [Library]**.
2. Search for **`YouTube Data API v3`** in the search bar and click it.
3. Click the blue **[Enable]** button to activate it.

#### 3. Configure OAuth Consent Screen
1. From the left menu, go to **[APIs & Services] -> [OAuth consent screen]**.
2. Click the blue **[Get Started]** button under `Google Auth Platform is not yet configured`.
3. Fill in the following app information:
   - App name: `zkzzk uploader`
   - User support email: Your email (Videos will be uploaded to this account.)
4. Select **`External`** for the **User Type**.
5. Enter your email in the Developer contact information.
6. Check `I agree to the Google API Services: User Data Policy` and click the blue **[Create]** button.

#### 4. Issue Credentials (Client ID / Secret)
1. From the left menu, go to **[APIs & Services] -> [Credentials]**.
2. Click **[+ CREATE CREDENTIALS]** at the top center and select **`OAuth client ID`**.
3. Select **`Web application`** as the Application type.
4. Name it whatever you like (e.g., `zkzzk-web`).
5. You must accurately add the callback address of your ZKZZK server to the **Authorized redirect URIs**.
   - If accessing locally: `http://localhost:5001/api/youtube/callback`
   - If accessing via a reverse proxy (Nginx, etc.), add that domain address (e.g., `https://zkzzk.mydomain.com/api/youtube/callback`).
6. Click the **[Create]** button.
Now your Client ID and Client Secret have been generated.

#### 5. Enter in ZKZZK Settings and Link Account
1. From the left menu, go to **[APIs & Services] -> [Credentials]**.
2. Under `OAuth 2.0 Client IDs`, click the client item you just created and copy the **Client ID** and **Client Secret**.
3. In the ZKZZK web dashboard **Settings** tab, click **[Connect Channel]** under the YouTube Auto Upload section, paste the **`Client ID`** and **`Client Secret`**, and click **[Save]**.
4. Complete the Google sign-in and consent screen you are redirected to, and your YouTube channel will be linked!

> [!IMPORTANT]
> ### Prevent 7-Day Token Expiration (Publish App Recommended)
> Under Google OAuth policy, if your app's publishing status remains in **'Testing'**, issued Refresh Tokens **automatically expire after 7 days**, causing automatic uploads to fail until you re-authenticate.
>
> 1. In Google Cloud Console, go to **[APIs & Services] -> [OAuth consent screen] -> [Audience]**.
> 2. Click **[Publish App]** to switch the status to **`In production`**.
> 3. For personal use on your own channel, Google app verification is not required (simply click `Advanced -> Go to ...` on the unverified app warning). After switching to production, re-authenticate once in ZKZZK to keep your connection active without the 7-day limit.

> [!WARNING]
> ### '403 access_denied' (Authentication Incomplete) Error
> If you encounter a `403 access_denied` error during authentication, check the following:
>
> 1. Click **[Publish App]** as described above to switch to production, or
> 2. If staying in Testing mode, add your Google account under **[OAuth consent screen] -> Test users -> [+ ADD USERS]** and try again.
> 3. Verify that the Google account used for YouTube authentication matches the account authorized for your OAuth client.

---

## 3. Discord Webhook Settings (Notification Bot)

This feature sends real-time notifications to your Discord channel when a monitored streamer starts or stops streaming, finishes MP4 conversion, or completes a YouTube upload. You can choose between **Rich Card (Embed)** and **Simple Text** in Settings.

### 📌 How to Issue a Discord Webhook URL
1. Click the gear icon (⚙️ Edit Channel) to the right of the Discord channel name where you want to receive notifications.
2. Click **Integrations** in the left menu and go to the **Webhooks** menu.
3. Click the **[New Webhook]** button and set the name and profile picture to your liking.
4. Click the **Copy Webhook URL** button to copy it.
5. Paste the copied URL into the `Webhook URL` field in the ZKZZK settings.
