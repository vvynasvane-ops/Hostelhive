import { auth, onAuthStateChanged } from "./firebase-init.js";

/**
 * Points the "Home" links on the static/legal pages (About, Contact, Terms,
 * Privacy) at the right destination.
 *
 * These pages are reached two ways: from the signed-out landing page
 * (index.html), and — via Settings' footer — from inside the app while
 * signed in. Every "Home" link on them (the brand logo, and the Home item
 * in the legal-nav row) used to hard-code href="index.html". For a signed-out
 * visitor that's correct. For a signed-in member it sent them back to the
 * login screen instead of the app, and until auth.js's listener there caught
 * up and bounced them onward, the page just showed the login form again with
 * no way back to Discover except typing the URL — this is the "can't get
 * back to the home page" bug.
 *
 * This resolves the real destination once auth state is known: Discover for
 * a signed-in member, the landing page for a signed-out visitor. Safe to
 * call on any page; a no-op if it finds no [data-home-link] elements.
 */
export function initLegalNav() {
  const links = document.querySelectorAll("[data-home-link]");
  if (!links.length) return;
  onAuthStateChanged(auth, (user) => {
    const href = user ? "discover.html" : "index.html";
    links.forEach(el => {
      el.setAttribute("href", href);
      if (el.hasAttribute("data-home-label")) {
        el.textContent = user ? "← Back to app" : "← Back home";
      }
    });
  });
}
