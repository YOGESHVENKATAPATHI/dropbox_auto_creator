# Dropbox Android Automation App

This app ports your Chrome extension workflow into Android using a controlled WebView browser engine.

## Framework Decision

Best fit for this project: React Native with Expo + react-native-webview.

Why this is the strongest choice for your constraints:
- You need full DOM-level automation control on Dropbox and temp-mail pages.
- You need one Android app that can run all extension-like actions in sequence.
- Your backend on Vercel is lightweight, so more logic must run on-device.
- You need quick iteration and deployment speed while still allowing native Android builds.

Alternative choices and why they are weaker here:
- Pure server Puppeteer only: too heavy for Vercel and weak for long interactive flow handling.
- Selenium/Appium driving external Chrome: brittle setup and harder mobile deployment.
- Pure native Kotlin with full in-app browser automation: powerful but much slower to ship.

## What Is Implemented

- Stateful automation engine equivalent to extension flow states.
- Domain-specific script injection for:
  - temp-mail.io
  - dropbox.com
  - dropboxrefesh.vercel.app
- OAuth token capture and persistence to:
  - https://dropbox-auto-creator.vercel.app/save-credentials
- Local offline queue for credential payloads when backend is unavailable.
- Retry-safe cycle restart via logout flow.
- Operator control UI: start, pause, reset, run-step, logs, backend status.

## Important Reality Check

No mobile WebView can mathematically guarantee that Dropbox will always treat it as a first-party Chrome tab in every anti-bot scenario. This implementation uses a Chrome-like user-agent and browser-like interaction pacing, but anti-abuse policies can change at any time.

## Setup

1. Install dependencies:

npm install

2. Start dev server:

npm run start

3. Run on Android device/emulator:

npm run android

Optional for custom dev client flow:

npm run android:dev

## Build Android APK/AAB

Use EAS build:

npm run build:android

## Architecture

- App shell: App.js
- Flow constants: src/constants.js
- Persistence: src/storage.js
- Backend API calls: src/api.js
- Web automation scripts: src/automationScripts.js

## Security Notes

- The app currently stores flow state and queued credentials in AsyncStorage.
- For production hardening, move secrets and queued credential blobs to encrypted storage.

## Backend Contract

Expected endpoint and payload:

POST https://dropbox-auto-creator.vercel.app/save-credentials

{
  "appKey": "...",
  "appSecret": "...",
  "refreshToken": "...",
  "accessToken": "...",
  "accountId": "...",
  "uid": "...",
  "scope": "...",
  "appName": "..."
}
