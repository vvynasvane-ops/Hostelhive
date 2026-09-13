import { initStarfield } from "./starfield.js";
import { showToast } from "./notifications.js";
import { initAppearance } from "./appearance.js";

const root = document.documentElement;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function applyAccent(h, s, l) {
  root.style.setProperty("--gold-h", h);
  root.style.setProperty("--gold-s", s + "%");
  root.style.setProperty("--gold-l", l + "%");
}

function applyMode(mode) {
  root.setAttribute("data-mode", mode);
}

export function initTheme() {
  initStarfield();
  initAppearance();

  const savedMode = localStorage.getItem("lw-mode") || "dark";
  applyMode(savedMode);

  const savedAccent = JSON.parse(localStorage.getItem("lw-accent") || "null");
  if (savedAccent) applyAccent(...savedAccent);

  document.querySelectorAll("[data-mode-btn]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.modeBtn === savedMode);
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      applyMode(btn.dataset.modeBtn);
      localStorage.setItem("lw-mode", btn.dataset.modeBtn);
      document.querySelectorAll("[data-mode-btn]").forEach(b => b.classList.toggle("active", b === btn));
      showToast(`${btn.dataset.modeBtn === "dark" ? "Dark" : "Light"} mode saved`, { type: "success", duration: 2200 });
    });
  });

  const r = document.querySelector("#rgb-r");
  const g = document.querySelector("#rgb-g");
  const b = document.querySelector("#rgb-b");
  const swatch = document.querySelector("#rgb-swatch");
  if (r && g && b) {
    const update = () => {
      const [h, s, l] = rgbToHsl(+r.value, +g.value, +b.value);
      applyAccent(h, s, l);
      if (swatch) swatch.style.background = `rgb(${r.value},${g.value},${b.value})`;
      localStorage.setItem("lw-accent", JSON.stringify([h, s, l]));
    };
    [r, g, b].forEach(input => {
      input.addEventListener("input", update);
      // Fires once when the drag/tap ends, so the confirmation doesn't spam mid-drag.
      input.addEventListener("change", () => showToast("Accent color saved", { type: "success", duration: 2200 }));
    });
  }
}
