"use strict";
/* Reel Studio — turns a Punjabi saying into a 9:16 reel, in Shahmukhi.
   A saying has one or more parts (lines). Each part is shown in Shahmukhi, with the romanised
   reading and the English meaning, while it is spoken; then the next part follows.
   Voice: an uploaded recording (timed by tapping as each line starts), the microphone live
   (tap "next line" while speaking), or none (timed automatically).
   Music: a generated tanpura drone, the user's own music file, or none, mixed under the voice.
   Backgrounds: generated phulkari, generated mustard field at dusk, or the user's own photo/video. */

const RW = 1080, RH = 1920, FPS = 30, END_CARD = 3.4;
const $ = (id) => document.getElementById(id);
const KEYS = { handle: "reels.handle.v1", bg: "reels.bg.v1", mine: "reels.mine.v1", sound: "reels.sound.v1", music: "reels.music.v1", level: "reels.level.v1", key: "reels.key.v1" };

const F = {
  sm: '"Noto Nastaliq Urdu", serif',
  roman: '"Cormorant Garamond", Georgia, serif',
  body: '"Mukta", system-ui, sans-serif',
};
const C = { cream: "#FFF3DE", gold: "#FFC94A", muted: "rgba(255,243,222,0.62)", ink: "#140A0A" };

let library = [];               // { id, mine, poet, note, checked, parts: [{shahmukhi, roman, english}] }
const state = { id: null, bg: "phulkari", sound: "upload", music: "drone", level: 30, key: 138.59, handle: "" };
let userMedia = null;           // background image or video chosen by the user
let audioEl = null;             // uploaded voice recording
let musicEl = null;             // uploaded music file
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
  const parts = Array.isArray(raw.parts) ? raw.parts : [{ shahmukhi: raw.shahmukhi, roman: raw.roman, english: raw.english }];
  return { id, mine, poet: raw.poet || "", note: raw.note || "", checked: !!raw.checked,
    parts: parts.filter((p) => p && p.shahmukhi).map((p) => ({ shahmukhi: p.shahmukhi, roman: p.roman || "", english: p.english || "" })) };
}
function loadMine() { try { return JSON.parse(store.get(KEYS.mine, "[]")) || []; } catch (_) { return []; } }
function saveMine(list) { store.set(KEYS.mine, JSON.stringify(list)); }

// ---------- sound: one mixer for voice and music ----------
/* voice ─► voiceIn ─┐
   music ─► musicBus ─► musicOut (fades, volume) ─┼─► dest (recorded)
                                                  └─► monitor ─► speakers (muted while the mic is live) */
const Mixer = {
  ac: null, dest: null, voiceIn: null, musicBus: null, musicOut: null, monitor: null,
  voiceRouted: null, musicRouted: null, micSrc: null, droneTimer: null, droneBus: null,
  ensure() {
    if (this.ac) return;
    const ac = (this.ac = new (window.AudioContext || window.webkitAudioContext)());
    this.dest = ac.createMediaStreamDestination();
    this.voiceIn = ac.createGain(); this.voiceIn.connect(this.dest);
    this.musicBus = ac.createGain();
    this.musicOut = ac.createGain(); this.musicOut.gain.value = 0;
    this.musicBus.connect(this.musicOut);
    this.musicOut.connect(this.dest);
    this.monitor = ac.createGain(); this.musicOut.connect(this.monitor); this.monitor.connect(ac.destination);
  },
  wake() { this.ensure(); return this.ac.resume(); },
  // A media element can be routed through Web Audio only once, so each element is wired once.
  routeVoice(el) {
    this.ensure();
    if (this.voiceRouted === el) return;
    const s = this.ac.createMediaElementSource(el);
    s.connect(this.voiceIn); s.connect(this.ac.destination);
    this.voiceRouted = el;
  },
  routeMusic(el) {
    this.ensure();
    if (this.musicRouted === el) return;
    this.ac.createMediaElementSource(el).connect(this.musicBus);
    this.musicRouted = el;
  },
  level() { return (state.level / 100) * (state.music === "drone" ? 0.7 : 1); },
  async start({ mic, live, total }) {
    await this.wake();
    const t = this.ac.currentTime;
    if (mic) { this.micSrc = this.ac.createMediaStreamSource(mic); this.micSrc.connect(this.voiceIn); }
    this.monitor.gain.value = live ? 0 : 1; // never play music out loud into a live microphone
    const g = this.musicOut.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(0, t);
    if (state.music === "none") return;
    g.linearRampToValueAtTime(this.level(), t + 1.5);
    if (state.music === "drone") this.startDrone();
    if (state.music === "file" && musicEl) { this.routeMusic(musicEl); musicEl.currentTime = 0; musicEl.loop = true; musicEl.play().catch(() => {}); }
    if (isFinite(total)) this.fadeOutAt(total);
  },
  fadeOutAt(total) { // seconds from now until the reel ends
    if (!this.ac) return;
    const g = this.musicOut.gain, now = this.ac.currentTime, endAt = now + Math.max(0, total);
    g.setValueAtTime(this.level(), Math.max(now, endAt - 2.6));
    g.linearRampToValueAtTime(0, endAt);
  },
  setLevel() { if (this.ac && this.musicOut.gain.value > 0) this.musicOut.gain.setTargetAtTime(this.level(), this.ac.currentTime, 0.1); },
  stop() {
    if (!this.ac) return;
    clearInterval(this.droneTimer); this.droneTimer = null;
    if (this.droneBus) { this.droneBus.disconnect(); this.droneBus = null; }
    if (musicEl) musicEl.pause();
    if (this.micSrc) { this.micSrc.disconnect(); this.micSrc = null; }
    const g = this.musicOut.gain; g.cancelScheduledValues(this.ac.currentTime); g.setValueAtTime(0, this.ac.currentTime);
  },

  /* Tanpura: four strings plucked in a slow cycle (Pa, Sa, Sa, low Sa). Each pluck is a rich
     harmonic tone that decays over a few seconds, plus a second set of upper harmonics that
     swells after the pluck: the shimmering "jawari" buzz of the bridge. A short generated
     reverb gives it room. */
  startDrone() {
    const ac = this.ac;
    if (!this.waves) {
      const n = 18, re = new Float32Array(n), base = new Float32Array(n), bright = new Float32Array(n);
      for (let h = 1; h < n; h++) { base[h] = 1 / Math.pow(h, 1.25); bright[h] = h >= 4 && h <= 15 ? 0.7 / Math.sqrt(h) : 0; }
      this.waves = { base: ac.createPeriodicWave(re, base), bright: ac.createPeriodicWave(re, bright) };
      const len = Math.floor(ac.sampleRate * 2.8), ir = ac.createBuffer(2, len, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      this.ir = ir;
    }
    const bus = (this.droneBus = ac.createGain());
    const tone = ac.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 3800;
    const verb = ac.createConvolver(); verb.buffer = this.ir;
    const wet = ac.createGain(); wet.gain.value = 0.35;
    bus.connect(tone); tone.connect(this.musicBus); tone.connect(verb); verb.connect(wet); wet.connect(this.musicBus);
    const sa = state.key, strings = [sa * 0.75, sa, sa, sa * 0.5], offsets = [0, 1.15, 1.65, 2.2], cycle = 4.4;
    const pluck = (t0, f) => {
      const detune = (Math.random() - 0.5) * 4;
      const o1 = ac.createOscillator(), g1 = ac.createGain();
      o1.setPeriodicWave(this.waves.base); o1.frequency.value = f; o1.detune.value = detune;
      g1.gain.setValueAtTime(0.0001, t0); g1.gain.linearRampToValueAtTime(0.32, t0 + 0.012); g1.gain.exponentialRampToValueAtTime(0.0008, t0 + 4.2);
      const o2 = ac.createOscillator(), g2 = ac.createGain();
      o2.setPeriodicWave(this.waves.bright); o2.frequency.value = f; o2.detune.value = detune + 1.5;
      g2.gain.setValueAtTime(0.0001, t0); g2.gain.linearRampToValueAtTime(0.11, t0 + 0.45); g2.gain.exponentialRampToValueAtTime(0.0006, t0 + 3.6);
      o1.connect(g1); g1.connect(bus); o2.connect(g2); g2.connect(bus);
      o1.start(t0); o2.start(t0); o1.stop(t0 + 4.3); o2.stop(t0 + 4.3);
    };
    let next = ac.currentTime + 0.1, cycleStart = next, k = 0;
    const schedule = () => { // keep ~6 s of plucks queued ahead
      while (next < ac.currentTime + 6) {
        pluck(next, strings[k]);
        k++;
        if (k === strings.length) { k = 0; cycleStart += cycle; }
        next = cycleStart + offsets[k];
      }
    };
    schedule();
    this.droneTimer = setInterval(schedule, 1000);
  },
};

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
    sm: layout(c, p.shahmukhi, F.sm, 700, { x: X, y: 380, w: Wd, h: 620 }, { size: 124, min: 40, lineH: 1.9, rtl: true, spaceMul: 2.2 }),
    ro: p.roman ? layout(c, p.roman, F.roman, "italic 600", { x: X, y: 1050, w: Wd, h: 230 }, { size: 70, min: 34, lineH: 1.25 }) : null,
    en: p.english,
  };
}

// ---------- timing ----------
function partSeconds(p) { return Math.min(12, Math.max(4, words(p.roman || p.shahmukhi).length * 0.55 + 2.4)); }
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
    const a = ease((dt - i * 0.07) / 0.32) * alpha;
    if (a <= 0) return;
    c.globalAlpha = a;
    c.fillText(w.t, w.x, w.y + (1 - a) * 16); // textAlign "left" anchors the word's left edge, RTL too
  });
  c.shadowBlur = 0; c.globalAlpha = 1; c.direction = "ltr";
}
function wrapCentered(c, text, y, maxW, lh) {
  const out = []; let cur = "";
  for (const w of words(text)) { const t = cur ? cur + " " + w : w; if (c.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  out.forEach((l, i) => c.fillText(l, RW / 2, y + i * lh));
}
function lineCount(c, text, maxW) {
  let n = 1, cur = "";
  for (const w of words(text)) { const t = cur ? cur + " " + w : w; if (c.measureText(t).width > maxW && cur) { n++; cur = w; } else cur = t; }
  return n;
}
function drawPart(c, L, dt, alpha) {
  const step = (s) => alpha * ease((dt - s) / 0.4);
  drawWords(c, L.sm, dt, alpha);
  if (L.ro) drawWords(c, L.ro, dt - 0.45, alpha);
  const ea = step(0.8);
  if (ea > 0 && L.en) {
    c.globalAlpha = ea; c.fillStyle = C.cream;
    c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "ltr";
    // long meanings shrink to stay within three lines, clear of the horizon and Instagram's caption
    let size = 46;
    for (; size > 34; size -= 2) { c.font = `400 ${size}px ${F.body}`; if (lineCount(c, L.en, RW - 340) <= 3) break; }
    c.font = `400 ${size}px ${F.body}`;
    wrapCentered(c, L.en, 1340, RW - 340, size * 1.3);
    c.globalAlpha = 1;
  }
}

function render(c, t, tl) {
  const s = current();
  BACKGROUNDS[state.bg].draw(c, t);
  const outro = ease((t - tl.end) / 0.5);

  // poet or source, always at the top
  c.globalAlpha = ease((t - 0.2) / 0.6) * (1 - outro);
  c.font = `italic 600 52px ${F.roman}`; c.fillStyle = C.gold;
  c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "ltr";
  if (s.poet) c.fillText(s.poet, RW / 2, 270);
  c.globalAlpha = 1;

  // the part being spoken, fading out just before the next one starts
  if (t < tl.end) {
    let i = -1;
    for (let k = 0; k < tl.marks.length; k++) if (t >= tl.marks[k]) i = k;
    if (i >= 0) {
      const next = i + 1 < tl.marks.length ? tl.marks[i + 1] : tl.end;
      drawPart(c, layouts[i], t - tl.marks[i], 1 - ease((t - (next - 0.3)) / 0.3));
    }
  }

  // end card
  const ec = ease((t - tl.end - 0.2) / 0.7);
  if (ec > 0) {
    c.globalAlpha = ec; c.textAlign = "center"; c.textBaseline = "middle";
    c.font = `700 120px ${F.sm}`; c.fillStyle = C.gold; c.direction = "rtl";
    c.fillText("پنجابی", RW / 2, 820);
    c.direction = "ltr";
    c.font = `italic 600 64px ${F.roman}`; c.fillStyle = C.cream;
    c.fillText("Punjabi wisdom, in Shahmukhi", RW / 2, 1000);
    if (state.handle) { c.font = `600 46px ${F.body}`; c.fillStyle = C.muted; c.fillText(state.handle, RW / 2, 1120); }
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
  $("drone-box").hidden = state.music !== "drone";
  $("music-file-box").hidden = state.music !== "file";
  $("level-box").hidden = state.music === "none";
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
  if (preview) { preview.clock.stop(); Mixer.stop(); }
  preview = null;
  $("btn-preview").textContent = "Play preview";
}
function musicReady() {
  if (state.music === "file" && !musicEl) { $("status").textContent = "Choose a music file, or pick another music option."; return false; }
  return true;
}
$("btn-preview").addEventListener("click", async () => {
  if (preview) { stopPreview(); return; }
  if (state.sound === "upload" && !audioEl) { $("status").textContent = "Choose a recording first, or pick No voice."; return; }
  if (!musicReady()) return;
  $("status").textContent = "";
  const tl = timeline();
  if (state.sound === "upload") Mixer.routeVoice(audioEl);
  const clock = state.sound === "upload" ? audioClock() : wallClock();
  Object.values(BACKGROUNDS).forEach((b) => b.reset());
  if (userMedia instanceof HTMLVideoElement) { userMedia.currentTime = 0; userMedia.play().catch(() => {}); }
  await Mixer.start({ live: false, total: tl.total });
  await clock.start().catch(() => {});
  preview = { clock, tl };
  $("btn-preview").textContent = "Stop preview";
});

// ---------- recording ----------
async function record() {
  const s = current();
  if (!s || recording) return;
  stopPreview();
  $("status").textContent = "";
  if (state.sound === "upload" && !audioEl) { $("status").textContent = "Choose a recording first, or pick No voice."; return; }
  if (!musicReady()) return;

  const live = state.sound === "live";
  let mic = null;
  if (live) {
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (_) { $("status").textContent = "Microphone access was refused. Allow it in Chrome's site settings, or upload a recording instead."; return; }
  }
  const type = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!type) { $("status").textContent = "This browser can't record video. Use Chrome on Android."; mic?.getTracks().forEach((t) => t.stop()); return; }

  recording = true;
  document.body.classList.add("is-recording");
  Object.values(BACKGROUNDS).forEach((b) => b.reset());
  await Mixer.wake();
  if (state.sound === "upload") Mixer.routeVoice(audioEl);
  const stream = cv.captureStream(FPS);
  Mixer.dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));

  const tl = live ? { marks: [], end: Infinity, total: Infinity } : timeline();
  if (live) { $("live-next").hidden = false; $("live-next").textContent = `Start line 1 of ${s.parts.length}`; }

  for (const n of ["3", "2", "1"]) { $("cue").textContent = n; await new Promise((r) => setTimeout(r, 700)); }
  $("cue").textContent = live ? "Tap the button as you start each line" : state.sound === "upload" ? "Recording with the uploaded voice…" : "Recording…";

  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const clock = state.sound === "upload" ? audioClock() : wallClock();
  if (userMedia instanceof HTMLVideoElement) { userMedia.currentTime = 0; userMedia.play().catch(() => {}); }
  rec.start(250);
  await Mixer.start({ mic, live, total: tl.total });
  await clock.start();

  $("live-next").onclick = () => {
    const t = clock.now();
    if (tl.marks.length < s.parts.length) tl.marks.push(t);
    else if (tl.end === Infinity) { tl.end = t; tl.total = t + END_CARD; Mixer.fadeOutAt(END_CARD); $("live-next").hidden = true; return; }
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
  Mixer.stop();
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
  const base = (s.parts[0].roman || s.poet || "reel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reel";
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
  const ro = s.parts.map((p) => p.roman).filter(Boolean).join("\n");
  const en = s.parts.map((p) => p.english).filter(Boolean).join(" ");
  return `${sm}\n\n${ro}${en ? `\n\n"${en}"` : ""}${s.poet ? "\n— " + s.poet : ""}\n\n#Punjabi #پنجابی #Shahmukhi #PunjabiWisdom #PunjabiPoetry`;
}

// ---------- timing by tapping ----------
let tapMarks = [];
function openTiming() {
  const s = current();
  $("timing-list").replaceChildren(...s.parts.map((p, i) => { const li = document.createElement("li"); li.id = "tl-" + i; li.textContent = p.roman || p.shahmukhi; return li; }));
  $("tap").disabled = true; $("tap").textContent = "Tap when line 1 starts";
  $("timing-msg").textContent = "Press Play, then tap the big button each time a new line starts.";
  $("timing").hidden = false;
}
function closeTiming() { audioEl.pause(); audioEl.onended = null; $("timing").hidden = true; updateSoundUI(); }
$("btn-timing").addEventListener("click", () => { stopPreview(); openTiming(); });
$("timing-play").addEventListener("click", async () => {
  tapMarks = [];
  document.querySelectorAll("#timing-list li").forEach((li) => li.classList.remove("done"));
  if (Mixer.voiceRouted) await Mixer.wake(); // once routed, the recording only plays through the mixer
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
  const sm = rows("ed-sm"), ro = rows("ed-ro"), en = rows("ed-en");
  if (!sm.length) return { error: "Add the saying in Shahmukhi." };
  if (ro.length && ro.length !== sm.length) return { error: `The romanised version has ${ro.length} lines but the Shahmukhi has ${sm.length}. Match them line by line, or leave it empty.` };
  if (en.length && en.length !== sm.length) return { error: `The English has ${en.length} lines but the Shahmukhi has ${sm.length}. Match them line by line, or leave it empty.` };
  return { poet: $("ed-poet").value.trim(), note: $("ed-note").value.trim(), checked: $("ed-checked").checked,
    parts: sm.map((_, i) => ({ shahmukhi: sm[i], roman: ro[i] || "", english: en[i] || "" })) };
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
      const first = s.parts[0].roman || s.parts[0].shahmukhi;
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
document.querySelectorAll('input[name="music"]').forEach((r) => r.addEventListener("change", (e) => {
  state.music = e.target.value; store.set(KEYS.music, state.music); stopPreview(); updateSoundUI();
}));
$("drone-key").addEventListener("change", (e) => { state.key = +e.target.value; store.set(KEYS.key, e.target.value); stopPreview(); });
$("music-level").addEventListener("input", (e) => {
  state.level = +e.target.value; store.set(KEYS.level, e.target.value);
  $("music-level-out").textContent = `${state.level}%`;
  Mixer.setLevel();
});
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
$("music-file").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  stopPreview();
  if (!musicEl) { musicEl = new Audio(); musicEl.preload = "auto"; }
  else if (musicEl.src) URL.revokeObjectURL(musicEl.src);
  musicEl.src = URL.createObjectURL(f);
  $("music-file-status").textContent = f.name;
  musicEl.onerror = () => { $("music-file-status").textContent = "This file couldn't be played. Try an MP3 or M4A."; };
});
$("handle").addEventListener("input", (e) => { state.handle = e.target.value.trim(); store.set(KEYS.handle, state.handle); });
$("btn-record").addEventListener("click", () => record().catch((e) => {
  recording = false; document.body.classList.remove("is-recording"); $("live-next").hidden = true; Mixer.stop();
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
  state.sound = store.get(KEYS.sound, "upload"); if (!["upload", "live", "none"].includes(state.sound)) state.sound = "upload";
  document.querySelector(`input[name="sound"][value="${state.sound}"]`).checked = true;
  state.music = store.get(KEYS.music, "drone"); if (!["drone", "none"].includes(state.music)) state.music = "drone"; // a music file isn't remembered
  document.querySelector(`input[name="music"][value="${state.music}"]`).checked = true;
  state.level = +store.get(KEYS.level, "30"); $("music-level").value = state.level; $("music-level-out").textContent = `${state.level}%`;
  state.key = +store.get(KEYS.key, "138.59"); $("drone-key").value = String(state.key);
  if (!$("drone-key").value) { state.key = 138.59; $("drone-key").value = "138.59"; }
  $("status").textContent = "Loading sayings and fonts…";
  try {
    const j = await (await fetch("lines.json", { cache: "no-cache" })).json();
    fileSayings = (j.sayings || j.lines || []).map((r, i) => normalise(r, "f:" + i, false));
  } catch (_) { $("status").textContent = "Couldn't load lines.json. Your own saved sayings still work."; }
  await Promise.all([
    document.fonts.load(`700 60px "Noto Nastaliq Urdu"`, "پنجابی"),
    document.fonts.load(`italic 600 60px "Cormorant Garamond"`, "Bulleh"),
    document.fonts.load(`400 40px "Mukta"`, "Bulleh"),
  ]).catch(() => {});
  if ($("status").textContent.startsWith("Loading")) $("status").textContent = "";
  rebuildLibrary();
  requestAnimationFrame(loop);
})();

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
