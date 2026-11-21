"use strict";
/* Reel maker — renders one Punjabi line as a 9:16 video for Instagram Reels.
   Timeline: dots gather into script A, flow into script B, the romanised reading and English
   meaning appear (the moment to read aloud), the dots flow back, then an end card.
   The video is drawn on its own 1080x1920 canvas and captured with MediaRecorder; the
   microphone, if chosen, is recorded alongside. Uses `lines`, `SCRIPTS`, `index` from app.js. */

const RW = 1080, RH = 1920, FPS = 30;
const HANDLE_KEY = "steady.handle.v1";
const r$ = (id) => document.getElementById(id);
let reelActive = false;
let reelBlob = null, reelURL = null;

// ---------- drawing helpers ----------
function rasterize(text, key, area) {
  const sc = SCRIPTS[key];
  const off = document.createElement("canvas");
  off.width = RW; off.height = RH;
  const o = off.getContext("2d");
  const maxW = RW * 0.84;
  let size = 150 * sc.scale, wrapped;
  for (;;) {
    o.font = `700 ${size}px ${sc.font}, serif`;
    wrapped = wrapText(o, text, maxW);
    const widest = Math.max(...wrapped.map((l) => o.measureText(l).width));
    if ((wrapped.length * size * sc.lineH <= area.h && widest <= maxW) || size < 30) break;
    size *= 0.93;
  }
  o.fillStyle = "#fff"; o.textAlign = "center"; o.textBaseline = "middle";
  o.direction = sc.rtl ? "rtl" : "ltr";
  const lh = size * sc.lineH, top = area.cy - ((wrapped.length - 1) * lh) / 2;
  wrapped.forEach((l, i) => o.fillText(l, RW / 2, top + i * lh));
  const data = o.getImageData(0, 0, RW, RH).data;
  const step = Math.max(3, Math.round(size / (sc.rtl ? 24 : 19)));
  const pts = [];
  for (let y = 0; y < RH; y += step)
    for (let x = 0; x < RW; x += step)
      if (data[(y * RW + x) * 4 + 3] > 128) pts.push({ x, y });
  for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return { pts, dot: step * 0.7 };
}
function wrapText(c, text, maxW) {
  const words = text.split(/\s+/), out = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (c.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// ---------- the reel ----------
function planFor(line) {
  // Give longer lines more time on screen while they are read aloud.
  const read = Math.min(11, Math.max(5, line.roman.length * 0.085));
  const t = {};
  t.formA = 1.0;               // dots start gathering
  t.holdA = 3.2;               // script A complete
  t.toB = 5.4;                 // flow into script B
  t.capIn = 7.2;               // reading + meaning appear: read now
  t.toA = t.capIn + read * 0.55;
  t.capOut = t.capIn + read;
  t.end = t.capOut + 0.4;      // end card
  t.total = t.end + 2.6;
  return t;
}

async function recordReel() {
  const line = lines[+r$("reel-line").value];
  if (!line) return;
  const handle = r$("reel-handle").value.trim();
  try { localStorage.setItem(HANDLE_KEY, handle); } catch (_) { /* not kept */ }
  const lead = r$("reel-lead").value;           // "sm" or "gm"
  const other = lead === "sm" ? "gm" : "sm";
  const plan = planFor(line);

  r$("reel-status").textContent = "Preparing…";
  await (fontsReady || Promise.resolve());
  const area = { cy: RH * 0.36, h: RH * 0.36 };
  const A = rasterize(line[lead === "sm" ? "shahmukhi" : "gurmukhi"], lead, area);
  const B = rasterize(line[other === "sm" ? "shahmukhi" : "gurmukhi"], other, area);

  // microphone
  let mic = null;
  if (r$("reel-voice").checked) {
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (_) { r$("reel-status").textContent = "Microphone access was refused, so the reel will be silent."; }
  }

  const cv = r$("reel-canvas"), c = cv.getContext("2d", { alpha: false });
  cv.width = RW; cv.height = RH;
  const stream = cv.captureStream(FPS);
  if (mic) mic.getAudioTracks().forEach((t) => stream.addTrack(t));
  const type = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!type) { r$("reel-status").textContent = "This browser can't record video. Try Chrome on Android."; mic?.getTracks().forEach((t) => t.stop()); return; }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  // particles
  const DUST = 250;
  const n = Math.min(Math.max(A.pts.length, B.pts.length) + DUST, 9000);
  const ps = Array.from({ length: n }, () => ({ x: Math.random() * RW, y: Math.random() * RH, vx: 0, vy: 0 }));
  let targets = null, targetKey = null;
  const setTargets = (set, key) => {
    if (targetKey === key) return;
    targetKey = key; targets = set;
    // every particle except a little background dust joins the letters, doubling up where needed
    ps.forEach((p, i) => { p.t = i < n - DUST ? set.pts[i % set.pts.length] : null; });
  };
  setTargets(A, "A");

  reelActive = true;
  r$("reel-setup").hidden = true; r$("reel-stage").hidden = false; r$("reel-result").hidden = true;
  r$("reel-cue").textContent = "Get ready…";
  rec.start(250);
  const t0 = performance.now();

  await new Promise((done) => {
    function tick(now) {
      const t = (now - t0) / 1000;
      if (t >= plan.total) { done(); return; }
      requestAnimationFrame(tick);

      // which shape, how strongly
      if (t >= plan.toB && t < plan.toA) setTargets(B, "B"); else setTargets(A, "A");
      const pull = t < plan.end ? ease((t - plan.formA) / (plan.holdA - plan.formA)) : 0;
      const s = pull;
      const dot = (targetKey === "B" ? B : A).dot;

      // background with trails
      c.fillStyle = "rgba(11,15,20,0.3)";
      c.fillRect(0, 0, RW, RH);

      // particles
      const k = pull * pull * pull, damp = 0.9 - k * 0.12;
      const col = `rgb(${Math.round(124 + 116 * s)},${Math.round(147 + 60 * s)},${Math.round(176 - 34 * s)})`;
      c.fillStyle = col;
      c.beginPath();
      const dustPath = new Path2D();
      for (const p of ps) {
        if (p.t) { p.vx += (p.t.x - p.x) * 0.014 * k; p.vy += (p.t.y - p.y) * 0.014 * k; }
        else { p.vy += 0.02; }
        const drift = 1 - k;
        p.vx += (Math.random() - 0.5) * 0.6 * drift; p.vy += (Math.random() - 0.5) * 0.6 * drift + 0.05 * drift;
        if (t >= plan.end) { p.vx += (Math.random() - 0.5) * 1.2; p.vy += (Math.random() - 0.5) * 1.2; }
        p.vx *= damp; p.vy *= damp; p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > RW) { p.vx *= -0.5; p.x = Math.min(RW, Math.max(0, p.x)); }
        if (p.y < 0 || p.y > RH) { p.vy *= -0.5; p.y = Math.min(RH, Math.max(0, p.y)); }
        if (p.t) c.rect(p.x, p.y, dot, dot); else dustPath.rect(p.x, p.y, dot, dot);
      }
      c.fill();
      c.globalAlpha = 0.12; c.fill(dustPath); c.globalAlpha = 1;

      // script label
      if (t > plan.formA && t < plan.end) {
        const key = targetKey === "A" ? lead : other;
        c.globalAlpha = ease((t - plan.formA) / 0.8) * 0.85;
        c.fillStyle = "#8C97A6"; c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "ltr";
        c.font = `500 40px ${SANS}`;
        c.fillText(SCRIPTS[key].label, RW / 2, 270); // below Instagram's own header
        c.globalAlpha = 1;
      }

      // reading and meaning
      if (t > plan.capIn && t < plan.end) {
        const a = Math.min(ease((t - plan.capIn) / 0.8), 1 - ease((t - plan.capOut + 0.4) / 0.4));
        c.globalAlpha = a; c.textAlign = "center"; c.direction = "ltr";
        let y = RH * 0.64;
        c.font = `italic 400 58px ${SERIF}`; c.fillStyle = "#F0CF8E";
        for (const l of wrapText(c, line.roman, RW * 0.84)) { c.fillText(l, RW / 2, y); y += 74; }
        y += 24;
        c.font = `400 44px ${SANS}`; c.fillStyle = "#EDE6DA";
        for (const l of wrapText(c, line.english, RW * 0.82)) { c.fillText(l, RW / 2, y); y += 60; }
        y += 26;
        c.font = `400 38px ${SANS}`; c.fillStyle = "#8C97A6";
        c.fillText("— " + line.poet, RW / 2, y);
        c.globalAlpha = 1;
      }

      // end card
      if (t >= plan.end) {
        const a = ease((t - plan.end) / 0.7);
        c.globalAlpha = a; c.textAlign = "center"; c.direction = "ltr";
        c.font = `400 76px ${SERIF}`; c.fillStyle = "#F0CF8E";
        c.fillText("One line, two scripts", RW / 2, RH * 0.46);
        c.font = `400 44px ${SANS}`; c.fillStyle = "#EDE6DA";
        c.fillText("Shahmukhi · Gurmukhi", RW / 2, RH * 0.46 + 90);
        if (handle) { c.font = `500 46px ${SANS}`; c.fillStyle = "#8C97A6"; c.fillText(handle, RW / 2, RH * 0.46 + 200); }
        c.globalAlpha = 1;
      }

      // cue for the person recording (not drawn into the video)
      r$("reel-cue").textContent =
        t < plan.capIn - 1.2 ? "Get ready…" :
        t < plan.capIn ? "Read in a moment…" :
        t < plan.capOut ? "Read now: " + line.roman :
        "Finishing…";
    }
    requestAnimationFrame(tick);
  });

  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  mic?.getTracks().forEach((t) => t.stop());
  reelActive = false;

  reelBlob = new Blob(chunks, { type: type.split(";")[0] });
  if (reelURL) URL.revokeObjectURL(reelURL);
  reelURL = URL.createObjectURL(reelBlob);
  r$("reel-stage").hidden = true; r$("reel-result").hidden = false;
  r$("reel-video").src = reelURL;
  const ext = type.includes("mp4") ? "mp4" : "webm";
  r$("reel-save").href = reelURL;
  r$("reel-save").download = `steady-${slug(line.roman)}.${ext}`;
  const file = new File([reelBlob], r$("reel-save").download, { type: reelBlob.type });
  r$("reel-share").hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  r$("reel-format").textContent = ext === "mp4" ? "" : "This phone recorded WebM, which Instagram may refuse. Updating Chrome usually gives MP4.";
  r$("reel-status").textContent = "";
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reel"; }

// ---------- sheet ----------
function openReel() {
  const sel = r$("reel-line");
  sel.replaceChildren(...lines.map((l, i) => {
    const o = document.createElement("option");
    o.value = i; o.textContent = (l.checked ? "" : "(not checked) ") + l.roman;
    return o;
  }));
  sel.value = String(index);
  try { r$("reel-handle").value = localStorage.getItem(HANDLE_KEY) || ""; } catch (_) { /* empty */ }
  updateReelWarning();
  r$("reel-setup").hidden = false; r$("reel-stage").hidden = true; r$("reel-result").hidden = true;
  r$("reel").hidden = false;
}
function updateReelWarning() {
  const l = lines[+r$("reel-line").value];
  r$("reel-warn").hidden = !l || l.checked;
}
function closeReel() {
  if (reelActive) return;
  r$("reel").hidden = true;
  r$("reel-video").removeAttribute("src");
}
r$("btn-reel").addEventListener("click", openReel);
r$("reel-line").addEventListener("change", updateReelWarning);
r$("reel-record").addEventListener("click", () => recordReel().catch((e) => {
  reelActive = false;
  r$("reel-setup").hidden = false; r$("reel-stage").hidden = true;
  r$("reel-status").textContent = "Recording failed: " + (e && e.message ? e.message : e);
}));
r$("reel-redo").addEventListener("click", () => { r$("reel-result").hidden = true; r$("reel-setup").hidden = false; });
r$("reel-close").addEventListener("click", closeReel);
r$("reel-close-2").addEventListener("click", closeReel);
r$("reel-share").addEventListener("click", async () => {
  const file = new File([reelBlob], r$("reel-save").download, { type: reelBlob.type });
  try { await navigator.share({ files: [file] }); }
  catch (e) { if (e && e.name !== "AbortError") r$("reel-status").textContent = "Sharing didn't work. Use Save instead."; }
});
