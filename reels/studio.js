"use strict";
/* Reel Studio — turns one Punjabi line into a 9:16 reel.
   Scene: the poet's name, then the line writes itself in Shahmukhi (right to left) and Gurmukhi
   (left to right), then the romanised reading. While the reader speaks, the same word lights up
   in all three. Then the English meaning, then an end card.
   Backgrounds: generated phulkari, generated mustard field at dusk, or the user's own photo/video. */

const RW = 1080, RH = 1920, FPS = 30;
const $ = (id) => document.getElementById(id);
const KEYS = { handle: "reels.handle.v1", bg: "reels.bg.v1", pace: "reels.pace.v1" };

const F = {
  sm: '"Noto Nastaliq Urdu", serif',
  gm: '"Anek Gurmukhi", "Noto Sans Gurmukhi", sans-serif',
  roman: '"Cormorant Garamond", Georgia, serif',
  body: '"Mukta", system-ui, sans-serif',
};
const C = { cream: "#FFF3DE", gold: "#FFC94A", muted: "rgba(255,243,222,0.62)", ink: "#140A0A" };

let lines = [];
let state = { line: 0, bg: "phulkari", pace: 0.8, handle: "" };
let userMedia = null;            // HTMLImageElement or HTMLVideoElement chosen by the user
let scene = null;                // built for the current line
let previewStart = 0, previewing = false, recording = false;

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* not kept */ } },
};
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const words = (s) => s.trim().split(/\s+/);

// ---------- text layout ----------
/* Lay words out in reading order inside a box, shrinking the size until it fits.
   Returns each word's left x, baseline y and width, so words can be revealed and lit one by one. */
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
    const orphan = rows.length > 1 && rows[rows.length - 1].length === 1 && size > opts.size * 0.8; // avoid one lonely word on the last row
    if ((rows.length * lh <= box.h && !orphan) || size <= opts.min) {
      const out = new Array(ws.length);
      const top = box.y + (box.h - rows.length * lh) / 2 + lh / 2;
      rows.forEach((row, r) => {
        const total = row.reduce((s, i) => s + widths[i], 0) + space * (row.length - 1);
        const y = top + r * lh;
        if (opts.rtl) {
          let x = box.x + box.w / 2 + total / 2;
          for (const i of row) { x -= widths[i]; out[i] = { t: ws[i], x, y, w: widths[i] }; x -= space; }
        } else {
          let x = box.x + box.w / 2 - total / 2;
          for (const i of row) { out[i] = { t: ws[i], x, y, w: widths[i] }; x += widths[i] + space; }
        }
      });
      return { words: out, size, font: `${weight} ${size}px ${font}`, rtl: !!opts.rtl };
    }
    size *= 0.94;
  }
}

function buildScene(line, c) {
  const n = words(line.gurmukhi).length;
  const aligned = n === words(line.shahmukhi).length && n === words(line.roman).length;
  const X = 170, Wd = RW - 340; // inside the phulkari panel, and clear of Instagram's right-hand buttons
  const sm = layout(c, line.shahmukhi, F.sm, 700, { x: X, y: 400, w: Wd, h: 390 }, { size: 96, min: 40, lineH: 1.85, rtl: true, spaceMul: 2.2 });
  const gm = layout(c, line.gurmukhi, F.gm, 600, { x: X, y: 868, w: Wd, h: 300 }, { size: 92, min: 40, lineH: 1.35 });
  const ro = layout(c, line.roman, F.roman, "italic 600", { x: X, y: 1200, w: Wd, h: 180 }, { size: 64, min: 34, lineH: 1.25 });
  const pace = state.pace;
  const T = {};
  T.poet = 0.4;
  T.sm = 1.1;                         T.smEnd = T.sm + n * 0.11 + 0.4;
  T.gm = T.smEnd + 0.25;              T.gmEnd = T.gm + n * 0.11 + 0.4;
  T.ro = T.gmEnd + 0.2;
  T.read = T.ro + 1.4;                T.readEnd = T.read + n * pace;
  T.en = T.readEnd + 0.1;
  T.end = T.en + 3.2;
  T.total = T.end + 3.0;
  return { line, n, aligned, sm, gm, ro, T };
}

// ---------- backgrounds ----------
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

const Phulkari = (() => {
  let cloth = null, motifs = null, done = null;
  const GOLD = ["#F2B636", "#E9A425", "#F6C95A"], ORANGE = "#E2701D", MAGENTA = "#C2185B", WHITE = "#F7EBD3";
  function init() {
    const r = rng(11);
    // khaddar: hand-woven cotton, dyed madder red, with a visible weave
    cloth = document.createElement("canvas"); cloth.width = RW; cloth.height = RH;
    const k = cloth.getContext("2d");
    k.fillStyle = "#6B1515"; k.fillRect(0, 0, RW, RH);
    for (let i = 0; i < 26000; i++) {
      k.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,200,160,0.035)";
      const horiz = r() < 0.5;
      k.fillRect(r() * RW, r() * RH, horiz ? 6 + r() * 14 : 1.4, horiz ? 1.4 : 6 + r() * 14);
    }
    // bagh-style border: rows of diamonds filled with long darning stitches
    motifs = [];
    const band = 150, s = 66;
    const place = (cx, cy, order) => motifs.push({ cx, cy, s, order, inner: r() < 0.5 ? ORANGE : MAGENTA, gold: GOLD[(r() * 3) | 0] });
    let o = 0;
    for (let x = s; x < RW - s / 2; x += s * 1.55) { place(x, band / 2 + 8, o++); }
    for (let y = band + s; y < RH - band - s / 2; y += s * 1.55) { place(RW - band / 2 + 4, y, o++); }
    for (let x = RW - s; x > s / 2; x -= s * 1.55) { place(x, RH - band / 2 - 8, o++); }
    for (let y = RH - band - s; y > band + s / 2; y -= s * 1.55) { place(band / 2 - 4, y, o++); }
    motifs.total = o;
  }
  function stitchDiamond(c, m, frac) {
    // horizontal darning stitches: long floats on the front, short gaps between them
    const rows = Math.floor((m.s * 2) / 5);
    const shown = Math.floor(rows * frac);
    for (let i = 0; i < shown; i++) {
      const dy = -m.s + i * 5 + 2.5;
      const half = m.s - Math.abs(dy);
      const innerHalf = m.s * 0.42 - Math.abs(dy);
      c.strokeStyle = m.gold; c.lineWidth = 3.2;
      c.beginPath(); c.moveTo(m.cx - half, m.cy + dy); c.lineTo(m.cx + half, m.cy + dy); c.stroke();
      if (innerHalf > 0) { c.strokeStyle = m.inner; c.beginPath(); c.moveTo(m.cx - innerHalf, m.cy + dy); c.lineTo(m.cx + innerHalf, m.cy + dy); c.stroke(); }
    }
    if (frac >= 1) { c.fillStyle = WHITE; c.fillRect(m.cx - 3, m.cy - 3, 6, 6); }
  }
  function panel(c, a) {
    c.save();
    c.globalAlpha = a;
    c.fillStyle = "rgba(28,6,8,0.86)";
    roundRect(c, 130, 190, RW - 260, RH - 380, 28); c.fill();
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
        const start = (m.order / motifs.total) * 1.6;
        const frac = Math.min(1, Math.max(0, (t - start) / 0.5));
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
    for (let i = 0; i < 90; i++) { k.fillStyle = `rgba(255,240,220,${0.15 + r() * 0.5})`; k.fillRect(r() * RW, r() * 700, 2, 2); } // first stars
    // distant tree line: shisham and kikar crowns
    trees = [];
    for (let x = -40; x < RW + 40; x += 30 + r() * 70) trees.push({ x, w: 40 + r() * 90, h: 20 + r() * 60 });
    flowers = [];
    for (let i = 0; i < 2600; i++) {
      const depth = Math.pow(r(), 1.7);          // more far-away flowers than near ones
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
        const sway = Math.sin(t * 1.3 + f.ph + f.x * 0.004) * (2 + f.d * 7);
        const sz = 2 + f.d * 9;
        c.fillStyle = f.c;
        c.fillRect(f.x + sway, f.y, sz, sz * 0.8);
        if (f.d > 0.45) c.fillRect(f.x + sway + sz * 0.6, f.y - sz * 0.5, sz * 0.8, sz * 0.7);
      }
      // soft shade behind the text so it reads over the bright horizon
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
    const m = userMedia;
    const mw = m && (m.videoWidth || m.naturalWidth), mh = m && (m.videoHeight || m.naturalHeight);
    if (mw && mh) {
      const s = Math.max(RW / mw, RH / mh), w = mw * s, h = mh * s;
      c.drawImage(m, (RW - w) / 2, (RH - h) / 2, w, h);
    }
    c.fillStyle = "rgba(10,6,8,0.58)"; c.fillRect(0, 0, RW, RH);
  },
  reset() {},
};
const BACKGROUNDS = { phulkari: Phulkari, sarson: Sarson, own: Own };

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// ---------- scene ----------
function drawBlock(c, block, t, start, hi, fade) {
  c.font = block.font; c.textBaseline = "middle"; c.textAlign = "left";
  c.direction = block.rtl ? "rtl" : "ltr";
  block.words.forEach((w, i) => {
    const a = ease((t - start - i * 0.11) / 0.35) * fade;
    if (a <= 0) return;
    const lit = i === hi;
    c.globalAlpha = a;
    c.fillStyle = lit ? C.gold : hi >= 0 ? "rgba(255,243,222,0.78)" : C.cream;
    if (lit) { // soft glow behind the word being read, the same word in every script
      const up = block.rtl ? 0.78 : 0.62, h = block.size * (block.rtl ? 1.45 : 1.2);
      c.fillStyle = "rgba(255,201,74,0.17)";
      roundRect(c, w.x - 12, w.y - block.size * up, w.w + 24, h, 14); c.fill();
      c.fillStyle = C.gold;
    }
    c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 14;
    // In RTL mode, textAlign "left" still anchors the word's left edge at x.
    c.fillText(w.t, w.x, w.y + (1 - a) * 18);
    c.shadowBlur = 0;
  });
  c.globalAlpha = 1; c.direction = "ltr";
}
function label(c, text, y, a) {
  if (a <= 0) return;
  c.globalAlpha = a * 0.9; c.font = `600 30px ${F.body}`; c.fillStyle = C.muted;
  c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "ltr";
  c.fillText(text, RW / 2, y);
  c.globalAlpha = 1;
}
function wrapCentered(c, text, y, maxW, lh) {
  const ws = words(text); let cur = ""; const out = [];
  for (const w of ws) { const tt = cur ? cur + " " + w : w; if (c.measureText(tt).width > maxW && cur) { out.push(cur); cur = w; } else cur = tt; }
  if (cur) out.push(cur);
  out.forEach((l, i) => c.fillText(l, RW / 2, y + i * lh));
}

function render(c, t) {
  const S = scene, T = S.T;
  BACKGROUNDS[state.bg].draw(c, t);
  const fade = 1 - ease((t - T.end) / 0.6);
  const hi = S.aligned && t >= T.read && t < T.readEnd ? Math.floor((t - T.read) / state.pace) : -1;

  c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "ltr";
  if (fade > 0) {
    // poet
    c.globalAlpha = ease((t - T.poet) / 0.6) * fade;
    c.font = `italic 600 50px ${F.roman}`; c.fillStyle = C.gold;
    c.fillText(S.line.poet, RW / 2, 262);
    c.globalAlpha = 1;
    label(c, "SHAHMUKHI  ·  read right to left  ←", 350, ease((t - T.sm) / 0.5) * fade);
    drawBlock(c, S.sm, t, T.sm, hi, fade);
    label(c, "GURMUKHI  ·  read left to right  →", 830, ease((t - T.gm) / 0.5) * fade);
    drawBlock(c, S.gm, t, T.gm, hi, fade);
    drawBlock(c, S.ro, t, T.ro, hi, fade);
    // meaning
    const ea = ease((t - T.en) / 0.7) * fade;
    if (ea > 0) {
      c.globalAlpha = ea; c.font = `400 44px ${F.body}`; c.fillStyle = C.cream; c.textAlign = "center";
      wrapCentered(c, S.line.english, 1440, RW - 340, 58);
      c.globalAlpha = 1;
    }
  }
  // end card
  const ec = ease((t - T.end - 0.3) / 0.7);
  if (ec > 0) {
    c.globalAlpha = ec; c.textAlign = "center"; c.direction = "ltr";
    c.font = `italic 600 80px ${F.roman}`; c.fillStyle = C.gold;
    c.fillText("One line, two scripts", RW / 2, 820);
    c.font = `700 64px ${F.sm}`; c.fillStyle = C.cream; c.direction = "rtl";
    c.fillText("پنجابی", RW / 2 + 150, 960);
    c.direction = "ltr"; c.font = `600 62px ${F.gm}`;
    c.fillText("ਪੰਜਾਬੀ", RW / 2 - 150, 960);
    if (state.handle) { c.font = `600 46px ${F.body}`; c.fillStyle = C.muted; c.fillText(state.handle, RW / 2, 1110); }
    c.globalAlpha = 1;
  }
}

// ---------- preview / record ----------
const cv = $("stage"), ctx = cv.getContext("2d", { alpha: false });
cv.width = RW; cv.height = RH;

function rebuild() {
  if (!lines.length) return;
  scene = buildScene(lines[state.line], ctx);
  Object.values(BACKGROUNDS).forEach((b) => b.reset());
  $("align-warn").hidden = scene.aligned;
  $("check-warn").hidden = !!lines[state.line].checked;
  $("length").textContent = `${scene.T.total.toFixed(0)} s`;
  previewStart = performance.now();
}
function loop(now) {
  requestAnimationFrame(loop);
  if (recording || !scene) return;
  let t = (now - previewStart) / 1000;
  if (!previewing) t = Math.min(t, scene.T.read + 0.2); // idle: show the finished layout
  else if (t > scene.T.total) { previewing = false; $("btn-preview").textContent = "Play preview"; }
  render(ctx, t);
}

async function record() {
  if (!scene || recording) return;
  const line = lines[state.line];
  $("status").textContent = "";
  let mic = null;
  if ($("voice").checked) {
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: $("denoise").checked, autoGainControl: true } }); }
    catch (_) { $("status").textContent = "Microphone access was refused, so this reel is silent. Instagram's voiceover tool can add your voice later."; }
  }
  const type = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!type) { $("status").textContent = "This browser can't record video. Use Chrome on Android."; mic?.getTracks().forEach((t) => t.stop()); return; }

  // count-in on screen (not recorded)
  recording = true;
  document.body.classList.add("is-recording");
  Object.values(BACKGROUNDS).forEach((b) => b.reset());
  if (userMedia instanceof HTMLVideoElement) { userMedia.currentTime = 0; userMedia.play().catch(() => {}); }
  for (const n of ["3", "2", "1"]) { $("cue").textContent = n; await new Promise((r) => setTimeout(r, 700)); }

  const stream = cv.captureStream(FPS);
  mic?.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(250);
  const t0 = performance.now();
  await new Promise((done) => {
    function tick(now) {
      const t = (now - t0) / 1000;
      if (t > scene.T.total) { done(); return; }
      requestAnimationFrame(tick);
      render(ctx, t);
      $("cue").textContent =
        t < scene.T.read - 1.2 ? "Get ready to read…" :
        t < scene.T.read ? "Read along with the gold word" :
        t < scene.T.readEnd ? "Reading…" : "Finishing…";
    }
    requestAnimationFrame(tick);
  });
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  mic?.getTracks().forEach((tr) => tr.stop());
  recording = false;
  document.body.classList.remove("is-recording");
  $("cue").textContent = "";

  const blob = new Blob(chunks, { type: type.split(";")[0] });
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const name = `${line.roman.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reel"}.${ext}`;
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
  $("caption-text").value = captionFor(line);
  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth" });
}

function captionFor(l) {
  return `${l.shahmukhi}\n${l.gurmukhi}\n${l.roman}\n\n"${l.english}"\n— ${l.poet}\n\nOne line, two scripts. Same Punjabi, written in Shahmukhi and Gurmukhi.\n\n#Punjabi #ਪੰਜਾਬੀ #پنجابی #Shahmukhi #Gurmukhi #PunjabiPoetry`;
}

// ---------- controls ----------
function fillLines() {
  $("line").replaceChildren(...lines.map((l, i) => {
    const o = document.createElement("option");
    o.value = i; o.textContent = `${l.checked ? "" : "○ "}${l.roman}`;
    return o;
  }));
  $("line").value = String(state.line);
}
$("line").addEventListener("change", (e) => { state.line = +e.target.value; rebuild(); });
document.querySelectorAll('input[name="bg"]').forEach((r) => r.addEventListener("change", (e) => {
  state.bg = e.target.value; store.set(KEYS.bg, state.bg);
  $("own-picker").hidden = state.bg !== "own";
  rebuild();
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
$("pace").addEventListener("change", (e) => { state.pace = +e.target.value; store.set(KEYS.pace, e.target.value); rebuild(); });
$("handle").addEventListener("input", (e) => { state.handle = e.target.value.trim(); store.set(KEYS.handle, state.handle); });
$("btn-preview").addEventListener("click", () => {
  previewing = !previewing;
  $("btn-preview").textContent = previewing ? "Stop preview" : "Play preview";
  previewStart = performance.now();
  Object.values(BACKGROUNDS).forEach((b) => b.reset());
});
$("btn-record").addEventListener("click", () => record().catch((e) => {
  recording = false; document.body.classList.remove("is-recording");
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
  state.pace = +store.get(KEYS.pace, "0.8"); $("pace").value = String(state.pace);
  $("status").textContent = "Loading lines and fonts…";
  try {
    const j = await (await fetch("lines.json")).json();
    lines = (j.lines || []).filter((l) => l.shahmukhi && l.gurmukhi && l.roman);
  } catch (_) { $("status").textContent = "Couldn't load lines.json. Check your connection and reload."; return; }
  await Promise.all([
    document.fonts.load(`700 60px "Noto Nastaliq Urdu"`, "پنجابی"),
    document.fonts.load(`600 60px "Anek Gurmukhi"`, "ਪੰਜਾਬੀ"),
    document.fonts.load(`600 60px "Noto Sans Gurmukhi"`, "ਪੰਜਾਬੀ"),
    document.fonts.load(`italic 600 60px "Cormorant Garamond"`, "Bulleh"),
    document.fonts.load(`400 40px "Mukta"`, "Bulleh"),
  ]).catch(() => {});
  $("status").textContent = "";
  fillLines();
  rebuild();
  requestAnimationFrame(loop);
})();

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
