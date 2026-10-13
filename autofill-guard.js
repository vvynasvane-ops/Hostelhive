/**
 * Autofill guard — stops browsers and password managers from dumping the
 * saved email / password into fields that never asked for them (search bars,
 * profile name, phone, "type DELETE", filters, chat boxes…).
 *
 * Opt-OUT model: every input and textarea on the page is guarded by default.
 * A field that genuinely needs autofill (the log-in email + password) opts in
 * with `data-autofill="allow"`.
 *
 * Browsers often ignore `autocomplete="off"` on their own, so this layers
 * several independent defences:
 *   1. Honest hints: autocomplete="off" (or "new-password" for password
 *      fields that are NOT a login), plus the opt-out attributes the major
 *      password managers respect (1Password, LastPass, Bitwarden, Dashlane).
 *   2. Decoy trap: invisible dummy email + password fields placed at the top
 *      of each form. Browsers that insist on filling "something" fill the
 *      decoys instead of the real fields.
 *   3. Read-only until touched: a guarded field is readonly while the page
 *      loads, so autofill can't write to it, then unlocks the moment the
 *      person focuses or taps it.
 *   4. Rename: the `name` attribute is made unique and meaningless, so
 *      heuristics keyed on "email" / "user" / "pass" find nothing.
 *   5. Late-fill sweep: if a browser still manages to fill a guarded field
 *      after load (detected through :-webkit-autofill), the value is cleared
 *      unless the person actually typed in it.
 *   6. A MutationObserver applies all of this to inputs built at runtime
 *      (modals, the chat lock screen, etc.).
 */

const SWEEP_MS = [150, 600, 1500, 3500]; // browsers fill at different moments after load
let counter = 0;

function isAllowed(el) {
  if (el.dataset.autofill === "block") return false;           // explicit opt-out wins
  return el.closest("[data-autofill='allow']") !== null;       // field or any ancestor opted in
}

function isGuardable(el) {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  if (el.dataset.agDecoy) return false;
  if (el instanceof HTMLInputElement) {
    const t = (el.type || "text").toLowerCase();
    if (["hidden", "checkbox", "radio", "range", "file", "button", "submit", "reset", "color", "image"].includes(t)) return false;
  }
  return true;
}

function guardField(el) {
  if (!isGuardable(el) || el.dataset.agGuarded) return;
  if (isAllowed(el)) { el.dataset.agGuarded = "allowed"; return; }
  el.dataset.agGuarded = "1";

  const isPassword = el instanceof HTMLInputElement && el.type === "password";
  // "new-password" is the one hint that makes browsers stop offering the
  // SAVED password; "off" covers everything else.
  el.setAttribute("autocomplete", isPassword ? "new-password" : "off");
  el.setAttribute("autocapitalize", el.getAttribute("autocapitalize") || "off");
  el.setAttribute("autocorrect", "off");
  el.setAttribute("spellcheck", "false");

  // Password-manager opt-outs.
  el.setAttribute("data-lpignore", "true");       // LastPass
  el.setAttribute("data-1p-ignore", "true");      // 1Password
  el.setAttribute("data-bwignore", "true");       // Bitwarden
  el.setAttribute("data-form-type", "other");     // Dashlane

  // Unique, meaningless name so "email"/"password" heuristics find nothing.
  if (!el.dataset.agName) {
    el.dataset.agName = "1";
    el.setAttribute("name", `f_${Date.now().toString(36)}_${++counter}`);
  }

  // Readonly until the person actually touches the field.
  if (!el.readOnly) {
    el.readOnly = true;
    el.dataset.agLocked = "1";
    const unlock = () => {
      if (el.dataset.agLocked) {
        el.readOnly = false;
        delete el.dataset.agLocked;
      }
      el.dataset.agTouched = "1";
    };
    el.addEventListener("focus", unlock, { once: true });
    el.addEventListener("pointerdown", unlock, { once: true });
    el.addEventListener("touchstart", unlock, { once: true, passive: true });
  }
  el.addEventListener("keydown", () => { el.dataset.agTyped = "1"; });
  el.addEventListener("paste", () => { el.dataset.agTyped = "1"; });
}

/** Invisible dummy fields browsers can fill instead of the real ones. */
function addDecoys(form) {
  if (form.dataset.agDecoys || form.closest("[data-autofill='allow']")) return;
  form.dataset.agDecoys = "1";
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;";
  box.innerHTML =
    `<input data-ag-decoy="1" type="text" name="username" autocomplete="username" tabindex="-1">` +
    `<input data-ag-decoy="1" type="email" name="email" autocomplete="email" tabindex="-1">` +
    `<input data-ag-decoy="1" type="password" name="password" autocomplete="current-password" tabindex="-1">`;
  form.insertBefore(box, form.firstChild);
}

/** Clears a guarded field a browser filled behind the person's back. */
function sweep() {
  document.querySelectorAll("[data-ag-guarded='1']").forEach(el => {
    if (el.dataset.agTyped) return; // the person typed/pasted here — leave it alone
    let filled = false;
    try { filled = el.matches(":-webkit-autofill") || el.matches(":autofill"); } catch { /* selector unsupported */ }
    if (filled) {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

/** Mark a field's value as set by the app itself (e.g. "Use this password") so the sweep never wipes it. */
export function markTyped(el) {
  if (el) el.dataset.agTyped = "1";
}

function guardAll(root = document) {
  root.querySelectorAll("form").forEach(addDecoys);
  root.querySelectorAll("input, textarea").forEach(guardField);
}

let started = false;
export function initAutofillGuard() {
  if (started) return;
  started = true;

  guardAll();
  SWEEP_MS.forEach(ms => setTimeout(sweep, ms));
  // Back/forward cache restores can re-fill fields.
  window.addEventListener("pageshow", e => { if (e.persisted) { guardAll(); sweep(); } });

  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.matches?.("input, textarea")) guardField(n);
        if (n.querySelectorAll) guardAll(n);
      });
    }
  });
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
}
