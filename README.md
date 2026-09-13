# HostelHive — setup

A static web app (no build step, all files flat in one folder) using
Firebase Auth + Firestore. No Firebase Storage and no billing plan needed —
photos are compressed to small JPEGs in the browser and stored as data
strings directly on the Firestore document.

This is a rebuild of an earlier dating-app codebase repurposed for a
different job: students finding and listing hostels near campus. See
section 9 for what changed and why.

## 1. Firebase project
1. Create a **new, separate** project at console.firebase.google.com —
   don't reuse an existing dating-app project; the data models don't mix.
2. Enable **Authentication** → Sign-in providers → turn on **Email/Password** and **Google**.
3. Enable **Firestore** (production mode).
4. Project settings → General → add a **Web app** → copy the config values into `firebase-config.js` (must be a plain `export const firebaseConfig = {...}` — not the console's own init snippet). The file currently ships with placeholder values and a comment reminding you of this.

## 2. Firestore security rules
Paste into Firestore → Rules (this file also ships as `firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /hostels/{hostelId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.ownerUid == request.auth.uid;
      allow update: if request.auth != null && (
        resource.data.ownerUid == request.auth.uid ||
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['viewCount'])
      );
      allow delete: if request.auth != null && resource.data.ownerUid == request.auth.uid;
    }
    match /threads/{threadId} {
      allow read: if request.auth != null && request.auth.uid in resource.data.participants;
      allow create, update: if request.auth != null
        && request.auth.uid in request.resource.data.participants;
    }
    match /threads/{threadId}/messages/{messageId} {
      allow read: if request.auth != null && threadId.matches('.*' + request.auth.uid + '.*');
      allow create: if request.auth != null && request.resource.data.from == request.auth.uid;
    }
    match /reports/{reportId} {
      allow create: if request.auth != null && request.resource.data.reporterUid == request.auth.uid;
      allow read, update, delete: if false; // reports are write-only from the client; review them in the console
    }
    match /feedback/{feedbackId} {
      allow create: if request.auth != null && request.resource.data.fromUid == request.auth.uid;
      allow read: if request.auth != null;
      allow update, delete: if false; // immutable once sent, same as reports
    }
  }
}
```

## 2b. Firestore indexes (required for Messages to load)
The Messages inbox queries `threads` by `participants array-contains <you>`
ordered by `lastAt desc` — Firestore needs a composite index for that combo,
and it won't exist yet on a fresh project. Without it, the inbox listener
fails silently (you'll see a `failed-precondition ... requires an index`
error in the console) and just sits on its loading state — the app itself
now recovers gracefully and shows a retry message, but the index still
needs to be created for Messages to actually work.

Two ways to create it:
- **Fastest:** open the app, trigger the error once, and click the link
  Firestore prints in the browser console (`...firestore/indexes?create_composite=...`) —
  it pre-fills everything.
- **Or deploy directly:** this project ships a `firestore.indexes.json` with
  the same index already defined. Run `firebase deploy --only firestore:indexes`
  from the project folder (needs the Firebase CLI + `firebase init` done once
  to link it to your project).

Hostel listings and feedback don't need a composite index — every query
against them (`hostels` by `ownerUid`, `feedback` by `ownerUid` or filtered
client-side by `hostelId`) is a single-field equality, which Firestore
indexes automatically.

## 3. What's in the app
- **Auth**: email/password and Google sign-in, plus a "Forgot password?"
  link on the login screen (Firebase's own reset-email flow). No age gate —
  this app isn't 18+-restricted the way the original was.
- **My Listings** (`profile.html`): your account basics (name, photo,
  phone/WhatsApp, an "active recently" toggle shown to students you chat
  with), a form to publish a hostel — name, price, distance to campus,
  area, exact address, a necessities checklist, description, contact info,
  and up to 6 photos — and a grid of everything you've published, each
  editable or deletable inline, with a live view counter per listing.
- **Browse** (`discover.html`): text search (name/area/description/listing
  code), a filter panel (price range, max distance, area, a necessities
  checklist, has-photo), sortable by newest/price/distance, savable filter
  presets (per-device, via `localStorage`), a "Saved" row, and a
  "Recommended for you" row that scores every visible listing against your
  saved filters (`recommend.js`) — it never hides anything, it just
  re-orders.
- **Saved**: tap the heart on any card to save a listing — stored on your
  own user doc (`savedHostels: [id, …]`), so no extra security rule is
  needed. Airbnb-style: a heart for bookmarking, not romance.
- **Nothing hidden**: every field on a listing — price, exact location,
  necessities, contact, and every photo — is visible immediately to any
  signed-in student. There's no unlock-code system in this app at all
  (the original's `crypto-utils.js` encrypt/decrypt pair is gone; only the
  PIN hasher for the optional chat-lock feature remains).
- **Feedback**: short preset reaction chips ("Clean & tidy", "Great
  value", "Fast to respond", …) a student can leave on a listing's detail
  view after visiting or messaging about it — public on the listing as
  lightweight social proof, not a private note to the owner. Backed by a
  `feedback` collection with a denormalized `ownerUid` so the owner's live
  notification listener and My Listings summary can query it directly.
- **Safety**: Block (hides an owner's listings from your Browse
  permanently) and Report (writes to a `reports` collection for manual
  review, referencing the specific listing) on every hostel detail, plus a
  Help & Safety card in Settings with hostel-viewing guidelines and a
  direct contact link (artyourtaste@gmail.com).
- **Messages**: a dedicated inbox page (`messages.html`) listing every
  conversation you've started — avatar, name, last message preview,
  relative timestamp, and an unread dot — next to a real chat panel:
  header with the other person's photo, date dividers, per-message
  timestamps, a "seen" tick once they've opened the thread, a typing
  indicator, an auto-growing input (Enter to send, Shift+Enter for a new
  line), and an empty state on a fresh conversation. The same chat panel
  also opens inline from a listing's detail view in Browse. If the other
  person has deleted their account, the header and composer clearly say
  so ("Deleted account" / "No longer on HostelHive") instead of showing a
  confusing blank name. Each thread is backed by a `threads/{id}` doc
  (`participants`, `lastText`, `lastAt`, `lastFrom`, `lastRead.{uid}`,
  `typing.{uid}`) plus its `threads/{id}/messages` subcollection.
- **Delete account** (Settings → Danger zone): type-to-confirm plus a
  fresh password/Google re-auth, then deletes every hostel you've listed,
  your profile, and your sign-in itself, in that order — permanent, and
  everything vanishes from Browse/Saved/search immediately since those are
  all built by live-querying `hostels`/`users`, not by scrubbing anyone
  else's data.
- **Theme**: gold & black by default (`#D4AF37`-family accent over a warm
  near-black background), RGB sliders to retune the accent, and a
  light/dark mode toggle — all saved to `localStorage` and applied on
  every page via `theme.js`. A gold hive-hexagon-with-house favicon
  (`gen_icons.py` — regenerate after tweaking the design).

## 4. Running it
Any static file server works, e.g.:
```
npx serve .
```
Firebase Auth requires the page be served over `http://localhost` or
`https://`, not opened as a bare `file://` path.

## 5. Notifications
- **Save confirmations**: every save action across the app (account,
  listings, filter presets, saves, blocks, reports, feedback, theme
  changes) raises a themed, stacked toast (`notifications.js`).
- **Match notifications**: a bell icon (top bar, every authenticated page)
  with an unread badge and a history dropdown. While the app is open, it
  watches Firestore live for brand-new hostel listings and, if one scores
  against your saved search filters (`recommend.js`), raises an in-app
  notification plus a real browser Notification (if you grant permission
  when prompted).
- **New-responder notifications**: the same pipeline watches your message
  threads live and fires the moment someone reaches out — their first
  message to you in a brand-new thread, or a reply back after you
  messaged them first.
- **Feedback notifications**: fires when a student leaves feedback on any
  listing you own.
- None of this is *background* push — it needs a tab open somewhere. True
  background push would need a service worker + FCM and a small backend;
  out of scope for this static-file setup for now.

## 6. App icon
Generated procedurally with Pillow (`gen_icons.py`, shipped in the project
root — rerun it any time you want to tweak the design and regenerate every
size): a gold hive hexagon with a black house silhouette cut into it, on a
near-black background. Outputs the full set — 16/32/48/96/192/512 plain
PNGs, two maskable PWA icons (192/512, glyph inset to the safe zone), a
180px `apple-touch-icon.png`, a multi-size `favicon.ico`, and an opaque
`favicon.jpg`. `manifest.json` lists the five PWA sizes with the correct
`purpose` per icon (`any` vs `maskable`), and every page's `<head>` links
the favicon set and `apple-touch-icon.png` directly.

## 7. Still worth adding later
- No *background* push (see section 5).
- No native iOS/Android app — the manifest makes it installable as a PWA.
- The Browse feed loads every hostel in one query; once listing count
  grows you'll want to paginate or add a geo-aware query.
- Reports land in Firestore but there's no admin screen to review them —
  check the `reports` collection directly in the Firebase console for now.
- No distance auto-calculation — an owner types distance-to-campus by
  hand rather than it being derived from a map pin; fine for a single
  campus, worth revisiting for multi-campus support.
- Feedback and reports referencing a listing aren't cleaned up if that
  specific listing is later deleted without the owner's account also
  being deleted — harmless orphaned data (nothing links back to a live
  page), but worth a cleanup pass eventually.

## 9. What changed from the original dating-app codebase
This app reuses the same underlying engine (Firebase Auth/Firestore
patterns, the chat system, notifications, theming, appearance settings,
the memory/skills-style file layout) but the product itself is different:
- `discover.js`/`discover.html` went from swiping through member profiles
  to browsing hostel listings with price/distance/necessities filters.
- `profile.js`/`profile.html` went from a single personal dating profile
  to "My Listings" — publish, edit, and delete one or more hostels you
  manage.
- The entire ID-code encrypt/unlock system is gone. Everything about a
  listing is public by design; `crypto-utils.js` now only hashes chat-lock
  PINs.
- "Likes" became "Saved" (a heart/bookmark, not romance); "Appreciations"
  became public "Feedback" on a listing instead of a private compliment to
  a person; "taste preferences" became "saved search filters" scored
  against listings instead of people.
- Color theme moved from a violet/cyan "deep space" look to gold & black.
- `firebase-config.js` was reset to placeholders — this needs its own
  Firebase project, not the original app's.
