"use strict";
/* Reel Studio — turns a Punjabi saying into a 9:16 reel.
   A saying has one or more parts (lines). Each part is shown in Shahmukhi, Gurmukhi, romanised
   and English while it is spoken, then the next part follows. The reel runs as long as the audio.
   Sound: an uploaded recording (timed by tapping as each line starts), the microphone live
   (tap "next line" while speaking), or none (timed automatically).
   Backgrounds: generated phulkari, generated mustard field at dusk, or the user's own photo/video. */

const RW = 1080, RH = 1920, FPS = 30, END_CARD = 3.4;
const $ = (id) => document.getElementById(id);
const KEYS = { handle: "reels.handle.v1", bg: "reels.bg.v1", mine: "reels.mine.v1", sound: "reels.sound.v1" };

const F = {
  sm: '"Noto Nastaliq Urdu", serif',
  gm: '"Anek Gurmukhi", "Noto Sans Gurmukhi", sans-serif',
  roman: '"Cormorant Garamond", Georgia, serif',
  body: '"Mukta", system-ui, sans-serif',
};
const C = { cream: "#FFF3DE", gold: "#FFC94A", muted: "rgba(255,243,222,0.62)", ink: "#140A0A" };

let library = [];               // { id, mine, poet, note, checked, parts: [{shahmukhi, gurmukhi, roman, english}] }
const state = { id: null, bg: "phulkari", sound: "upload", handle: "" };
let userMedia = null;           // background image or video chosen by the user
let audioEl = null;             // uploaded recording
let audioGraph = null;          // Web Audio routing for the recording, built once
let marks = null;               // tapped start times for the current saying + recording
let layouts = [];               // laid-out text for each part
let preview = null;             // { clock, tl } while previewing
let recording = false;

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* not kept */ } },
};
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const words = (s) => s.trim().split(/\s+/).filter(Boolean);
const current = () => library.find((s) => s.id === state.id);

// ---------- data ----------
function normalise(raw, id, mine) {
  const parts = Array.isArray(raw.parts) ? raw.parts
    : [{ shahmukhi: raw.shahmukhi, gurmukhi: raw.gurmukhi, roman: raw.roman, english: raw.english }];
  return { id, mine, poet: raw.poet || "", note: raw.note || "", checked: !!raw.checked,
    parts: parts.filter((p) => p && p.shahmukhi && p.gurmukhi).map((p) => ({ shahmukhi: p.shahmukhi, gurmukhi: p.gurmukhi, roman: p.roman || "", english: p.english || "" })) };
}
function loadMine() { try { return JSON.parse(store.get(KEYS.mine, "[]")) || []; } catch (_) { return []; } }
function saveMine(list) { store.set(KEYS.mine, JSON.stringify(list)); }

// ---------- text layout ----------
function layout(c, text, font, weight, box, opts) {
  const ws = words(text);
  let size = opts.size;
  for (;;) {
    c.font = `${weight} ${size}px ${font}`;
    const space = c.measureText(" ").width * (opts.spaceMul || 1);
    const widths = ws.map((w) => c.measureText(w).width);
    const rows = [[]]; let rowW = 0;
    widths.forEach((w, i) => {
      const add = rows[rows.length - 1].length ? space + w : w;
      if (rowW + add > box.w && rows[rows.length - 1].length) { rows.push([i]); rowW = w; }
      else { rows[rows.length - 1].push(i); rowW += add; }
    });
    const lh = size * opts.lineH;
    const orphan = rows.length > 1 && rows[rows.length - 1].length === 1 && size > opts.size * 0.8;
    if ((rows.length * lh <= box.h && !orphan) || size <= opts.min) {
      const out = new Array(ws.length);
      const top = box.y + (box.h - rows.length * lh) / 2 + lh / 2;
      rows.forEach((row, r) => {
        const total = row.reduce((s, i) => s + widths[i], 0) + space * (row.length - 1);
        const y = top + r * lh;
        if (opts.rtl) {
          let x = box.x + box.w / 2 + total / 2;
          for (const i of row) { x -= widths[i]; out[i] = { t: ws[i], x, y }; x -= space; }
        } else {
          let x = box.x + box.w / 2 - total / 2;
          for (const i of row) { out[i] = { t: ws[i], x, y }; x += widths[i] + space; }
        }
      });
      return { words: out, size, font: `${weight} ${size}px ${font}`, rtl: !!opts.rtl };
    }
    size *= 0.94;
  }
}
function layoutPart(c, p) {
  const X = 170, Wd = RW - 340; // inside the phulkari panel, clear of Instagram's right-hand buttons
  return {
    sm: layout(c, p.shahmukhi, F.sm, 700, { x: X, y: 432, w: Wd, h: 360 }, { size: 96, min: 36, lineH: 1.85, rtl: true, spaceMul: 2.2 }),
    gm: layout(c, p.gurmukhi, F.gm, 600, { x: X, y: 868, w: Wd, h: 300 }, { size: 92, min: 36, lineH: 1.35 }),
    ro: p.roman ? layout(c, p.roman, F.roman, "italic 600", { x: X, y: 1200, w: Wd, h: 180 }, { size: 64, min: 32, lineH: 1.25 }) : null,
    en: p.english,
  };
}

// ---------- timing ----------
function partSeconds(p) { return Math.min(12, Math.max(4, words(p.roman || p.gurmukhi).length * 0.55 + 2.4)); }
function autoTimeline(s) {
  const m = []; let t = 0.8;
  for (const p of s.parts) { m.push(t); t += partSeconds(p); }
  return { marks: m, end: t, total: t + END_CARD };
}
function timeline() {
  const s = current();
  if (state.sound === "upload" && audioEl && isFinite(audioEl.duration)) {
    const d = audioEl.duration, n = s.parts.length;
    const m = marks && marks.length === n ? marks : s.parts.map((_, i) => (i === 0 ? 0.3 : (d * i) / n));
    return { marks: m, end: d, total: d + END_CARD };
  }
  return autoTimeline(s);
}

// ---------- backgrounds ----------
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

const Phulkari = (() => {
  let cloth = null, motifs = null, done = null;
  const GOLD = ["#F2B636", "#E9A425", "#F6C95A"], ORANGE = "#E2701D", MAGENTA = "#C2185B", WHITE = "#F7EBD3";
  function init() {
    const r = rng(11);
    // khaddar: hand-woven cotton dyed madder red, with a visible weave
    cloth = document.createElement("canvas"); cloth.width = RW; cloth.height = RH;
    const k = cloth.getContext("2d");
    k.fillStyle = "#6B1515"; k.fillRect(0, 0, RW, RH);
    for (let i = 0; i < 26000; i++) {
      k.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,200,160,0.035)";
      const horiz = r() < 0.5;
      k.fillRect(r() * RW, r() * RH, horiz ? 6 + r() * 14 : 1.4, horiz ? 1.4 : 6 + r() * 14);
    }
    // bagh-style border: diamonds filled with long darning stitches
    motifs = [];
    const band = 150, s = 66;
    const place = (cx, cy, order) => motifs.push({ cx, cy, s, order, inner: r() < 0.5 ? ORANGE : MAGENTA, gold: GOLD[(r() * 3) | 0] });
    let o = 0;
    for (let x = s; x < RW - s / 2; x += s * 1.55) place(x, band / 2 + 8, o++);
    for (let y = band + s; y < RH - band - s / 2; y += s * 1.55) place(RW - band / 2 + 4, y, o++);
    for (let x = RW - s; x > s / 2; x -= s * 1.55) place(x, RH - band / 2 - 8, o++);
    for (let y = RH - band - s; y > band + s / 2; y -= s * 1.55) place(band / 2 - 4, y, o++);
    motifs.total = o;
  }
  function stitchDiamond(c, m, frac) {
    const rows = Math.floor((m.s * 2) / 5), shown = Math.floor(rows * frac);
    for (let i = 0; i < shown; i++) {
      const dy = -m.s + i * 5 + 2.5, half = m.s - Math.abs(dy), innerHalf = m.s * 0.42 - Math.abs(dy);
      c.strokeStyle = m.gold; c.lineWidth = 3.2;
      c.beginPath(); c.moveTo(m.cx - half, m.cy + dy); c.lineTo(m.cx + half, m.cy + dy); c.stroke();
      if (innerHalf > 0) { c.strokeStyle = m.inner; c.beginPath(); c.moveTo(m.cx - innerHalf, m.cy + dy); c.lineTo(m.cx + innerHalf, m.cy + dy); c.stroke(); }
    }
    if (frac >= 1) { c.fillStyle = WHITE; c.fillRect(m.cx - 3, m.cy - 3, 6, 6); }
  }
  function panel(c, a) {
    c.save(); c.globalAlpha = a;
    c.fillStyle = "rgba(28,6,8,0.86)"; roundRect(c, 130, 190, RW - 260, RH - 380, 28); c.fill();
    c.setLineDash([16, 11]); c.lineWidth = 3; c.strokeStyle = "rgba(242,182,54,0.75)";
    roundRect(c, 148, 208, RW - 296, RH - 416, 20); c.stroke();
    c.restore();
  }
  return {
    draw(c, t) {
      if (!cloth) init();
      if (done) { c.drawImage(done, 0, 0); return; }
      c.drawImage(cloth, 0, 0);
      let complete = true;
      for (const m of motifs) {
        const frac = Math.min(1, Math.max(0, (t - (m.order / motifs.total) * 1.6) / 0.5));
        if (frac < 1) complete = false;
        if (frac > 0) stitchDiamond(c, m, frac);
      }
      panel(c, ease(t / 0.8));
      if (complete && t > 1) { done = document.createElement("canvas"); done.width = RW; done.height = RH; done.getContext("2d").drawImage(c.canvas, 0, 0); }
    },
    reset() { done = null; },
  };
})();

const Sarson = (() => {
  let sky = null, flowers = null, trees = null;
  function init() {
    sky = document.createElement("canvas"); sky.width = RW; sky.height = RH;
    const k = sky.getContext("2d");
    const g = k.createLinearGradient(0, 0, 0, 1560);
    g.addColorStop(0, "#0E0B22"); g.addColorStop(0.45, "#2A1636"); g.addColorStop(0.78, "#7A3434"); g.addColorStop(0.93, "#D9772E"); g.addColorStop(1, "#F2B54A");
    k.fillStyle = g; k.fillRect(0, 0, RW, RH);
    const sun = k.createRadialGradient(760, 1520, 10, 760, 1520, 300);
    sun.addColorStop(0, "rgba(255,220,140,0.95)"); sun.addColorStop(0.25, "rgba(255,190,90,0.55)"); sun.addColorStop(1, "rgba(255,160,60,0)");
    k.fillStyle = sun; k.fillRect(0, 1100, RW, 600);
    const r = rng(5);
    for (let i = 0; i < 90; i++) { k.fillStyle = `rgba(255,240,220,${0.15 + r() * 0.5})`; k.fillRect(r() * RW, r() * 700, 2, 2); }
    trees = [];
    for (let x = -40; x < RW + 40; x += 30 + r() * 70) trees.push({ x, w: 40 + r() * 90, h: 20 + r() * 60 });
    flowers = [];
    for (let i = 0; i < 2600; i++) {
      const depth = Math.pow(r(), 1.7);
      flowers.push({ x: r() * RW, y: 1560 + depth * 360, d: depth, ph: r() * 6.28, c: r() < 0.75 ? "#F4CD2E" : "#E8B321" });
    }
    flowers.sort((a, b) => a.y - b.y);
  }
  return {
    draw(c, t) {
      if (!sky) init();
      c.drawImage(sky, 0, 0);
      c.fillStyle = "#1E1420";
      for (const tr of trees) { c.beginPath(); c.ellipse(tr.x, 1556, tr.w / 2, tr.h, 0, Math.PI, 0); c.fill(); }
      c.fillRect(0, 1552, RW, 10);
      const fg = c.createLinearGradient(0, 1556, 0, RH);
      fg.addColorStop(0, "#26361A"); fg.addColorStop(1, "#18240F");
      c.fillStyle = fg; c.fillRect(0, 1556, RW, RH - 1556);
      for (const f of flowers) {
        const sway = Math.sin(t * 1.3 + f.ph + f.x * 0.004) * (2 + f.d * 7), sz = 2 + f.d * 9;
        c.fillStyle = f.c;
        c.fillRect(f.x + sway, f.y, sz, sz * 0.8);
        if (f.d > 0.45) c.fillRect(f.x + sway + sz * 0.6, f.y - sz * 0.5, sz * 0.8, sz * 0.7);
      }
      const v = c.createLinearGradient(0, 200, 0, 1560);
      v.addColorStop(0, "rgba(8,6,18,0.15)"); v.addColorStop(0.75, "rgba(8,6,18,0.45)"); v.addColorStop(1, "rgba(8,6,18,0)");
      c.fillStyle = v; c.fillRect(0, 200, RW, 1360);
    },
    reset() {},
  };
})();

const Own = {
  draw(c) {
    c.fillStyle = C.ink; c.fillRect(0, 0, RW, RH);
    const m = userMedia, mw = m && (m.videoWidth || m.naturalWidth), mh = m && (m.videoHeight || m.naturalHeight);
    if (mw && mh) { const s = Math.max(RW / mw, RH / mh), w = mw * s, h = mh * s; c.drawImage(m, (RW - w) / 2, (RH - h) / 2, w, h); }
    c.fillStyle = "rgba(10,6,8,0.58)"; c.fillRect(0, 0, RW, RH);
  },
  reset() {},
};
const BACKGROUNDS = { phulkari: Phulkari, sarson: Sarson, own: Own };

// ---------- scene ----------
function drawWords(c, block, dt, alpha) {
  c.font = block.font; c.textBaseline = "middle"; c.textAlign = "left";
  c.direction = block.rtl ? "rtl" : "ltr";
  c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 14; c.fillStyle = C.cream;
  block.words.forEach((w, i) => {
    const a = ease((dt - i * 0.06) / 0.3) * alpha;
    if (a <= 0) return;
    c.globalAlpha = a;
    c.fillText(w.t, w.x, w.y + (1 - a) * 16); // textAlign "left" anchors the word's left edge, RTL too
  });
  c.shadowBlur = 0; c.globalAlpha = 1; c.direction = "ltr";
}
function label(c, text, y, a) {
  if (a <= 0) return;
  c.globalAlpha = a * 0.9; c.font = `600 30px ${F.body}`; c.fillStyle = C.muted;
  c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "ltr";
  c.fillText(text, RW / 2, y); c.globalAlpha = 1;
}
function wrapCentered(c, text, y, maxW, lh) {
  const out = []; let cur = "";
  for (const w of words(text)) { const t = cur ? cur + " " + w : w; if (c.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  out.forEach((l, i) => c.fillText(l, RW / 2, y + i * lh));
}
function drawPart(c, L, dt, alpha) {
  const step = (s) => alpha * ease((dt - s) / 0.4);
  label(c, "SHAHMUKHI  ·  read right to left  ←", 350, step(0));
  drawWords(c, L.sm, dt, alpha);
  label(c, "GURMUKHI  ·  read left to right  →", 830, step(0.25));
  drawWords(c, L.gm, dt - 0.25, alpha);
  if (L.ro) drawWords(c, L.ro, dt - 0.5, alpha);
  const ea = step(0.8);
  if (ea > 0 && L.en) {
    c.globalAlpha = ea; c.font = `400 44px ${F.body}`; c.fillStyle = C.cream;
    c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "ltr";
    wrapCentered(c, L.en, 1440, RW - 340, 58);
    c.globalAlpha = 1;
  }
}

function render(c, t, tl) {
  const s = current();
  BACKGROUNDS[state.bg].draw(c, t);
  const outro = ease((t - tl.end) / 0.5);

  // poet or source, always at the top
  c.globalAlpha = ease((t - 0.2) / 0.6) * (1 - outro);
  c.font = `italic 600 50px ${F.roman}`; c.fillStyle = C.gold;
  c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "ltr";
  if (s.poet) c.fillText(s.poet, RW / 2, 262);
  c.globalAlpha = 1;

  // the part being spoken, fading out just before the next one starts
  if (t < tl.end) {
    let i = -1;
    for (let k = 0; k < tl.marks.length; k++) if (t >= tl.marks[k]) i = k;
    if (i >= 0) {
      const next = i + 1 < tl.marks.length ? tl.marks[i + 1] : tl.end;
      const fadeOut = 1 - ease((t - (next - 0.3)) / 0.3);
      drawPart(c, layouts[i], t - tl.marks[i], fadeOut);
    }
  }

  // end card
  const ec = ease((t - tl.end - 0.2) / 0.7);
  if (ec > 0) {
    c.globalAlpha = ec; c.textAlign = "center"; c.direction = "ltr";
    c.font = `italic 600 80px ${F.roman}`; c.fillStyle = C.gold;
    c.fillText("One saying, two scripts", RW / 2, 820);
    c.font = `700 64px ${F.sm}`; c.fillStyle = C.cream; c.direction = "rtl";
    c.fillText("پنجابی", RW / 2 + 150, 960);
    c.direction = "ltr"; c.font = `600 62px ${F.gm}`;
    c.fillText("ਪੰਜਾਬੀ", RW / 2 - 150, 960);
    if (state.handle) { c.font = `600 46px ${F.body}`; c.fillStyle = C.muted; c.fillText(state.handle, RW / 2, 1110); }
    c.globalAlpha = 1;
  }
}

// ---------- stage ----------
const cv = $("stage"), ctx = cv.getContext("2d", { alpha: false });
cv.width = RW; cv.height = RH;

function rebuild() {
  const s = current();
  if (!s) return;
  layouts = s.parts.map((p) => layoutPart(ctx, p));
  Object.values(BACKGROUNDS).forEach((b) => b.reset());
  $("check-warn").hidden = s.checked;
  $("btn-edit").hidden = !s.mine;
  updateSoundUI();
}
function updateSoundUI() {
  const s = current(), tl = s ? timeline() : null;
  $("upload-box").hidden = state.sound !== "upload";
  $("live-note").hidden = state.sound !== "live";
  const timed = marks && s && marks.length === s.parts.length;
  $("timing-status").textContent = !audioEl ? "No recording chosen yet."
    : !isFinite(audioEl.duration) ? "Loading the recording…"
    : s.parts.length === 1 ? "One line: it shows for the whole recording."
    : timed ? `Timed: ${s.parts.length} lines.` : "Not timed yet. Lines are spread evenly until you tap the timing.";
  $("btn-timing").hidden = !audioEl || !s || s.parts.length < 2;
  $("length").textContent = tl ? `${Math.round(tl.total)} s` : "";
}

function audioClock() {
  let endedAt = null;
  return {
    start() { audioEl.currentTime = 0; endedAt = null; audioEl.onended = () => { endedAt = performance.now(); }; return audioEl.play(); },
    now() { return endedAt ? audioEl.duration + (performance.now() - endedAt) / 1000 : audioEl.currentTime; },
    stop() { audioEl.pause(); audioEl.onended = null; },
  };
}
function wallClock() {
  let t0 = 0;
  return { start() { t0 = performance.now(); return Promise.resolve(); }, now() { return (performance.now() - t0) / 1000; }, stop() {} };
}

function loop() {
  requestAnimationFrame(loop);
  if (recording || !current()) return;
  if (preview) {
    const t = preview.clock.now();
    if (t > preview.tl.total) stopPreview(); else { render(ctx, t, preview.tl); return; }
  }
  const tl = timeline();
  render(ctx, (tl.marks[0] || 0) + 2.2, tl); // idle: show the first line in full
}
function stopPreview() {
  if (preview) preview.clock.stop();
  preview = null;
  $("btn-preview").textContent = "Play preview";
}
$("btn-preview").addEventListener("click", async () => {
  if (preview) { stopPreview(); return; }
  if (state.sound === "upload" && !audioEl) { $("status").textContent = "Choose a recording first, or pick No sound."; return; }
  $("status").textContent = "";
  const tl = timeline();
  const clock = state.sound === "upload" ? audioClock() : wallClock();
  Object.values(BACKGROUNDS).forEach((b) => b.reset());
  if (userMedia instanceof HTMLVideoElement) { userMedia.currentTime = 0; userMedia.play().catch(() => {}); }
  await clock.start().catch(() => {});
  preview = { clock, tl };
  $("btn-preview").textContent = "Stop preview";
});

// ---------- recording ----------
function routeAudio() {
  // A media element can only be routed through Web Audio once, so build the graph once.
  if (audioGraph) return audioGraph;
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaElementSource(audioEl);
  const dest = ac.createMediaStreamDestination();
  src.connect(dest); src.connect(ac.destination);
  audioGraph = { ac, dest };
  return audioGraph;
}

async function record() {
  const s = current();
  if (!s || recording) return;
  stopPreview();
  $("status").textContent = "";
  if (state.sound === "upload" && !audioEl) { $("status").textContent = "Choose a recording first, or pick No sound."; return; }

  let mic = null;
  if (state.sound === "live") {
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (_) { $("status").textContent = "Microphone access was refused. Allow it in Chrome's site settings, or upload a recording instead."; return; }
  }
  const type = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!type) { $("status").textContent = "This browser can't record video. Use Chrome on Android."; mic?.getTracks().forEach((t) => t.stop()); return; }

  recording = true;
  document.body.classList.add("is-recording");
  Object.values(BACKGROUNDS).forEach((b) => b.reset());
  const stream = cv.captureStream(FPS);
  if (state.sound === "upload") {
    const g = routeAudio();
    await g.ac.resume();
    g.dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  mic?.getAudioTracks().forEach((tr) => stream.addTrack(tr));

  // live mode: the person speaking taps to start each line, then Finish
  const live = state.sound === "live";
  const tl = live ? { marks: [], end: Infinity, total: Infinity } : timeline();
  if (live) { $("live-next").hidden = false; $("live-next").textContent = `Start line 1 of ${s.parts.length}`; }

  for (const n of ["3", "2", "1"]) { $("cue").textContent = n; await new Promise((r) => setTimeout(r, 700)); }
  $("cue").textContent = live ? "Tap the button as you start each line" : state.sound === "upload" ? "Recording with the uploaded sound…" : "Recording…";

  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const clock = state.sound === "upload" ? audioClock() : wallClock();
  if (userMedia instanceof HTMLVideoElement) { userMedia.currentTime = 0; userMedia.play().catch(() => {}); }
  rec.start(250);
  await clock.start();

  $("live-next").onclick = () => {
    const t = clock.now();
    if (tl.marks.length < s.parts.length) tl.marks.push(t);
    else if (tl.end === Infinity) { tl.end = t; tl.total = t + END_CARD; $("live-next").hidden = true; return; }
    $("live-next").textContent = tl.marks.length < s.parts.length ? `Start line ${tl.marks.length + 1} of ${s.parts.length}` : "Finish";
  };

  await new Promise((done) => {
    (function tick() {
      const t = clock.now();
      if (t > tl.total) { done(); return; }
      requestAnimationFrame(tick);
      render(ctx, t, tl);
    })();
  });
  clock.stop();
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  mic?.getTracks().forEach((tr) => tr.stop());
  recording = false;
  document.body.classList.remove("is-recording");
  $("live-next").hidden = true;
  $("cue").textContent = "";
  showResult(s, chunks, type);
}

function showResult(s, chunks, type) {
  const blob = new Blob(chunks, { type: type.split(";")[0] });
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const base = (s.parts[0].roman || "reel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reel";
  const name = `${base}.${ext}`;
  const url = URL.createObjectURL(blob);
  $("result-video").src = url;
  $("btn-save").href = url; $("btn-save").download = name;
  const file = new File([blob], name, { type: blob.type });
  $("btn-share").hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  $("btn-share").onclick = async () => {
    try { await navigator.share({ files: [file] }); }
    catch (e) { if (e && e.name !== "AbortError") $("status").textContent = "Sharing didn't work. Use Save video, then upload it from your gallery."; }
  };
  $("format-warn").hidden = ext === "mp4";
  $("caption-text").value = captionFor(s);
  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth" });
}
function captionFor(s) {
  const sm = s.parts.map((p) => p.shahmukhi).join("\n");
  const gm = s.parts.map((p) => p.gurmukhi).join("\n");
  const ro = s.parts.map((p) => p.roman).filter(Boolean).join("\n");
  const en = s.parts.map((p) => p.english).filter(Boolean).join(" ");
  return `${sm}\n\n${gm}\n\n${ro}\n\n"${en}"${s.poet ? "\n— " + s.poet : ""}\n\nOne saying, two scripts: the same Punjabi in Shahmukhi and Gurmukhi.\n\n#Punjabi #ਪੰਜਾਬੀ #پنجابی #Shahmukhi #Gurmukhi #PunjabiWisdom`;
}

// ---------- timing by tapping ----------
let tapMarks = [];
function openTiming() {
  const s = current();
  $("timing-list").replaceChildren(...s.parts.map((p, i) => { const li = document.createElement("li"); li.id = "tl-" + i; li.textContent = p.roman || p.gurmukhi; return li; }));
  $("tap").disabled = true; $("tap").textContent = "Tap when line 1 starts";
  $("timing-msg").textContent = "Press Play, then tap the big button each time a new line starts.";
  $("timing").hidden = false;
}
function closeTiming() { audioEl.pause(); audioEl.onended = null; $("timing").hidden = true; updateSoundUI(); }
$("btn-timing").addEventListener("click", () => { stopPreview(); openTiming(); });
$("timing-play").addEventListener("click", () => {
  tapMarks = [];
  document.querySelectorAll("#timing-list li").forEach((li) => li.classList.remove("done"));
  audioEl.currentTime = 0; audioEl.play().catch(() => {});
  audioEl.onended = () => { $("tap").disabled = true; if (tapMarks.length < current().parts.length) $("timing-msg").textContent = "The recording ended before every line was tapped. Press Play to try again."; };
  $("tap").disabled = false; $("tap").textContent = "Tap when line 1 starts";
  $("timing-msg").textContent = "Listening…";
});
$("tap").addEventListener("click", () => {
  const n = current().parts.length;
  tapMarks.push(audioEl.currentTime);
  $("tl-" + (tapMarks.length - 1)).classList.add("done");
  if (tapMarks.length < n) { $("tap").textContent = `Tap when line ${tapMarks.length + 1} starts`; return; }
  marks = tapMarks.slice();
  $("tap").disabled = true; $("tap").textContent = "All lines timed";
  $("timing-msg").textContent = "Done. The last line stays until the recording ends.";
});
$("timing-done").addEventListener("click", closeTiming);

// ---------- adding sayings ----------
function openEditor(s) {
  $("ed-poet").value = s ? s.poet : "";
  $("ed-note").value = s ? s.note : "";
  $("ed-sm").value = s ? s.parts.map((p) => p.shahmukhi).join("\n") : "";
  $("ed-gm").value = s ? s.parts.map((p) => p.gurmukhi).join("\n") : "";
  $("ed-ro").value = s ? s.parts.map((p) => p.roman).join("\n") : "";
  $("ed-en").value = s ? s.parts.map((p) => p.english).join("\n") : "";
  $("ed-checked").checked = s ? s.checked : false;
  $("ed-msg").textContent = "";
  $("ed-delete").hidden = !s;
  $("ed-delete").dataset.confirm = ""; $("ed-delete").textContent = "Delete";
  $("editor").dataset.editing = s ? s.id : "";
  $("editor").hidden = false;
  $("ed-poet").focus();
}
function readEditor() {
  const rows = (id) => $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);
  const sm = rows("ed-sm"), gm = rows("ed-gm"), ro = rows("ed-ro"), en = rows("ed-en");
  if (!sm.length || !gm.length) return { error: "Add the saying in both scripts." };
  if (sm.length !== gm.length) return { error: `Shahmukhi has ${sm.length} lines and Gurmukhi has ${gm.length}. Each line needs a partner in the other script.` };
  if (ro.length && ro.length !== sm.length) return { error: `The romanised version has ${ro.length} lines but the scripts have ${sm.length}. Match them line by line, or leave it empty.` };
  if (en.length && en.length !== sm.length) return { error: `The English has ${en.length} lines but the scripts have ${sm.length}. Match them line by line, or leave it empty.` };
  return { poet: $("ed-poet").value.trim(), note: $("ed-note").value.trim(), checked: $("ed-checked").checked,
    parts: sm.map((_, i) => ({ shahmukhi: sm[i], gurmukhi: gm[i], roman: ro[i] || "", english: en[i] || "" })) };
}
$("btn-new").addEventListener("click", () => openEditor(null));
$("btn-edit").addEventListener("click", () => openEditor(current()));
$("ed-cancel").addEventListener("click", () => { $("editor").hidden = true; });
$("ed-save").addEventListener("click", () => {
  const r = readEditor();
  if (r.error) { $("ed-msg").textContent = r.error; return; }
  const mine = loadMine(), editing = $("editor").dataset.editing;
  const idx = editing ? +editing.slice(2) : mine.length;
  mine[idx] = r; saveMine(mine);
  rebuildLibrary("m:" + idx);
  $("editor").hidden = true;
});
$("ed-delete").addEventListener("click", () => {
  const editing = $("editor").dataset.editing;
  if (!editing) return;
  if ($("ed-delete").dataset.confirm !== "1") { $("ed-delete").dataset.confirm = "1"; $("ed-delete").textContent = "Tap again to delete"; return; }
  const mine = loadMine(); mine.splice(+editing.slice(2), 1); saveMine(mine);
  $("editor").hidden = true;
  rebuildLibrary();
});
$("ed-copy").addEventListener("click", () => {
  const r = readEditor();
  if (r.error) { $("ed-msg").textContent = r.error; return; }
  navigator.clipboard.writeText(JSON.stringify(r, null, 2))
    .then(() => { $("ed-msg").textContent = "Copied. Paste it into the sayings list in lines.json, with a comma between entries."; })
    .catch(() => { $("ed-msg").textContent = "Couldn't copy here. Save it on the phone instead."; });
});

// ---------- library ----------
let fileSayings = [];
function rebuildLibrary(selectId) {
  library = [...fileSayings, ...loadMine().map((r, i) => normalise(r, "m:" + i, true))].filter((s) => s.parts.length);
  const groups = [["From lines.json", library.filter((s) => !s.mine)], ["Saved on this phone", library.filter((s) => s.mine)]];
  $("saying").replaceChildren(...groups.filter(([, l]) => l.length).map(([name, l]) => {
    const g = document.createElement("optgroup"); g.label = name;
    l.forEach((s) => {
      const o = document.createElement("option"); o.value = s.id;
      const first = s.parts[0].roman || s.parts[0].gurmukhi;
      o.textContent = `${s.checked ? "" : "○ "}${first}${s.parts.length > 1 ? ` (+${s.parts.length - 1} lines)` : ""}`;
      g.append(o);
    });
    return g;
  }));
  state.id = selectId && library.some((s) => s.id === selectId) ? selectId : (library.some((s) => s.id === state.id) ? state.id : library[0]?.id);
  $("saying").value = state.id;
  marks = null;
  rebuild();
}

// ---------- controls ----------
$("saying").addEventListener("change", (e) => { state.id = e.target.value; marks = null; stopPreview(); rebuild(); });
document.querySelectorAll('input[name="bg"]').forEach((r) => r.addEventListener("change", (e) => {
  state.bg = e.target.value; store.set(KEYS.bg, state.bg);
  $("own-picker").hidden = state.bg !== "own";
  rebuild();
}));
document.querySelectorAll('input[name="sound"]').forEach((r) => r.addEventListener("change", (e) => {
  state.sound = e.target.value; store.set(KEYS.sound, state.sound); stopPreview(); updateSoundUI();
}));
$("own-file").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  if (f.type.startsWith("video/")) {
    const v = document.createElement("video");
    v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.play().catch(() => {});
    userMedia = v;
  } else { const img = new Image(); img.src = url; userMedia = img; }
});
$("audio-file").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  stopPreview();
  if (!audioEl) { audioEl = new Audio(); audioEl.preload = "auto"; }
  else if (audioEl.src) URL.revokeObjectURL(audioEl.src);
  audioEl.src = URL.createObjectURL(f);
  marks = null;
  $("timing-status").textContent = "Loading the recording…";
  audioEl.onloadedmetadata = () => updateSoundUI();
  audioEl.onerror = () => { $("timing-status").textContent = "This file couldn't be played. Try an MP3, M4A, OGG or a video file."; };
});
$("handle").addEventListener("input", (e) => { state.handle = e.target.value.trim(); store.set(KEYS.handle, state.handle); });
$("btn-record").addEventListener("click", () => record().catch((e) => {
  recording = false; document.body.classList.remove("is-recording"); $("live-next").hidden = true;
  $("status").textContent = "Recording failed: " + (e && e.message ? e.message : e);
}));
$("btn-copy").addEventListener("click", () => {
  const ta = $("caption-text");
  navigator.clipboard.writeText(ta.value).then(() => { $("copy-status").textContent = "Copied"; })
    .catch(() => { ta.select(); $("copy-status").textContent = "Selected. Long-press to copy."; });
});

// ---------- start ----------
(async function boot() {
  state.handle = store.get(KEYS.handle, ""); $("handle").value = state.handle;
  state.bg = store.get(KEYS.bg, "phulkari"); if (state.bg === "own") state.bg = "phulkari";
  document.querySelector(`input[name="bg"][value="${state.bg}"]`).checked = true;
  state.sound = store.get(KEYS.sound, "upload");
  if (!["upload", "live", "none"].includes(state.sound)) state.sound = "upload";
  document.querySelector(`input[name="sound"][value="${state.sound}"]`).checked = true;
  $("status").textContent = "Loading sayings and fonts…";
  try {
    const j = await (await fetch("lines.json")).json();
    fileSayings = (j.sayings || j.lines || []).map((r, i) => normalise(r, "f:" + i, false));
  } catch (_) { $("status").textContent = "Couldn't load lines.json. Your own saved sayings still work."; }
  await Promise.all([
    document.fonts.load(`700 60px "Noto Nastaliq Urdu"`, "پنجابی"),
    document.fonts.load(`600 60px "Anek Gurmukhi"`, "ਪੰਜਾਬੀ"),
    document.fonts.load(`600 60px "Noto Sans Gurmukhi"`, "ਪੰਜਾਬੀ"),
    document.fonts.load(`italic 600 60px "Cormorant Garamond"`, "Bulleh"),
    document.fonts.load(`400 40px "Mukta"`, "Bulleh"),
  ]).catch(() => {});
  if ($("status").textContent.startsWith("Loading")) $("status").textContent = "";
  rebuildLibrary();
  requestAnimationFrame(loop);
})();

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
