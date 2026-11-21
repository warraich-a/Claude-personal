"use strict";
/* Steady — hold the phone still and particles settle into a message; shake for the next one.
   Two modes:
   - English: short messages the owner can edit on the phone.
   - Punjabi: lines from punjabi.json. The line forms in one script (Shahmukhi or Gurmukhi), and while
     the phone stays still the same dots flow into the other script and back, with a romanised
     reading and English meaning underneath.
   Sensors: DeviceMotion (tilt, stillness, shake), Vibration, Screen Wake Lock.
   Without a motion sensor (desktop), the pointer stands in: move to tilt, stop to settle,
   double-click or Space for the next message. */

const DEFAULT_MESSAGES = [
  "Be still. The answer is already here.",
  "You are not behind.",
  "Waste no more time arguing what a good person should be. Be one. -- Marcus Aurelius",
  "We suffer more often in imagination than in reality. -- Seneca",
  "Start where you are. Use what you have. Do what you can. -- Arthur Ashe",
  "Small steps, every day.",
  "Somebody is proud of you.",
  "The obstacle is the way. -- after Marcus Aurelius",
  "Breathe. This moment is enough.",
  "You have survived every hard day so far.",
];
const STORE_KEY = "steady.messages.v1";
const MODE_KEY = "steady.mode.v1";

const SCRIPTS = {
  sm: { label: "Shahmukhi · شاہ مکھی", font: '"Noto Nastaliq Urdu"', rtl: true, lineH: 2.0, scale: 0.8 },
  gm: { label: "Gurmukhi · ਗੁਰਮੁਖੀ", font: '"Noto Sans Gurmukhi"', rtl: false, lineH: 1.45, scale: 1 },
};

// ---------- tuning ----------
const T = {
  jitterFloor: 0.06,   // m/s² of change per sample that still counts as "still"
  jitterRange: 0.9,    // above floor + range, stillness is 0
  shakeDelta: 16,      // m/s² jump in one sample that counts as a shake spike
  shakeWindow: 600,    // two spikes within this many ms = a shake
  revealAt: 0.9,       // stillness needed to count as settled
  revealHold: 900,     // ms of settled before the message "lands"
  loseAt: 0.45,        // below this the message is lost again
  swapEvery: 4500,     // Punjabi mode: ms between script changes while still
};

// ---------- state ----------
const $ = (id) => document.getElementById(id);
const canvas = $("stage"), ctx = canvas.getContext("2d", { alpha: false });
let W = 0, H = 0, DPR = 1, dot = 2;
let particles = [];
let mode = loadMode();
let messages = loadMessages();
let lines = [];                    // Punjabi lines, loaded from punjabi.json
let index = 0;
let script = "sm", firstScript = "sm", lastSwap = 0;
let gravity = { x: 0, y: 0.4 };
let jitter = 1, stillness = 0;
let settledSince = 0, revealed = false;
let lastSpike = 0, lastShake = 0;
let prevA = null, signFix = 1, signKnown = false;
let usingPointer = false, lastMotionAt = 0;
let running = false, wakeLock = null;
let paVoice = null;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function loadMode() { try { return localStorage.getItem(MODE_KEY) === "pa" ? "pa" : "en"; } catch (_) { return "en"; } }
function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (_) { /* not persisted */ } }
function loadMessages() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (Array.isArray(list) && list.length) return list;
  } catch (_) { /* storage blocked: use defaults */ }
  return DEFAULT_MESSAGES.slice();
}
function saveMessages(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (_) { /* not persisted */ } }
function splitMessage(line) {
  const i = line.lastIndexOf("--");
  return i > 0 ? { text: line.slice(0, i).trim(), author: line.slice(i + 2).trim() } : { text: line.trim(), author: "" };
}
function count() { return mode === "pa" ? lines.length : messages.length; }

// ---------- Punjabi data and fonts ----------
let fontsReady = null;
function loadPunjabi() {
  const data = fetch("punjabi.json").then((r) => r.json()).then((j) => { lines = (j.lines || []).filter((l) => l.shahmukhi && l.gurmukhi); });
  fontsReady = Promise.all([
    document.fonts.load(`700 40px ${SCRIPTS.sm.font}`, "بلھیا"),
    document.fonts.load(`700 40px ${SCRIPTS.gm.font}`, "ਪੰਜਾਬੀ"),
  ]).catch(() => {});
  return Promise.all([data, fontsReady]);
}
function findVoice() {
  if (!("speechSynthesis" in window)) return;
  const pick = () => { paVoice = speechSynthesis.getVoices().find((v) => /^pa(-|_|$)/i.test(v.lang)) || null; updateCard(); };
  pick();
  speechSynthesis.addEventListener?.("voiceschanged", pick);
}

// ---------- layout: rasterise text into target points ----------
function fontFor(size) {
  if (mode === "pa") return `700 ${size}px ${SCRIPTS[script].font}, serif`;
  return `700 ${size}px ${getComputedStyle(document.documentElement).getPropertyValue("--serif")}`;
}
function wrapLines(text, size, maxW) {
  ctx.font = fontFor(size);
  const words = text.split(/\s+/), out = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
function buildTargets(text) {
  const pa = mode === "pa", sc = SCRIPTS[script];
  const lineH = pa ? sc.lineH : 1.18;
  const maxW = W * 0.86, maxH = H * (pa ? 0.44 : 0.52), centre = H * (pa ? 0.36 : 0.44);
  let size = Math.min(W, H) * 0.17 * (pa ? sc.scale : 1), wrapped;
  for (;;) {
    wrapped = wrapLines(text, size, maxW);
    const widest = Math.max(...wrapped.map((l) => ctx.measureText(l).width));
    if ((wrapped.length * size * lineH <= maxH && widest <= maxW) || size < 14) break;
    size *= 0.92;
  }
  const off = document.createElement("canvas");
  off.width = Math.ceil(W); off.height = Math.ceil(H);
  const o = off.getContext("2d");
  o.font = ctx.font; o.fillStyle = "#fff"; o.textAlign = "center"; o.textBaseline = "middle";
  o.direction = pa && sc.rtl ? "rtl" : "ltr";
  const lh = size * lineH, top = centre - ((wrapped.length - 1) * lh) / 2;
  wrapped.forEach((l, i) => o.fillText(l, W / 2, top + i * lh));
  const data = o.getImageData(0, 0, off.width, off.height).data;
  // Nastaliq strokes are thin, so sample it more finely
  const step = Math.max(2, Math.round(size / (pa && sc.rtl ? 26 : 20)));
  dot = Math.max(1.6, step * 0.68);
  const pts = [];
  for (let y = 0; y < off.height; y += step)
    for (let x = 0; x < off.width; x += step)
      if (data[(y * off.width + x) * 4 + 3] > 128) pts.push({ x, y });
  return pts;
}

function currentText() {
  if (mode === "pa") { const l = lines[index]; return l ? l[script === "sm" ? "shahmukhi" : "gurmukhi"] : "…"; }
  return splitMessage(messages[index] || "").text;
}

/* Point every particle at the current text. Particles keep their positions, so calling this
   while a message is showing makes the dots flow from one shape to the next. */
function retarget() {
  const pts = buildTargets(currentText());
  for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
  if (!pts.length) pts.push({ x: W / 2, y: H / 2 });
  const want = Math.min(Math.max(pts.length, 300), Math.round((W * H) / 60), 6000);
  while (particles.length < want) particles.push(spawn());
  particles.length = want;
  particles.forEach((p, i) => { const t = pts[i % pts.length]; p.tx = t.x; p.ty = t.y; p.dust = i >= pts.length; });
  $("script-tag").textContent = mode === "pa" ? SCRIPTS[script].label : "";
}
function showItem(i) {
  index = i;
  if (mode === "pa") { firstScript = index % 2 ? "gm" : "sm"; script = firstScript; } // alternate which script leads
  retarget();
  revealed = false; hideCard(); updateCard();
  $("sr-message").textContent = "";
}
function spawn() { return { x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, tx: 0, ty: 0, dust: false }; }

// ---------- reading card ----------
function updateCard() {
  const pa = mode === "pa";
  const l = pa ? lines[index] : null;
  const m = !pa ? splitMessage(messages[index] || "") : null;
  $("card-roman").textContent = pa && l ? l.roman : "";
  $("card-roman").hidden = !pa;
  $("card-english").textContent = pa && l ? l.english : "";
  $("card-english").hidden = !pa;
  $("card-poet").textContent = pa ? (l ? l.poet : "") : m.author;
  $("card-note").textContent = pa && l ? (l.note || "") : "";
  $("card-note").hidden = !(pa && l && l.note);
  $("card-unchecked").hidden = !(pa && l && !l.checked);
  $("btn-listen").hidden = !(pa && paVoice);
}
function showCard() {
  const pa = mode === "pa";
  if (pa || $("card-poet").textContent) $("card").hidden = false;
  $("sr-message").textContent = pa && lines[index]
    ? `${lines[index].roman}. ${lines[index].english} ${lines[index].poet}.`
    : splitMessage(messages[index] || "").text;
}
function hideCard() { $("card").hidden = true; }

// ---------- sensors ----------
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  lastMotionAt = performance.now();
  usingPointer = false;
  // iOS and Android have historically reported opposite signs. Calibrate from the first clear reading:
  // whichever axis gravity dominates (y when held upright, z when flat face-up) should read positive.
  if (!signKnown) {
    const dom = Math.abs(a.y) > Math.abs(a.z) ? a.y : a.z;
    if (Math.abs(dom) > 4) { signFix = dom < 0 ? -1 : 1; signKnown = true; }
  }
  const ax = a.x * signFix, ay = a.y * signFix, az = a.z * signFix;
  if (prevA) {
    const d = Math.hypot(ax - prevA.x, ay - prevA.y, az - prevA.z);
    jitter = jitter * 0.88 + d * 0.12;
    if (d > T.shakeDelta) registerSpike();
  }
  prevA = { x: ax, y: ay, z: az };
  const dx = -ax / 9.81, dy = ay / 9.81;
  const ang = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
  gravity.x = dx * Math.cos(ang) + dy * Math.sin(ang);
  gravity.y = -dx * Math.sin(ang) + dy * Math.cos(ang);
}
function registerSpike() {
  if (typeof reelActive !== "undefined" && reelActive) return;
  const now = performance.now();
  if (now - lastSpike < T.shakeWindow && now - lastShake > 1200) { lastShake = now; next(); }
  lastSpike = now;
}
let ptr = null;
function onPointer(e) {
  if (performance.now() - lastMotionAt < 1500) return;
  usingPointer = true;
  if (ptr) jitter = jitter * 0.7 + Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) * 0.08;
  ptr = { x: e.clientX, y: e.clientY };
  gravity.x = (e.clientX / W) * 2 - 1; gravity.y = (e.clientY / H) * 2 - 1;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch (_) { /* refused or unsupported: the app still works */ }
}
document.addEventListener("visibilitychange", () => { if (running && document.visibilityState === "visible" && !wakeLock) requestWakeLock(); });

async function start(chosen) {
  // iOS 13+ only grants motion access from a tap, so ask before anything is awaited
  let perm = null;
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    perm = DeviceMotionEvent.requestPermission().catch(() => "error");
  }
  mode = chosen; saveMode(mode);
  $("btn-edit").hidden = mode === "pa";
  $("btn-reel").hidden = mode !== "pa";
  if (mode === "pa") {
    $("intro-note").textContent = "Loading Punjabi fonts…";
    await loadPunjabi().catch(() => {});
    if (!lines.length) { $("intro-note").textContent = "Couldn't load the Punjabi lines. Check your connection and try again."; mode = "en"; return; }
    findVoice();
  }
  if (perm && (await perm) !== "granted") $("hint").dataset.denied = "1";
  window.addEventListener("devicemotion", onMotion);
  window.addEventListener("pointermove", onPointer);
  requestWakeLock();
  $("intro").hidden = true; $("hud").hidden = false;
  running = true;
  showItem(Math.floor(Math.random() * count()));
  setTimeout(() => { if (!lastMotionAt) { usingPointer = true; $("hint").dataset.mode = "pointer"; } }, 1500);
}

// ---------- flow ----------
function next() {
  if (!count()) return;
  for (const p of particles) {
    const a = Math.random() * Math.PI * 2, f = 6 + Math.random() * 14;
    p.vx += Math.cos(a) * f; p.vy += Math.sin(a) * f;
  }
  jitter = 1.2; stillness = 0;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  showItem((index + 1) % count());
  if (navigator.vibrate) navigator.vibrate(20);
}
function swapScript() {
  script = script === "sm" ? "gm" : "sm";
  retarget();
}

// ---------- frame ----------
const COOL = [124, 147, 176], GOLD = [240, 207, 142];
function mix(a, b, t) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`; }

function frame(now) {
  requestAnimationFrame(frame);
  if (typeof reelActive !== "undefined" && reelActive) return; // the reel maker has the screen
  if (usingPointer) jitter *= 0.94;
  const raw = Math.max(0, Math.min(1, 1 - (jitter - T.jitterFloor) / T.jitterRange));
  stillness += (raw - stillness) * (raw > stillness ? 0.035 : 0.25);

  if (running) {
    if (stillness > T.revealAt) {
      if (!settledSince) settledSince = now;
      if (!revealed && now - settledSince > T.revealHold) {
        revealed = true; lastSwap = now; showCard();
        if (navigator.vibrate) navigator.vibrate([12, 60, 12]);
      }
    } else settledSince = 0;
    if (revealed && stillness < T.loseAt) {
      revealed = false; hideCard();
      if (mode === "pa" && script !== firstScript) { script = firstScript; retarget(); }
    }
    if (revealed && mode === "pa" && now - lastSwap > T.swapEvery) { lastSwap = now; swapScript(); }
    $("meter-fill").style.width = (stillness * 100).toFixed(1) + "%";
    const pointer = $("hint").dataset.mode === "pointer";
    $("hint").textContent = revealed ? (pointer ? "Double-click for another" : "Shake for another")
      : stillness > 0.6 ? "Almost…" : stillness > 0.25 ? "Steadier…"
      : pointer ? "Move the mouse, then stop"
      : $("hint").dataset.denied ? "Motion access is off. Tap Next to change lines." : "Hold still";
  }

  const s = running ? stillness : 0.15;
  const pull = s * s * s;
  const g = (1 - pull) * 0.55;
  const damp = 0.9 - pull * 0.12;
  const gx = gravity.x * g, gy = gravity.y * g;

  ctx.fillStyle = "rgba(11,15,20,0.32)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = mix(COOL, GOLD, s);
  ctx.beginPath();
  for (const p of particles) {
    if (p.dust) { p.vx += gx * 0.6 + (Math.random() - 0.5) * 0.08; p.vy += gy * 0.6 + (Math.random() - 0.5) * 0.08; }
    else {
      p.vx += gx + (p.tx - p.x) * 0.012 * pull;
      p.vy += gy + (p.ty - p.y) * 0.012 * pull;
      if (!reduceMotion) { p.vx += (Math.random() - 0.5) * 0.15 * (1 - s); p.vy += (Math.random() - 0.5) * 0.15 * (1 - s); }
    }
    p.vx *= damp; p.vy *= damp;
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) { p.x = 0; p.vx *= -0.5; } else if (p.x > W) { p.x = W; p.vx *= -0.5; }
    if (p.y < 0) { p.y = 0; p.vy *= -0.5; } else if (p.y > H) { p.y = H; p.vy *= -0.5; }
    if (!p.dust) ctx.rect(p.x, p.y, dot, dot);
  }
  ctx.fill();
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  for (const p of particles) if (p.dust) ctx.rect(p.x, p.y, dot, dot);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = "#0B0F14"; ctx.fillRect(0, 0, W, H);
  retarget();
}

// ---------- controls ----------
function openEditor() { $("editor-text").value = messages.join("\n"); $("editor").hidden = false; $("editor-text").focus(); }
function closeEditor() { $("editor").hidden = true; }
$("btn-edit").addEventListener("click", openEditor);
$("btn-cancel").addEventListener("click", closeEditor);
$("btn-reset").addEventListener("click", () => { $("editor-text").value = DEFAULT_MESSAGES.join("\n"); });
$("btn-save").addEventListener("click", () => {
  const list = $("editor-text").value.split("\n").map((l) => l.trim()).filter(Boolean);
  messages = list.length ? list : DEFAULT_MESSAGES.slice();
  saveMessages(messages);
  showItem(0); closeEditor();
});
$("btn-next").addEventListener("click", next);
$("btn-start-pa").addEventListener("click", () => start("pa"));
$("btn-start-en").addEventListener("click", () => start("en"));
$("btn-mode").addEventListener("click", () => {
  running = false; hideCard();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("hud").hidden = true; $("intro").hidden = false;
  $("intro-note").textContent = "Uses the motion sensor and keeps the screen awake while open. Nothing is recorded or sent anywhere.";
});
$("btn-listen").addEventListener("click", () => {
  const l = lines[index];
  if (!l || !paVoice) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(l.gurmukhi);
  u.voice = paVoice; u.lang = paVoice.lang; u.rate = 0.85;
  speechSynthesis.speak(u);
});
canvas.addEventListener("dblclick", next);
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && $("editor").hidden && running) { e.preventDefault(); next(); }
});
window.addEventListener("resize", resize);

// Lead with the mode used last time.
if (mode === "pa") $("btn-start-pa").classList.add("primary"), $("btn-start-en").classList.remove("primary");
resize();
requestAnimationFrame(frame);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
