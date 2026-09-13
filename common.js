const EYE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

/**
 * Adds a "show password" eye toggle to a password input, wherever it lives
 * (a static form, or a modal/lock-screen built at runtime by chat.js). Wraps
 * the input in a small positioning container (`.pw-field` in styles.css) and
 * inserts a button that flips the field between type="password" and
 * type="text" — the actual reveal, not just a masked re-display, since the
 * underlying input value never changes, only how it's rendered.
 * Idempotent (safe to call twice on the same input) and a no-op if the
 * element doesn't exist, so call sites don't need to guard for either.
 */
export function addPasswordToggle(input) {
  if (!input || input.dataset.pwToggleAttached) return;
  input.dataset.pwToggleAttached = "1";
  const wrap = document.createElement("div");
  wrap.className = "pw-field";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-toggle";
  btn.setAttribute("aria-label", "Show password");
  btn.innerHTML = EYE_ICON;
  wrap.appendChild(btn);
  btn.addEventListener("click", () => {
    const revealed = input.type === "text";
    input.type = revealed ? "password" : "text";
    btn.innerHTML = revealed ? EYE_ICON : EYE_OFF_ICON;
    btn.setAttribute("aria-label", revealed ? "Show password" : "Hide password");
    // Keep focus + caret in the field after the tap, instead of losing focus to the button.
    input.focus();
  });
}

/** The standard necessities checklist — shared by the Browse filters and the
 * My Listings upload form so a student's saved search and an owner's listing
 * are always describing amenities the same way. */
export const NECESSITIES = [
  "WiFi", "Water 24/7", "Electricity backup", "Furnished", "Security guard",
  "CCTV", "Kitchen", "Meals included", "Laundry", "Parking",
  "Study room", "En-suite bathroom"
];

export function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function placeholderPhoto() {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400'><rect width='100%' height='100%' fill='#1e1b14'/></svg>`
  );
}

/** Generates a short, human-friendly reference code for a hostel listing, like
 * "HH-482913" — handy for a student to quote when messaging support or filing
 * a report ("the listing HH-482913 looks fake"). Not a secret of any kind. */
export function generateListingCode() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `HH-${n}`;
}

/** True if lastActive (a Firestore Timestamp, Date, or ms number) was within the last 5 minutes. */
export function isOnlineNow(lastActive) {
  if (!lastActive) return false;
  const ms = lastActive.toMillis ? lastActive.toMillis() : (lastActive instanceof Date ? lastActive.getTime() : lastActive);
  return Date.now() - ms < 5 * 60 * 1000;
}

/** "Online now" / "Active 3h ago" / "" (never active) label for a profile. */
export function activityLabel(lastActive) {
  if (!lastActive) return "";
  if (isOnlineNow(lastActive)) return "Online now";
  const ms = lastActive.toMillis ? lastActive.toMillis() : (lastActive instanceof Date ? lastActive.getTime() : lastActive);
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 60) return `Active ${mins}m ago`;
  if (mins < 1440) return `Active ${Math.floor(mins / 60)}h ago`;
  return `Active ${Math.floor(mins / 1440)}d ago`;
}

/** Cosmic "two stars orbiting" loading indicator (see styles.css .loader-orbit). Drop this into
 * any container while its real content is still streaming in from Firestore. */
export function loaderHtml(label) {
  return `
    <div class="loader-wrap">
      <div class="loader-orbit"></div>
      ${label ? `<div class="loader-label">${escapeHtml(label)}</div>` : ""}
    </div>`;
}

// The jelly-dot loader's ooze effect needs one shared <filter> def in the DOM
// (SVG filters can't be inlined via CSS). Injected lazily, once, the first
// time loaderTrackHtml() actually runs — duplicate ids are harmless in SVG
// `url(#id)` references (the first match wins), but there's no reason to
// stamp out a copy on every page that uses the loader.
let jellyFilterInjected = false;
function ensureJellyFilter() {
  if (jellyFilterInjected) return;
  jellyFilterInjected = true;
  document.body.insertAdjacentHTML("afterbegin", `
    <svg width="0" height="0" style="position:absolute">
      <defs>
        <filter id="uib-jelly-ooze">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="ooze" />
          <feBlend in="SourceGraphic" in2="ooze" />
        </filter>
      </defs>
    </svg>`);
}

/** Full-page "jelly dots" loader — five oozing dots streaming across and merging
 * into one another. Used as a brief splash while a protected page waits on
 * requireAuth()/the initial data fetch. */
export function loaderTrackHtml(label) {
  ensureJellyFilter();
  return `
    <div class="loader-page">
      <div class="loader-jelly">
        <div class="jelly-dot"></div>
        <div class="jelly-dot"></div>
        <div class="jelly-dot"></div>
        <div class="jelly-dot"></div>
        <div class="jelly-dot"></div>
      </div>
      ${label ? `<div class="loader-label">${escapeHtml(label)}</div>` : ""}
    </div>`;
}

/** Small rounded-track loader for in-place processing (photo compression). */
export function loaderPhotoHtml() {
  return `
    <svg class="loader-photo" viewBox="0 0 40 40" height="26" width="26" preserveAspectRatio="xMidYMid meet">
      <path class="loader-photo-bg" fill="none" stroke-width="4" pathLength="100"
        d="M29.76 18.72c0 7.28-3.92 13.6-9.84 16.96-2.88 1.68-6.24 2.64-9.84 2.64-3.6 0-6.88-.96-9.76-2.64 0-7.28 3.92-13.52 9.84-16.96 2.88-1.68 6.24-2.64 9.76-2.64s6.88.96 9.84 2.64c5.84 3.36 9.76 9.68 9.84 16.96-2.88 1.68-6.24 2.64-9.76 2.64-3.6 0-6.88-.96-9.84-2.64-5.84-3.36-9.76-9.68-9.76-16.96 0-7.28 3.92-13.6 9.76-16.96 5.84 3.36 9.76 9.68 9.76 16.96z"/>
      <path class="loader-photo-car" fill="none" stroke-width="4" pathLength="100"
        d="M29.76 18.72c0 7.28-3.92 13.6-9.84 16.96-2.88 1.68-6.24 2.64-9.84 2.64-3.6 0-6.88-.96-9.76-2.64 0-7.28 3.92-13.52 9.84-16.96 2.88-1.68 6.24-2.64 9.76-2.64s6.88.96 9.84 2.64c5.84 3.36 9.76 9.68 9.84 16.96-2.88 1.68-6.24 2.64-9.76 2.64-3.6 0-6.88-.96-9.84-2.64-5.84-3.36-9.76-9.68-9.76-16.96 0-7.28 3.92-13.6 9.76-16.96 5.84 3.36 9.76 9.68 9.76 16.96z"/>
    </svg>`;
}

/** Small "streaming dots" loader (gooey blend) for a message in flight. */
export function loaderStreamHtml() {
  return `
    <span class="loader-stream-wrap">
      <span class="loader-stream"><span></span><span></span><span></span><span></span><span></span></span>
      <svg width="0" height="0" style="position:absolute">
        <filter id="loader-stream-ooze">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="ooze"/>
          <feBlend in="SourceGraphic" in2="ooze"/>
        </filter>
      </svg>
    </span>`;
}

/** Small "merging blobs" loader (gooey blend) for an inline button's busy state. */
export function loaderBlobHtml() {
  return `
    <span class="loader-blob-wrap">
      <span class="loader-blob"></span>
      <svg width="0" height="0" style="position:absolute">
        <filter id="loader-blob-ooze">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="ooze"/>
          <feBlend in="SourceGraphic" in2="ooze"/>
        </filter>
      </svg>
    </span>`;
}

/** Splits a comma-separated input string into a clean array of short tags. */
export function parseTags(str) {
  return (str || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 12);
}

/** Renders an array of tags as small chip pills (reuses the existing .chip style). */
export function tagsHtml(tags) {
  return (tags || []).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join("");
}

/** Builds one hostel card's markup. `recommended` adds a small badge, `saved` fills the heart/save button. */
export function hostelCardHtml(hostelId, h, recommended, saved) {
  const priceLabel = h.price ? `KES ${Number(h.price).toLocaleString()}/mo` : "Price on request";
  const distLabel = h.distanceKm != null && h.distanceKm !== "" ? `${h.distanceKm} km to campus` : "";
  const chips = (h.necessities || []).slice(0, 3);
  const extra = (h.necessities || []).length - chips.length;
  return `
    <div class="person-card" data-hostel-id="${hostelId}">
      ${recommended ? `<span class="chip recommended">Recommended</span>` : ""}
      <button type="button" class="like-btn card-like-btn ${saved ? "liked" : ""}" data-save-id="${hostelId}" title="${saved ? "Remove from Saved" : "Save"}">${saved ? "&#10084;" : "&#9825;"}</button>
      <img class="person-photo" src="${(h.photos && h.photos[0]) || placeholderPhoto()}" alt="${escapeHtml(h.name || "Hostel")}">
      <div class="person-meta">
        <div class="person-name">${escapeHtml(h.name || "Hostel")}</div>
        <div class="person-sub">${escapeHtml(priceLabel)}${distLabel ? " · " + escapeHtml(distLabel) : (h.area ? " · " + escapeHtml(h.area) : "")}</div>
        ${chips.length ? `<div class="person-sub">${chips.map(c => escapeHtml(c)).join(" · ")}${extra > 0 ? ` +${extra} more` : ""}</div>` : ""}
      </div>
    </div>`;
}
