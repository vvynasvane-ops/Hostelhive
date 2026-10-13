import {
  auth, db, googleProvider, onAuthStateChanged, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  doc, setDoc, getDoc, serverTimestamp
} from "./firebase-init.js";
import { loaderBlobHtml, addPasswordToggle } from "./common.js";
import { showToast } from "./notifications.js";
import { attachPasswordHelper } from "./password-tools.js";
import { scorePassword } from "./password-tools.js";

const form = document.querySelector("#auth-form");
const tabLogin = document.querySelector("#tab-login");
const tabSignup = document.querySelector("#tab-signup");
const nameField = document.querySelector("#name-field");
const submitBtn = document.querySelector("#auth-submit");
const errorBox = document.querySelector("#auth-error");
const forgotLink = document.querySelector("#forgot-link");
const passwordInput = document.querySelector("#password");
const emailInput = document.querySelector("#email");
const nameInput = document.querySelector("#name");
addPasswordToggle(passwordInput);
// Strength meter + generator only appear on Sign up — logging in needs neither.
const helper = attachPasswordHelper(passwordInput, {
  getEmail: () => emailInput.value,
  getName: () => nameInput.value
});
const helperPanel = passwordInput.closest(".pw-field").parentNode.querySelector(".pw-helper");
let mode = "login";
let userTypedPw = false; // distinguishes a browser-filled password from one the person typed
["keydown", "paste"].forEach(ev => passwordInput.addEventListener(ev, () => { userTypedPw = true; }));

function setMode(next) {
  mode = next;
  tabLogin.classList.toggle("active", mode === "login");
  tabSignup.classList.toggle("active", mode === "signup");
  nameField.style.display = mode === "signup" ? "block" : "none";
  submitBtn.textContent = mode === "signup" ? "Create account" : "Log in";
  errorBox.textContent = "";
  // Logging in: let the browser offer the saved password. Signing up: it must NOT
  // (and "new-password" also lets password managers suggest a fresh one).
  passwordInput.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
  if (helperPanel) helperPanel.style.display = mode === "signup" ? "block" : "none";
  forgotLink.parentNode.style.display = mode === "signup" ? "none" : "";
  if (mode === "signup" && !userTypedPw) passwordInput.value = ""; // drop a browser-filled saved password
  if (helper) helper.update();
}
tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));
setMode("login"); // initial state: hides the signup-only helper

/** Creates the Firestore profile doc for a brand-new student, the first time they sign in. */
async function ensureProfileDoc(user, displayName) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: displayName || user.displayName || "New student",
      photoURL: user.photoURL || "",
      phone: "",
      showOnlineStatus: true,
      lastActive: serverTimestamp(),
      savedHostels: [],
      blockedUsers: [],
      // Saved search filters — price range, distance, and the necessities a
      // student cares about — set from the Browse page and reused there to
      // power "Recommended for you" and the new-listing match notifications.
      preferences: { priceMin: null, priceMax: null, maxDistanceKm: null, area: "", necessities: [] },
      createdAt: Date.now()
    });
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.textContent = "";
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const name = document.querySelector("#name").value.trim();
  if (mode === "signup") {
    const r = scorePassword(password, { email, name });
    if (password.length < 8) { errorBox.textContent = "Use at least 8 characters for a new password."; return; }
    if (r.score < 2) { errorBox.textContent = "That password is too easy to guess" + (r.warning ? " — " + r.warning.toLowerCase() : ".") + " Try the suggestion button."; return; }
  }
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.innerHTML = loaderBlobHtml();
  try {
    if (mode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await ensureProfileDoc(cred.user, name);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    window.location.href = "discover.html";
  } catch (err) {
    errorBox.textContent = friendlyError(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

document.querySelector("#google-btn").addEventListener("click", async (e) => {
  errorBox.textContent = "";
  const googleBtn = e.currentTarget;
  const originalLabel = googleBtn.textContent;
  googleBtn.disabled = true;
  googleBtn.innerHTML = loaderBlobHtml();
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    await ensureProfileDoc(cred.user);
    window.location.href = "discover.html";
  } catch (err) {
    errorBox.textContent = friendlyError(err);
  } finally {
    googleBtn.disabled = false;
    googleBtn.textContent = originalLabel;
  }
});

forgotLink.addEventListener("click", async (e) => {
  e.preventDefault();
  errorBox.textContent = "";
  const email = document.querySelector("#email").value.trim();
  if (!email) { errorBox.textContent = "Enter your email above first, then tap \"Forgot password?\"."; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast("Password reset email sent — check your inbox.", { type: "success" });
  } catch (err) {
    errorBox.textContent = friendlyError(err);
  }
});

function friendlyError(err) {
  const code = err.code || "";
  if (code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-credential")) return "Email or password is incorrect.";
  if (code.includes("email-already-in-use")) return "That email already has an account — try logging in instead.";
  if (code.includes("weak-password")) return "That password is too weak — use at least 8 characters.";
  if (code.includes("invalid-email")) return "That doesn't look like a valid email address.";
  return "Something went wrong. Please try again.";
}

// If already signed in, skip straight past the auth screen.
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "discover.html";
});

// Land here via index.html?deleted=1 right after Settings' Danger zone
// finishes deleting the account — a short, one-time farewell instead of
// silently dumping them back on the login screen with no acknowledgment.
if (new URLSearchParams(window.location.search).get("deleted") === "1") {
  showToast("Your account has been deleted. Take care.", { type: "info", duration: 5000 });
  window.history.replaceState({}, "", "index.html");
}
