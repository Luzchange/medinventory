# MedInventory (Expo / React Native, Android)

Features: Expo Camera barcode scanning, openFDA NDC lookup, local SQLite inventory (expo-sqlite), CSV export via the Android share sheet.

## Run
    npm install
    npx expo install --fix     # aligns versions to your installed Expo SDK
    npx expo start --android   # use Expo Go or a dev build

## Build an installable APK/AAB
    npm i -g eas-cli && eas build -p android --profile preview

## Open in Google Antigravity
Open this folder as a workspace, then ask the agent: "Run npm install and npx expo start, and verify the Scan and Inventory flows."

## Notes
- Barcode -> NDC: UPC-A "3" + 10-digit NDC + check digit is decoded; because 10-digit NDCs come in 4-4-2, 5-3-2 and 5-4-1 layouts, the app tries each candidate against openFDA (`product_ndc`). Many drug packages carry no scannable NDC barcode (or only a DataMatrix lot code); the manual entry field and "Add manually" path cover those.
- openFDA allows limited requests without an API key; add `&api_key=KEY` in src/ndc.js for higher quota.
- openFDA data is informational and not a substitute for clinical or pharmacy verification.
- Inventory is stored only on-device; do not store patient identifiers.
