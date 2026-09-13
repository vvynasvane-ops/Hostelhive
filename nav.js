// Renders the same 5-item nav everywhere (top bar on wide screens, fixed
// bottom bar on narrow ones — see the @media block in styles.css). One
// source of truth so every page stays in sync automatically.

const ITEMS = [
  { id: "discover", href: "discover.html", label: "Browse", icon: "⌕" },
  { id: "messages", href: "messages.html", label: "Messages", icon: "✉" },
  { id: "profile", href: "profile.html", label: "My Listings", icon: "⌂" },
  { id: "settings", href: "settings.html", label: "Theme", icon: "☰" }
];

// The unread-message badge is driven by a live Firestore listener in
// notifications.js (watchForNewResponses), which can call setMessagesBadge()
// from any page, at any time — including before renderNav() has painted
// anything on a slow connection. Keeping the last known count here (not just
// in the DOM) means whichever happens first — the listener firing or the
// nav painting — the badge still ends up correct instead of racing.
let lastCount = 0;

/** Call once per page load to paint the nav. */
export function renderNav(activeId) {
  const mount = document.querySelector("#nav-mount");
  if (!mount) return;
  mount.innerHTML = `<nav class="appnav">${ITEMS.map(item => `
    <a class="appnav-item ${item.id === activeId ? "active" : ""}" href="${item.href}">
      <span class="appnav-icon-wrap">
        <span class="appnav-icon">${item.icon}</span>
        ${item.id === "messages" ? `<span id="appnav-msg-badge" class="appnav-badge" hidden></span>` : ""}
      </span>
      <span class="appnav-label">${item.label}</span>
    </a>`).join("")}</nav>`;
  paintBadge();
  syncTopbarHeightVar();
}

// The nav row sticks directly under the top bar (see #nav-mount in
// styles.css, which reads --topbar-h). The top bar's real height shifts
// with font-size/weight settings and viewport width, so it's measured
// live rather than hardcoded — kept in sync on load and on resize.
function syncTopbarHeightVar() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const set = () => document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
  set();
  window.addEventListener("resize", set);
  if (window.ResizeObserver) new ResizeObserver(set).observe(topbar);
}

/**
 * Sets the live "new messages" count on the Messages nav item, from any page.
 * Safe to call before renderNav() has mounted anything, or on a page with no
 * #nav-mount at all — the count is kept either way so the next renderNav()
 * paints it correctly. This is what keeps Messages "always pinging for new":
 * the badge is wired to notifications.js's live thread listener, not to a
 * one-time check, so it updates in real time on whichever page is open.
 */
export function setMessagesBadge(count) {
  lastCount = count;
  paintBadge();
}

function paintBadge() {
  const el = document.querySelector("#appnav-msg-badge");
  if (!el) return;
  if (lastCount > 0) {
    el.hidden = false;
    el.textContent = lastCount > 9 ? "9+" : String(lastCount);
  } else {
    el.hidden = true;
  }
}
