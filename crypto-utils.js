// ============================================================
// HostelHive doesn't gate any hostel info behind a code — price, location,
// necessities, and photos are all public on the listing, on purpose,
// because that's exactly what a student needs to compare places quickly.
// The one thing this file still does is hashPin(), used by the optional
// chat-lock feature (Settings-adjacent, see chat.js) to keep a device PIN
// out of localStorage in plain text — that's a personal-device privacy
// convenience, unrelated to hiding listing data.
// ============================================================

const enc = new TextEncoder();

function toB64(bytes) { return btoa(String.fromCharCode(...bytes)); }

/** Hashes a PIN/password with SHA-256 for local (device-only) verification —
 *  used by the chat-lock feature. Not a secret vault, just enough so the
 *  raw PIN is never sitting in localStorage in plain text. */
export async function hashPin(pin) {
  const bytes = await crypto.subtle.digest("SHA-256", enc.encode(pin));
  return toB64(new Uint8Array(bytes));
}
