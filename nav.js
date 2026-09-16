// Renders the app nav everywhere: a sticky horizontal bar under the top
// bar on wide screens, and a hamburger-triggered left sidebar (off-canvas
// drawer over a dimmed backdrop) on narrow ones — see the @media blocks
// in styles.css for exactly where the breakpoint sits. One source of
// truth so every page stays in sync automatically.

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
// nav painting — the badge still ends up correct instead of racing. Both
// the desktop nav and the sidebar nav render their own badge element, so
// paintBadge() updates every one it finds rather than a single node.
let lastCount = 0;

/** Call once per page load to paint the nav. */
export function renderNav(activeId) {
  const mount = document.querySelector("#nav-mount");
  if (!mount) return;

  const itemsHtml = () => ITEMS.map(item => `
    <a class="appnav-item ${item.id === activeId ? "active" : ""}" href="${item.href}">
      <span class="appnav-icon-wrap">
        <span class="appnav-icon">${item.icon}</span>
        ${item.id === "messages" ? `<span class="appnav-badge" hidden></span>` : ""}
      </span>
      <span class="appnav-label">${item.label}</span>
    </a>`).join("");

  mount.innerHTML = `
    <nav class="appnav" aria-label="Main">${itemsHtml()}</nav>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
    <aside class="app-sidebar" id="app-sidebar" aria-hidden="true">
      <div class="sidebar-head">
        <span class="sidebar-brand">Hostel<em>Hive</em></span>
        <button class="sidebar-close" id="sidebar-close" type="button" aria-label="Close menu">✕</button>
      </div>
      <nav class="sidebar-nav" aria-label="Main">${itemsHtml()}</nav>
    </aside>`;

  mountToggle();
  wireSidebar();
  paintBadge();
  syncTopbarHeightVar();
}

// Injected as the topbar's own first child (not into #nav-mount) so it
// sits inline with the brand instead of needing its own fixed position.
// CSS hides it above the 720px breakpoint. Guarded so re-running
// renderNav() on the same page never duplicates it.
function mountToggle() {
  const topbar = document.querySelector(".topbar");
  if (!topbar || topbar.querySelector(".nav-toggle")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "nav-toggle";
  btn.className = "nav-toggle";
  btn.setAttribute("aria-label", "Open menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "app-sidebar");
  btn.innerHTML = `<span class="nav-toggle-bars"><span></span><span></span><span></span></span>`;
  topbar.insertBefore(btn, topbar.firstChild);
}

// Opens/closes the drawer from: the hamburger, the backdrop, the sidebar's
// own close button, tapping a nav link (about to navigate away anyway),
// Escape, or resizing/rotating past the breakpoint while it's open.
function wireSidebar() {
  const sidebar = document.querySelector("#app-sidebar");
  const backdrop = document.querySelector("#sidebar-backdrop");
  const toggle = document.querySelector("#nav-toggle");
  const closeBtn = document.querySelector("#sidebar-close");
  if (!sidebar || !backdrop || !toggle) return;

  const isOpen = () => sidebar.classList.contains("open");
  const open = () => {
    sidebar.classList.add("open");
    backdrop.classList.add("open");
    sidebar.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("sidebar-lock-scroll");
  };
  const close = () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("open");
    sidebar.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("sidebar-lock-scroll");
  };

  toggle.addEventListener("click", () => (isOpen() ? close() : open()));
  backdrop.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  sidebar.querySelectorAll(".appnav-item").forEach(a => a.addEventListener("click", close));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && isOpen()) close(); });
  window.addEventListener("resize", () => { if (isOpen() && window.innerWidth > 720) close(); });
}

// The nav row sticks directly under the top bar (see .appnav in
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
  document.querySelectorAll(".appnav-badge").forEach(el => {
    if (lastCount > 0) {
      el.hidden = false;
      el.textContent = lastCount > 9 ? "9+" : String(lastCount);
    } else {
      el.hidden = true;
    }
  });
}
