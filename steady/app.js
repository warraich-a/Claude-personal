"use strict";
/* Steady — hold the phone still and particles settle into a message; shake for the next one.
   Sensors: DeviceMotion (tilt + stillness + shake), Vibration (a tap on reveal), Screen Wake Lock.
   Without a motion sensor (desktop), the pointer stands in: move it to tilt, stop moving to settle,
   double-click or press Space for the next message. */

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

// ---------- tuning ----------
const T = {
  jitterFloor: 0.06,   // m/s² of change per sample that still counts as "still"
  jitterRange: 0.9,    // above floor + range, stillness is 0
  shakeDelta: 16,      // m/s² jump in one sample that counts as a shake spike
  shakeWindow: 600,    // two spikes within this many ms = a shake
  revealAt: 0.9,       // stillness needed to count as settled
  revealHold: 900,     // ms of settled before the message "lands"
  loseAt: 0.45,        // below this the message is lost again
};

// ---------- state ----------
const $ = (id) => document.getElementById(id);
const canvas = $("stage"), ctx = canvas.getContext("2d", { alpha: false });
let W = 0, H = 0, DPR = 1, dot = 2;
let particles = [];
let messages = loadMessages();
let msgIndex = Math.floor(Math.random() * messages.length);
let gravity = { x: 0, y: 0.4 };   // screen-space, roughly in g
let jitter = 1;                   // EMA of per-sample acceleration change
let stillness = 0;                // smoothed 0..1
let settledSince = 0, revealed = false;
let lastSpike = 0, lastShake = 0;
let prevA = null, signFix = 1, signKnown = false;
let usingPointer = false, lastMotionAt = 0;
let running = false, wakeLock = null;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : null;
    if (Array.isArray(list) && list.length) return list;
  } catch (_) { /* storage blocked: use defaults */ }
  return DEFAULT_MESSAGES.slice();
}
function saveMessages(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (_) { /* not persisted */ }
}
function splitMessage(line) {
  const i = line.lastIndexOf("--");
  return i > 0 ? { text: line.slice(0, i).trim(), author: line.slice(i + 2).trim() } : { text: line.trim(), author: "" };
}

// ---------- layout: rasterise text into target points ----------
function wrapLines(text, size, maxW) {
  ctx.font = `700 ${size}px ${getComputedStyle(document.documentElement).getPropertyValue("--serif")}`;
  const words = text.split(/\s+/), lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function buildTargets(text) {
  const maxW = W * 0.86, maxH = H * 0.52;
  let size = Math.min(W, H) * 0.17, lines;
  for (;;) {
    lines = wrapLines(text, size, maxW);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if ((lines.length * size * 1.18 <= maxH && widest <= maxW) || size < 14) break;
    size *= 0.92;
  }
  const off = document.createElement("canvas");
  off.width = Math.ceil(W); off.height = Math.ceil(H);
  const o = off.getContext("2d");
  o.font = ctx.font; o.fillStyle = "#fff"; o.textAlign = "center"; o.textBaseline = "middle";
  const lh = size * 1.18, top = H * 0.44 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => o.fillText(l, W / 2, top + i * lh));
  const data = o.getImageData(0, 0, off.width, off.height).data;
  const step = Math.max(2, Math.round(size / 20));
  dot = Math.max(1.6, step * 0.68);
  const pts = [];
  for (let y = 0; y < off.height; y += step)
    for (let x = 0; x < off.width; x += step)
      if (data[(y * off.width + x) * 4 + 3] > 128) pts.push({ x, y });
  return pts;
}

function assignMessage(index) {
  const { text, author } = splitMessage(messages[index]);
  const pts = buildTargets(text);
  // shuffle so particles fly in from everywhere, not row by row
  for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
  const want = Math.min(Math.max(pts.length, 300), Math.round((W * H) / 60), 6000);
  while (particles.length < want) particles.push(spawn());
  particles.length = want;
  particles.forEach((p, i) => { const t = pts[i % pts.length]; p.tx = t.x; p.ty = t.y; p.dust = i >= pts.length; });
  $("author").textContent = author;
  $("sr-message").textContent = "";
  revealed = false; hideCaption();
}
function spawn() {
  return { x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, tx: 0, ty: 0, dust: false, s: Math.random() };
}

// ---------- sensors ----------
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  lastMotionAt = performance.now();
  if (usingPointer) usingPointer = false;
  // iOS and Android historically report opposite signs. Calibrate from the first reading:
  // whichever axis gravity dominates (y when held upright, z when flat face-up) should be positive.
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
  // device frame (x right, y down on screen) -> rotate into current screen orientation
  const dx = -ax / 9.81, dy = ay / 9.81;
  const ang = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
  gravity.x = dx * Math.cos(ang) + dy * Math.sin(ang);
  gravity.y = -dx * Math.sin(ang) + dy * Math.cos(ang);
}
function registerSpike() {
  const now = performance.now();
  if (now - lastSpike < T.shakeWindow && now - lastShake > 1200) { lastShake = now; next(); }
  lastSpike = now;
}

// pointer fallback
let ptr = null;
function onPointer(e) {
  if (performance.now() - lastMotionAt < 1500) return; // real sensor present
  usingPointer = true;
  const nx = (e.clientX / W) * 2 - 1, ny = (e.clientY / H) * 2 - 1;
  if (ptr) jitter = jitter * 0.7 + Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) * 0.08;
  ptr = { x: e.clientX, y: e.clientY };
  gravity.x = nx; gravity.y = ny;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch (_) { /* refused (battery saver, unsupported): the app still works */ }
}
document.addEventListener("visibilitychange", () => { if (running && document.visibilityState === "visible" && !wakeLock) requestWakeLock(); });

async function start() {
  // iOS 13+ requires asking from a tap
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== "granted") $("hint").textContent = "Motion access was refused. Move your finger instead.";
    } catch (_) { /* not from a gesture or not supported */ }
  }
  window.addEventListener("devicemotion", onMotion);
  window.addEventListener("pointermove", onPointer);
  requestWakeLock();
  $("intro").hidden = true; $("hud").hidden = false;
  running = true;
  // If no motion sensor speaks within 1.5 s, explain the pointer mode.
  setTimeout(() => { if (!lastMotionAt) { usingPointer = true; $("hint").dataset.mode = "pointer"; } }, 1500);
}

// ---------- flow ----------
function next() {
  msgIndex = (msgIndex + 1) % messages.length;
  for (const p of particles) { // scatter
    const a = Math.random() * Math.PI * 2, f = 6 + Math.random() * 14;
    p.vx += Math.cos(a) * f; p.vy += Math.sin(a) * f;
  }
  jitter = 1.2; stillness = 0;
  assignMessage(msgIndex);
  if (navigator.vibrate) navigator.vibrate(20);
}
function showCaption() {
  if ($("author").textContent) $("caption").hidden = false;
  $("sr-message").textContent = splitMessage(messages[msgIndex]).text;
}
function hideCaption() { $("caption").hidden = true; }

// ---------- frame ----------
const COOL = [124, 147, 176], GOLD = [240, 207, 142];
function mix(a, b, t) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`; }

function frame(now) {
  requestAnimationFrame(frame);
  // pointer jitter decays when the pointer stops (no events fire while still)
  if (usingPointer) jitter *= 0.94;
  const raw = Math.max(0, Math.min(1, 1 - (jitter - T.jitterFloor) / T.jitterRange));
  stillness += (raw - stillness) * (raw > stillness ? 0.035 : 0.25);

  if (running) {
    if (stillness > T.revealAt) {
      if (!settledSince) settledSince = now;
      if (!revealed && now - settledSince > T.revealHold) {
        revealed = true; showCaption();
        if (navigator.vibrate) navigator.vibrate([12, 60, 12]);
      }
    } else settledSince = 0;
    if (revealed && stillness < T.loseAt) { revealed = false; hideCaption(); }
    $("meter-fill").style.width = (stillness * 100).toFixed(1) + "%";
    const pointer = $("hint").dataset.mode === "pointer";
    $("hint").textContent = revealed ? (pointer ? "Double-click for another" : "Shake for another")
      : stillness > 0.6 ? "Almost…" : stillness > 0.25 ? "Steadier…" : (pointer ? "Move the mouse, then stop" : "Hold still");
  }

  const s = running ? stillness : 0.15;
  const pull = s * s * s;                 // attraction grows sharply only near real stillness
  const g = (1 - pull) * 0.55;            // tilt matters less as the message forms
  const damp = 0.9 - pull * 0.12;
  const gx = gravity.x * g, gy = gravity.y * g;

  ctx.fillStyle = "rgba(11,15,20,0.32)";  // trails
  ctx.fillRect(0, 0, W, H);

  const size = dot;
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
    if (!p.dust) ctx.rect(p.x, p.y, size, size);
  }
  ctx.fill();
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  for (const p of particles) if (p.dust) ctx.rect(p.x, p.y, size, size);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = "#0B0F14"; ctx.fillRect(0, 0, W, H);
  assignMessage(msgIndex);
}

// ---------- editor ----------
function openEditor() { $("editor-text").value = messages.join("\n"); $("editor").hidden = false; $("editor-text").focus(); }
function closeEditor() { $("editor").hidden = true; }
$("btn-edit").addEventListener("click", openEditor);
$("btn-cancel").addEventListener("click", closeEditor);
$("btn-reset").addEventListener("click", () => { $("editor-text").value = DEFAULT_MESSAGES.join("\n"); });
$("btn-save").addEventListener("click", () => {
  const list = $("editor-text").value.split("\n").map((l) => l.trim()).filter(Boolean);
  messages = list.length ? list : DEFAULT_MESSAGES.slice();
  saveMessages(messages);
  msgIndex = 0; assignMessage(0); closeEditor();
});
$("btn-next").addEventListener("click", next);
$("btn-start").addEventListener("click", start);
canvas.addEventListener("dblclick", next);
window.addEventListener("keydown", (e) => { if (e.code === "Space" && $("editor").hidden && running) { e.preventDefault(); next(); } });
window.addEventListener("resize", resize);

resize();
requestAnimationFrame(frame);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
