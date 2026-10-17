# Native iPhone icon and wireless testing

## App icon

`MyEyes/Assets.xcassets/AppIcon.appiconset/AppIcon.png` reuses the four footprint ellipses and colors from [`frontend/icons/icon.svg`](../../frontend/icons/icon.svg). It is rendered at 1024×1024 with antialiasing, an opaque RGB/sRGB background (`#c6ee91`), and dark footprints (`#203b27`). Only the background changes from a rounded rectangle to a full square: iOS supplies the corner mask. The existing 180/192/512px web PNGs have alpha and are not used as native icons.

Both native build configurations select `AppIcon`. Xcode compiles the catalog and generates icon metadata in the **built** Info.plist. The source Info.plist, bundle ID and signing configuration are unchanged.

Run source/resource guards without building:

```sh
node --test samples/ios/tests/app-icon.test.mjs
```

After a separately authorized Xcode build, verify its actual output without installing:

```sh
CLARITY_BUILT_APP=/absolute/path/to/Clarity.app \
  node --test samples/ios/tests/app-icon.test.mjs
```

The built-resource test checks `Assets.car`, generated `CFBundleIcons` and icon PNGs. It explicitly skips without `CLARITY_BUILT_APP`. Source checks alone do not establish asset compilation or appearance on a phone. Home Screen confirmation requires a later owner-approved installation. Do not uninstall/reset an existing app to refresh its icon.

## Fastest free route: existing Xcode pairing

Wireless development is not public app distribution. For the team's own phone, retain its existing signing setup and pairing:

1. With the owner's approval, put Mac and iPhone on the same reachable Wi-Fi. Apple's current guidance requires IPv6 for post-pairing Wi-Fi operation. Guest/client-isolated networks can block discovery.
2. In Xcode 27, open **Xcode → Open Developer Tool → Device Hub**, select the known phone and inspect its status. The owner handles unlocking, Trust prompts and Developer Mode if required. Do not reset trust, permissions or credentials as troubleshooting shortcuts.
3. Once available, select the phone and the **Clarity** scheme. Only after explicit installation approval, Run using the existing valid development signing. This may update the matching installed bundle, so confirm `com.dahacks.clarity.v2testing` is the intended app first.

For a **new pairing**, Xcode 27 supports **Pair Nearby Device** without a cable on iOS 27+. Earlier iOS needs initial cable pairing; subsequent runs can use Wi-Fi. Do not assume a remembered device is currently paired, reachable or running iOS 27.

A free Apple Account/Personal Team can test on personal devices through Xcode. Its provisioning expires after **7 days**, with up to **3 registered devices** and **3 installed apps per device**. Renewing requires rebuilding/reinstalling. A configured development team does not establish whether the account is paid or whether its current profile remains valid.

## Sharing with other people

| Route | Prerequisites and limitations |
| --- | --- |
| Existing installed team demo | Immediate option if the app still launches. Verify which app/version is installed. No new distribution required. |
| TestFlight | Apple Developer Program membership, appropriate App Store Connect access/app record, matching bundle ID, distribution signing, archive/upload/processing and beta information. External testers require beta review; internal testers must be eligible App Store Connect users. No tester UDID collection. |
| Ad-hoc IPA | Paid program, registered tester UDIDs, distribution certificate and a profile including those devices, then signed archive/export. No beta review. Wireless OTA delivery additionally needs a suitable HTTPS manifest/IPA delivery setup; a raw download or AirDrop is not a universal install link. |

The current prototype declares `voip` background mode for video-call PiP camera behavior. Existing documentation explicitly does **not** claim App Store eligibility. Assess this before promising external TestFlight approval. An unsigned `.app` or simulator artifact is not an installable iPhone distribution.

### Observed audit state, October 17, 2026

- Xcode **27.1 (27A9275)** is installed. The target is iPhone-only, minimum iOS 16.
- Debug and Release use Automatic signing with the same configured team. No explicit distribution profile/export configuration was found in the repository.
- Both remembered physical phones returned **unavailable** from a read-only device listing. Current wireless transport, device OS and profile validity are **not verified**.
- Paid membership, App Store Connect access, usable distribution signing and a public TestFlight invitation are **not verified**. No account/keychain inspection, pairing changes, signing changes, installation or publishing was performed by this audit.

### Apple references

- [Current Device Hub pairing and Wi-Fi requirements](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub)
- [Free Personal Team limits and membership](https://developer.apple.com/support/compare-memberships/)
- [Registered-device and ad-hoc distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices)
- [TestFlight prerequisites and tester types](https://developer.apple.com/testflight/)
