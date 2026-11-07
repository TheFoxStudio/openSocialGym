# Existing machine NFC tags

Open an exercise's details and select **Assign existing NFC tag**. Tap **Scan tag**,
hold the phone near the machine's tag, then **Save assignment**. Existing assignments
are listed there with a Remove action. A tag can be reassigned to another exercise;
the sheet identifies a conflicting assignment before you save it. Multiple tags can
point to one exercise. Reading and assignment never rewrite the gym's tag or open
its original app link. The separate Write NFC sticker action remains available for
your own stickers.

During a live workout, use **Scan NFC machine** when needed. An assigned exercise
already in the session becomes active. Otherwise it is added after the current
exercise/superset using the normal workout prescription and selected. Repeated
reads do not add duplicates. Scans do not change finished workouts, backfill
sessions or the saved-workout editor. Unknown tags show a message and are not opened.

| Platform | Existing machine tags |
| --- | --- |
| Chrome on Android, HTTPS or installed PWA | Start scanning to grant permission. Subsequent foreground workouts resume reading when permission is already granted. |
| Updated native Android app | Reader mode starts while the workout view is open and no sheet covers it; Stop pauses it. |
| Updated native iPhone app | Tap Scan NFC machine for a Core NFC session. One tag completes the session; tap again for another scan. |
| Safari / iPhone PWA / desktop browsers | Reading unavailable; assignment management still appears in exercise details. |

The gym tag's original app behavior is unchanged outside the foreground reader.
Native Android/iOS scanning requires rebuilding and installing the updated phone
app. Updating Docker supplies the PWA and server changes but cannot update an
installed native plugin. Physical NFC and native builds require device testing.
This Windows workspace has no Android SDK, Java toolchain or Xcode, so no native
binary or hardware verification is claimed.

Assignments store SHA-256 fingerprints of the tag UID (when available) and its NDEF
links, not raw links or tag IDs. `S.nfcAssignments` belongs to the private training
state, syncs per key, and uses tombstones so removal survives stale device sync.
Assignments are excluded from social workout snapshots. Up to 256 active tag
assignments are supported per profile.

Android/Web NFC can expose unique tag IDs. The iPhone NDEF session uses the link
content. If several machines share exactly the same link, a reader without a UID
cannot reliably distinguish them; ambiguous matches are refused. Use Android UID
assignment for those machines. Tags with no readable ID or NDEF link are not
supported. No credentials or protected tag sectors are read.

Verification: 37 focused frontend/bridge/sync checks and 21 API stamping checks
passed. An Edge simulation exercised read, explicit save, workout add/select,
repeat scans and zero writes. The web and mobile web bundles were built; native
plugins were reviewed but not compiled or exercised on hardware.

References:
- [Chrome Web NFC](https://developer.chrome.com/docs/capabilities/nfc)
- [Android reader mode](https://developer.android.com/reference/android/nfc/NfcAdapter)
- [Apple NFC tag readers](https://developer.apple.com/documentation/corenfc/building-an-nfc-tag-reader-app)
