// ============================================================
// Shared notification system for HostelHive.
//
// Three pieces, all drop-in-safe for the existing pages:
//   1. showToast(msg, opts)   — stacked, themed toasts. Same call
//      signature as every page's old local showToast(msg), so
//      swapping the import is the only change needed at call sites.
//   2. renderBell(uid)        — a persistent notification bell +
//      history, backed by localStorage (per student), rendered into
//      any page that has a #notif-mount element.
//   3. watchForNewHostelMatches() — a live Firestore listener that
//      raises a notification (in-app + browser Notification, if
//      permitted) the moment a brand-new hostel listing goes up
//      that fits the signed-in student's saved search filters.
// ============================================================

import { db, collection, onSnapshot, query, where, doc, getDoc } from "./firebase-init.js";
import { matchScore, hasPreferences } from "./recommend.js";
import { setMessagesBadge } from "./nav.js";

const SESSION_KEY = "lw-session-start";
const SEEN_KEY = "lw-seen-new-users";
const MSG_SESSION_KEY = "lw-msg-session-start";
const SEEN_THREADS_KEY = "lw-seen-thread-replies";

let toastRoot = null;
function ensureToastRoot() {
  if (toastRoot && document.body.contains(toastRoot)) return toastRoot;
  toastRoot = document.querySelector("#toast-root");
  if (!toastRoot) {
    toastRoot = document.createElement("div");
    toastRoot.id = "toast-root";
    toastRoot.className = "toast-root";
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

const ICONS = { success: "&#10003;", match: "&#10022;", error: "!", info: "&#9670;" };

/** Stacked, auto-dismissing toast. opts: { type: "info"|"success"|"match"|"error", duration, icon } */
export function showToast(msg, opts = {}) {
  const root = ensureToastRoot();
  const type = opts.type || "info";
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${opts.icon || ICONS[type] || ICONS.info}</span><span class="toast-msg"></span>`;
  el.querySelector(".toast-msg").textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const life = opts.duration || 3200;
  const dismiss = () => {
    el.classList.remove("show");
    el.classList.add("hide");
    setTimeout(() => el.remove(), 320);
  };
  const timer = setTimeout(dismiss, life);
  el.addEventListener("click", () => { clearTimeout(timer); dismiss(); });
  return el;
}

/** The "priority" confirmation — every save action gets one of these. */
export function savedToast(what = "Changes") {
  showToast(`${what} saved`, { type: "success" });
}

function notifKey(uid) { return `lw-notifications-${uid}`; }
function loadNotifs(uid) { try { return JSON.parse(localStorage.getItem(notifKey(uid))) || []; } catch { return []; } }
function saveNotifs(uid, list) { localStorage.setItem(notifKey(uid), JSON.stringify(list.slice(0, 30))); }

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function addNotification(uid, notif) {
  const list = loadNotifs(uid);
  list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, read: false, at: Date.now(), ...notif });
  saveNotifs(uid, list);
  renderBell(uid);
}

/** Renders the bell + dropdown into #notif-mount, if the current page has one. Safe to call repeatedly. */
export function renderBell(uid) {
  const mount = document.querySelector("#notif-mount");
  if (!mount) return;
  const list = loadNotifs(uid);
  const unread = list.filter(n => !n.read).length;

  mount.innerHTML = `
    <button id="notif-bell-btn" class="notif-bell" type="button" aria-label="Notifications" aria-expanded="false">
      <span class="notif-bell-icon">&#128276;</span>
      ${unread ? `<span class="notif-badge">${unread > 9 ? "9+" : unread}</span>` : ""}
    </button>
    <div id="notif-panel" class="notif-panel">
      <div class="notif-panel-head">
        <span>Notifications</span>
        <button id="notif-clear" type="button" class="notif-clear-btn" ${list.length ? "" : "disabled"}>Clear all</button>
      </div>
      <div class="notif-list">
        ${list.length ? list.map(n => `
          <a class="notif-item ${n.read ? "" : "unread"}" href="${n.href || "#"}" data-id="${n.id}">
            <span class="notif-item-icon">${n.icon || "&#10022;"}</span>
            <span class="notif-item-body">
              <span class="notif-item-title" data-title></span>
              <span class="notif-item-time">${timeAgo(n.at)}</span>
            </span>
          </a>`).join("") : `<p class="notif-empty">Nothing yet — new messages and hostel matches will show up here.</p>`}
      </div>
    </div>`;

  // Titles are set as text (not interpolated into the template) so a member's stored
  // name can never be read back as HTML.
  list.forEach(n => {
    const t = mount.querySelector(`[data-id="${n.id}"] [data-title]`);
    if (t) t.textContent = n.title;
  });

  const btn = mount.querySelector("#notif-bell-btn");
  const panel = mount.querySelector("#notif-panel");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !panel.classList.contains("open");
    panel.classList.toggle("open", opening);
    btn.setAttribute("aria-expanded", String(opening));
    if (opening && unread) {
      setTimeout(() => {
        saveNotifs(uid, loadNotifs(uid).map(n => ({ ...n, read: true })));
        const badge = mount.querySelector(".notif-badge");
        if (badge) badge.remove();
      }, 900);
    }
  });
  document.addEventListener("click", (e) => {
    if (!mount.contains(e.target)) panel.classList.remove("open");
  });
  const clearBtn = mount.querySelector("#notif-clear");
  if (clearBtn) clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    saveNotifs(uid, []);
    renderBell(uid);
  });
}

// Kept live so a page can call watchForNewHostelMatches(...) again after the student
// edits their taste mid-session (e.g. Save taste) without stacking a second
// Firestore listener — only one listener is ever attached per page load.
let watcherArmed = false;
let latestPrefs = null;

/**
 * Live-watches new hostel listings for the rest of this tab's session and raises
 * a match notification (in-app bell + toast, plus a real browser Notification if
 * permitted) the moment a listing goes up that fits the signed-in student's saved
 * search filters (price range, distance, necessities, area). Safe to call
 * repeatedly (e.g. right after filters are saved) — it always matches against the
 * most recently passed-in filters, but only ever attaches one underlying listener.
 */
export function watchForNewHostelMatches(uid, myPrefs) {
  latestPrefs = myPrefs;
  if (!hasPreferences(myPrefs) || watcherArmed) return;
  watcherArmed = true;

  if (!sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  const sessionStart = Number(sessionStorage.getItem(SESSION_KEY));

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  let seen;
  try { seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY)) || []); } catch { seen = new Set(); }

  onSnapshot(query(collection(db, "hostels")), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const d = change.doc;
      if (seen.has(d.id)) return;
      const data = d.data();
      if (data.ownerUid === uid) return; // don't notify someone about their own new listing
      const createdMs = typeof data.createdAt === "number" ? data.createdAt : (data.createdAt?.toMillis ? data.createdAt.toMillis() : 0);
      // Firestore replays every existing doc as an "added" change on first load —
      // only react to listings actually posted after this tab session began.
      if (!createdMs || createdMs < sessionStart - 2 * 60 * 1000) return;
      seen.add(d.id);
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));

      const score = matchScore(latestPrefs, { ...data, id: d.id });
      if (score <= 0) return;

      const name = data.name || "A new hostel";
      addNotification(uid, { title: `${name} just listed and fits your search`, icon: "&#10022;", href: "discover.html" });
      showToast(`New match: ${name} fits your search`, { type: "match", duration: 4400 });

      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("HostelHive — new match", {
            body: `${name} just listed and fits your search filters.`,
            icon: "icon-192.png"
          });
        } catch { /* some browsers restrict this — the in-app toast/bell still cover it */ }
      }
    });
  });
}

/** Call once per authenticated page, right after load(): renders the bell and arms the live watcher. */
export function initNotifications(uid, myPrefs) {
  renderBell(uid);
  watchForNewHostelMatches(uid, myPrefs);
  watchForNewResponses(uid);
  watchForListingFeedback(uid);
}

// Kept live for the same reason as the other watchers above.
let feedbackWatcherArmed = false;
const FEEDBACK_SESSION_KEY = "lw-feedback-session-start";
const SEEN_FEEDBACK_KEY = "lw-seen-feedback";

/**
 * Live-watches the `feedback` collection (see discover.js's quick-feedback
 * chips on a hostel's detail view) for docs on a listing this member owns,
 * and raises a notification the moment a new one lands, for the rest of
 * this tab's session — same pattern as watchForNewResponses, just filtered
 * by `ownerUid` instead of `participants`.
 */
export function watchForListingFeedback(uid) {
  if (feedbackWatcherArmed) return;
  feedbackWatcherArmed = true;

  if (!sessionStorage.getItem(FEEDBACK_SESSION_KEY)) sessionStorage.setItem(FEEDBACK_SESSION_KEY, String(Date.now()));
  const sessionStart = Number(sessionStorage.getItem(FEEDBACK_SESSION_KEY));

  let seen;
  try { seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_FEEDBACK_KEY)) || []); } catch { seen = new Set(); }

  const q = query(collection(db, "feedback"), where("ownerUid", "==", uid));
  onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      if (seen.has(change.doc.id)) return;
      seen.add(change.doc.id);
      sessionStorage.setItem(SEEN_FEEDBACK_KEY, JSON.stringify([...seen]));

      const f = change.doc.data();
      const createdMs = f.createdAt?.toMillis ? f.createdAt.toMillis() : 0;
      // Firestore replays every existing doc as an "added" change on first
      // load — only notify for ones that landed after this tab session began,
      // same guard the other watchers use.
      if (!createdMs || createdMs < sessionStart - 2 * 60 * 1000) return;

      addNotification(uid, { title: `New feedback on ${f.hostelName || "your listing"}: "${f.text}"`, icon: "&#10024;", href: "profile.html" });
      showToast(`\u2728 New feedback on ${f.hostelName || "your listing"}`, { type: "match", duration: 4400 });
    });
  });
}

// Kept live for the same reason as watcherArmed above — only one listener
// per tab, safe to call initNotifications() again mid-session.
let msgWatcherArmed = false;
const senderProfileCache = new Map(); // uid -> {name, photoURL}, so a busy conversation doesn't re-fetch per message

/**
 * Looks up the sender info we already stashed on a past message notification
 * for `otherUid`, if any — most recent first. Lets messages.html paint a
 * conversation's header (name + photo) the instant a notification is tapped,
 * instead of waiting on a fresh round-trip to Firestore before it can show
 * anything. This is the same stale-while-revalidate idea chat apps use: show
 * the cached sender right away, then quietly confirm/refresh from the network.
 */
export function getCachedSenderProfile(myUid, otherUid) {
  const list = loadNotifs(myUid);
  const hit = list.find(n => n.data?.uid === otherUid);
  return hit ? { name: hit.data.name, photoURL: hit.data.photoURL } : null;
}

/**
 * Live-watches this member's message threads for the rest of this tab's session
 * and raises a notification (in-app bell + toast, plus a real browser
 * Notification if permitted) the moment someone "reaches out" — whether
 * that's the *first* message in a brand-new thread they started, or a
 * *reply* back after this member messaged them first. Either way, what
 * matters is: the latest message in the thread is from the other person,
 * and it's new since this tab opened. Points at messages.html, where the
 * inbox's "New" filter (see messages.js) lists exactly these threads.
 */
export function watchForNewResponses(uid) {
  if (msgWatcherArmed) return;
  msgWatcherArmed = true;

  if (!sessionStorage.getItem(MSG_SESSION_KEY)) sessionStorage.setItem(MSG_SESSION_KEY, String(Date.now()));
  const sessionStart = Number(sessionStorage.getItem(MSG_SESSION_KEY));

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  // threadId -> lastAt (ms) we've already notified for, so a thread's other
  // unrelated field changes (e.g. lastRead ticking while the chat is open)
  // don't re-fire a notification for the same incoming message.
  let seen;
  try { seen = new Map(JSON.parse(sessionStorage.getItem(SEEN_THREADS_KEY)) || []); } catch { seen = new Map(); }

  const q = query(collection(db, "threads"), where("participants", "array-contains", uid));
  onSnapshot(q, (snap) => {
    // Always-on unread badge for the Messages nav item (see nav.js). Recomputed
    // from the full snapshot — not just this batch's changes — so it stays
    // correct no matter which thread changed, and pings live on every page
    // that has the nav mounted, not just messages.html.
    let unreadCount = 0;
    snap.forEach((docSnap) => {
      const t = docSnap.data();
      if (!t.lastAt || t.lastFrom === uid) return;
      const lastAtMs = t.lastAt?.toMillis ? t.lastAt.toMillis() : 0;
      const readMs = t.lastRead?.[uid]?.toMillis ? t.lastRead[uid].toMillis() : 0;
      if (!readMs || readMs < lastAtMs) unreadCount++;
    });
    setMessagesBadge(unreadCount);

    snap.docChanges().forEach((change) => {
      if (change.type === "removed") return;
      const data = change.doc.data();
      // Only their incoming messages count as "reaching out" — not our own sends,
      // and not a thread that only just got created with no message yet.
      if (!data.lastFrom || data.lastFrom === uid) return;

      const lastAtMs = data.lastAt?.toMillis ? data.lastAt.toMillis() : 0;
      // Firestore replays every existing doc as an "added" change on first load —
      // only react to messages that actually landed after this tab session began,
      // same guard as watchForNewHostelMatches uses for new listings.
      if (!lastAtMs || lastAtMs < sessionStart - 2 * 60 * 1000) return;

      const already = seen.get(change.doc.id);
      if (already && already >= lastAtMs) return;
      seen.set(change.doc.id, lastAtMs);
      sessionStorage.setItem(SEEN_THREADS_KEY, JSON.stringify([...seen]));

      const otherUid = data.lastFrom;
      const threadId = change.doc.id;
      // Deep-link straight to this conversation (not just the inbox), and
      // stash the sender's name + photo on the notification itself. Together
      // these let a tap open the actual conversation with the sender's
      // details already on screen — no second click to find the right row,
      // and no waiting on a fresh Firestore round-trip before anything shows.
      const announce = ({ name, photoURL }) => {
        addNotification(uid, {
          title: `${name} sent you a message`,
          icon: "&#128172;",
          href: `messages.html?uid=${encodeURIComponent(otherUid)}&tid=${encodeURIComponent(threadId)}`,
          data: { uid: otherUid, name, photoURL: photoURL || "" }
        });
        showToast(`New message from ${name}`, { type: "match", duration: 4400 });
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("HostelHive — new message", {
              body: `${name} sent you a message.`,
              icon: "icon-192.png"
            });
          } catch { /* some browsers restrict this — the in-app toast/bell still cover it */ }
        }
      };

      if (senderProfileCache.has(otherUid)) {
        announce(senderProfileCache.get(otherUid));
      } else {
        getDoc(doc(db, "users", otherUid)).then(userSnap => {
          const u = userSnap.data() || {};
          const profile = { name: u.name || "Someone", photoURL: u.photoURL || "" };
          senderProfileCache.set(otherUid, profile);
          announce(profile);
        }).catch(() => announce({ name: "Someone", photoURL: "" }));
      }
    });
  });
}
