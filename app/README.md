# Rural Greece app (Android + iOS)

The visitor and member app for the Rural Value Engine. Built with Expo SDK 58 (React Native 0.88) and Expo Router.
It talks only to the engine (`../engine`); content comes from ruralgreece.gr through the engine's sync.

## Screens

**Visitors** (tabs)

- **Explore**: thematic packages, businesses / routes / points of interest, search, "near me".
- **Map**: everything on an OpenStreetMap map (Leaflet in a WebView, no API key).
- **Scan**: scan a business or POI QR code, with an optional referral code. Works offline: scans are queued and sent when the phone is back online.
- **Passport**: stamps from verified visits and completed routes.
- **Wallet**: points balance, rewards, redeem (a 6-digit code to show at the business), history.
- **Profile**: language (Ελληνικά / English), sign in or out, link to the member area.
- Item detail: description, photos, KML track for routes, contact details, Impact Score, nearby places, and a GPS check-in for POIs that have no QR (stay within 75 m for 2 minutes).
- Package detail: stops and progress; completing all stops earns +30 points.

**Members** (Profile → Member area)

- Sign in with the business email (6-digit code, no password).
- Dashboard: Impact Score, points, visits and visitors in the last 30 days.
- My QR codes, to print or show.
- Referrals: send visitors to another member and share the code.
- Partners: accept or decline requests, and suggested partners with the reasons.
- Rewards: confirm a visitor's redemption code, add or withdraw rewards.
- Analytics: visits per day (7 / 30 / 90 days), returning visitors, referrals, points, and where else your visitors go.

Sign-in is passwordless for everyone: enter an email, receive a 6-digit code, done.

## Run it

```bash
npm ci
npx expo start            # then open in Expo Go or a dev build
npm run typecheck         # TypeScript
npm test                  # unit tests for the pure helpers
```

The engine address is `extra.apiUrl` in `app.json` (default `https://engine.ruralgreece.gr`).
For local testing point it at your machine, for example `http://192.168.1.20:8080`, and run the engine with `npm run dev`.

Camera scanning and GPS need a real phone. Expo Go is enough for both.

## Build installable files (no store accounts needed)

Android APK, built locally (needs Android Studio / SDK):

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk, install with adb or by sending the file
```

Or with EAS (free Expo account): `npx eas build -p android --profile preview` with a `preview` profile that sets `"android": { "buildType": "apk" }`.

iOS: without an Apple developer account, the app can run on your own iPhone through Expo Go,
or from Xcode with a free personal team (`npx expo prebuild --platform ios`, open `ios/*.xcworkspace`, run on the device; the build expires after 7 days).
TestFlight and ad-hoc installs for other people need the paid Apple account.

## Notes

- Colours follow ruralgreece.gr: greens `#1c2c23`, `#376245`, `#2d9141`; accents `#7a3123`, `#8a5a3c`, `#b1d1ea` (see `../docs/theme.json`).
- The icons and splash in `assets/` are Expo placeholders and should be replaced with ETAM's artwork.
- Tokens are kept in the device's secure storage; the offline scan queue in AsyncStorage.
- `npm install` uses `legacy-peer-deps` (see `.npmrc`) because of a react-dom peer range in one dependency.
