// A quiet, full-viewport starfield + drifting nebula glow behind every page.
// Pure canvas, no assets, respects prefers-reduced-motion, and dims itself
// automatically in light mode (see the [data-mode="light"] rule in styles.css).

let started = false;

export function initStarfield() {
  if (started) return;
  started = true;

  const canvas = document.createElement("canvas");
  canvas.id = "starfield-canvas";
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w, h, dpr;
  let stars = [];
  let nebulae = [];

  function accentHsl(alpha) {
    const cs = getComputedStyle(document.documentElement);
    const h = cs.getPropertyValue("--gold-h").trim() || "265";
    const s = cs.getPropertyValue("--gold-s").trim() || "90%";
    return `hsl(${h} ${s} 60% / ${alpha})`;
  }
  function tealHsl(alpha) {
    const cs = getComputedStyle(document.documentElement);
    const h = cs.getPropertyValue("--teal-h").trim() || "189";
    const s = cs.getPropertyValue("--teal-s").trim() || "80%";
    return `hsl(${h} ${s} 55% / ${alpha})`;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.min(180, Math.round((w * h) / 9000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.3 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.8,
      drift: (Math.random() - 0.5) * 0.06
    }));

    nebulae = [
      { x: w * 0.18, y: h * 0.22, r: Math.max(w, h) * 0.32, colorFn: accentHsl, t: 0, sp: 0.00018 },
      { x: w * 0.82, y: h * 0.75, r: Math.max(w, h) * 0.28, colorFn: tealHsl, t: 2, sp: 0.00014 },
      { x: w * 0.7, y: h * 0.15, r: Math.max(w, h) * 0.22, colorFn: accentHsl, t: 4, sp: 0.0002 }
    ];
  }

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    nebulae.forEach(n => paintNebula(n, 0.16));
    stars.forEach(s => {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#fff3d6";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function paintNebula(n, boost) {
    n.t += n.sp;
    const x = n.x + Math.sin(n.t * 6) * n.r * 0.15;
    const y = n.y + Math.cos(n.t * 5) * n.r * 0.15;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, n.r);
    grad.addColorStop(0, n.colorFn(0.22 + boost));
    grad.addColorStop(0.5, n.colorFn(0.08 + boost * 0.4));
    grad.addColorStop(1, n.colorFn(0));
    ctx.fillStyle = grad;
    ctx.fillRect(x - n.r, y - n.r, n.r * 2, n.r * 2);
  }

  let raf;
  function frame(t) {
    ctx.clearRect(0, 0, w, h);
    nebulae.forEach(n => paintNebula(n, 0));
    stars.forEach(s => {
      s.x += s.drift;
      if (s.x < 0) s.x = w; if (s.x > w) s.x = 0;
      const twinkle = 0.35 + Math.abs(Math.sin(t * 0.001 * s.speed + s.phase)) * 0.65;
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = "#fff3d6";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener("resize", () => {
    resize();
    if (reduceMotion) drawStatic();
  });

  resize();
  if (reduceMotion) {
    drawStatic();
  } else {
    raf = requestAnimationFrame(frame);
  }
}
