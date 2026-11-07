# openSocialGym iOS build and TestFlight

## Build output

Run **Actions > Build openSocialGym iOS > Run workflow** in this repository.
The default proposed fork identifier is `space.orktork.opensocialgym`; change the
input if you have already registered a different identifier. The script updates
the iPhone app, extensions, Watch app, app-group references and Capacitor config in
the CI checkout. It does not register anything with Apple. Use a unique positive
build number for each upload.

The `openSocialGym-ios-unsigned` artifact contains:

- `openSocialGym-unsigned.ipa`: compiled device app, **unsigned**.
- `openSocialGym.xcarchive.zip`: device archive, **unsigned**.
- `BUILD-INFO.txt`: exact source commit and bundle identifier.

Neither unsigned file is installable or uploadable to TestFlight. Signing requires
an Apple Developer Program team and app registrations you control. No Apple signing
secrets were configured in this GitHub repository when this build was prepared.
Downloaded artifacts are stored locally in `artifacts/ios/` (ignored by Git).

## First TestFlight release from a Mac

1. Enroll in the Apple Developer Program. In Certificates, Identifiers & Profiles,
   register your own app IDs and shared App Group. For the proposed identifier:

   | Target | Identifier |
   | --- | --- |
   | iPhone | `space.orktork.opensocialgym` |
   | Widgets / Live Activity | `space.orktork.opensocialgym.widgets` |
   | Animation downloader | `space.orktork.opensocialgym.AnimationPacksDownloader` |
   | Apple Watch | `space.orktork.opensocialgym.watchkitapp` |
   | Watch widgets | `space.orktork.opensocialgym.watchkitapp.widgets` |
   | Shared App Group | `group.space.orktork.opensocialgym` |

   Preserve the capabilities declared in each target's entitlements. The main app
   uses NFC Tag Reading, HealthKit, Associated Domains and the App Group. The Watch
   app uses HealthKit and the App Group; extensions share the App Group. Associate
   the App Group with each participating identifier. Do not use the upstream
   `ch.opengym.app` registrations: those belong to the original app's team.

2. Create an iOS app in App Store Connect using the main bundle ID, a unique SKU,
   primary language and your app name.

3. On a Mac with current Xcode and Node 22, clone/pull this repository. In a clean
   release checkout, run (replace the identifier/build number if necessary):

   ```sh
   node scripts/ios/configure-fork.mjs space.orktork.opensocialgym 1
   cd frontend
   npm ci
   VITE_MOBILE=1 npm run build
   node ../scripts/catalogue/stage-media.mjs dist
   npx cap sync ios
   ruby ios/ci/add-asset-downloader.rb
   ruby ios/ci/add-watch-app.rb
   ruby ios/ci/add-widgets.rb
   npx cap open ios
   ```

4. In Xcode, sign into your Apple Developer account under Settings > Accounts.
   Choose your Team and Automatically manage signing for **all five app/extension
   targets**. Review the bundle IDs and capabilities. Select the App scheme and an
   iOS device destination, then **Product > Archive**. In Organizer choose
   **Distribute App > App Store Connect > Upload**. This is the signed build that
   Apple can process; the unsigned CI artifact cannot be uploaded as-is.

   Xcode normally stores archives in `~/Library/Developer/Xcode/Archives/`.
   An exported signed IPA goes to the folder you select in Organizer; use
   `artifacts/ios/` if you want the repo-local convention.

5. In App Store Connect > your app > TestFlight, wait for processing, answer any
   export-compliance questions, and add the build to an internal testing group.
   Testers install Apple's TestFlight app and accept the invitation. External
   testing requires Apple's TestFlight beta review. This does not publish the app
   to the public App Store.

For automated signed CI builds later, install signing material through GitHub
Actions secrets or a protected environment, never a public commit or a chat
message. The current build workflow deliberately produces an unsigned archive and
never uploads a build to Apple.

After installing, pair the app with `https://gym.orktork.space` from the app's server
connection screen. Docker/PWA updates do not update the native app or NFC plugin.

Apple references:
- [Create an app record](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
- [Upload through Xcode](https://help.apple.com/xcode/mac/current/en.lproj/dev442d7f2ca.html)
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)


## Verified build

The first fork build completed successfully on GitHub's macOS runner:
https://github.com/TheFoxStudio/openSocialGym/actions/runs/42294288279

- Source commit: 41f86845cb9314e0373f26691e2ac4ec5f266af4
- Bundle ID: space.orktork.opensocialgym
- Version/build: 1.4.4 / 1
- Result: unsigned iPhone archive including the Watch app and extensions
- Local directory: C:/Users/Leonida/Desktop/openSocialGym/artifacts/ios/
- Outer artifact SHA-256: 1e312958f4054e2062bb8064b28ac1613eaf690f7d56897a5ca4b23c2adc8fe2

The downloaded artifact checksum matched GitHub's digest. The compiled IPA's
Info.plist was checked for the fork bundle ID. Native compilation succeeded,
including the NFC plugin. Signing, physical-device behavior and TestFlight upload
have not been performed.
