import { markTyped } from "./autofill-guard.js";
import { showToast } from "./notifications.js";

const COMMON = [
  "password", "passw0rd", "123456", "12345678", "123456789", "qwerty", "qwertyuiop", "abc123",
  "111111", "000000", "iloveyou", "admin", "welcome", "letmein", "monkey", "dragon", "football",
  "hostel", "hostelhive", "student", "kenya", "nairobi", "maseno", "kikuyu", "654321", "123123"
];

const LABELS = ["Too weak", "Weak", "Okay", "Strong", "Excellent"];
const COLORS = ["#d96a6a", "#d98a4a", "#d9b84a", "#8fbf5a", "#4fbf8a"];

/** Scores a password 0-4 and returns the checklist the meter shows. Runs entirely in the browser. */
export function scorePassword(pw, { email = "", name = "" } = {}) {
  const checks = {
    length: pw.length >= 8,
    mixedCase: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw)
  };
  let pts = 0;
  if (pw.length >= 8) pts++;
  if (pw.length >= 12) pts++;
  if (pw.length >= 16) pts++;
  if (checks.mixedCase) pts++;
  if (checks.number) pts++;
  if (checks.symbol) pts++;

  const lower = pw.toLowerCase();
  const local = (email.split("@")[0] || "").toLowerCase();
  const firstName = (name.split(/\s+/)[0] || "").toLowerCase();
  let penalty = 0;
  let warning = "";
  if (COMMON.some(c => lower.includes(c))) { penalty += 3; warning = "Contains a very common password or word."; }
  if (local.length >= 3 && lower.includes(local)) { penalty += 3; warning = "Don't use part of your email."; }
  if (firstName.length >= 3 && lower.includes(firstName)) { penalty += 2; warning = "Don't use your name."; }
  if (/(.)\1{2,}/.test(pw)) { penalty += 1; warning = warning || "Avoid repeated characters."; }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf)/i.test(pw)) { penalty += 2; warning = warning || "Avoid easy sequences."; }

  const score = pw ? Math.max(0, Math.min(4, Math.floor((pts - penalty) * 4 / 6 + (pts - penalty > 0 ? 0.5 : 0)))) : 0;
  return { score, label: pw ? LABELS[score] : "", checks, warning };
}

const SAFE_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // no I, O
const SAFE_LOWER = "abcdefghijkmnopqrstuvwxyz";  // no l
const SAFE_DIGIT = "23456789";                   // no 0, 1
const SAFE_SYMBOL = "!@#$%^&*-_=+?";

function randInt(max) {
  // Rejection sampling — no modulo bias.
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % max;
}

/** Cryptographically random password with at least one of every character class and no look-alike characters. */
export function generatePassword(length = 16) {
  const pools = [SAFE_UPPER, SAFE_LOWER, SAFE_DIGIT, SAFE_SYMBOL];
  const all = pools.join("");
  const chars = pools.map(p => p[randInt(p.length)]);
  while (chars.length < length) chars.push(all[randInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { // Fisher–Yates shuffle
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Copies text, then wipes it from the clipboard after 30s — but only if it's still our text. */
async function copySafely(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showToast("Couldn't copy — reveal it and copy manually.", { type: "error" });
    return;
  }
  showToast("Copied — clipboard clears in 30 seconds.", { type: "success", duration: 2600 });
  setTimeout(async () => {
    try {
      const now = await navigator.clipboard.readText();
      if (now === text) await navigator.clipboard.writeText("");
    } catch { /* permission denied or unfocused — nothing safe to do */ }
  }, 30000);
}

/**
 * Attaches a live strength meter (with checklist) and a "Suggest a strong
 * password" generator to a password input.
 *
 * options.getEmail / options.getName — read lazily so the meter can flag
 * passwords built from the person's own email or name.
 * options.matchInput — a confirm field to fill with the same value when a password is suggested.
 */
export function attachPasswordHelper(input, options = {}) {
  if (!input || input.dataset.pwHelperAttached) return null;
  input.dataset.pwHelperAttached = "1";
  const host = input.closest(".pw-field") || input;

  const panel = document.createElement("div");
  panel.className = "pw-helper";
  panel.innerHTML = `
    <div class="pw-meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <div class="pw-meter-label" role="status" aria-live="polite"></div>
    <ul class="pw-checks">
      <li data-k="length">8+ characters</li>
      <li data-k="mixedCase">Upper &amp; lower case</li>
      <li data-k="number">A number</li>
      <li data-k="symbol">A symbol</li>
    </ul>
    <div class="pw-actions">
      <button type="button" class="btn ghost small pw-gen">Suggest a strong password</button>
      <button type="button" class="btn ghost small pw-copy" style="display:none;">Copy</button>
    </div>`;
  const anchor = host.nextElementSibling?.classList.contains("caps-hint") ? host.nextElementSibling : host;
  anchor.insertAdjacentElement("afterend", panel);

  const segs = [...panel.querySelectorAll(".pw-meter span")];
  const labelEl = panel.querySelector(".pw-meter-label");
  const checkEls = Object.fromEntries([...panel.querySelectorAll(".pw-checks li")].map(li => [li.dataset.k, li]));
  const genBtn = panel.querySelector(".pw-gen");
  const copyBtn = panel.querySelector(".pw-copy");

  function update() {
    const pw = input.value;
    const r = scorePassword(pw, {
      email: options.getEmail ? options.getEmail() : "",
      name: options.getName ? options.getName() : ""
    });
    segs.forEach((s, i) => {
      const on = !!pw && i <= r.score; // score 0 lights one red bar, 4 lights all four
      s.style.background = on ? COLORS[r.score] : "";
    });
    labelEl.textContent = pw ? `${r.label}${r.warning ? " — " + r.warning : ""}` : "";
    labelEl.style.color = pw ? COLORS[r.score] : "";
    Object.entries(r.checks).forEach(([k, ok]) => checkEls[k].classList.toggle("ok", !!ok && !!pw));
    copyBtn.style.display = pw ? "" : "none";
  }

  input.addEventListener("input", update);
  genBtn.addEventListener("click", () => {
    const pw = generatePassword(16);
    input.value = pw;
    markTyped(input);
    if (options.matchInput) { options.matchInput.value = pw; markTyped(options.matchInput); }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Show it once so it can be read / written down — the toggle's own timer
    // re-masks it after 10 seconds.
    host.querySelector(".pw-toggle")?.[input.type === "password" ? "click" : "focus"]();
    showToast("Strong password filled in. Copy it somewhere safe before you continue.", { type: "info", duration: 3500 });
  });
  copyBtn.addEventListener("click", () => { if (input.value) copySafely(input.value); });

  update();
  return { update };
}

/** Live "passwords match" indicator for a confirm field. */
export function attachMatchHint(primary, confirm) {
  if (!primary || !confirm || confirm.dataset.pwMatchAttached) return;
  confirm.dataset.pwMatchAttached = "1";
  const host = confirm.closest(".pw-field") || confirm;
  const hint = document.createElement("p");
  hint.className = "field-hint pw-match";
  const anchor = host.nextElementSibling?.classList.contains("caps-hint") ? host.nextElementSibling : host;
  anchor.insertAdjacentElement("afterend", hint);
  const check = () => {
    if (!confirm.value) { hint.textContent = ""; return; }
    const ok = confirm.value === primary.value;
    hint.textContent = ok ? "Passwords match" : "Passwords don't match yet";
    hint.classList.toggle("ok", ok);
  };
  primary.addEventListener("input", check);
  confirm.addEventListener("input", check);
}
