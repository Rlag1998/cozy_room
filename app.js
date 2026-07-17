'use strict';
/* ============================================================================
   snug · a cozy room machine
   ----------------------------------------------------------------------------
   A fully deterministic, seeded, procedural cozy-room generator.
   Same seed => pixel-identical scene content. (Math.random is never used for
   scene content — only crypto.getRandomValues when MINTING a fresh seed.)
   Sections: 1 utils/rng/color · 2 architecture · 3 item catalog · 4 engine/ui
============================================================================ */

/* ================================ 1. CORE ================================ */

const SW = 960, SH = 600;            // logical scene units (16:10)

/* ---- seeded prng ---- */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// independent, forkable stream per subsystem — adding features later never
// reshuffles unrelated parts of old seeds
const makeStreams = seed => name => mulberry32(xmur3(seed + '|' + name)());

const rf = (r, a, b) => a + (b - a) * r();
const ri = (r, a, b) => Math.floor(rf(r, a, b + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const chance = (r, p) => r() < p;
function wpick(r, pairs) {              // pairs: [[value, weight], ...]
  let tot = 0; for (const p of pairs) tot += p[1];
  let x = r() * tot;
  for (const p of pairs) { if ((x -= p[1]) <= 0) return p[0]; }
  return pairs[pairs.length - 1][0];
}

/* ---- math ---- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/* ---- color: {h,s,l,a} objects, hue-drifted two-tone shading ---- */
function col(h, s, l, a = 1) {
  return { h: ((h % 360) + 360) % 360, s: clamp(s, 0, 100), l: clamp(l, 0, 100), a };
}
const css = c => `hsla(${c.h.toFixed(1)},${c.s.toFixed(1)}%,${c.l.toFixed(1)}%,${c.a ?? 1})`;
function lerpHue(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
// shadows drift toward dusk blue, highlights toward lamplight amber
const shade = (c, d = 10) => col(lerpHue(c.h, 250, .22), Math.min(c.s + 6, 100), c.l - d, c.a);
const lite  = (c, d = 8)  => col(lerpHue(c.h, 46, .18), Math.max(c.s - 6, 0), c.l + d, c.a);
const withA = (c, a) => ({ ...c, a });

/* ---- seed words ---- */
const ADJ = ('mossy amber sleepy velvet honeyed quiet dappled misty butter tawny golden dusky rainy snowy fern cedar clover maple hazel ember woolly minty plush faded tea rusty pale lilac drowsy toasty pebble bramble willow candlelit fireside foggy harvest juniper lantern marmalade nutmeg orchard patchwork pinecone saffron thimble tulip twilight biscuit chamomile drifting feather gingham hollyhock inkwell jasmine kettle lullaby').split(' ');
const NOUN = ('teacup otter fox lantern quilt sparrow acorn kettle biscuit moth clementine fern mitten bramble owl pudding wren snail hearth satchel dumpling turnip badger thistle cocoa marble pillow shutter clover crumpet bobbin femur gnome hedgehog inkpot jam knapsack loaf meadow nook ottoman pantry raccoon slipper toadstool umbrella violet walnut yarnball attic bellows cardigan dormouse eiderdown firefly gingersnap hobbit').split(' ');

function mintSeed() {          // the ONLY non-seeded entropy in this file
  const u = new Uint32Array(3);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(u);
  else { u[0] = Date.now(); u[1] = Date.now() >> 3; u[2] = Date.now() >> 5; }
  return ADJ[u[0] % ADJ.length] + '-' + NOUN[u[1] % NOUN.length] + '-' +
         String(u[2] % 1000).padStart(3, '0');
}

/* ---- moods ---- */
const MOODS = {
  day:    { Sx: .44, wallL: 78, glow: .14, ambient: col(48, 14, 93), sky: [col(205, 55, 74), col(45, 60, 88)] },
  golden: { Sx: .52, wallL: 73, glow: .30, ambient: col(34, 45, 80), sky: [col(230, 35, 60), col(28, 85, 66)] },
  dusk:   { Sx: .46, wallL: 56, glow: .42, ambient: col(268, 25, 64), sky: [col(258, 40, 34), col(340, 45, 55)] },
  night:  { Sx: .36, wallL: 39, glow: .55, ambient: col(228, 30, 53), sky: [col(232, 45, 14), col(222, 40, 26)] },
};
const HUE_FAMILIES = [
  [[18, 45], 28, 'terracotta'], [[45, 70], 10, 'mustard'], [[135, 170], 16, 'sage'],
  [[200, 228], 16, 'dusty blue'], [[258, 288], 14, 'mauve'], [[330, 356], 16, 'rose'],
];

/* ---- palette: seeded, always harmonious ---- */
function buildPalette(r, weather, forceMood) {
  let mood = wpick(r, [['day', 34], ['golden', 22], ['dusk', 20], ['night', 24]]);
  if (forceMood) mood = forceMood;
  const M = MOODS[mood];
  const fam = wpick(r, HUE_FAMILIES.map(f => [f, f[1]]));
  const H = rf(r, fam[0][0], fam[0][1]);
  let Sx = M.Sx;
  let glow = M.glow;
  if (weather === 'rain' || weather === 'snow') { Sx *= .92; glow += .08; } // cozier inside
  const wallL = M.wallL + rf(r, -3, 3);
  let wallS = 34 * Sx;

  // floor
  const wood = chance(r, .70);
  let floorHue = wood ? 25 + rf(r, -12, 12) : (H + 30 + rf(r, -10, 10) + 360) % 360;
  const floorL = clamp(wallL - 22, 22, 58);
  const floorS = 40 * Sx;

  // taste rails — bad combos are corrected, not hoped against
  if (mood === 'night' && H >= 70 && H <= 150) wallS = Math.min(wallS, 22 * Sx);
  if (Math.abs(H - floorHue) < 25 && wallS > 30) wallS = 18;

  const accentH = (H + pick(r, [150, 180, 210])) % 360;
  const accentS = Math.min(55 * Sx + 20, 55);
  const textileH = (H + rf(r, -14, 14) + 360) % 360;
  const leafGreen = col(95 + rf(r, 0, 40), 30 + rf(r, 0, 18), 32 + rf(r, 0, 14));

  // 5-step quantized lightness ramp relative to the wall
  const ramp = [wallL - 45, wallL - 32, wallL - 20, wallL - 8, wallL + 6]
    .map(L => clamp(L, 14, 92));

  const P = {
    mood, M, H, Sx, glow, wallL,
    ambient: M.ambient, sky: M.sky,
    wall: col(H, wallS, wallL),
    floor: col(floorHue, floorS, floorL),
    base: col(floorHue, floorS, clamp(floorL + 10, 14, 92)),   // baseboard
    accent: col(accentH, accentS, clamp(rf(r, 48, 62), 45, 70)),
    textileH, leafGreen, ramp, wood,
    famName: fam[2],
    warm: col(36, 90, 62),               // universal lamp/fire warmth
  };

  // spice pool for book spines, glazes, art, fruit
  P.spice = [
    P.accent,
    col(accentH + 20, accentS, 55), col(accentH - 20, accentS, 48),
    col(textileH, 40 * Sx + 10, ramp[3]),
    col(H, 8, 88), leafGreen,
  ];

  // quantized item color — items may ONLY get colors from here
  P.item = (rr, opts = {}) => {
    const hue = wpick(rr, [
      [(H + rf(rr, -14, 14)) % 360, 45],
      [(accentH + rf(rr, -10, 10)) % 360, 18],
      [(floorHue + 8) % 360, 22],
      [-1, 15],                                          // neutral
    ]);
    const step = opts.step != null ? opts.step : ri(rr, 0, 4);
    const L = ramp[clamp(step, 0, 4)];
    if (hue < 0) return col(40, 8, L);
    const sat = clamp((opts.sat ?? 30) * Sx + rf(rr, 0, 10), 6, 62);
    return col(hue, sat, L);
  };
  // contrast guard — nudge one ramp step away if too close to background
  P.contrast = (c, behindL, min = 12) => {
    if (Math.abs(c.l - behindL) >= min) return c;
    return col(c.h, c.s, behindL > 50 ? behindL - (min + 4) : behindL + (min + 4));
  };
  return P;
}

/* ---- layout primitives ---- */
class Lane {
  constructor(x0, x1) { this.min = x0; this.max = x1; this.spans = []; }
  fits(x0, x1, gap = 10) {
    if (x0 < this.min || x1 > this.max) return false;
    for (const s of this.spans) if (x0 - gap < s[1] && x1 + gap > s[0]) return false;
    return true;
  }
  add(x0, x1) { this.spans.push([x0, x1]); }
  coverage() { let c = 0; for (const s of this.spans) c += s[1] - s[0]; return c / (this.max - this.min); }
  gaps(gap = 10) {
    const ss = [...this.spans].sort((a, b) => a[0] - b[0]);
    const out = []; let x = this.min;
    for (const s of ss) { if (s[0] - gap > x) out.push([x, s[0] - gap]); x = Math.max(x, s[1] + gap); }
    if (this.max > x) out.push([x, this.max]);
    return out;
  }
}
const rectsOverlap = (a, b, pad = 0) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x &&
  a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/* ---- style helpers: no item may bypass these ---- */
function rrPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r ?? clamp(.06 * Math.min(w, h), 3, 14), w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fillRR(ctx, x, y, w, h, r, c) { rrPath(ctx, x, y, w, h, r); ctx.fillStyle = css(c); ctx.fill(); }
// two-tone cel shading: base + one shade fill clipped to bottom (or right) band
function twoToneRR(ctx, x, y, w, h, r, c, mode = 'bottom', frac = .35) {
  fillRR(ctx, x, y, w, h, r, c);
  ctx.save(); rrPath(ctx, x, y, w, h, r); ctx.clip();
  ctx.fillStyle = css(shade(c));
  if (mode === 'bottom') ctx.fillRect(x, y + h * (1 - frac), w, h * frac);
  else ctx.fillRect(x + w * (1 - frac), y, w * frac, h);
  ctx.restore();
}
function ell(ctx, cx, cy, rx, ry, c) {
  ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(rx, .1), Math.max(ry, .1), 0, 0, TAU);
  ctx.fillStyle = css(c); ctx.fill();
}
function poly(ctx, pts, c) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath(); ctx.fillStyle = css(c); ctx.fill();
}
function line(ctx, x1, y1, x2, y2, c, w = 2, cap = 'round') {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = css(c); ctx.lineWidth = w; ctx.lineCap = cap; ctx.stroke();
}
// welds an object to the floor — drawn AFTER the item so it laps the bottom edge
function contactShadow(ctx, P, cx, baseline, w, a = .18) {
  ell(ctx, cx, baseline + 2, w * .46, 5, col(P.H, 40, 8, a));
}

/* ============================= 2. ARCHITECTURE ============================= */

/* ---- shell generation (all randomness drawn here, drawing stays pure) ---- */
function genShell(streams, P, weather) {
  const r = streams('shell');
  const floorY = SH * rf(r, .70, .78);
  const FD = SH - floorY;
  const shell = {
    floorY, FD,
    yB: floorY + .22 * FD,           // back-lane baseline
    yF: floorY + .62 * FD,           // front-lane baseline
    wallTreat: wpick(r, [['solid', 28], ['wainscot', 16], ['stripes', 14], ['dots', 10],
                         ['scallop', 10], ['wash', 8], ['brick', 14]]),
    floorTreat: wpick(r, [['planks', 50], ['checker', 15], ['solid', 20], ['carpet', 15]]),
    weather,
    windows: [], door: null,
  };

  // windows
  const winCount = wpick(r, [[1, 70], [2, 22], [0, 8]]);
  const styles = [['sash', 44], ['wide', 22], ['arch', 18], ['round', 8], ['french', 8]];
  const thirds = winCount === 2 ? [pick(r, [0, 1]), 2] : [ri(r, 0, 2)];
  for (let i = 0; i < winCount; i++) {
    const style = wpick(r, styles);
    let w, h;
    if (style === 'wide') { w = rf(r, 260, 340); h = rf(r, 160, 210); }
    else if (style === 'round') { w = h = rf(r, 140, 190); }
    else if (style === 'french') { w = rf(r, 180, 240); h = rf(r, 230, 290); }
    else { w = rf(r, 150, 220); h = rf(r, 190, 260); }
    h = Math.min(h, floorY * .62);
    const third = thirds[i];
    const cx = clamp(160 + third * 320 + rf(r, -60, 60), 40 + w / 2, SW - 40 - w / 2);
    const y = .10 * floorY + rf(r, 0, 14);
    shell.windows.push({
      style, w, h, x: cx - w / 2, y, cx,
      dress: style === 'round' ? 'bare' : wpick(r, [['curtains', 55], ['blind', 15], ['bare', 30]]),
      curtainC: col(P.textileH, 38 * P.Sx + 12, clamp(P.ramp[ri(r, 1, 3)], 20, 80)),
      blindDrop: rf(r, .2, .6),
      frameL: chance(r, .5) ? clamp(P.wallL + 10, 0, 94) : 90,
      idx: i,
    });
  }

  // door — 12% of rooms, only when there's wall space for it
  if (winCount < 2 && chance(r, .12)) {
    const w = rf(r, 110, 130), h = .82 * floorY;
    let x = clamp(160 + pick(r, [0, 1, 2]) * 320 - w / 2 + rf(r, -50, 50), 30, SW - 30 - w);
    const doorRect = { x, y: floorY - h, w, h };
    if (!shell.windows.some(win => rectsOverlap(doorRect, winRect(win), 30))) {
      shell.door = {
        x, w, h, rounded: chance(r, .2), panels: ri(r, 2, 4),
        c: col(P.wood ? P.floor.h : P.H + 20, 30 * P.Sx, P.ramp[ri(r, 1, 2)]),
        knobRight: chance(r, .5),
      };
    }
  }

  // outside world
  shell.outside = {
    silhouette: wpick(r, [['hills', 40], ['pines', 30], ['town', 30]]),
    moon: wpick(r, [['full', 25], ['gibbous', 25], ['crescent', 40], ['new', 10]]),
    moonX: rf(r, .2, .8), moonY: rf(r, .12, .38),
    sunX: rf(r, .25, .75),
  };
  return shell;
}
const winRect = w => ({ x: w.x, y: w.y, w: w.w, h: w.h });

/* ---- wall & floor ---- */
function drawWall(ctx, S) {
  const { P, shell } = S, r = S.streams('wallTex');
  const fy = shell.floorY, W = P.wall;
  ctx.fillStyle = css(W); ctx.fillRect(0, 0, SW, fy);
  const t = shell.wallTreat;
  if (t === 'wainscot') {
    const hy = fy * .62;
    ctx.fillStyle = css(col(W.h, W.s, W.l - 8)); ctx.fillRect(0, hy, SW, fy - hy);
    ctx.fillStyle = css(col(W.h, W.s, W.l + 6)); ctx.fillRect(0, hy - 6, SW, 6);
  } else if (t === 'stripes') {
    const sw = rf(r, 46, 70);
    for (let x = 0, i = 0; x < SW; x += sw, i++)
      if (i % 2) { ctx.fillStyle = css(col(W.h, W.s, W.l + (chance(r, .5) ? 4 : -4))); ctx.fillRect(x, 0, sw, fy); }
  } else if (t === 'dots') {
    ctx.fillStyle = css(col(W.h, W.s, W.l + 7));
    for (let gy = 40, row = 0; gy < fy - 20; gy += 64, row++)
      for (let gx = 32 + (row % 2) * 32; gx < SW; gx += 64) {
        if (chance(r, .08)) { // 4-point star
          poly(ctx, [[gx, gy - 7], [gx + 2, gy - 2], [gx + 7, gy], [gx + 2, gy + 2], [gx, gy + 7], [gx - 2, gy + 2], [gx - 7, gy], [gx - 2, gy - 2]], col(W.h, W.s, W.l + 7));
        } else { ctx.beginPath(); ctx.arc(gx, gy, 5, 0, TAU); ctx.fill(); }
      }
  } else if (t === 'scallop') {
    ctx.strokeStyle = css(col(W.h, W.s, W.l - 6, .7)); ctx.lineWidth = 2;
    for (let gy = 30, row = 0; gy < fy - 10; gy += 30, row++)
      for (let gx = (row % 2) * 26; gx < SW + 26; gx += 52) {
        ctx.beginPath(); ctx.arc(gx, gy, 26, Math.PI, 0); ctx.stroke();
      }
  } else if (t === 'wash') {
    const g = ctx.createLinearGradient(0, 0, 0, fy);
    g.addColorStop(0, css(col(W.h, W.s, W.l - 6))); g.addColorStop(1, css(W));
    ctx.fillStyle = g; ctx.fillRect(0, 0, SW, fy);
  } else if (t === 'brick') {
    const bw = 58, bh = 22;
    for (let gy = 0, row = 0; gy < fy; gy += bh, row++)
      for (let gx = -bw + (row % 2) * (bw / 2); gx < SW; gx += bw) {
        ctx.fillStyle = css(col(W.h, W.s, W.l + rf(r, -2, 2)));
        rrPath(ctx, gx + 1.5, gy + 1.5, bw - 3, bh - 3, 3); ctx.fill();
      }
    // mortar shows through as the wall base — repaint base under bricks first:
    // (cheap trick: bricks are drawn over a slightly lighter wall)
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = css(col(W.h, W.s, W.l + 5)); ctx.fillRect(0, 0, SW, fy);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawFloor(ctx, S) {
  const { P, shell } = S, r = S.streams('floorTex');
  const fy = shell.floorY, FD = shell.FD, F = P.floor;
  ctx.fillStyle = css(F); ctx.fillRect(0, fy, SW, FD);
  const t = shell.floorTreat;
  if (t === 'planks') {
    const rows = FD > 150 ? 3 : 2, rh = FD / rows;
    ctx.strokeStyle = css(col(F.h, F.s, F.l - 7, .5)); ctx.lineWidth = 2;
    for (let i = 1; i < rows; i++) { ctx.beginPath(); ctx.moveTo(0, fy + i * rh); ctx.lineTo(SW, fy + i * rh); ctx.stroke(); }
    for (let i = 0; i < rows; i++) {
      let x = -rf(r, 0, 140);
      while (x < SW - 8) {
        const seg = rf(r, 140, 220); x += seg;
        if (x > SW - 4) break;
        line(ctx, x, fy + i * rh + 2, x, fy + (i + 1) * rh - 2, col(F.h, F.s, F.l - 7, .5), 2, 'butt');
        if (chance(r, .12)) ell(ctx, x - seg * rf(r, .3, .7), fy + i * rh + rh * rf(r, .3, .7), 2.2, 1.6, col(F.h, F.s, F.l - 12, .6));
      }
      // subtle per-row tone
      ctx.fillStyle = css(col(F.h, F.s, F.l + (i % 2 ? 1.5 : -1.5), .25));
      ctx.fillRect(0, fy + i * rh, SW, rh);
    }
  } else if (t === 'checker') {
    const s = 44;
    ctx.fillStyle = css(col(F.h, F.s, F.l + 6));
    for (let gy = fy, row = 0; gy < SH; gy += s, row++)
      for (let gx = (row % 2) * s; gx < SW; gx += s * 2) ctx.fillRect(gx, gy, s, Math.min(s, SH - gy));
  } else if (t === 'carpet') {
    for (let i = 0; i < 300; i++)
      ell(ctx, rf(r, 0, SW), rf(r, fy + 2, SH - 2), 1.1, 1.1, col(F.h, F.s, F.l + rf(r, -5, 5), .8));
  }
  // baseboard
  ctx.fillStyle = css(P.base); ctx.fillRect(0, fy - 14, SW, 14);
  ctx.fillStyle = css(lite(P.base, 5)); ctx.fillRect(0, fy - 14, SW, 2.5);
}

/* baked ambient occlusion: junction seam + halos behind tall furniture */
function drawAO(ctx, S) {
  const fy = S.shell.floorY, P = S.P;
  let g = ctx.createLinearGradient(0, fy - 10, 0, fy + 14);
  g.addColorStop(0, css(col(P.H, 30, 10, 0)));
  g.addColorStop(.42, css(col(P.H, 30, 10, .14)));
  g.addColorStop(1, css(col(P.H, 30, 10, 0)));
  ctx.fillStyle = g; ctx.fillRect(0, fy - 10, SW, 24);
}
function drawHalo(ctx, S, it) {   // soft wall shadow behind tall back-lane items
  const fy = S.shell.floorY;
  if (it.h < .35 * fy) return;
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  const c = col(S.P.H, 25, 30, .08);
  fillRR(ctx, it.x - 8, it.y - it.h - 8, it.w + 16, it.h + 8, 12, c);
  ctx.restore();
}

/* ---- outside the window ---- */
function glassClip(ctx, win) {
  const { x, y, w, h, style } = win;
  ctx.beginPath();
  if (style === 'round') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU);
  else if (style === 'arch') {
    const r = w / 2;
    ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath();
  } else ctx.rect(x, y, w, h);
}

function drawOutside(ctx, S, win) {
  const { P, shell } = S, r = S.streams('outside' + win.idx);
  const { x, y, w, h } = win;
  ctx.save(); glassClip(ctx, win); ctx.clip();

  // sky
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, css(P.sky[0])); g.addColorStop(1, css(P.sky[1]));
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);

  const mood = P.mood;
  // celestial bodies
  if (mood === 'night' || mood === 'dusk') {
    const n = mood === 'night' ? 26 : 8;
    win.stars = [];
    for (let i = 0; i < n; i++) {
      const sx = x + rf(r, .04, .96) * w, sy = y + rf(r, .04, .6) * h, sr = rf(r, .8, 1.7);
      win.stars.push({ x: sx, y: sy, r: sr, tw: chance(r, .2), ph: rf(r, 0, TAU) });
      ell(ctx, sx, sy, sr, sr, col(50, 60, 88, .9));
    }
    if (mood === 'night' && shell.outside.moon !== 'new') {
      const mx = x + shell.outside.moonX * w, my = y + shell.outside.moonY * h;
      const mr = S.rare.harvestMoon ? 26 : 16;
      const mc = S.rare.harvestMoon ? col(35, 80, 78) : col(48, 30, 88);
      ell(ctx, mx, my, mr, mr, mc);
      if (shell.outside.moon === 'crescent') ell(ctx, mx + mr * .45, my - mr * .18, mr * .92, mr * .92, P.sky[0]);
      if (shell.outside.moon === 'gibbous') ell(ctx, mx + mr * .55, my - mr * .2, mr * .55, mr * .55, withA(P.sky[0], .85));
      ell(ctx, mx, my, mr * 2.2, mr * 2.2, col(48, 40, 80, .08)); // halo
    }
  }
  if (mood === 'golden') {
    const sx = x + shell.outside.sunX * w, sy = y + h * .55;
    ell(ctx, sx, sy, 22, 22, col(30, 95, 70));
    ell(ctx, sx, sy, 34, 34, col(30, 95, 70, .25));
    for (let i = 0; i < 3; i++) // long cloud bars
      fillRR(ctx, x + rf(r, 0, .5) * w, y + h * rf(r, .2, .55), w * rf(r, .3, .6), 7, 4, col(28, 60, 74, .5));
  }
  if (mood === 'day') {
    for (let i = 0, n = ri(r, 2, 3); i < n; i++) {
      const cx = x + rf(r, .1, .9) * w, cy = y + h * rf(r, .12, .4), s = rf(r, .7, 1.3);
      const cc = col(210, 30, 96, .92);
      ell(ctx, cx, cy, 26 * s, 12 * s, cc); ell(ctx, cx - 16 * s, cy + 4 * s, 16 * s, 9 * s, cc);
      ell(ctx, cx + 15 * s, cy + 4 * s, 18 * s, 9 * s, cc);
    }
  }

  // horizon silhouette
  const horizon = y + h * .72;
  const sil = shell.outside.silhouette;
  const silL = { day: 52, golden: 26, dusk: 17, night: 10 }[mood];
  const silC = col(P.sky[0].h, mood === 'day' ? 32 : 28, silL);
  const caps = [];   // for snow
  ctx.beginPath(); ctx.moveTo(x, y + h);
  if (sil === 'hills') {
    ctx.lineTo(x, horizon + 10);
    for (let gx = x; gx <= x + w + 20; gx += 20) {
      const gy = horizon + 12 - 26 * Math.abs(Math.sin((gx - x) / w * 2.4 + rf(r, 0, .01) + win.idx));
      ctx.lineTo(gx, gy); if (gx % 60 < 20) caps.push([gx, gy]);
    }
  } else if (sil === 'pines') {
    ctx.lineTo(x, horizon + 14);
    let gx = x;
    while (gx < x + w + 10) {
      const tw = rf(r, 16, 30), th = rf(r, 24, 52);
      ctx.lineTo(gx, horizon + 14); ctx.lineTo(gx + tw / 2, horizon + 14 - th); ctx.lineTo(gx + tw, horizon + 14);
      caps.push([gx + tw / 2, horizon + 14 - th]);
      gx += tw;
    }
  } else { // town
    ctx.lineTo(x, horizon + 16);
    let gx = x;
    win.townLights = [];
    while (gx < x + w + 10) {
      const bw = rf(r, 24, 46), bh = rf(r, 18, 46);
      ctx.lineTo(gx, horizon + 16); ctx.lineTo(gx, horizon + 16 - bh);
      ctx.lineTo(gx + bw, horizon + 16 - bh); ctx.lineTo(gx + bw, horizon + 16);
      caps.push([gx + bw / 2, horizon + 16 - bh]);
      if ((mood === 'dusk' || mood === 'night') && chance(r, .7))
        win.townLights.push([gx + rf(r, .2, .8) * bw, horizon + 16 - rf(r, .3, .8) * bh]);
      gx += bw + rf(r, 2, 10);
    }
  }
  ctx.lineTo(x + w, y + h); ctx.closePath();
  ctx.fillStyle = css(silC); ctx.fill();
  if (win.townLights) for (const [lx, ly] of win.townLights)
    fillRR(ctx, lx - 2, ly - 2.5, 4, 5, 1.5, col(42, 85, 70, .95));
  if (shell.weather === 'snow') {
    for (const [cx2, cy2] of caps) fillRR(ctx, cx2 - 7, cy2 - 2, 14, 4, 2, col(210, 15, 92, .9));
    ctx.fillStyle = css(col(210, 15, 90)); ctx.fillRect(x, horizon + 14, w, y + h - horizon - 14);
  }
  if (shell.weather === 'fog') {
    fillRR(ctx, x - 4, horizon - 18, w + 8, 13, 6, col(P.sky[0].h, 20, 80, .35));
    fillRR(ctx, x - 4, horizon + 4, w + 8, 16, 8, col(P.sky[0].h, 20, 84, .45));
  }
  if (S.rare.rainbow) {
    const rcx = x + w * .5, rcy = y + h * .95;
    const hues = [0, 35, 60, 130, 240];
    ctx.lineWidth = 5;
    hues.forEach((hh, i) => {
      ctx.beginPath(); ctx.arc(rcx, rcy, w * .42 - i * 6, Math.PI * 1.05, Math.PI * 1.95);
      ctx.strokeStyle = css(col(hh, 60, 65, .4)); ctx.stroke();
    });
  }
  ctx.restore();
}

function drawWindow(ctx, S, win) {
  const { P } = S;
  drawOutside(ctx, S, win);
  const { x, y, w, h, style } = win;
  const fc = col(P.H, 12 * P.Sx, win.frameL);
  ctx.save();
  glassClip(ctx, win);
  // mullions
  ctx.strokeStyle = css(fc); ctx.lineCap = 'butt';
  ctx.lineWidth = 7;
  if (style === 'sash' || style === 'french') {
    ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + h * .5); ctx.lineTo(x + w, y + h * .5); ctx.stroke();
    if (style === 'french') { ctx.beginPath(); ctx.moveTo(x, y + h * .25); ctx.lineTo(x + w, y + h * .25); ctx.moveTo(x, y + h * .75); ctx.lineTo(x + w, y + h * .75); ctx.stroke(); }
  } else if (style === 'wide') {
    ctx.beginPath(); ctx.moveTo(x + w / 3, y); ctx.lineTo(x + w / 3, y + h);
    ctx.moveTo(x + 2 * w / 3, y); ctx.lineTo(x + 2 * w / 3, y + h); ctx.stroke();
  } else if (style === 'arch') {
    ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + w / 2); ctx.lineTo(x + w, y + w / 2); ctx.stroke();
  } else if (style === 'round') {
    ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
  }
  ctx.restore();
  // frame
  ctx.save();
  ctx.strokeStyle = css(fc); ctx.lineWidth = 11; glassClip(ctx, win); ctx.stroke();
  ctx.strokeStyle = css(shade(fc, 7)); ctx.lineWidth = 3;
  glassClip(ctx, win); ctx.stroke();
  ctx.restore();

  // sill (round windows skip it)
  if (style !== 'round') {
    fillRR(ctx, x - 12, y + h, w + 24, 12, 4, lite(fc, 4));
    ctx.fillStyle = css(shade(fc, 6)); ctx.fillRect(x - 12, y + h + 9, w + 24, 3);
  }

  // dressing
  if (win.dress === 'curtains' && style !== 'round') {
    const cw = w * .24, cc = win.curtainC;
    for (const side of [-1, 1]) {
      const cx = side < 0 ? x - cw * .55 : x + w - cw * .45;
      twoToneRR(ctx, cx, y - 12, cw, h * rf(S.streams('curt' + win.idx + side), .82, 1.02) + 16, 10, cc, side < 0 ? 'bottom' : 'bottom');
      // scallop hem
      const hemY = y - 12 + h * .92;
      for (let i = 0; i < 3; i++)
        ell(ctx, cx + cw * (i + .5) / 3, hemY + 12, cw / 6 + 1, 7, shade(cc, 4));
      // tieback
      fillRR(ctx, cx - 2, y + h * .45, cw + 4, 9, 5, lite(cc, 10));
    }
    // valance rod
    fillRR(ctx, x - cw * .6, y - 16, w + cw * 1.2, 7, 3.5, shade(cc, 12));
  } else if (win.dress === 'blind') {
    const bh = h * win.blindDrop;
    twoToneRR(ctx, x - 4, y - 6, w + 8, bh, 5, win.curtainC, 'bottom', .2);
    for (let ly = y + 12; ly < y + bh - 10; ly += 13)
      line(ctx, x - 1, ly, x + w + 1, ly, withA(shade(win.curtainC, 5), .5), 1.5);
    fillRR(ctx, x + w / 2 - 1.5, y + bh - 4, 3, 12, 1.5, shade(win.curtainC, 10));
  }
}

function drawDoor(ctx, S, d) {
  const { P, shell } = S;
  const y0 = shell.floorY - d.h;
  const fc = col(P.H, 12 * P.Sx, clamp(P.wallL + 10, 0, 94));
  // frame trim
  fillRR(ctx, d.x - 9, y0 - 9, d.w + 18, d.h + 9, d.rounded ? d.w / 2 + 9 : 6, fc);
  // slab
  const rTop = d.rounded ? d.w / 2 : 8;
  ctx.save();
  rrPath(ctx, d.x, y0, d.w, d.h + 10, rTop); ctx.clip();
  ctx.fillStyle = css(d.c); ctx.fillRect(d.x, y0, d.w, d.h);
  ctx.fillStyle = css(withA(shade(d.c, 7), .55)); ctx.fillRect(d.x, y0 + d.h * .88, d.w, d.h * .12);
  ctx.restore();
  // panels
  const pad = 16, ph = (d.h - pad * (d.panels + 1) - (d.rounded ? d.w * .3 : 0)) / d.panels;
  for (let i = 0; i < d.panels; i++) {
    const py = y0 + (d.rounded ? d.w * .3 : 0) + pad + i * (ph + pad);
    fillRR(ctx, d.x + pad, py, d.w - pad * 2, ph, 6, shade(d.c, 5));
    fillRR(ctx, d.x + pad + 3, py + 3, d.w - pad * 2 - 6, ph - 6, 5, lite(d.c, 2));
  }
  // knob
  const kx = d.knobRight ? d.x + d.w - 16 : d.x + 16;
  ell(ctx, kx, y0 + d.h * .52, 5, 5, col(40, 38, 58));
  ell(ctx, kx - 1.2, y0 + d.h * .52 - 1.2, 1.8, 1.8, col(40, 45, 80));
}

/* ---- rug ---- */
function drawRug(ctx, S) {
  const rug = S.rug; if (!rug) return;
  const { P } = S, r = S.streams('rug');
  const cy = S.shell.floorY + .45 * S.shell.FD;
  const rh = clamp(S.shell.FD * .52, 52, 86);
  const c0 = P.contrast(col(rug.h, rug.s, rug.l), P.floor.l, 14);
  if (rug.shape === 'ellipse') {
    ell(ctx, rug.cx, cy, rug.w / 2, rh / 2, c0);
    for (let i = 0; i < rug.bands; i++) {
      const k = 1 - (i + 1) * .16;
      ell(ctx, rug.cx, cy, rug.w / 2 * k, rh / 2 * k, i % 2 ? c0 : rug.bandC);
    }
    ell(ctx, rug.cx, cy, rug.w / 2 * (1 - (rug.bands + .8) * .16), rh / 2 * (1 - (rug.bands + .8) * .16), c0);
  } else {
    fillRR(ctx, rug.cx - rug.w / 2, cy - rh / 2, rug.w, rh, 14, c0);
    for (let i = 0; i < rug.bands; i++) {
      const inset = 8 + i * 8;
      rrPath(ctx, rug.cx - rug.w / 2 + inset, cy - rh / 2 + inset, rug.w - inset * 2, rh - inset * 2, 10);
      ctx.strokeStyle = css(i % 2 ? rug.bandC : lite(c0, 6)); ctx.lineWidth = 4; ctx.stroke();
    }
    if (rug.fringe) {
      ctx.strokeStyle = css(withA(lite(c0, 14), .85)); ctx.lineWidth = 2;
      for (const side of [-1, 1]) {
        const fx = rug.cx + side * rug.w / 2;
        for (let fy2 = cy - rh / 2 + 4; fy2 < cy + rh / 2 - 2; fy2 += 7)
          line(ctx, fx, fy2, fx + side * 7, fy2 + 1, withA(lite(c0, 14), .85), 2);
      }
    }
  }
  rug.top = cy - rh / 2; rug.cy = cy; rug.rh = rh;
}

/* directional cast shadows away from the window (pass 6) */
function castShadows(ctx, S) {
  const win = S.shell.windows[0]; if (!win) return;
  const fy = S.shell.floorY;
  for (const it of S.items) {
    if (it.lane !== 'back' || it.noShadow) continue;
    const dir = Math.sign((it.x + it.w / 2) - win.cx) || 1;
    const dx = dir * (14 + .10 * it.h), dy = 10;
    const g = ctx.createLinearGradient(it.x, 0, it.x + it.w + dx * 2.2, 0);
    if (dir > 0) { g.addColorStop(0, css(col(S.P.H, 40, 8, .10))); g.addColorStop(1, css(col(S.P.H, 40, 8, 0))); }
    else { g.addColorStop(0, css(col(S.P.H, 40, 8, 0))); g.addColorStop(1, css(col(S.P.H, 40, 8, .10))); }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(it.x + 2, it.y); ctx.lineTo(it.x + it.w - 2, it.y);
    ctx.lineTo(it.x + it.w - 2 + dx, it.y + dy); ctx.lineTo(it.x + 2 + dx, it.y + dy);
    ctx.closePath(); ctx.fill();
  }
}

/* ============================== 3. ITEM CATALOG ==============================
   CAT[kind] = { make(r,P,S)->d , draw(ctx,it,S) }
   floor items: it.x = left, it.y = baseline, it.w/it.h; drawn from (x, y-h)
   wall items:  it.x/it.y = top-left of rect
   surface items: it.cx = center, it.y = surface top (baseline)
   d.fx = effects resolved after placement: steam/flame/light/perch/slots…
============================================================================= */
const CAT = {};

/* shared mini-recipes */
function drawBookRun(ctx, r, P, x0, x1, baseY, hMax = 44) {
  let x = x0;
  while (x < x1 - 9) {
    if (chance(r, .12)) { x += rf(r, 8, 18); continue; }            // breathing gap
    if (chance(r, .15) && x1 - x > 34) {                             // horizontal stack
      const n = ri(r, 2, 3); let sy = baseY;
      for (let i = 0; i < n; i++) {
        const bw = rf(r, 26, 34), bh = rf(r, 6, 8);
        fillRR(ctx, x + rf(r, -2, 2), sy - bh, bw, bh, 2, pick(r, P.spice));
        sy -= bh;
      }
      x += 38; continue;
    }
    const bw = rf(r, 8, 16), bh = rf(r, 30, hMax);
    const c = pick(r, P.spice);
    const leanTailSpace = x1 - x > 30;
    if (chance(r, .18) && leanTailSpace) {
      ctx.save(); ctx.translate(x + bw, baseY); ctx.rotate(-rf(r, .05, .1));
      fillRR(ctx, -bw, -bh, bw, bh, 2, c);
      ctx.fillStyle = css(lite(c, 12)); ctx.fillRect(-bw, -bh + 3, bw, 2);
      ctx.restore();
    } else {
      fillRR(ctx, x, baseY - bh, bw, bh, 2, c);
      ctx.fillStyle = css(lite(c, 12)); ctx.fillRect(x + 1, baseY - bh + 3, bw - 2, 2);
      if (chance(r, .4)) { ctx.fillStyle = css(shade(c, 6)); ctx.fillRect(x + 1, baseY - 8, bw - 2, 2); }
    }
    x += bw + 1.5;
  }
}
function drawLegs(ctx, x, y, w, c, n = 2, lh = 10, lw = 8) {
  for (let i = 0; i < n; i++) {
    const lx = x + (n === 1 ? w / 2 - lw / 2 : (w - lw) * i / (n - 1));
    fillRR(ctx, lx, y - lh, lw, lh, 3, shade(c, 6));
  }
}

/* ------------------------------- A. anchors ------------------------------- */
CAT.sofa = {
  make(r, P) {
    const w = rf(r, 220, 300), h = rf(r, 88, 104);
    const c = P.contrast(P.item(r, { sat: 38, step: ri(r, 1, 3) }), P.wallL);
    return { w, h, c, cush: ri(r, 2, 3), throw: chance(r, .4), throwSide: chance(r, .5),
             throwC: P.accent, fx: [{ t: 'perch', dx: w * .5, dy: -h * .48 }], surfBonus: true };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    const arm = w * .13, bodyH = h * .55;
    drawLegs(ctx, x + 8, y, w - 16, c, 2, 9, 9);
    twoToneRR(ctx, x + arm * .5, y - h, w - arm, h * .55, 14, c);                 // back
    twoToneRR(ctx, x, y - bodyH - 9, w, bodyH, 13, c, 'bottom', .5);              // seat base
    const cw = (w - arm * 2 - 12) / d.cush;
    for (let i = 0; i < d.cush; i++)
      twoToneRR(ctx, x + arm + 6 + i * cw + 2, y - bodyH - 16, cw - 4, 24, 9, lite(c, 5), 'bottom', .4);
    for (const side of [0, 1])                                                     // armrest pills
      twoToneRR(ctx, x + side * (w - arm), y - h * .72, arm, h * .72 - 6, arm / 2, lite(c, 3));
    if (d.throw) {                                                                 // throw blanket
      const tx = d.throwSide ? x + 2 : x + w - arm - 14;
      poly(ctx, [[tx, y - h * .70], [tx + arm + 10, y - h * .70], [tx + arm + 2, y - h * .30], [tx - 6, y - h * .34]], d.throwC);
      for (let i = 1; i < 3; i++) line(ctx, tx - 6 + i * (arm / 2.4), y - h * .68, tx - 2 + i * (arm / 2.4), y - h * .36, shade(d.throwC, 8), 1.6);
    }
  }
};

CAT.armchair = {
  make(r, P) {
    const w = rf(r, 110, 140), h = rf(r, 100, 118);
    const c = P.contrast(P.item(r, { sat: 40, step: ri(r, 1, 3) }), P.wallL);
    return { w, h, c, fx: [{ t: 'perch', dx: w * .5, dy: -h * .42 }] };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    drawLegs(ctx, x + 10, y, w - 20, c, 2, 8, 8);
    twoToneRR(ctx, x + w * .16, y - h, w * .68, h * .8, w * .28, c);              // tall back
    for (const s of [0, 1])                                                        // wings
      twoToneRR(ctx, x + s * (w - w * .2), y - h * .66, w * .2, h * .6, w * .1, lite(c, 3));
    twoToneRR(ctx, x + w * .12, y - h * .45, w * .76, 22, 9, lite(c, 6), 'bottom', .4); // cushion
    twoToneRR(ctx, x + w * .06, y - h * .3, w * .88, h * .24, 10, c, 'bottom', .5);     // seat front
  }
};

CAT.bed = {
  make(r, P) {
    const w = rf(r, 240, 300), h = rf(r, 64, 76);
    const duvet = P.contrast(col(P.textileH, 40 * P.Sx + 8, P.ramp[ri(r, 2, 3)]), P.wallL);
    return { w, h, hb: rf(r, 100, 120), c: P.item(r, { sat: 24, step: 1 }), duvet,
             headLeft: null, fx: [{ t: 'perch', dx: w * .55, dy: -h * .9 }] };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it;
    const hl = d.headLeft, hbW = 26;
    const hx = hl ? x : x + w - hbW;
    twoToneRR(ctx, hx, y - d.hb, hbW, d.hb, 12, d.c, 'bottom', .25);              // headboard
    drawLegs(ctx, x + 4, y, w - 8, d.c, 2, 8, 9);
    twoToneRR(ctx, x, y - h, w, h - 6, 10, lite(d.c, 14), 'bottom', .3);          // mattress
    ctx.save();                                                                    // duvet w/ scalloped hem
    rrPath(ctx, x - 3, y - h + 6, w + 6, h - 4, 10); ctx.clip();
    ctx.fillStyle = css(d.duvet);
    ctx.beginPath(); ctx.moveTo(x - 3, y - h + 6); ctx.lineTo(x + w + 3, y - h + 6);
    ctx.lineTo(x + w + 3, y - 16);
    for (let sx = x + w; sx > x - 6; sx -= 24) ctx.quadraticCurveTo(sx - 12, y - 4, sx - 24, y - 16);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(shade(d.duvet, 6));
    for (let i = 1; i < 3; i++) { ctx.fillRect(x - 3, y - h + 6 + i * 14, w + 6, 2); }
    ctx.restore();
    const px = hl ? x + 14 : x + w - 60;                                           // pillows
    twoToneRR(ctx, px, y - h - 16, 46, 22, 10, lite(d.c, 22), 'bottom', .4);
    twoToneRR(ctx, px + (hl ? 18 : -18), y - h - 13, 46, 21, 10, lite(d.c, 18), 'bottom', .4);
  }
};

CAT.bookshelf = {
  make(r, P, S) {
    const w = rf(r, 120, 170), h = S.shell.floorY * rf(r, .55, .72);
    return { w, h, c: P.item(r, { sat: 26, step: ri(r, 0, 2) }), boards: ri(r, 3, 5), tall: true };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, c = d.c, r = S.streams('books' + (it.x | 0));
    twoToneRR(ctx, x, y - h, w, h, 6, c, 'right', .12);
    const inset = 7, bh = (h - inset * 2) / d.boards;
    for (let i = 0; i < d.boards; i++) {
      const by = y - inset - i * bh;
      ctx.fillStyle = css(shade(c, 8)); ctx.fillRect(x + inset, by - bh + 5, w - inset * 2, bh - 5);
      ctx.fillStyle = css(shade(c, 3)); ctx.fillRect(x + inset, by, w - inset * 2, 4);
      drawBookRun(ctx, r, S.P, x + inset + 3, x + w - inset - 3, by, Math.min(bh - 9, 44));
    }
  }
};

CAT.wardrobe = {
  make(r, P, S) {
    const w = rf(r, 130, 160), h = S.shell.floorY * rf(r, .55, .66);
    return { w, h, c: P.item(r, { sat: 24, step: ri(r, 1, 2) }), tall: true };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    twoToneRR(ctx, x, y - h, w, h, 8, c, 'bottom', .12);
    fillRR(ctx, x - 4, y - h - 6, w + 8, 10, 4, lite(c, 4));                       // crown
    for (const s of [0, 1]) {
      fillRR(ctx, x + 9 + s * (w / 2 - 5), y - h + 12, w / 2 - 13, h - 26, 7, lite(c, 4));
      fillRR(ctx, x + 12 + s * (w / 2 - 5), y - h + 16, w / 2 - 19, h - 34, 6, shade(c, 2));
      ell(ctx, x + w / 2 + (s ? 10 : -10), y - h / 2, 3.4, 3.4, col(40, 30, 30));
    }
    drawLegs(ctx, x + 6, y, w - 12, c, 2, 6, 9);
  }
};

CAT.fireplace = {
  make(r, P) {
    const w = rf(r, 180, 220);
    const brick = chance(r, .5);
    return { w, h: 150, brick, c: brick ? col(14, 32 * P.Sx + 8, P.ramp[2]) : P.item(r, { sat: 16, step: ri(r, 2, 3) }),
             keepClear: true, surface: { slots: 3, inset: 14, topDy: -160 },
             fx: [{ t: 'flame', dx: null, dy: -34, big: true }, { t: 'light', dx: null, dy: -44, r: 200, a: 1 }] };
  },
  draw(ctx, it, S) {
    const { x, y, w, d } = it, h = it.h, c = d.c, P = S.P;
    const r = S.streams('fire' + (it.x | 0));
    twoToneRR(ctx, x, y - h, w, h, 6, c, 'right', .14);                            // surround
    if (d.brick) {
      ctx.strokeStyle = css(withA(shade(c, 8), .5)); ctx.lineWidth = 2;
      for (let gy = y - h + 8, row = 0; gy < y - 6; gy += 16, row++) {
        ctx.beginPath(); ctx.moveTo(x + 3, gy); ctx.lineTo(x + w - 3, gy); ctx.stroke();
        for (let gx = x + ((row % 2) * 22) + 12; gx < x + w - 6; gx += 44) {
          ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, Math.min(gy + 16, y - 6)); ctx.stroke();
        }
      }
    }
    fillRR(ctx, x - 6, y - h - 10, w + 12, 14, 5, lite(c, 8));                     // mantel
    const ow = 96, oh = 84, ox = x + w / 2 - ow / 2, oy = y - 14 - oh;             // opening
    fillRR(ctx, ox - 7, oy - 7, ow + 14, oh + 14, 10, shade(c, 10));
    ctx.save(); rrPath(ctx, ox, oy, ow, oh, 8); ctx.clip();
    ctx.fillStyle = css(col(20, 30, 9)); ctx.fillRect(ox, oy, ow, oh);
    ctx.fillStyle = css(col(24, 45, 14));                                          // back glow wall
    ctx.beginPath(); ctx.ellipse(ox + ow / 2, oy + oh, ow * .42, oh * .5, 0, 0, TAU); ctx.fill();
    ctx.restore();
    for (const [ldx, lrot] of [[-16, .3], [14, -.25]])                              // logs
      { ctx.save(); ctx.translate(ox + ow / 2 + ldx, y - 20); ctx.rotate(lrot);
        fillRR(ctx, -22, -7, 44, 13, 6, col(24, 30, 24)); ctx.restore(); }
    d.flameX = ox + ow / 2; d.flameY = y - 22;                                     // animator anchor
    // ember dots
    for (let i = 0; i < 5; i++) ell(ctx, ox + ow / 2 + rf(r, -20, 20), y - 16 + rf(r, -3, 3), 1.6, 1.6, col(28, 90, 55, .9));
  }
};

CAT.desk = {
  make(r, P, S) {
    const w = rf(r, 150, 190), h = rf(r, 66, 76);
    return { w, h, c: P.item(r, { sat: 24, step: ri(r, 1, 3) }),
             surface: { slots: 4, inset: 10, topDy: null }, chair: true };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    for (const s of [0, 1]) twoToneRR(ctx, x + 4 + s * (w - 22), y - h + 8, 14, h - 8, 4, c, 'bottom', .2);
    twoToneRR(ctx, x, y - h, w, 11, 5, lite(c, 6), 'bottom', .45);                 // top slab
    fillRR(ctx, x + 6, y - h + 14, w - 12, 16, 4, shade(c, 4));                    // apron drawer
    ell(ctx, x + w / 2, y - h + 22, 3, 3, col(40, 30, 34));
  }
};

CAT.chair = {
  make(r, P) {
    const w = rf(r, 40, 48), h = rf(r, 66, 76);
    return { w, h, c: P.item(r, { sat: 22, step: ri(r, 1, 2) }), noShadow: true };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    fillRR(ctx, x + w - 10, y - h, 8, h - 18, 4, c);                               // back post
    fillRR(ctx, x + w - 16, y - h + 8, 12, 7, 3.5, lite(c, 5));                    // back slat
    twoToneRR(ctx, x, y - 26, w, 9, 4, lite(c, 3), 'bottom', .5);                  // seat
    drawLegs(ctx, x + 2, y, w - 4, c, 2, 18, 6);
  }
};

CAT.dresser = {
  make(r, P) {
    const w = rf(r, 120, 150), h = rf(r, 86, 96);
    return { w, h, c: P.item(r, { sat: 26, step: ri(r, 1, 3) }), surface: { slots: 3, inset: 8, topDy: null } };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    twoToneRR(ctx, x, y - h, w, h - 5, 7, c, 'right', .12);
    drawLegs(ctx, x + 6, y, w - 12, c, 2, 6, 8);
    const dh = (h - 26) / 3;
    for (let i = 0; i < 3; i++) {
      const dy = y - h + 8 + i * (dh + 3);
      fillRR(ctx, x + 8, dy, w - 16, dh, 5, lite(c, i === 1 ? 2 : 4));
      fillRR(ctx, x + w / 2 - 11, dy + dh / 2 - 2.4, 22, 4.8, 2.4, shade(c, 8));
    }
  }
};

CAT.piano = {
  make(r, P) {
    return { w: rf(r, 150, 170), h: rf(r, 115, 128), c: P.item(r, { sat: 18, step: ri(r, 0, 1) }),
             surface: { slots: 2, inset: 16, topDy: null } };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    twoToneRR(ctx, x, y - h, w, h - 8, 6, c, 'right', .14);
    drawLegs(ctx, x + 4, y, w - 8, c, 2, 8, 9);
    fillRR(ctx, x + 4, y - h * .52, w - 8, 12, 3, lite(c, 3));                      // key bed lid
    ctx.fillStyle = css(col(45, 12, 90));                                           // white keys
    ctx.fillRect(x + 8, y - h * .52 + 2, w - 16, 8);
    ctx.fillStyle = css(col(240, 15, 12));
    const nk = Math.floor((w - 20) / 9);
    for (let i = 0; i < nk; i++) if (i % 7 !== 2 && i % 7 !== 6)
      ctx.fillRect(x + 11 + i * 9, y - h * .52 + 2, 4, 5);
    fillRR(ctx, x + w * .25, y - h + 14, w * .5, 8, 3, shade(c, 5));                // music ledge
  }
};

CAT.counter = {
  make(r, P) {
    const w = rf(r, 160, 220), h = rf(r, 82, 90);
    return { w, h, c: P.item(r, { sat: 26, step: ri(r, 1, 3) }), sink: chance(r, .5),
             surface: { slots: 4, inset: 10, topDy: null } };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    twoToneRR(ctx, x, y - h + 8, w, h - 12, 6, c, 'bottom', .12);
    twoToneRR(ctx, x - 4, y - h, w + 8, 12, 4, lite(c, 12), 'bottom', .4);          // countertop
    fillRR(ctx, x + 8, y - h + 24, w * .44, 14, 4, lite(c, 4));                     // drawer
    fillRR(ctx, x + w / 2 - 14, y - h + 30, 24, 4, 2, shade(c, 8));
    for (const s of [0, 1]) {                                                        // doors
      fillRR(ctx, x + 8 + s * (w / 2 - 6), y - h + 44, w / 2 - 14, h - 56, 5, lite(c, s ? 2 : 4));
      ell(ctx, x + w / 2 + (s ? 12 : -12), y - h / 2 + 14, 2.8, 2.8, col(40, 30, 32));
    }
    if (d.sink) {
      fillRR(ctx, x + w * .55, y - h - 2, w * .3, 6, 3, shade(c, 14));               // basin rim
      const fx = x + w * .7;
      line(ctx, fx, y - h - 2, fx, y - h - 16, col(40, 20, 60), 4);                  // faucet
      line(ctx, fx, y - h - 15, fx + 12, y - h - 15, col(40, 20, 60), 4);
    }
  }
};

CAT.bench = {   // window bench
  make(r, P) {
    const w = rf(r, 120, 160), h = rf(r, 42, 50);
    return { w, h, c: P.item(r, { sat: 34, step: ri(r, 1, 3) }), fx: [{ t: 'perch', dx: w * .5, dy: -h * .8 }] };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    drawLegs(ctx, x + 6, y, w - 12, c, 2, 14, 8);
    twoToneRR(ctx, x, y - h, w, h - 12, 12, lite(c, 4), 'bottom', .4);
    for (let i = 1; i < 3; i++) line(ctx, x + i * w / 3, y - h + 4, x + i * w / 3, y - 16, withA(shade(c, 4), .6), 2);
  }
};

CAT.radiator = {
  make(r, P) {
    const w = rf(r, 90, 130), h = rf(r, 62, 72);
    return { w, h, c: col(P.H, 10, P.ramp[3]), fins: ri(r, 6, 8), shimmer: true };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    const fw = w / d.fins;
    for (let i = 0; i < d.fins; i++)
      twoToneRR(ctx, x + i * fw + 1, y - h, fw - 2, h - 6, fw / 2.6, col(c.h, c.s, c.l + (i % 2 ? 2.5 : -2.5)), 'bottom', .25);
    line(ctx, x + 6, y - h - 4, x + w - 6, y - h - 4, shade(c, 8), 4);              // top pipe
    ell(ctx, x + w - 5, y - h - 4, 4, 4, shade(c, 14));                             // valve
    drawLegs(ctx, x + 8, y, w - 16, c, 2, 5, 6);
  }
};

/* ------------------------------ B. surfaces ------------------------------ */
CAT.sidetable = {
  make(r, P) {
    const w = rf(r, 60, 80), h = rf(r, 52, 60);
    return { w, h, c: P.item(r, { sat: 24, step: ri(r, 1, 3) }), round: chance(r, .5),
             surface: { slots: 2, inset: 6, topDy: null } };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    if (d.round) {
      fillRR(ctx, x + w / 2 - 5, y - h + 4, 10, h - 10, 4, shade(c, 4));            // pedestal
      ell(ctx, x + w / 2, y - 4, w * .32, 5, shade(c, 4));
      ell(ctx, x + w / 2, y - h + 4, w / 2, 8, c); ell(ctx, x + w / 2, y - h + 2, w / 2, 7, lite(c, 5));
    } else {
      drawLegs(ctx, x + 4, y, w - 8, c, 2, h - 12, 6);
      twoToneRR(ctx, x, y - h, w, 10, 4, lite(c, 5), 'bottom', .45);
    }
  }
};

CAT.coffeetable = {
  make(r, P) {
    const w = rf(r, 120, 150), h = rf(r, 34, 40);
    return { w, h, c: P.item(r, { sat: 24, step: ri(r, 1, 3) }), surface: { slots: 3, inset: 10, topDy: null }, noShadow: true };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    drawLegs(ctx, x + 6, y, w - 12, c, 2, h - 10, 7);
    twoToneRR(ctx, x, y - h, w, 11, 5, lite(c, 6), 'bottom', .45);
  }
};

CAT.console = {
  make(r, P) {
    const w = rf(r, 130, 170), h = rf(r, 66, 74);
    return { w, h, c: P.item(r, { sat: 24, step: ri(r, 1, 3) }), surface: { slots: 3, inset: 10, topDy: null } };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, c = d.c, r = S.streams('console' + (it.x | 0));
    drawLegs(ctx, x + 4, y, w - 8, c, 2, h - 10, 6);
    twoToneRR(ctx, x, y - h, w, 9, 4, lite(c, 6), 'bottom', .45);
    fillRR(ctx, x + 8, y - h * .42, w - 16, 6, 3, c);                               // lower shelf
    drawBookRun(ctx, r, S.P, x + w * .2, x + w * .62, y - h * .42, 26);             // few books below
  }
};

CAT.nightstand = {
  make(r, P) {
    const w = rf(r, 52, 62), h = rf(r, 56, 64);
    return { w, h, c: P.item(r, { sat: 24, step: ri(r, 1, 3) }), surface: { slots: 2, inset: 5, topDy: null } };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    twoToneRR(ctx, x, y - h, w, h - 6, 6, c, 'right', .16);
    drawLegs(ctx, x + 4, y, w - 8, c, 2, 5, 6);
    fillRR(ctx, x + 6, y - h + 8, w - 12, 16, 4, lite(c, 4));
    fillRR(ctx, x + w / 2 - 8, y - h + 14, 16, 4, 2, shade(c, 8));
  }
};

CAT.stool = {
  make(r, P) {
    const w = rf(r, 38, 46), h = rf(r, 42, 48);
    return { w, h, c: P.item(r, { sat: 24, step: ri(r, 1, 3) }), surface: { slots: 1, inset: 4, topDy: null }, noShadow: true };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, c = d.c;
    line(ctx, x + w * .25, y - h + 6, x + w * .12, y, shade(c, 4), 5);
    line(ctx, x + w * .75, y - h + 6, x + w * .88, y, shade(c, 4), 5);
    line(ctx, x + w * .5, y - h + 6, x + w * .5, y, shade(c, 6), 5);
    ell(ctx, x + w / 2, y - h + 4, w / 2, 7, c);
    ell(ctx, x + w / 2, y - h + 2, w / 2, 6, lite(c, 6));
  }
};

CAT.wallshelf = {
  make(r, P) {
    const w = rf(r, 90, 150);
    return { w, h: 30, c: P.item(r, { sat: 22, step: ri(r, 1, 2) }), ivy: chance(r, .25),
             surface: { slots: 3, inset: 4, topDy: null } };
  },
  draw(ctx, it, S) {
    const { x, y, w, d } = it, c = d.c;   // wall item: y = top of board zone; board sits at y+22
    const by = y + 22;
    fillRR(ctx, x, by, w, 7, 3, c);
    ctx.fillStyle = css(lite(c, 7)); ctx.fillRect(x + 1, by, w - 2, 2);
    for (const bx of [x + 8, x + w - 14])                                           // brackets
      poly(ctx, [[bx, by + 7], [bx + 6, by + 7], [bx, by + 16]], shade(c, 6));
    if (d.ivy) {
      const r = S.streams('ivy' + (x | 0)), g = S.P.leafGreen;
      for (let v = 0; v < 3; v++) {
        const vx = x + w - 6 - v * 7;
        ctx.beginPath(); ctx.moveTo(vx, by + 6);
        ctx.quadraticCurveTo(vx + rf(r, -8, 8), by + 20, vx + rf(r, -6, 6), by + 20 + rf(r, 14, 34));
        ctx.strokeStyle = css(g); ctx.lineWidth = 1.6; ctx.stroke();
        for (let l = 0; l < 4; l++) ell(ctx, vx + rf(r, -7, 7), by + 10 + l * 9, 3, 2.2, col(g.h + rf(r, -8, 8), g.s, g.l + rf(r, -4, 6)));
      }
    }
  }
};

CAT.recordstand = {
  make(r, P) {
    const w = rf(r, 86, 100), h = rf(r, 56, 64);
    return { w, h, c: P.item(r, { sat: 24, step: ri(r, 1, 2) }), spin: chance(r, .6) };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, c = d.c, r = S.streams('records' + (x | 0));
    drawLegs(ctx, x + 4, y, w - 8, c, 2, 6, 7);
    twoToneRR(ctx, x, y - h, w, h - 8, 6, c, 'right', .14);
    ctx.fillStyle = css(shade(c, 9)); ctx.fillRect(x + 7, y - h + 9, w - 14, h - 22);
    let vx = x + 10;                                                                // record spines
    while (vx < x + w - 12) { const vw = rf(r, 3, 5);
      ctx.fillStyle = css(withA(pick(r, S.P.spice), .95)); ctx.fillRect(vx, y - h + 12, vw, h - 28); vx += vw + 2; }
    // player on top
    fillRR(ctx, x + 6, y - h - 10, w - 12, 11, 4, lite(c, 8));
    ell(ctx, x + w / 2 - 5, y - h - 5, 12, 4.5, col(240, 12, 16));
    d.labelX = x + w / 2 - 5; d.labelY = y - h - 5;
    ell(ctx, d.labelX, d.labelY, 3, 1.4, pick(r, S.P.spice));
    line(ctx, x + w - 16, y - h - 12, x + w - 22, y - h - 5, col(40, 15, 70), 2);   // tonearm
  }
};

/* ----------------------------- C. wall décor ----------------------------- */
CAT.artLandscape = {
  make(r, P) {
    const w = rf(r, 60, 110), h = rf(r, 50, 80);
    return { w, h, frame: P.item(r, { sat: 20, step: ri(r, 0, 2) }), sky: pick(r, P.spice),
             hill1: pick(r, P.spice), hill2: pick(r, P.spice), sun: chance(r, .6) };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it;
    fillRR(ctx, x, y, w, h, 4, d.frame);
    fillRR(ctx, x + 4, y + 4, w - 8, h - 8, 2, col(45, 15, 88));                    // mat
    const px = x + 7, py = y + 7, pw = w - 14, ph = h - 14;
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    ctx.fillStyle = css(lite(d.sky, 14)); ctx.fillRect(px, py, pw, ph);
    if (d.sun) ell(ctx, px + pw * .72, py + ph * .3, ph * .12, ph * .12, col(42, 80, 72));
    ctx.beginPath(); ctx.ellipse(px + pw * .3, py + ph * 1.05, pw * .55, ph * .55, 0, 0, TAU);
    ctx.fillStyle = css(d.hill1); ctx.fill();
    ctx.beginPath(); ctx.ellipse(px + pw * .85, py + ph * 1.15, pw * .5, ph * .6, 0, 0, TAU);
    ctx.fillStyle = css(shade(d.hill2, 4)); ctx.fill();
    ctx.restore();
  }
};

CAT.artAbstract = {
  make(r, P) {
    const w = rf(r, 50, 80), h = rf(r, 50, 80);
    return { w, h, frame: P.item(r, { sat: 20, step: ri(r, 0, 2) }),
             blobs: Array.from({ length: ri(r, 2, 3) }, () => ({ bx: r(), by: r(), br: .2 + r() * .3, c: null })),
             cs: [pick(r, P.spice), pick(r, P.spice), pick(r, P.spice)], bg: chance(r, .5) };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it;
    fillRR(ctx, x, y, w, h, 4, d.frame);
    fillRR(ctx, x + 5, y + 5, w - 10, h - 10, 2, d.bg ? col(45, 15, 88) : lite(d.cs[2], 20));
    ctx.save(); ctx.beginPath(); ctx.rect(x + 6, y + 6, w - 12, h - 12); ctx.clip();
    d.blobs.forEach((b, i) => {
      ctx.beginPath(); ctx.arc(x + 6 + b.bx * (w - 12), y + 6 + b.by * (h - 12), b.br * w, 0, TAU);
      ctx.fillStyle = css(withA(d.cs[i % 3], .85)); ctx.fill();
    });
    ctx.restore();
  }
};

CAT.portrait = {
  make(r, P) {
    return { w: 34, h: 44, frame: P.item(r, { sat: 20, step: ri(r, 0, 1) }), skin: col(30, 35, 70) };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it;
    fillRR(ctx, x, y, w, h, 3, d.frame);
    ell(ctx, x + w / 2, y + h / 2, w / 2 - 4, h / 2 - 4, col(45, 12, 90));
    ell(ctx, x + w / 2, y + h * .42, 6, 7, d.skin);                                  // head
    ell(ctx, x + w / 2, y + h * .72, 10, 8, shade(d.skin, 18));                      // shoulders
  }
};

CAT.mirror = {
  make(r, P) { const rr2 = rf(r, 30, 45); return { w: rr2 * 2, h: rr2 * 2, rim: P.item(r, { sat: 24, step: ri(r, 2, 4) }) }; },
  draw(ctx, it, S) {
    const { x, y, w, d } = it, cx = x + w / 2, cy = y + w / 2, R = w / 2;
    ell(ctx, cx, cy, R, R, d.rim);
    ell(ctx, cx, cy, R - 5, R - 5, col(S.P.H, S.P.wall.s * .6, clamp(S.P.wallL + 14, 0, 96)));
    line(ctx, cx - R * .4, cy - R * .1, cx + R * .1, cy - R * .6, col(0, 0, 100, .35), 4);
    line(ctx, cx - R * .15, cy + R * .35, cx + R * .45, cy - R * .25, col(0, 0, 100, .22), 3);
  }
};

CAT.clock = {
  make(r, P) {
    const R = rf(r, 24, 32);
    return { w: R * 2, h: R * 2, rim: P.item(r, { sat: 26, step: ri(r, 1, 3) }),
             hh: rf(r, 0, TAU), mm: rf(r, 0, TAU) };
  },
  draw(ctx, it) {
    const { x, y, w, d } = it, cx = x + w / 2, cy = y + w / 2, R = w / 2;
    ell(ctx, cx, cy, R, R, d.rim);
    ell(ctx, cx, cy, R - 4, R - 4, col(45, 15, 92));
    ctx.strokeStyle = css(col(30, 20, 30)); ctx.lineWidth = 1.6;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 7), cy + Math.sin(a) * (R - 7));
      ctx.lineTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10));
      ctx.stroke();
    }
    line(ctx, cx, cy, cx + Math.cos(d.hh) * R * .42, cy + Math.sin(d.hh) * R * .42, col(30, 20, 25), 3);
    line(ctx, cx, cy, cx + Math.cos(d.mm) * R * .62, cy + Math.sin(d.mm) * R * .62, col(30, 20, 25), 2);
    ell(ctx, cx, cy, 2.2, 2.2, col(30, 20, 25));
  }
};

CAT.hangplant = {
  make(r, P) {
    return { w: 60, h: rf(r, 110, 150), pot: col(16, 45 * P.Sx + 15, 48), vines: ri(r, 5, 7), sway: true };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, cx = x + w / 2, r = S.streams('hang' + (x | 0));
    const potY = y + h * .42;
    line(ctx, cx, y, cx - 12, potY, col(35, 25, 75, .9), 1.5);                       // macramé
    line(ctx, cx, y, cx + 12, potY, col(35, 25, 75, .9), 1.5);
    ell(ctx, cx, y, 3, 3, col(35, 25, 60));                                          // hook
    poly(ctx, [[cx - 17, potY], [cx + 17, potY], [cx + 12, potY + 20], [cx - 12, potY + 20]], d.pot);
    ctx.fillStyle = css(shade(d.pot, 8)); ctx.fillRect(cx - 17, potY + 12, 34, 4);
    const g = S.P.leafGreen;
    for (let v = 0; v < d.vines; v++) {
      const a = (v / (d.vines - 1) - .5), vx = cx + a * 26;
      const len = rf(r, h * .3, h * .55);
      ctx.beginPath(); ctx.moveTo(vx, potY + 2);
      ctx.quadraticCurveTo(vx + a * 22, potY + len * .6, vx + a * 30, potY + len);
      ctx.strokeStyle = css(g); ctx.lineWidth = 1.6; ctx.stroke();
      for (let l = 1; l < 5; l++)
        ell(ctx, vx + a * 22 * l / 4 + rf(r, -3, 3), potY + len * l / 4.6, 3.4, 2.4,
            col(g.h + rf(r, -10, 10), g.s + 4, g.l + rf(r, -5, 8)));
    }
  }
};

CAT.stringlights = {
  make(r, P) {
    const w = rf(r, 200, 400);
    return { w, h: 60, bulbs: ri(r, 8, 14), warm: col(42, 90, 70), twinkle: true };
  },
  draw(ctx, it) {
    const { x, y, w, d } = it;
    const sag = 26 + w * .05;
    ctx.beginPath(); ctx.moveTo(x, y + 6);
    ctx.quadraticCurveTo(x + w / 2, y + 6 + sag * 2, x + w, y + 6);
    ctx.strokeStyle = css(col(30, 15, 30, .8)); ctx.lineWidth = 1.6; ctx.stroke();
    d.pts = [];
    for (let i = 0; i < d.bulbs; i++) {
      const t = (i + .5) / d.bulbs;
      const bx = x + t * w, by = y + 6 + 2 * sag * t * (1 - t) * 2 + 3;
      d.pts.push([bx, by]);
      ell(ctx, bx, by + 2, 6, 6, withA(d.warm, .18));                                 // baked halo
      ell(ctx, bx, by + 2, 2.6, 3.2, d.warm);
    }
  }
};

CAT.pennant = {
  make(r, P) {
    const w = rf(r, 160, 300);
    return { w, h: 44, n: ri(r, 6, 9), cs: [P.accent, pick(r, P.spice), pick(r, P.spice)] };
  },
  draw(ctx, it) {
    const { x, y, w, d } = it;
    const sag = 18 + w * .04;
    ctx.beginPath(); ctx.moveTo(x, y + 4);
    ctx.quadraticCurveTo(x + w / 2, y + 4 + sag * 2, x + w, y + 4);
    ctx.strokeStyle = css(col(30, 15, 35, .8)); ctx.lineWidth = 1.5; ctx.stroke();
    for (let i = 0; i < d.n; i++) {
      const t0 = (i + .12) / d.n, t1 = (i + .88) / d.n, tm = (t0 + t1) / 2;
      const p = tt => [x + tt * w, y + 4 + 2 * sag * tt * (1 - tt) * 2];
      const [ax, ay] = p(t0), [bx, by] = p(t1), [mx2, my2] = p(tm);
      poly(ctx, [[ax, ay], [bx, by], [mx2, my2 + 16]], withA(d.cs[i % 3], .95));
    }
  }
};

CAT.sconce = {
  make(r, P) {
    return { w: 34, h: 40, c: P.item(r, { sat: 20, step: 3 }),
             fx: [{ t: 'light', dx: 17, dy: 10, r: 90, a: .7 }] };
  },
  draw(ctx, it, S) {
    const { x, y, w, d } = it, cx = x + w / 2;
    fillRR(ctx, cx - 7, y + 26, 14, 8, 4, shade(d.c, 4));                              // wall plate
    fillRR(ctx, cx - 2.6, y + 12, 5.2, 18, 2.6, d.c);                                  // stem
    ctx.beginPath(); ctx.arc(cx, y + 14, 14, Math.PI, 0); ctx.closePath();             // half-dome shade
    ctx.fillStyle = css(lite(d.c, 6)); ctx.fill();
    ell(ctx, cx, y + 12, 8, 4, col(45, 80, 82, S.P.mood === 'day' ? .4 : .9));          // glow lip
  }
};

CAT.plates = {
  make(r, P) {
    return { w: 76, h: 44, n: ri(r, 2, 3), cs: [pick(r, P.spice), pick(r, P.spice)] };
  },
  draw(ctx, it) {
    const { x, y, d } = it;
    for (let i = 0; i < d.n; i++) {
      const R = 12 + (i % 2) * 5, px = x + 14 + i * 26, py = y + 20 + (i % 2) * 9;
      ell(ctx, px, py, R, R, col(45, 15, 90));
      ctx.strokeStyle = css(d.cs[i % 2]); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(px, py, R - 3.4, 0, TAU); ctx.stroke();
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + i;
        ell(ctx, px + Math.cos(a) * (R - 8), py + Math.sin(a) * (R - 8), 1.2, 1.2, d.cs[(i + 1) % 2]); }
    }
  }
};

CAT.calendar = {
  make(r, P) { return { w: 40, h: 54, img: pick(r, P.spice), ring: ri(r, 0, 19) }; },
  draw(ctx, it) {
    const { x, y, w, h, d } = it;
    fillRR(ctx, x, y, w, h, 3, col(45, 18, 92));
    fillRR(ctx, x + 3, y + 3, w - 6, 18, 2, lite(d.img, 8));
    ell(ctx, x + w * .3, y + 12, 5, 4, d.img); ell(ctx, x + w * .68, y + 10, 4, 5, shade(d.img, 8));
    ctx.fillStyle = css(col(30, 15, 45));
    for (let row = 0; row < 4; row++) for (let cc = 0; cc < 5; cc++)
      ctx.fillRect(x + 6 + cc * 6.4, y + 26 + row * 6.4, 3, 3);
    const rx = x + 6 + (d.ring % 5) * 6.4 + 1.5, ry2 = y + 26 + Math.floor(d.ring / 5) * 6.4 + 1.5;
    ctx.strokeStyle = css(col(8, 70, 55)); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(rx, ry2, 4, 0, TAU); ctx.stroke();
  }
};

CAT.neon = {
  make(r, P) {
    return { w: 120, h: 60, c: col(P.accent.h, 85, 62),
             fx: [{ t: 'light', dx: 60, dy: 30, r: 110, a: .8, tint: P.accent.h }] };
  },
  draw(ctx, it) {
    const { x, y, w, h, d } = it;
    ctx.strokeStyle = css(d.c); ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + 8, y + h * .6);
    ctx.bezierCurveTo(x + w * .25, y, x + w * .45, y + h, x + w * .6, y + h * .35);
    ctx.quadraticCurveTo(x + w * .78, y + 4, x + w - 8, y + h * .45);
    ctx.stroke();
    ctx.strokeStyle = css(withA(lite(d.c, 18), .5)); ctx.lineWidth = 8; ctx.stroke();
  }
};

/* ----------------------------- D. floor clutter ----------------------------- */
function drawPot(ctx, cx, baseY, w, h, c) {
  poly(ctx, [[cx - w / 2, baseY - h], [cx + w / 2, baseY - h], [cx + w * .38, baseY], [cx - w * .38, baseY]], c);
  ctx.fillStyle = css(lite(c, 7)); ctx.fillRect(cx - w / 2, baseY - h, w, 4);
  ctx.fillStyle = css(shade(c, 6)); ctx.fillRect(cx - w * .42, baseY - 4, w * .84, 4);
}

CAT.monstera = {
  make(r, P) {
    const h = rf(r, 95, 150);
    return { w: rf(r, 70, 95), h, pot: col(16, 45 * P.Sx + 15, 48), leaves: ri(r, 5, 7) };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, cx = x + w / 2, r = S.streams('mon' + (x | 0)), g = S.P.leafGreen;
    const potH = h * .22;
    for (let i = 0; i < d.leaves; i++) {
      const a = (i / (d.leaves - 1) - .5) * 1.9 + rf(r, -.12, .12);
      const len = rf(r, h * .45, h * .75), tipX = cx + Math.sin(a) * len * .62, tipY = y - potH - Math.abs(Math.cos(a)) * len;
      ctx.beginPath(); ctx.moveTo(cx, y - potH + 2);
      ctx.quadraticCurveTo(cx + Math.sin(a) * len * .2, y - potH - len * .55, tipX, tipY);
      ctx.strokeStyle = css(shade(g, 4)); ctx.lineWidth = 2; ctx.stroke();
      const lc = col(g.h + rf(r, -10, 10), g.s + rf(r, 0, 8), g.l + rf(r, -5, 8));
      ctx.save(); ctx.translate(tipX, tipY); ctx.rotate(a * .55);
      ctx.beginPath(); ctx.ellipse(0, -8, 12, 16, 0, 0, TAU); ctx.fillStyle = css(lc); ctx.fill();
      ctx.strokeStyle = css(withA(shade(lc, 10), .8)); ctx.lineWidth = 1.6;          // splits
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, 4);
      ctx.moveTo(-9, -14); ctx.lineTo(-2, -8); ctx.moveTo(9, -12); ctx.lineTo(2, -6); ctx.stroke();
      ctx.restore();
    }
    drawPot(ctx, cx, y, w * .5, potH, d.pot);
  }
};

CAT.snakeplant = {
  make(r, P) {
    return { w: rf(r, 36, 48), h: rf(r, 70, 105), pot: P.item(r, { sat: 30, step: ri(r, 1, 3) }), blades: ri(r, 6, 9) };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, cx = x + w / 2, r = S.streams('snake' + (x | 0)), g = S.P.leafGreen;
    const potH = h * .24;
    for (let i = 0; i < d.blades; i++) {
      const bx = cx + rf(r, -w * .26, w * .26), bh = rf(r, h * .5, h * .78), lean = rf(r, -.12, .12);
      const c = col(g.h + rf(r, -8, 8), g.s + 6, g.l + rf(r, -6, 6));
      poly(ctx, [[bx - 3.4, y - potH + 2], [bx + 3.4, y - potH + 2], [bx + lean * bh, y - potH - bh]], c);
      if (chance(r, .5)) line(ctx, bx, y - potH, bx + lean * bh * .8, y - potH - bh * .8, withA(lite(c, 14), .8), 1.2);
    }
    drawPot(ctx, cx, y, w, potH, d.pot);
  }
};

CAT.fig = {
  make(r, P) {
    return { w: rf(r, 70, 90), h: rf(r, 125, 175), pot: P.item(r, { sat: 28, step: ri(r, 1, 3) }), leaves: ri(r, 8, 11) };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, cx = x + w / 2, r = S.streams('fig' + (x | 0)), g = S.P.leafGreen;
    const potH = h * .16;
    line(ctx, cx, y - potH, cx + rf(r, -4, 4), y - h * .92, col(25, 30, 30), 3.4);
    for (let i = 0; i < d.leaves; i++) {
      const ly = y - h * (.45 + .5 * (i / d.leaves)), lx = cx + rf(r, -w * .4, w * .4) * (1 - i / (d.leaves * 2));
      const lc = col(g.h + rf(r, -8, 8), g.s + 4, g.l + rf(r, -5, 7));
      ell(ctx, lx, ly, rf(r, 8, 12), rf(r, 10, 14), lc);
      ell(ctx, lx - 2, ly - 3, 4, 5, withA(lite(lc, 8), .7));
    }
    drawPot(ctx, cx, y, w * .5, potH, d.pot);
  }
};

CAT.floorlamp = {
  make(r, P) {
    const h = rf(r, 150, 185);
    return { w: rf(r, 54, 66), h, c: P.item(r, { sat: 22, step: ri(r, 0, 2) }),
             shadeC: col(P.textileH, 30 * P.Sx + 10, P.ramp[3]),
             fx: [{ t: 'light', dx: null, dy: null, r: 190, a: 1 }] };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, cx = x + w / 2;
    ell(ctx, cx, y - 3, w * .38, 5, d.c);
    line(ctx, cx, y - 5, cx, y - h + 34, d.c, 4);
    const shY = y - h;                                                              // trapezoid shade
    poly(ctx, [[cx - w * .34, shY + 34], [cx + w * .34, shY + 34], [cx + w * .24, shY], [cx - w * .24, shY]], d.shadeC);
    ctx.fillStyle = css(lite(d.shadeC, 8)); ctx.fillRect(cx - w * .24, shY, w * .48, 3);
    const lit = S.P.mood !== 'day';
    ell(ctx, cx, shY + 35, w * .3, 4, col(45, 85, 80, lit ? .85 : .35));             // under-glow lip
    d.fx[0].ax = cx; d.fx[0].ay = shY + 20;
  }
};

CAT.bookstack = {
  make(r, P) { return { w: rf(r, 34, 44), h: rf(r, 24, 44), n: ri(r, 3, 6), open: chance(r, .2) }; },
  draw(ctx, it, S) {
    const { x, y, w, d } = it, r = S.streams('stack' + (x | 0));
    let sy = y;
    for (let i = 0; i < d.n; i++) {
      const bw = w - rf(r, 0, 8), bh = rf(r, 6, 9);
      twoToneRR(ctx, x + (w - bw) / 2 + rf(r, -3, 3), sy - bh, bw, bh, 2.5, pick(r, S.P.spice), 'bottom', .45);
      sy -= bh;
    }
    if (d.open) {
      const ox = x + w / 2;
      ctx.fillStyle = css(col(45, 18, 90));
      ctx.beginPath(); ctx.moveTo(ox - 12, sy); ctx.quadraticCurveTo(ox - 6, sy - 7, ox, sy);
      ctx.quadraticCurveTo(ox + 6, sy - 7, ox + 12, sy); ctx.closePath(); ctx.fill();
      line(ctx, ox, sy, ox, sy - 4, col(30, 15, 60), 1.2);
    }
  }
};

CAT.yarnbasket = {
  make(r, P) {
    return { w: rf(r, 52, 64), h: rf(r, 34, 42), c: col(32, 40 * P.Sx + 10, P.ramp[2]),
             yarns: [pick(r, P.spice), pick(r, P.spice), pick(r, P.spice)].slice(0, ri(r, 2, 3)) };
  },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, r = S.streams('yarn' + (x | 0));
    d.yarns.forEach((yc, i) => {
      const yx = x + w * (.28 + i * .24), yy = y - h + 2, yr = rf(r, 7, 10);
      ell(ctx, yx, yy, yr, yr, yc);
      ctx.strokeStyle = css(shade(yc, 8)); ctx.lineWidth = 1.2;
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.arc(yx, yy, yr * .8, .6 + k * .5, 2.6 + k * .5); ctx.stroke(); }
    });
    twoToneRR(ctx, x, y - h * .72, w, h * .72, 8, d.c, 'bottom', .4);                // basket
    ctx.strokeStyle = css(withA(shade(d.c, 6), .7)); ctx.lineWidth = 1.4;
    for (let gx = x + 6; gx < x + w - 4; gx += 8)
      line(ctx, gx, y - h * .68, gx + 4, y - 4, withA(shade(d.c, 6), .5), 1.4);
    ctx.beginPath(); ctx.moveTo(x + w - 4, y - 8);                                   // trailing thread
    ctx.quadraticCurveTo(x + w + 16, y - 2, x + w + 26, y - 1);
    ctx.strokeStyle = css(d.yarns[0]); ctx.lineWidth = 1.4; ctx.stroke();
  }
};

CAT.guitar = {
  make(r, P) {
    return { w: 52, h: rf(r, 108, 122), body: col(24, 50 * P.Sx + 15, 42), lean: rf(r, .2, .3) };
  },
  draw(ctx, it) {
    const { x, y, h, d } = it, cx = x + 26;
    ctx.save(); ctx.translate(cx, y); ctx.rotate(d.lean);
    ell(ctx, 0, -22, 20, 18, d.body);                                                // lower bout
    ell(ctx, 0, -42, 15, 13, d.body);                                                // upper bout
    ell(ctx, 0, -30, 5.5, 5.5, col(30, 40, 18));                                     // sound hole
    fillRR(ctx, -3, -h + 8, 6, h - 46, 3, shade(d.body, 10));                        // neck
    fillRR(ctx, -4.4, -h + 2, 8.8, 12, 3, col(30, 25, 22));                          // head
    ctx.strokeStyle = css(col(45, 30, 80, .8)); ctx.lineWidth = .8;
    for (let i = -1.5; i <= 1.5; i++) line(ctx, i * 2, -h + 12, i * 2, -14, col(45, 30, 80, .7), .8);
    ell(ctx, 0, -14, 7, 3.4, shade(d.body, 14));                                     // bridge
    ctx.restore();
  }
};

CAT.wateringcan = {
  make(r, P) { return { w: 40, h: 34, c: P.item(r, { sat: 34, step: ri(r, 2, 3) }) }; },
  draw(ctx, it) {
    const { x, y, w, h, d } = it;
    twoToneRR(ctx, x + 8, y - h * .75, w * .55, h * .75, 6, d.c, 'bottom', .4);
    ctx.strokeStyle = css(d.c); ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.arc(x + 8 + w * .27, y - h * .75, 9, Math.PI, 0); ctx.stroke();   // top handle
    line(ctx, x + 9, y - h * .5, x - 4, y - h - 2, d.c, 4);                           // spout
    ell(ctx, x - 5, y - h - 3, 4, 3, lite(d.c, 6));                                   // rose
  }
};

CAT.wastebin = {
  make(r, P) { return { w: 30, h: 34, c: P.item(r, { sat: 18, step: ri(r, 2, 3) }) }; },
  draw(ctx, it) {
    const { x, y, w, h, d } = it;
    poly(ctx, [[x + 2, y - h], [x + w - 2, y - h], [x + w - 6, y], [x + 6, y]], d.c);
    ctx.fillStyle = css(lite(d.c, 6)); ctx.fillRect(x + 2, y - h, w - 4, 3);
    ell(ctx, x + w * .4, y - h - 2, 5, 4, col(45, 12, 88));                           // crumple
    ell(ctx, x + w * .6, y - h - 4, 4, 3.4, col(45, 10, 82));
  }
};

CAT.boots = {
  make(r, P) { return { w: 40, h: 30, c: P.item(r, { sat: 40, step: ri(r, 1, 2) }) }; },
  draw(ctx, it) {
    const { x, y, h, d } = it;
    for (const [bx, flip] of [[x, 1], [x + 21, -1]]) {
      ctx.save(); ctx.translate(bx + 9, y); ctx.scale(flip, 1); ctx.rotate(.04);
      fillRR(ctx, -6, -h, 12, h - 6, 4, d.c);                                          // shaft
      fillRR(ctx, -6, -10, 17, 10, 4, shade(d.c, 6));                                  // foot
      ctx.fillStyle = css(lite(d.c, 10)); ctx.fillRect(-6, -h, 12, 4);                 // cuff
      ctx.restore();
    }
  }
};

CAT.firewood = {
  make(r, P) { return { w: rf(r, 44, 58), h: 40, n: ri(r, 5, 7) }; },
  draw(ctx, it, S) {
    const { x, y, w, d } = it, r = S.streams('wood' + (x | 0));
    const rows = [[0, d.n >= 6 ? 3 : 2], [1, 2], [2, 1]];
    let idx = 0;
    for (const [row, count] of rows) {
      for (let i = 0; i < count && idx < d.n; i++, idx++) {
        const lx = x + w / 2 + (i - (count - 1) / 2) * 15, ly = y - 7 - row * 12;
        const wc = col(26, 30 + rf(r, 0, 8), 30 + rf(r, -4, 6));
        ell(ctx, lx, ly, 7.4, 7.4, wc);
        ell(ctx, lx, ly, 4.4, 4.4, lite(wc, 12));
        line(ctx, lx, ly, lx + rf(r, -4, 4), ly + rf(r, -4, 4), shade(wc, 8), 1);
      }
    }
  }
};

CAT.catbed = {
  make(r, P) { return { w: rf(r, 54, 64), h: 22, c: col(P.textileH, 30 * P.Sx + 8, P.ramp[2]) }; },
  draw(ctx, it) {
    const { x, y, w, h, d } = it, cx = x + w / 2;
    ell(ctx, cx, y - h / 2, w / 2, h / 2 + 2, d.c);
    ell(ctx, cx, y - h / 2 - 2, w / 2 - 7, h / 2 - 4, shade(d.c, 8));
    ell(ctx, x + w + 8, y - 4, 4, 4, lite(d.c, 15));                                  // toy ball
  }
};

CAT.slippers = {
  make(r, P) { return { w: 34, h: 12, c: col(P.textileH, 34 * P.Sx + 8, P.ramp[3]) }; },
  draw(ctx, it) {
    const { x, y, d } = it;
    for (const [sx2, rot] of [[x, -.06], [x + 18, .14]]) {
      ctx.save(); ctx.translate(sx2 + 8, y - 4); ctx.rotate(rot);
      ell(ctx, 0, 0, 9, 4.5, d.c);
      ctx.beginPath(); ctx.ellipse(2, -1, 6, 3.4, 0, Math.PI, 0); ctx.fillStyle = css(shade(d.c, 8)); ctx.fill();
      ctx.restore();
    }
  }
};

CAT.movingbox = {
  make(r, P) { return { w: rf(r, 62, 76), h: rf(r, 46, 56), c: col(30, 25 * P.Sx + 14, clamp(P.wallL - 20, 20, 62)) }; },
  draw(ctx, it, S) {
    const { x, y, w, h, d } = it, c = d.c;
    twoToneRR(ctx, x, y - h, w, h, 3, c, 'bottom', .25);
    poly(ctx, [[x, y - h], [x + w * .34, y - h], [x - 6, y - h - 13]], lite(c, 6));    // open flaps
    poly(ctx, [[x + w, y - h], [x + w * .66, y - h], [x + w + 6, y - h - 13]], lite(c, 4));
    line(ctx, x + w * .38, y - h + 4, x + w * .62, y - h + 4, col(40, 20, 78, .8), 3); // tape
    if (d.cat) drawCatInBox(ctx, it, S);
  }
};

/* ---------------------------- E. surface clutter ---------------------------- */
CAT.mug = {
  make(r, P) {
    return { w: 16, h: 15, c: pick(r, P.spice), fx: [{ t: 'steam', dx: 0, dy: -18 }] };
  },
  draw(ctx, it) {
    const { cx, y, d } = it;
    twoToneRR(ctx, cx - 7, y - 14, 14, 14, 4, d.c, 'bottom', .35);
    ctx.strokeStyle = css(d.c); ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(cx + 8.4, y - 8, 4, -1.2, 1.2); ctx.stroke();
    ctx.fillStyle = css(lite(d.c, 16)); ctx.fillRect(cx - 7, y - 14, 14, 3);
  }
};

CAT.teapot = {
  make(r, P) { return { w: 34, h: 20, c: pick(r, P.spice), fx: [{ t: 'steam', dx: -4, dy: -24 }] }; },
  draw(ctx, it) {
    const { cx, y, d } = it;
    ell(ctx, cx + 12, y - 2, 11, 2.4, withA(shade(d.c, 12), .5));                      // tray
    ell(ctx, cx - 4, y - 8, 10, 8, d.c);
    ctx.strokeStyle = css(d.c); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx + 5, y - 12); ctx.quadraticCurveTo(cx + 12, y - 15, cx + 12, y - 20); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 13, y - 10, 4.4, .8, Math.PI * 1.4); ctx.stroke();   // handle
    ell(ctx, cx - 4, y - 16, 2.4, 2, lite(d.c, 10));                                   // lid knob
    twoToneRR(ctx, cx + 9, y - 7, 8, 7, 2.4, lite(d.c, 8), 'bottom', .4);              // tiny cup
  }
};

CAT.candle = {
  make(r, P) {
    return { w: 12, h: rf(r, 14, 22), c: col(42, 25, 88), jar: chance(r, .3),
             fx: [{ t: 'flame', dx: 0, dy: null }, { t: 'light', dx: 0, dy: -20, r: 55, a: .55 }] };
  },
  draw(ctx, it) {
    const { cx, y, h, d } = it;
    fillRR(ctx, cx - 4.4, y - h, 8.8, h, 3, d.c);
    ctx.fillStyle = css(shade(d.c, 6)); ctx.fillRect(cx - 4.4, y - h + 2, 8.8, 1.6);
    if (d.jar) {
      fillRR(ctx, cx - 7, y - h - 4, 14, h + 4, 4, col(45, 20, 85, .28));
      line(ctx, cx - 7, y - h - 4, cx + 7, y - h - 4, col(45, 20, 92, .5), 1.4);
    }
    d.flameX = cx; d.flameY = y - h - 1;
  }
};

CAT.succulents = {
  make(r, P) { return { w: rf(r, 16, 34), h: 16, n: ri(r, 1, 3) }; },
  draw(ctx, it, S) {
    const { cx, y, w, d } = it, r = S.streams('succ' + (cx | 0)), g = S.P.leafGreen;
    for (let i = 0; i < d.n; i++) {
      const px = cx + (i - (d.n - 1) / 2) * 16;
      const pc = pick(r, S.P.spice);
      poly(ctx, [[px - 5, y - 7], [px + 5, y - 7], [px + 3.6, y], [px - 3.6, y]], pc);
      if (chance(r, .5)) {                                                             // rosette
        for (let k = 0; k < 6; k++) { const a = k / 6 * TAU;
          ell(ctx, px + Math.cos(a) * 3, y - 10 + Math.sin(a) * 2.2, 2.6, 1.8, col(g.h + rf(r, -8, 8), g.s + 6, g.l + rf(r, -4, 8))); }
        ell(ctx, px, y - 10, 2, 1.6, lite(g, 12));
      } else {                                                                          // cactus
        fillRR(ctx, px - 2.6, y - 16, 5.2, 10, 2.6, g);
        fillRR(ctx, px - 6, y - 13, 4, 2.6, 1.3, g); fillRR(ctx, px + 2, y - 14.4, 4, 2.6, 1.3, g);
      }
    }
  }
};

CAT.vase = {
  make(r, P) {
    return { w: 18, h: rf(r, 20, 26), c: pick(r, P.spice), fl: pick(r, P.spice), n: ri(r, 3, 4) };
  },
  draw(ctx, it, S) {
    const { cx, y, h, d } = it, r = S.streams('vase' + (cx | 0)), g = S.P.leafGreen;
    for (let i = 0; i < d.n; i++) {
      const a = (i - (d.n - 1) / 2) * .4;
      const tx = cx + Math.sin(a) * 12, ty = y - h - rf(r, 8, 16);
      ctx.beginPath(); ctx.moveTo(cx, y - h + 3);
      ctx.quadraticCurveTo(cx + Math.sin(a) * 5, y - h - 6, tx, ty);
      ctx.strokeStyle = css(g); ctx.lineWidth = 1.4; ctx.stroke();
      ell(ctx, tx, ty, 3, 3, d.fl); ell(ctx, tx, ty, 1.2, 1.2, lite(d.fl, 18));
    }
    poly(ctx, [[cx - 5, y - h], [cx + 5, y - h], [cx + 7.4, y], [cx - 7.4, y]], d.c);
    ctx.fillStyle = css(lite(d.c, 8)); ctx.fillRect(cx - 5, y - h, 10, 2.4);
  }
};

CAT.fishbowl = {
  make(r, P) { return { w: 26, h: 22, water: col(200, 40, 70), fish: col(22, 80, 60), fx: [{ t: 'fish' }] }; },
  draw(ctx, it, S) {
    const { cx, y, d } = it;
    ell(ctx, cx, y - 11, 13, 11, col(S.P.H, 20, clamp(S.P.wallL + 14, 0, 96), .35));
    ctx.save(); ctx.beginPath(); ctx.ellipse(cx, y - 11, 11.4, 9.4, 0, 0, TAU); ctx.clip();
    ctx.fillStyle = css(withA(d.water, .5)); ctx.fillRect(cx - 12, y - 15, 24, 15);
    for (let i = 0; i < 4; i++) ell(ctx, cx - 7 + i * 4.6, y - 2.4, 2, 1.6, col(30, 20, 45 + i * 6));
    ctx.restore();
    line(ctx, cx - 11, y - 15, cx + 11, y - 15, col(200, 30, 85, .6), 1.2);
    d.fishX = cx; d.fishY = y - 9;
  }
};

CAT.tablelamp = {
  make(r, P) {
    return { w: 26, h: rf(r, 30, 36), c: P.item(r, { sat: 26, step: ri(r, 1, 3) }),
             shadeC: col(P.textileH, 30 * P.Sx + 10, P.ramp[3]),
             fx: [{ t: 'light', dx: 0, dy: null, r: 120, a: .9 }] };
  },
  draw(ctx, it, S) {
    const { cx, y, h, d } = it;
    ell(ctx, cx, y - 2, 8, 3, d.c);
    line(ctx, cx, y - 3, cx, y - h + 14, d.c, 3);
    poly(ctx, [[cx - 11, y - h + 15], [cx + 11, y - h + 15], [cx + 7.4, y - h], [cx - 7.4, y - h]], d.shadeC);
    ctx.fillStyle = css(lite(d.shadeC, 8)); ctx.fillRect(cx - 7.4, y - h, 14.8, 2);
    ell(ctx, cx, y - h + 16, 9, 3, col(45, 85, 80, S.P.mood === 'day' ? .35 : .85));
    d.fx[0].ax = cx; d.fx[0].ay = y - h + 8;
  }
};

CAT.radio = {
  make(r, P) { return { w: 30, h: 18, c: pick(r, P.spice) }; },
  draw(ctx, it) {
    const { cx, y, d } = it;
    twoToneRR(ctx, cx - 14, y - 17, 28, 17, 5, d.c, 'bottom', .3);
    ctx.strokeStyle = css(shade(d.c, 12)); ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) line(ctx, cx - 9 + i * 3.4, y - 13, cx - 9 + i * 3.4, y - 5, shade(d.c, 12), 1.4);
    ell(ctx, cx + 7, y - 11, 2.6, 2.6, lite(d.c, 14)); ell(ctx, cx + 7, y - 5.4, 1.8, 1.8, lite(d.c, 14));
    line(ctx, cx + 10, y - 17, cx + 17, y - 26, shade(d.c, 10), 1.4);
  }
};

CAT.photoframe = {
  make(r, P) { return { w: 14, h: 17, c: P.item(r, { sat: 22, step: ri(r, 1, 3) }), tilt: rf(r, -.1, .1) }; },
  draw(ctx, it) {
    const { cx, y, d } = it;
    ctx.save(); ctx.translate(cx, y); ctx.rotate(d.tilt);
    fillRR(ctx, -6.4, -16, 12.8, 16, 2, d.c);
    fillRR(ctx, -4.4, -14, 8.8, 11, 1, col(45, 15, 90));
    ell(ctx, 0, -9.4, 2.6, 3, shade(d.c, 16));
    ctx.restore();
  }
};

CAT.alarmclock = {
  make(r, P) { return { w: 15, h: 16, c: pick(r, P.spice), hh: rf(r, 0, TAU), mm: rf(r, 0, TAU) }; },
  draw(ctx, it) {
    const { cx, y, d } = it;
    ell(ctx, cx - 4.4, y - 13.4, 2.6, 2.6, d.c); ell(ctx, cx + 4.4, y - 13.4, 2.6, 2.6, d.c);
    ell(ctx, cx, y - 8, 7.4, 7.4, d.c);
    ell(ctx, cx, y - 8, 5.4, 5.4, col(45, 15, 92));
    line(ctx, cx, y - 8, cx + Math.cos(d.hh) * 3, y - 8 + Math.sin(d.hh) * 3, col(30, 20, 25), 1.4);
    line(ctx, cx, y - 8, cx + Math.cos(d.mm) * 4.4, y - 8 + Math.sin(d.mm) * 4.4, col(30, 20, 25), 1);
  }
};

CAT.globe = {
  make(r, P) { return { w: 20, h: 24, sea: col(205, 45, 55), land: P.leafGreen }; },
  draw(ctx, it, S) {
    const { cx, y, d } = it, r = S.streams('globe' + (cx | 0));
    poly(ctx, [[cx - 6, y], [cx + 6, y], [cx + 3, y - 4], [cx - 3, y - 4]], col(30, 25, 35));
    ctx.strokeStyle = css(col(40, 30, 40)); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, y - 13, 9.4, Math.PI * .4, Math.PI * 1.45); ctx.stroke();  // C-arm
    ell(ctx, cx, y - 13, 8, 8, d.sea);
    for (let i = 0; i < 3; i++) ell(ctx, cx + rf(r, -4, 4), y - 13 + rf(r, -4, 4), rf(r, 2, 3.4), rf(r, 1.4, 2.6), d.land);
  }
};

CAT.typewriter = {
  make(r, P) { return { w: 34, h: 20, c: P.item(r, { sat: 26, step: ri(r, 1, 2) }) }; },
  draw(ctx, it) {
    const { cx, y, d } = it;
    fillRR(ctx, cx - 12, y - 17, 24, 8, 3, shade(d.c, 4));                            // carriage
    fillRR(ctx, cx - 15, y - 11, 30, 11, 4, d.c);                                     // body
    fillRR(ctx, cx - 7, y - 26, 14, 11, 1, col(45, 18, 93));                          // paper
    ctx.fillStyle = css(lite(d.c, 16));
    for (let row = 0; row < 2; row++) for (let k = 0; k < 6; k++)
      ell(ctx, cx - 10 + k * 4 + row * 2, y - 7 + row * 3.4, 1.2, 1.2, lite(d.c, 16));
  }
};

CAT.fruitbowl = {
  make(r, P) {
    return { w: 30, h: 14, c: pick(r, P.spice), fruits: Array.from({ length: ri(r, 4, 6) }, () => pick(r, P.spice)) };
  },
  draw(ctx, it, S) {
    const { cx, y, d } = it, r = S.streams('fruit' + (cx | 0));
    d.fruits.forEach((fc, i) => {
      const fx2 = cx + (i - (d.fruits.length - 1) / 2) * 6, fy2 = y - 9 - (i % 2) * 4;
      ell(ctx, fx2, fy2, 4.4, 4.4, fc);
      line(ctx, fx2, fy2 - 4, fx2 + 1.4, fy2 - 6, col(100, 30, 30), 1);
    });
    ctx.beginPath(); ctx.moveTo(cx - 15, y - 10);
    ctx.quadraticCurveTo(cx, y + 6, cx + 15, y - 10);
    ctx.lineTo(cx + 12, y - 4); ctx.quadraticCurveTo(cx, y + 2, cx - 12, y - 4);
    ctx.closePath(); ctx.fillStyle = css(d.c); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - 15, y - 10); ctx.quadraticCurveTo(cx, y + 6, cx + 15, y - 10);
    ctx.lineTo(cx + 15, y - 8); ctx.quadraticCurveTo(cx, y + 7, cx - 15, y - 8); ctx.closePath();
    ctx.fillStyle = css(shade(d.c, 8)); ctx.fill();
  }
};

CAT.pencils = {
  make(r, P) { return { w: 12, h: 18, c: pick(r, P.spice), n: ri(r, 4, 5) }; },
  draw(ctx, it, S) {
    const { cx, y, d } = it, r = S.streams('pen' + (cx | 0));
    for (let i = 0; i < d.n; i++) {
      const a = rf(r, -.35, .35), pc = pick(r, S.P.spice);
      const tx = cx + Math.sin(a) * 12, ty = y - 10 - Math.cos(a) * 11;
      line(ctx, cx + Math.sin(a) * 4, y - 9, tx, ty, pc, 2);
      poly(ctx, [[tx - 1.4, ty], [tx + 1.4, ty], [tx + Math.sin(a) * 2.4, ty - 3]], col(35, 45, 75));
    }
    twoToneRR(ctx, cx - 6, y - 11, 12, 11, 3, d.c, 'bottom', .4);
  }
};

CAT.smallbooks = {
  make(r, P) { return { w: rf(r, 24, 40), h: 22 }; },
  draw(ctx, it, S) {
    const { cx, y, w } = it, r = S.streams('sb' + (cx | 0));
    drawBookRun(ctx, r, S.P, cx - w / 2, cx + w / 2, y, 22);
  }
};

/* ------------------------------ F. creatures ------------------------------ */
function catPattern(ctx, r, d, bodyPath) {
  ctx.save(); bodyPath(); ctx.clip();
  if (d.coat === 'tuxedo') {
    ell(ctx, d.px, d.py + d.pr * .45, d.pr * .5, d.pr * .5, col(40, 8, 92));
  } else if (d.coat === 'calico') {
    ell(ctx, d.px - d.pr * .5, d.py - d.pr * .3, d.pr * .45, d.pr * .4, col(24, 70, 58));
    ell(ctx, d.px + d.pr * .55, d.py + d.pr * .1, d.pr * .4, d.pr * .35, col(30, 25, 22));
  } else if (d.coat === 'tabby') {
    ctx.strokeStyle = css(shade(d.c, 12)); ctx.lineWidth = 2.4;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(d.px + i * d.pr * .34, d.py - d.pr);
      ctx.lineTo(d.px + i * d.pr * .34 + 2, d.py - d.pr * .4); ctx.stroke();
    }
  }
  ctx.restore();
}
const CAT_COATS = [['orange', 30, col(25, 65, 58)], ['gray', 25, col(220, 8, 55)],
  ['tuxedo', 18, col(240, 12, 18)], ['calico', 14, col(38, 30, 88)],
  ['tabby', 8, col(32, 35, 48)], ['black', 5, col(250, 15, 14)]];

CAT.cat = {
  make(r, P, S) {
    const [coat, , c] = wpick(r, CAT_COATS.map(k => [k, k[1]]));
    const pose = S.rare.catWatching ? 'sit' : wpick(r, [['curl', 50], ['loaf', 30], ['sit', 20]]);
    return { w: pose === 'curl' ? 58 : 42, h: pose === 'sit' ? 46 : 26, coat, c, pose,
             awake: S.rare.mouse ? true : pose === 'sit', fx: [{ t: 'cattail' }] };
  },
  draw(ctx, it, S) {
    const { x, y, w, d } = it, cx = x + w / 2, c = d.c;
    const dark = shade(c, 10), r = S.streams('cat');
    d.px = cx; d.py = y - 14; d.pr = 20;
    if (d.pose === 'curl') {
      const bp = () => { ctx.beginPath(); ctx.ellipse(cx, y - 13, 27, 15, 0, 0, TAU); };
      bp(); ctx.fillStyle = css(c); ctx.fill();
      catPattern(ctx, r, d, bp);
      ctx.strokeStyle = css(dark); ctx.lineWidth = 5; ctx.lineCap = 'round';           // tail wrap
      ctx.beginPath(); ctx.arc(cx - 2, y - 9, 20, Math.PI * .25, Math.PI * .95); ctx.stroke();
      ell(ctx, cx + 13, y - 18, 11, 9.4, c);                                            // head
      poly(ctx, [[cx + 6, y - 24], [cx + 11, y - 32], [cx + 14, y - 24]], c);           // ears
      poly(ctx, [[cx + 16, y - 25], [cx + 21, y - 31], [cx + 23, y - 23]], c);
      if (d.awake) { ell(ctx, cx + 10, y - 19, 1.6, 2.2, col(140, 60, 55)); ell(ctx, cx + 17, y - 19, 1.6, 2.2, col(140, 60, 55)); }
      else { ctx.strokeStyle = css(dark); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx + 10, y - 19, 2.4, .2, Math.PI - .2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + 17, y - 19, 2.4, .2, Math.PI - .2); ctx.stroke(); }
      ell(ctx, cx + 13.5, y - 15.4, 1.4, 1, col(340, 40, 70));
      d.tailX = cx - 20; d.tailY = y - 6;
    } else if (d.pose === 'loaf') {
      const bp = () => { rrPath(ctx, cx - 20, y - 24, 40, 24, 13); };
      bp(); ctx.fillStyle = css(c); ctx.fill();
      catPattern(ctx, r, d, bp);
      poly(ctx, [[cx - 16, y - 22], [cx - 12, y - 31], [cx - 7, y - 23]], c);
      poly(ctx, [[cx - 4, y - 23], [cx + 1, y - 31], [cx + 5, y - 22]], c);
      ctx.strokeStyle = css(dark); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx - 10, y - 17, 2.4, .2, Math.PI - .2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - 1, y - 17, 2.4, .2, Math.PI - .2); ctx.stroke();
      ell(ctx, cx - 5.6, y - 13.4, 1.4, 1, col(340, 40, 70));
      d.tailX = cx + 19; d.tailY = y - 6;
    } else { // sit
      const bp = () => { ctx.beginPath(); ctx.ellipse(cx, y - 15, 15, 16, 0, 0, TAU); };
      bp(); ctx.fillStyle = css(c); ctx.fill();
      catPattern(ctx, r, d, bp);
      ell(ctx, cx + 1, y - 36, 11, 10, c);                                              // head
      poly(ctx, [[cx - 8, y - 42], [cx - 4, y - 51], [cx + 1, y - 43]], c);
      poly(ctx, [[cx + 3, y - 43], [cx + 8, y - 51], [cx + 11, y - 42]], c);
      ell(ctx, cx - 3, y - 37, 1.6, 2.4, d.coat === 'black' ? col(120, 70, 55) : col(140, 55, 45));
      ell(ctx, cx + 5, y - 37, 1.6, 2.4, d.coat === 'black' ? col(120, 70, 55) : col(140, 55, 45));
      ell(ctx, cx + 1, y - 33.4, 1.4, 1, col(340, 40, 70));
      ell(ctx, cx - 7, y - 3, 5, 3, shade(c, 4)); ell(ctx, cx + 7, y - 3, 5, 3, shade(c, 4)); // paws
      d.tailX = cx + 14; d.tailY = y - 4; d.tailUp = true;
    }
    if (d.coat === 'black')                                                              // lucky sparkle
      poly(ctx, [[cx - 24, y - 34], [cx - 22.6, y - 30.4], [cx - 19, y - 29], [cx - 22.6, y - 27.6],
                 [cx - 24, y - 24], [cx - 25.4, y - 27.6], [cx - 29, y - 29], [cx - 25.4, y - 30.4]], col(48, 80, 82, .9));
  }
};
function drawCatInBox(ctx, it, S) {
  const { x, y, w, h } = it, d = it.d.cat, cx = x + w / 2, ty = y - h;
  poly(ctx, [[cx - 9, ty], [cx - 5, ty - 10], [cx - 1, ty]], d.c);
  poly(ctx, [[cx + 1, ty], [cx + 5, ty - 10], [cx + 9, ty]], d.c);
  fillRR(ctx, cx - 10, ty - 2, 20, 5, 2.5, d.c);
  ell(ctx, cx - 4, ty + .5, 1.7, 2.2, col(140, 60, 50));
  ell(ctx, cx + 4, ty + .5, 1.7, 2.2, col(140, 60, 50));
}

CAT.dog = {
  make(r, P) {
    const c = wpick(r, [[col(28, 45, 55), 40], [col(35, 30, 75), 25], [col(20, 25, 30), 20], [col(40, 20, 88), 15]]);
    return { w: 72, h: 32, c, collar: P.accent };
  },
  draw(ctx, it) {
    const { x, y, w, d } = it, cx = x + w / 2, c = d.c;
    ell(ctx, cx, y - 14, 32, 16, c);                                                     // curled body
    ctx.strokeStyle = css(shade(c, 8)); ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx - 6, y - 10, 24, Math.PI * .35, Math.PI * .9); ctx.stroke();
    ell(ctx, cx + 17, y - 21, 13, 11, c);                                                // head
    ell(ctx, cx + 26, y - 24, 6.4, 9, shade(c, 6));                                      // floppy ear
    ctx.strokeStyle = css(shade(c, 14)); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx + 14, y - 22, 2.6, .2, Math.PI - .2); ctx.stroke();
    ell(ctx, cx + 9.4, y - 17.4, 2.4, 1.8, col(250, 15, 15));                             // nose
    ctx.strokeStyle = css(d.collar); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx + 15, y - 14, 8, Math.PI * 1.15, Math.PI * 1.9); ctx.stroke();
    ell(ctx, cx + 20, y - 8, 2, 2.4, col(45, 70, 65));                                    // tag
  }
};

CAT.birdcage = {
  make(r, P) {
    return { w: 46, h: 92, c: P.item(r, { sat: 18, step: ri(r, 3, 4) }), bird: pick(r, P.spice) };
  },
  draw(ctx, it) {
    const { x, y, w, d } = it, cx = x + w / 2, top = y - it.h + 14;
    line(ctx, cx, top - 14, cx, top, d.c, 2);                                             // hang wire
    ell(ctx, cx, top - 2, 3, 3, d.c);                                                     // finial
    ctx.strokeStyle = css(d.c); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, top + 26, 21, Math.PI, 0); ctx.stroke();                 // dome
    for (let i = -2; i <= 2; i++) {
      const bx = cx + i * 9.4;
      line(ctx, bx, top + 26 - Math.sqrt(Math.max(0, 441 - (i * 9.4) ** 2)), bx, y - 6, withA(d.c, .8), 1.6);
    }
    ell(ctx, cx, y - 6, 22, 4.4, d.c);                                                    // base
    line(ctx, cx - 8, top + 22, cx + 8, top + 22, withA(d.c, .9), 1.4);                   // swing
    ell(ctx, cx, top + 27, 5, 4, d.bird);                                                 // bird
    ell(ctx, cx + 4.4, top + 24, 2.6, 2.4, d.bird);
    poly(ctx, [[cx + 6.4, top + 24], [cx + 10, top + 23.4], [cx + 6.4, top + 25.4]], col(40, 70, 60));
    ell(ctx, cx + 5.4, top + 23.4, .7, .7, col(0, 0, 10));
  }
};

CAT.mouse = {
  make() { return { w: 22, h: 10, c: col(220, 10, 62) }; },
  draw(ctx, it, S) {
    const { x, y, d } = it, cx = x + 8;
    // baseboard mouse hole beside it
    const fy = S.shell.floorY;
    ctx.beginPath(); ctx.moveTo(x - 16, fy); ctx.lineTo(x - 16, fy - 9);
    ctx.arc(x - 10, fy - 9, 6, Math.PI, 0); ctx.lineTo(x - 4, fy); ctx.closePath();
    ctx.fillStyle = css(col(25, 25, 8)); ctx.fill();
    ell(ctx, cx, y - 4, 7, 4.4, d.c);                                                     // body
    ell(ctx, cx + 5.4, y - 6.4, 3, 3, d.c);                                               // head+ear
    ell(ctx, cx + 3.4, y - 9, 2.4, 2.4, lite(d.c, 8));
    ctx.beginPath(); ctx.moveTo(cx - 7, y - 4);
    ctx.quadraticCurveTo(cx - 13, y - 7, cx - 15, y - 2);
    ctx.strokeStyle = css(d.c); ctx.lineWidth = 1.2; ctx.stroke();
    ell(ctx, cx + 8.4, y - 5.4, .6, .6, col(0, 0, 10));
    for (let i = 0; i < 3; i++) ell(ctx, cx + 12 + i * 5, y - 2, 1.2, 1, col(38, 50, 60)); // crumbs
  }
};

CAT.balloon = {
  make(r, P) { return { w: 30, h: 60, c: P.accent }; },
  draw() { /* fully animated — see animators */ }
};

/* ============================ 4. ENGINE ============================ */

/* tiny inline extras used by rares */
CAT.letter = {
  make() { return { w: 22, h: 8, noShadow: true }; },
  draw(ctx, it) {
    const { x, y } = it;
    ctx.save(); ctx.translate(x + 11, y - 4); ctx.rotate(.06);
    fillRR(ctx, -10, -6, 20, 12, 1.5, col(45, 20, 92));
    line(ctx, -10, -6, 0, 2, col(40, 15, 70), 1); line(ctx, 10, -6, 0, 2, col(40, 15, 70), 1);
    ell(ctx, 0, 0, 2.2, 2.2, col(5, 70, 48));
    ctx.restore();
  }
};
CAT.gifts = {
  make(r, P) { return { w: 46, h: 26, c1: P.accent, c2: pick(r, P.spice) }; },
  draw(ctx, it) {
    const { x, y, d } = it;
    twoToneRR(ctx, x, y - 24, 26, 24, 3, d.c1, 'bottom', .3);
    ctx.fillStyle = css(lite(d.c1, 16)); ctx.fillRect(x + 10, y - 24, 6, 24);
    fillRR(ctx, x + 8, y - 29, 10, 6, 3, lite(d.c1, 16));
    twoToneRR(ctx, x + 24, y - 16, 20, 16, 3, d.c2, 'bottom', .3);
    ctx.fillStyle = css(lite(d.c2, 16)); ctx.fillRect(x + 31, y - 16, 5, 16);
  }
};

/* ------------------------------ generation ------------------------------ */
function generate(seed) {
  const streams = makeStreams(seed);
  const weather = wpick(streams('weather'), [['clear', 62], ['rain', 20], ['snow', 8], ['fog', 10]]);
  const rRare = streams('rare');

  // fixed-order rare rolls (order is part of the determinism contract)
  const rare = {};
  rare.golden = chance(rRare, .004);
  const P = buildPalette(streams('pal'), weather, rare.golden ? 'golden' : null);
  const shell = genShell(streams, P, weather);
  const hasWin = shell.windows.length > 0;
  rare.cat = chance(rRare, .38);
  rare.catWatching = rare.cat && hasWin && chance(rRare, .15);
  rare.catInBox = rare.cat && chance(rRare, .10);
  rare.dog = chance(rRare, .12);
  rare.mouse = chance(rRare, .015);
  rare.aurora = P.mood === 'night' && weather === 'clear' && chance(rRare, .08);
  rare.shootingStar = P.mood === 'night' && weather === 'clear' && chance(rRare, .06);
  rare.harvestMoon = P.mood === 'night' && chance(rRare, .04);
  rare.rainbow = P.mood === 'day' && weather === 'rain' && chance(rRare, .25);
  rare.fireflies = P.mood === 'dusk' && weather === 'clear' && chance(rRare, .30);
  rare.godRays = (P.mood === 'day' || P.mood === 'golden') && hasWin && chance(rRare, .05);
  rare.neon = (P.mood === 'dusk' || P.mood === 'night') && chance(rRare, .03);
  rare.balloon = chance(rRare, .008);
  rare.letter = !!shell.door && chance(rRare, .02);
  rare.birthday = chance(rRare, .005);
  rare.mono = chance(rRare, .01);
  if (rare.golden) { rare.godRays = hasWin; rare.cat = true; rare.catInBox = false; }
  if (rare.mono) P.spice = P.spice.map(c => col(P.H + (c.h % 24) - 12, Math.min(c.s, 40), c.l));

  // layout attempts (density guard, deterministic)
  let S = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const sfx = attempt ? '#' + attempt : '';
    S = buildLayout({ seed, streams, P, shell, rare, weather },
      streams('layout' + sfx), streams('decor' + sfx));
    const cov = S.laneBack.coverage();
    if ((cov >= .52 && S.items.length + S.wallItems.length >= 11) || attempt === 2) break;
  }
  resolveFX(S);
  S.manifest = buildManifest(S);
  S.jackpot = rare.golden || (S.catCoat === 'black' && rare.aurora) || (rare.dog && rare.cat && weather === 'snow');
  return S;
}

function buildLayout(base, rLay, rDecor) {
  const { P, shell, rare } = base;
  const S = { ...base, items: [], wallItems: [], surfaces: [], lights: [], anims: [],
              laneBack: new Lane(14, SW - 14), laneFront: new Lane(24, SW - 24),
              wallRects: shell.windows.map(winRect), rug: null, perches: [] };
  if (shell.door) S.wallRects.push({ x: shell.door.x - 9, y: shell.floorY - shell.door.h - 9, w: shell.door.w + 18, h: shell.door.h + 9 });
  const doorClear = shell.door ? [shell.door.x - 20, shell.door.x + shell.door.w + 20] : null;
  if (doorClear) S.laneFront.add(doorClear[0], doorClear[1]);

  const mk = kind => { const d = CAT[kind].make(rLay, P, S); return { kind, w: d.w, h: d.h, d, lane: 'back' }; };

  const jitter = () => rf(rLay, -3, 3);
  const tryBack = (it, opts = {}) => {
    const K = 12, cands = [];
    for (let i = 0; i < K; i++) {
      let x;
      if (opts.targetX != null && i < 6) x = clamp(opts.targetX - it.w / 2 + rf(rLay, -30, 30), 14, SW - 14 - it.w);
      else x = rf(rLay, 14, SW - 14 - it.w);
      if (!S.laneBack.fits(x, x + it.w)) continue;
      if (it.d.tall || it.h > .5 * shell.floorY) {
        const sil = { x, y: shell.yB - it.h, w: it.w, h: it.h };
        if (S.wallRects.some(wr => rectsOverlap(sil, wr, 14))) continue;
      }
      let score = 0;
      for (const s of S.laneBack.spans) score = Math.max(score, 0); // placeholder
      const gapL = Math.min(...S.laneBack.spans.map(s => Math.abs(x - s[1])).concat([x]));
      const gapR = Math.min(...S.laneBack.spans.map(s => Math.abs(s[0] - (x + it.w))).concat([SW - x - it.w]));
      score = Math.min(gapL, gapR) + rf(rLay, 0, 20);
      if (opts.nearWin != null) score -= Math.abs((x + it.w / 2) - opts.nearWin) * .5;
      if (opts.targetX != null) score -= Math.abs((x + it.w / 2) - opts.targetX) * .8;
      cands.push([score, x]);
    }
    if (!cands.length) return false;
    cands.sort((a, b) => b[0] - a[0]);
    const x = cands[0][1];
    it.x = x; it.y = shell.yB + jitter();
    S.laneBack.add(x, x + it.w);
    if (it.d.tall || it.h > .5 * shell.floorY)
      S.wallRects.push({ x, y: shell.yB - it.h, w: it.w, h: it.h });
    commit(S, it, rLay);
    return true;
  };
  const tryFront = (it, targetX = null, strict = false) => {
    const K = 10;
    for (let i = 0; i < K; i++) {
      if (strict && i >= 5) return false;      // targeted-only: skip rather than scatter
      let x = targetX != null && i < 5
        ? clamp(targetX - it.w / 2 + rf(rLay, -20, 20), 24, SW - 24 - it.w)
        : rf(rLay, 24, SW - 24 - it.w);
      if (!S.laneFront.fits(x, x + it.w)) continue;
      it.x = x; it.y = shell.yF + jitter(); it.lane = 'front';
      S.laneFront.add(x, x + it.w);
      commit(S, it, rLay);
      return true;
    }
    return false;
  };

  /* -- archetype & anchors -- */
  const arch = wpick(rLay, [['nook', 20], ['bedroom', 18], ['studio', 16], ['lounge', 18],
                            ['music', 8], ['plants', 10], ['kitchen', 10]]);
  S.arch = arch;
  const anchorPlan = {
    nook:    ['armchair', 'bookshelf'],
    bedroom: ['bed', 'nightstand'],
    studio:  ['desk', 'bookshelf'],
    lounge:  ['sofa', 'sidetable'],
    music:   ['piano', 'recordstand'],
    plants:  ['bench', 'bookshelf'],
    kitchen: ['counter'],
  }[arch].slice();
  const extras = ['fireplace', 'wardrobe', 'dresser', 'armchair', 'sofa', 'bookshelf', 'radiator', 'bench', 'console'];
  const nExtra = ri(rLay, 1, 3);
  for (let i = 0; i < nExtra; i++) {
    const e = pick(rLay, extras);
    if (!anchorPlan.includes(e) || e === 'bookshelf') anchorPlan.push(e);
  }
  if ((P.mood === 'night' || P.mood === 'dusk') && !anchorPlan.includes('fireplace') && chance(rLay, .25))
    anchorPlan.push('fireplace');

  let bedIt = null, seatIt = null, deskIt = null, fireIt = null, counterIt = null;
  for (const kind of anchorPlan) {
    if (kind === 'nightstand') continue;                       // placed beside bed below
    const it = mk(kind);
    const opts = {};
    if (kind === 'bed') opts.targetX = chance(rLay, .5) ? 40 + it.w / 2 : SW - 40 - it.w / 2;
    if ((kind === 'bench' || kind === 'radiator') && shell.windows[0]) opts.nearWin = shell.windows[0].cx;
    if (!tryBack(it, opts)) continue;
    if (kind === 'bed') { bedIt = it; it.d.headLeft = it.x < SW / 2; }
    if (kind === 'sofa' || kind === 'armchair' || kind === 'bench') seatIt = seatIt || it;
    if (kind === 'desk') deskIt = it;
    if (kind === 'fireplace') { fireIt = it; S.laneFront.add(it.x + it.w / 2 - 58, it.x + it.w / 2 + 58); }
    if (kind === 'counter') counterIt = it;
  }
  // guaranteed something big: if back lane nearly empty, force a sofa or shelf
  if (S.items.length < 2) { tryBack(mk('sofa')); tryBack(mk('bookshelf')); }

  /* -- secondary furniture -- */
  if (bedIt) { const ns = mk('nightstand');
    tryBack(ns, { targetX: bedIt.d.headLeft ? bedIt.x + bedIt.w + 40 : bedIt.x - 40 }); }
  if (seatIt && chance(rLay, .7)) { const st = mk('sidetable');
    tryBack(st, { targetX: chance(rLay, .5) ? seatIt.x - 45 : seatIt.x + seatIt.w + 45 }); }
  if (chance(rLay, .4)) { const dr = mk(pick(rLay, ['dresser', 'console'])); tryBack(dr); }
  if (shell.windows[0] && !S.items.some(i => i.kind === 'radiator') && chance(rLay, .25))
    tryBack(mk('radiator'), { nearWin: shell.windows[0].cx });
  if (deskIt) { const ch = mk('chair'); ch.d.c = deskIt.d.c; tryFront(ch, deskIt.x + deskIt.w / 2, true); }

  /* -- rug -- */
  {
    const anchor = seatIt || bedIt || S.items[0];
    let cx2 = anchor ? anchor.x + anchor.w / 2 : SW / 2;
    let w = clamp((anchor ? anchor.w : 200) + rf(rLay, 60, 120), 140, 460);
    cx2 = clamp(cx2 + rf(rLay, -30, 30), 40 + w / 2, SW - 40 - w / 2);
    S.rug = { cx: cx2, w, shape: chance(rLay, .6) ? 'rect' : 'ellipse',
      bands: ri(rLay, 1, 3), fringe: chance(rLay, .55),
      h: P.textileH, s: clamp(38 * P.Sx + 8, 8, 55), l: P.ramp[ri(rLay, 1, 3)],
      bandC: withA(P.accent, .9) };
  }

  /* -- wall décor -- */
  const eyeY = .42 * shell.floorY;
  const tryWall = (it, tx, ty, strict = false) => {
    for (let i = 0; i < 10; i++) {
      if (strict && i >= 5) return false;
      const x = clamp((i < 5 && tx != null ? tx + rf(rDecor, -40, 40) : rf(rDecor, 20, SW - 20 - it.w)), 12, SW - 12 - it.w);
      const y = clamp((ty != null ? ty : eyeY - it.h / 2) + rf(rDecor, -20, 20), 16, shell.floorY - it.h - 60);
      const rect = { x, y, w: it.w, h: it.h };
      if (S.wallRects.some(wr => rectsOverlap(rect, wr, 14))) continue;
      it.x = x; it.y = y; it.lane = 'wall';
      S.wallRects.push(rect); S.wallItems.push(it);
      if (it.d.surface)   // wall shelf holds clutter
        S.surfaces.push({ x: x + it.d.surface.inset, w: it.w - it.d.surface.inset * 2,
                          topY: y + 22, slots: it.d.surface.slots, kind: 'wallshelf' });
      return true;
    }
    return false;
  };
  const mkW = kind => { const d = CAT[kind].make(rDecor, P, S); return { kind, w: d.w, h: d.h, d, lane: 'wall' }; };
  const nDecor = ri(rDecor, 2, 4) + (shell.windows.length <= 1 ? 1 : 0);
  const decorPool = [['artLandscape', 20], ['artAbstract', 14], ['mirror', 12], ['clock', 12],
    ['wallshelf', 12], ['hangplant', 10], ['stringlights', 9], ['pennant', 7], ['plates', 6], ['calendar', 5], ['portrait', 5]];
  let placedDecor = 0;
  const oneOf = new Set();       // singletons: never two clocks / mirrors / calendars
  // art prefers hanging above the widest committed furniture
  const wide = [...S.items].sort((a, b) => b.w - a.w)[0];
  for (let guard = 0; placedDecor < nDecor && guard < 14; guard++) {
    const kind = wpick(rDecor, decorPool);
    if (['clock', 'mirror', 'calendar', 'stringlights', 'pennant', 'hangplant'].includes(kind)) {
      if (oneOf.has(kind)) continue;
      oneOf.add(kind);
    }
    const it = mkW(kind);
    let tx = null, ty = null;
    if ((kind === 'artLandscape' || kind === 'artAbstract') && wide && chance(rDecor, .6))
      tx = wide.x + wide.w / 2 - it.w / 2;
    if (kind === 'hangplant') ty = 0;
    if (kind === 'stringlights' || kind === 'pennant') ty = rf(rDecor, 14, 50);
    if (kind === 'calendar' && deskIt) tx = deskIt.x + deskIt.w / 2 - it.w / 2;
    if (tryWall(it, tx, ty)) {
      placedDecor++;
      if ((kind === 'artLandscape' || kind === 'artAbstract') && chance(rDecor, .3)) {   // gallery cluster
        const g2 = mkW(pick(rDecor, ['portrait', 'artAbstract', 'artLandscape']));
        tryWall(g2, it.x + it.w + 18 + g2.w / 2 - g2.w / 2, it.y + rf(rDecor, -10, 10));
      }
    }
  }
  // sconces flank the first window / fireplace
  if (chance(rDecor, .3)) {
    const fw = shell.windows[0];
    const fcx = fw ? fw.cx : (fireIt ? fireIt.x + fireIt.w / 2 : null);
    const fwid = fw ? fw.w : (fireIt ? fireIt.w : 0);
    const fy2 = fw ? fw.y + fw.h * .25 : eyeY - 30;
    if (fcx != null) for (const side of [-1, 1]) {
      const sc = mkW('sconce');
      tryWall(sc, fcx + side * (fwid / 2 + 34) - sc.w / 2, fy2, true);
    }
  }
  if (counterIt) {                            // kitchens read as kitchens
    const ks = mkW('wallshelf');
    if (tryWall(ks, counterIt.x + counterIt.w / 2 - ks.w / 2, eyeY - 60)) {
      const pl = mkW('plates');
      tryWall(pl, counterIt.x + counterIt.w / 2 + (chance(rDecor, .5) ? -90 : 90), eyeY - 40);
    }
  }
  if (rare.neon) { const nn = mkW('neon'); tryWall(nn, null, rf(rDecor, 30, 80)); }
  if (rare.birthday) { const pn = mkW('pennant'); tryWall(pn, SW / 2 - pn.w / 2, 20); }

  /* -- floor clutter (front + leaning) -- */
  const plantKinds = ['monstera', 'snakeplant', 'fig'];
  const wantPlants = arch === 'plants' ? 3 : (chance(rLay, .75) ? 1 : 0) + (chance(rLay, .3) ? 1 : 0);
  for (let i = 0; i < wantPlants; i++) {
    const pk = arch === 'plants' ? pick(rLay, plantKinds) : wpick(rLay, [['monstera', 40], ['snakeplant', 30], ['fig', 30]]);
    const it = mk(pk);
    const corner = chance(rLay, .5) ? rf(rLay, 26, 120) : rf(rLay, SW - 190, SW - 90);
    tryFront(it, pk === 'fig' ? corner : null);
  }
  const clutterPlan = [];
  if (arch === 'lounge' || (seatIt && chance(rLay, .4))) clutterPlan.push(['coffeetable', S.rug ? S.rug.cx : null]);
  if (chance(rLay, .5)) clutterPlan.push(['bookstack', seatIt ? seatIt.x - 30 : null]);
  if (seatIt && chance(rLay, .3)) clutterPlan.push(['yarnbasket', seatIt.x + seatIt.w + 30]);
  if (chance(rLay, .25) || arch === 'music') clutterPlan.push(['guitar', null]);
  if (deskIt && chance(rLay, .5)) clutterPlan.push(['wastebin', deskIt.x - 24]);
  if (chance(rLay, .22)) clutterPlan.push(['boots', chance(rLay, .5) ? 40 : SW - 60]);
  if (fireIt) clutterPlan.push(['firewood', fireIt.x + fireIt.w + 34]);
  if (bedIt && chance(rLay, .4)) clutterPlan.push(['slippers', bedIt.x + bedIt.w * .4]);
  if (chance(rLay, .12)) clutterPlan.push(['movingbox', null]);
  if (chance(rLay, .2)) clutterPlan.push(['stool', null]);
  if (rare.birthday) clutterPlan.push(['gifts', S.rug ? S.rug.cx + 60 : SW / 2]);
  if (rare.letter && shell.door) {
    const li = mk('letter'); li.x = shell.door.x + shell.door.w / 2 - 11 + rf(rLay, -8, 8);
    li.y = shell.yF - 14; li.lane = 'front'; commit(S, li, rLay);   // inside door keep-clear on purpose
  }
  const storyBound = new Set(['firewood', 'wastebin', 'slippers', 'yarnbasket', 'gifts']);
  for (const [kind, tx] of clutterPlan) {
    const it = mk(kind);
    if (kind === 'guitar') {
      const host = pick(rLay, S.items.filter(i2 => i2.lane === 'back' && i2.h > 60) || [null]);
      if (!host) continue;
      tryFront(it, chance(rLay, .5) ? host.x - 14 : host.x + host.w + 14, true);
    } else tryFront(it, tx, storyBound.has(kind) && tx != null);
  }
  // watering can near a plant
  const plant = S.items.find(i2 => plantKinds.includes(i2.kind));
  if (plant && chance(rLay, .4)) tryFront(mk('wateringcan'), plant.x + plant.w + 30, true);

  /* -- guaranteed warmth: a lamp must exist when it matters -- */
  const hasFire = !!fireIt;
  const needLamp = !hasFire && (P.mood !== 'day' || !shell.windows.length);
  if (needLamp || chance(rLay, .45)) {
    const fl = mk('floorlamp');
    const host = seatIt || bedIt;
    if (!tryFront(fl, host ? (chance(rLay, .5) ? host.x - 40 : host.x + host.w + 40) : null)) tryFront(fl);
  }

  /* -- surface clutter -- */
  fillSurfaces(S, rDecor);

  /* -- creatures -- */
  placeCreatures(S, rLay);

  return S;
}

function commit(S, it, r) {
  S.items.push(it);
  const surf = it.d.surface;
  if (surf) {
    const topY = surf.topDy != null ? it.y + surf.topDy : it.y - it.h;
    S.surfaces.push({ x: it.x + surf.inset, w: it.w - surf.inset * 2, topY, slots: surf.slots, kind: it.kind });
  }
  if (it.d.fx) for (const f of it.d.fx) if (f.t === 'perch')
    S.perches.push([it.x + f.dx, it.y + f.dy]);
}

function fillSurfaces(S, rDecor) {
  const { P, rare } = S;
  // window sills + mantel as surfaces
  for (const win of S.shell.windows) if (win.style !== 'round')
    S.surfaces.push({ x: win.x, w: win.w, topY: win.y + win.h, slots: Math.max(2, Math.floor(win.w / 90)), kind: 'sill' });
  const allowed = {
    sill: ['succulents', 'candle', 'vase', 'smallbooks', 'mug'],
    nightstand: ['tablelamp', 'alarmclock', 'mug', 'smallbooks', 'candle', 'photoframe'],
    desk: ['tablelamp', 'typewriter', 'pencils', 'mug', 'smallbooks', 'globe', 'photoframe', 'radio'],
    counter: ['fruitbowl', 'teapot', 'mug', 'vase', 'radio', 'smallbooks'],
    coffeetable: ['teapot', 'mug', 'fruitbowl', 'smallbooks', 'candle', 'vase'],
    fireplace: ['candle', 'clockM', 'photoframe', 'vase', 'succulents'],
    def: ['mug', 'candle', 'vase', 'succulents', 'photoframe', 'smallbooks', 'radio', 'fishbowl', 'tablelamp', 'globe'],
  };
  const sturdy = ['console', 'dresser', 'desk', 'counter'];
  let lampPlaced = S.items.some(i => i.kind === 'floorlamp'), mugPlaced = false;
  for (const sf of S.surfaces) {
    const pool = (allowed[sf.kind] || allowed.def).slice();
    const fillP = rf(rDecor, .4, .85);
    const slotW = sf.w / sf.slots;
    for (let i = 0; i < sf.slots; i++) {
      if (!chance(rDecor, fillP)) continue;
      let kind = pick(rDecor, pool);
      if (kind === 'clockM') kind = 'photoframe';
      if (kind === 'fishbowl' && !sturdy.includes(sf.kind)) kind = 'smallbooks';
      if (kind === 'tablelamp' && lampPlaced && chance(rDecor, .6)) kind = 'smallbooks';
      const d = CAT[kind].make(rDecor, P, S);
      if (d.w > slotW - 4) continue;
      const it = { kind, cx: sf.x + (i + .5) * slotW + rf(rDecor, -4, 4), y: sf.topY, w: d.w, h: d.h, d, lane: 'surf' };
      S.items.push(it);
      if (kind === 'tablelamp') lampPlaced = true;
      if (kind === 'mug' || kind === 'teapot') mugPlaced = true;
    }
  }
  // coziness laws
  const bestSf = S.surfaces[0];
  if (!mugPlaced && bestSf) {
    const d = CAT.mug.make(rDecor, P, S);
    S.items.push({ kind: 'mug', cx: bestSf.x + bestSf.w / 2, y: bestSf.topY, w: d.w, h: d.h, d, lane: 'surf' });
  }
  if (!lampPlaced && !S.items.some(i => i.kind === 'fireplace') && P.mood !== 'day' && bestSf) {
    const d = CAT.tablelamp.make(rDecor, P, S);
    S.items.push({ kind: 'tablelamp', cx: bestSf.x + bestSf.w * .2, y: bestSf.topY, w: d.w, h: d.h, d, lane: 'surf' });
  }
  const hasPlant = S.items.some(i => ['monstera', 'snakeplant', 'fig', 'succulents', 'hangplant'].includes(i.kind)) ||
                   S.wallItems.some(i => i.kind === 'hangplant');
  if (!hasPlant && bestSf) {
    const d = CAT.succulents.make(rDecor, P, S);
    S.items.push({ kind: 'succulents', cx: bestSf.x + bestSf.w * .8, y: bestSf.topY, w: d.w, h: d.h, d, lane: 'surf' });
  }
}

function placeCreatures(S, rLay) {
  const { rare, P } = S;
  if (rare.mouse) {
    const d = CAT.mouse.make(rLay, P, S);
    const mx = chance(rLay, .5) ? rf(rLay, 40, 90) : rf(rLay, SW - 120, SW - 60);
    S.items.push({ kind: 'mouse', x: mx, y: S.shell.yF + 2, w: d.w, h: d.h, d, lane: 'front' });
  }
  let catPlaced = false;
  if (rare.cat) {
    const box = S.items.find(i => i.kind === 'movingbox');
    const d = CAT.cat.make(rLay, P, S);
    S.catCoat = d.coat;
    if (rare.catInBox && box) { box.d.cat = d; catPlaced = true; }
    else {
      const it = { kind: 'cat', w: d.w, h: d.h, d, lane: 'creature' };
      const win0 = S.shell.windows[0];
      // ordered preferences: window-watch → rug center → perch → cat bed → floor
      if (rare.catWatching && win0 && S.perches.length && Math.abs(S.perches[0][0] - win0.cx) < 200) {
        it.x = S.perches[0][0] - it.w / 2; it.y = S.perches[0][1];
      } else if (S.rug && S.laneFront.fits(S.rug.cx - d.w / 2, S.rug.cx + d.w / 2)) {
        it.x = S.rug.cx - d.w / 2; it.y = S.shell.yF - 6;
        S.laneFront.add(it.x, it.x + it.w);
      } else if (S.perches.length) {
        const p = pick(rLay, S.perches);
        it.x = p[0] - it.w / 2; it.y = p[1];
      } else {
        const bed = S.items.find(i => i.kind === 'catbed');
        if (bed) { it.x = bed.x + bed.w / 2 - it.w / 2; it.y = bed.y - 6; }
        else { const gaps = S.laneFront.gaps().filter(g => g[1] - g[0] > it.w + 8);
          if (gaps.length) { const g = pick(rLay, gaps); it.x = (g[0] + g[1]) / 2 - it.w / 2; it.y = S.shell.yF;
            S.laneFront.add(it.x, it.x + it.w); } }
      }
      if (it.x != null) { S.items.push(it); catPlaced = true; }
    }
    // mouse standoff: cat is awake
    if (rare.mouse && catPlaced) { const c = S.items.find(i => i.kind === 'cat'); if (c) c.d.awake = true; }
  }
  if (rare.dog) {
    const d = CAT.dog.make(rLay, P, S);
    const it = { kind: 'dog', w: d.w, h: d.h, d, lane: 'creature' };
    const cx2 = S.rug ? S.rug.cx + (catPlaced ? 44 : 0) : SW / 2;
    if (S.rug && S.laneFront.fits(cx2 - d.w / 2, cx2 + d.w / 2)) {
      it.x = cx2 - d.w / 2; it.y = S.shell.yF - 4; S.laneFront.add(it.x, it.x + it.w); S.items.push(it);
    } else { const gaps = S.laneFront.gaps().filter(g => g[1] - g[0] > it.w + 8);
      if (gaps.length) { const g = pick(rLay, gaps); it.x = (g[0] + g[1]) / 2 - it.w / 2; it.y = S.shell.yF;
        S.laneFront.add(it.x, it.x + it.w); S.items.push(it); } }
  }
  if (chance(rLay, .06)) {   // caged bird
    const it = { kind: 'birdcage', lane: 'wall' };
    const d = CAT.birdcage.make(rLay, P, S); it.d = d; it.w = d.w; it.h = d.h;
    for (let i = 0; i < 8; i++) {
      const x = rf(rLay, 30, SW - 80);
      const rect = { x, y: 0, w: d.w, h: d.h };
      if (S.wallRects.some(wr => rectsOverlap(rect, wr, 12))) continue;
      it.x = x; it.y = d.h; S.wallRects.push(rect); S.wallItems.push(it); break;
    }
  }
}

/* light sources & animation anchors, resolved post-layout */
function resolveFX(S) {
  const { P } = S;
  const L = (x, y, r2, a, tint) => S.lights.push({ x, y, r: r2, a, tint });
  for (const it of S.items) {
    const cx2 = it.cx != null ? it.cx : it.x + it.w / 2;
    switch (it.kind) {
      case 'fireplace': L(cx2, it.y - 50, 210, 1); break;
      case 'floorlamp': L(cx2, it.y - it.h + 22, 185, 1); break;
      case 'tablelamp': L(cx2, it.y - it.h + 10, 120, .9); break;
      case 'candle': L(cx2, it.y - it.h - 4, 55, .55); break;
    }
  }
  for (const it of S.wallItems) {
    if (it.kind === 'sconce') L(it.x + 17, it.y + 12, 70, .5);
    if (it.kind === 'neon') L(it.x + 60, it.y + 30, 120, .85, it.d.c.h);
  }
}

function buildManifest(S) {
  const nice = { sofa: 'a sofa', armchair: 'an armchair', bed: 'a bed', bookshelf: 'a bookshelf',
    fireplace: 'a crackling fireplace', desk: 'a desk', piano: 'an upright piano', counter: 'a kitchen counter' };
  const feats = S.items.filter(i => nice[i.kind]).slice(0, 3).map(i => nice[i.kind]);
  const weather = { rain: 'rain outside', snow: 'snow falling outside', fog: 'fog outside', clear: '' }[S.weather];
  const cat = S.items.some(i => i.kind === 'cat') ? `a ${S.catCoat} cat` : '';
  const dog = S.items.some(i => i.kind === 'dog') ? 'a sleeping dog' : '';
  return `A ${S.P.mood === 'golden' ? 'golden-hour' : S.P.mood}-lit ${S.P.famName} room` +
    (feats.length ? ' with ' + feats.join(', ') : '') +
    [weather, cat, dog].filter(Boolean).map(s => '; ' + s).join('') + '.';
}

/* ------------------------------ render/bake ------------------------------ */
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(2, w | 0); c.height = Math.max(2, h | 0); return c; }

let glowSprite = null;
function getGlowSprite() {
  if (glowSprite) return glowSprite;
  glowSprite = mkCanvas(128, 128);
  const g = glowSprite.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'hsla(38,90%,70%,.9)'); gr.addColorStop(.4, 'hsla(36,85%,64%,.35)'); gr.addColorStop(1, 'hsla(36,85%,60%,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return glowSprite;
}

function drawScene(ctx, S) {
  const { shell, P } = S;
  drawWall(ctx, S);
  drawFloor(ctx, S);
  drawAO(ctx, S);
  for (const win of shell.windows) drawWindow(ctx, S, win);
  if (shell.door) drawDoor(ctx, S, shell.door);
  for (const it of S.items) if (it.lane === 'back') drawHalo(ctx, S, it);      // wall AO halos
  for (const it of [...S.wallItems].sort((a, b) => a.x - b.x)) CAT[it.kind].draw(ctx, it, S);
  drawRug(ctx, S);
  castShadows(ctx, S);
  const back = S.items.filter(i => i.lane === 'back').sort((a, b) => a.x - b.x);
  const front = S.items.filter(i => i.lane === 'front').sort((a, b) => a.x - b.x);
  const surf = S.items.filter(i => i.lane === 'surf');
  const creatures = S.items.filter(i => i.lane === 'creature');
  for (const it of back) {
    CAT[it.kind].draw(ctx, it, S);
    if (!it.d.noShadow) contactShadow(ctx, P, it.x + it.w / 2, it.y, it.w);
  }
  for (const it of surf) CAT[it.kind].draw(ctx, it, S);
  for (const it of front) {
    CAT[it.kind].draw(ctx, it, S);
    if (!it.d.noShadow) contactShadow(ctx, P, it.x + it.w / 2, it.y, it.w, .14);
  }
  for (const it of creatures) {
    contactShadow(ctx, P, it.x + it.w / 2, it.y, it.w * .9, .12);
    CAT[it.kind].draw(ctx, it, S);
  }
}

function finishStack(base, bctx, S, k, ox, oy) {
  const { P, shell } = S;
  const pxW = base.width, pxH = base.height;
  const toPx = (x, y) => [x * k + ox, y * k + oy];
  // confine every finish pass to the scene rect — letterbox stays transparent
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.save();
  bctx.beginPath(); bctx.rect(ox, oy, SW * k, SH * k); bctx.clip();

  /* 1 — mood grade: ambient multiply with warm holes punched at lights */
  const half = mkCanvas(pxW / 2, pxH / 2);
  const hctx = half.getContext('2d');
  hctx.fillStyle = css(P.ambient); hctx.fillRect(0, 0, half.width, half.height);
  hctx.globalCompositeOperation = 'lighter';
  const hk = k / 2;
  const hole = (x, y, r2, a, tintH) => {
    const [px, py] = [x * hk + ox / 2, y * hk + oy / 2];
    const g = hctx.createRadialGradient(px, py, 0, px, py, Math.max(r2 * hk, 1));
    const core = tintH != null ? col(tintH, 60, 78, a) : col(40, 85, 88, a);
    g.addColorStop(0, css(core)); g.addColorStop(1, css(withA(core, 0)));
    hctx.fillStyle = g; hctx.beginPath(); hctx.arc(px, py, Math.max(r2 * hk, 1), 0, TAU); hctx.fill();
  };
  for (const li of S.lights) hole(li.x, li.y, li.r * 1.55, .85 * li.a, li.tint);
  for (const win of shell.windows) {                       // the window is a light too
    const wcx = win.x + win.w / 2, wcy = win.y + win.h * .55;
    if (P.mood === 'day') hole(wcx, wcy, win.h * 1.15, .8, 50);
    else if (P.mood === 'golden') hole(wcx, wcy, win.h * 1.05, .7, 35);
    else if (P.mood === 'night') hole(wcx, wcy, win.h * .8, .30, 222);
    else hole(wcx, wcy, win.h * .8, .35, 300);
  }
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.globalCompositeOperation = 'multiply';
  bctx.drawImage(half, 0, 0, pxW, pxH);

  /* 2 — window light slab */
  bctx.globalCompositeOperation = 'overlay';
  for (const win of shell.windows) {
    if (P.mood === 'dusk' && !S.rare.godRays) continue;
    const sillY = win.y + win.h + (win.style === 'round' ? 0 : 12);
    const dir = win.cx < SW / 2 ? 1 : -1;
    const spread = 30 * dir, mult = S.rare.godRays ? 1.8 : 1;
    const cSlab = P.mood === 'night' ? col(220, 45, 75, .16 * mult) : col(48, 70, 80, .22 * mult);
    const [ax, ay] = toPx(win.x + 4, sillY), [bx2, by2] = toPx(win.x + win.w - 4, sillY);
    const [cx3, cy3] = toPx(win.x + win.w - 4 + spread * 1.6, shell.yF + 26), [dx2, dy2] = toPx(win.x + 4 + spread * .4, shell.yF + 26);
    const g = bctx.createLinearGradient(0, ay, 0, cy3);
    g.addColorStop(0, css(cSlab)); g.addColorStop(1, css(withA(cSlab, 0)));
    bctx.fillStyle = g;
    bctx.beginPath(); bctx.moveTo(ax, ay); bctx.lineTo(bx2, by2); bctx.lineTo(cx3, cy3); bctx.lineTo(dx2, dy2);
    bctx.closePath(); bctx.fill();
    if (S.rare.godRays) {                                   // extra diagonal shafts
      for (const off of [.25, .6]) {
        const sx0 = win.x + win.w * off, sw2 = win.w * .14;
        const [p1x, p1y] = toPx(sx0, win.y + 8), [p2x, p2y] = toPx(sx0 + sw2, win.y + 8);
        const [p3x, p3y] = toPx(sx0 + sw2 + spread * 2.4, shell.yF + 20), [p4x, p4y] = toPx(sx0 + spread * 2.4, shell.yF + 20);
        bctx.fillStyle = css(withA(cSlab, .5));
        bctx.beginPath(); bctx.moveTo(p1x, p1y); bctx.lineTo(p2x, p2y); bctx.lineTo(p3x, p3y); bctx.lineTo(p4x, p4y);
        bctx.closePath(); bctx.fill();
      }
    }
  }

  /* 3 — glow hot cores */
  bctx.globalCompositeOperation = 'lighter';
  const spr = getGlowSprite();
  for (const li of S.lights) {
    const [px, py] = toPx(li.x, li.y);
    const rr2 = li.r * .5 * k;
    bctx.globalAlpha = P.glow * .55 * li.a;
    bctx.drawImage(spr, px - rr2, py - rr2, rr2 * 2, rr2 * 2);
  }
  bctx.globalAlpha = 1;

  /* 4 — paper grain */
  bctx.globalCompositeOperation = 'overlay';
  bctx.globalAlpha = .05;
  bctx.fillStyle = getGrainPattern(bctx, S);
  bctx.fillRect(0, 0, pxW, pxH);
  bctx.globalAlpha = 1;

  /* 5 — vignette */
  bctx.globalCompositeOperation = 'multiply';
  const vg = bctx.createRadialGradient(pxW / 2, pxH * .44, Math.min(pxW, pxH) * .34, pxW / 2, pxH * .5, Math.max(pxW, pxH) * .72);
  vg.addColorStop(0, 'hsla(25,30%,10%,0)'); vg.addColorStop(1, 'hsla(25,30%,10%,.16)');
  bctx.fillStyle = vg; bctx.fillRect(0, 0, pxW, pxH);
  bctx.globalCompositeOperation = 'source-over';
  bctx.restore();
}

let grainPat = null;
function getGrainPattern(ctx, S) {
  if (grainPat) return grainPat;
  const gc = mkCanvas(128, 128), g = gc.getContext('2d');
  const rg = mulberry32(1234567);
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 108 + rg() * 40;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainPat = ctx.createPattern(gc, 'repeat');
  return grainPat;
}

function bakeStill(S, pxW, pxH) {
  const base = mkCanvas(pxW, pxH);
  const bctx = base.getContext('2d');
  const k = Math.min(pxW / SW, pxH / SH), ox = (pxW - SW * k) / 2, oy = (pxH - SH * k) / 2;
  bctx.setTransform(k, 0, 0, k, ox, oy);
  drawScene(bctx, S);
  finishStack(base, bctx, S, k, ox, oy);
  S.k = k; S.ox = ox; S.oy = oy;
  return base;
}

/* ------------------------------ animators ------------------------------ */
function buildAnims(S) {
  const { P, shell } = S;
  const anims = [];
  const cxOf = it => it.cx != null ? it.cx : it.x + it.w / 2;

  for (const it of S.items) {
    if (it.kind === 'mug') anims.push(steamAnim(cxOf(it), it.y - 16, .8));
    if (it.kind === 'teapot') anims.push(steamAnim(cxOf(it) - 4, it.y - 22, 1));
    if (it.kind === 'candle') anims.push(flameAnim(it, 8, 26, false));
    if (it.kind === 'fireplace') anims.push(flameAnim(it, 30, 105, true));
    if (it.kind === 'fishbowl') anims.push(fishAnim(it));
    if (it.kind === 'cat' && it.d.pose !== 'curl') anims.push(catTailAnim(it));
    if (it.kind === 'recordstand' && it.d.spin && (P.mood === 'day' || P.mood === 'golden')) anims.push(recordAnim(it));
  }
  for (const it of S.wallItems)
    if (it.kind === 'stringlights') anims.push(stringAnim(it));

  const wins = shell.windows;
  if (wins.length) {
    if (shell.weather === 'rain') anims.push(rainAnim(wins));
    if (shell.weather === 'snow') anims.push(snowAnim(wins));
    if (P.mood === 'night' || P.mood === 'dusk') anims.push(twinkleAnim(wins));
    if ((P.mood === 'day' || P.mood === 'golden')) anims.push(dustAnim(S, wins));
    if (S.rare.aurora) anims.push(auroraAnim(wins[0]));
    if (S.rare.shootingStar) anims.push(shootAnim(wins[0]));
    if (S.rare.fireflies) anims.push(fireflyAnim(wins[0]));
  }
  if (S.rare.balloon) anims.push(balloonAnim(S));
  return anims;
}

function steamAnim(x, y, s) {
  return (ctx, t) => {
    for (let i = 0; i < 3; i++) {
      const ph = i * 2.1 + x * .13;
      const cyc = ((t * .32 + ph * .37) % 1 + 1) % 1;
      const a = .22 * (1 - cyc) * Math.min(1, cyc * 8) * s;
      if (a <= 0) continue;
      const wx = x + 6 * Math.sin(t * .9 + ph + cyc * 3.2), wy = y - cyc * 26;
      ell(ctx, wx, wy, 2.6 + cyc * 2.4, 2.2 + cyc * 2, col(45, 25, 92, a));
    }
  };
}
function flameAnim(it, w0, glowR, big) {
  return (ctx, t) => {
    const x = it.d.flameX ?? (it.cx != null ? it.cx : it.x + it.w / 2);
    const y = it.d.flameY ?? it.y - it.h - 1;
    const ph = x * .17;
    const fl = 1 + .09 * Math.sin(9 * t + ph) + .05 * Math.sin(23 * t + 1.7 + ph);
    const sway = (big ? 3 : 1.4) * Math.sin(2.6 * t + ph);
    const layers = big
      ? [[w0, 34 * fl, col(16, 88, 52, .92)], [w0 * .62, 24 * fl, col(32, 95, 60)], [w0 * .32, 13 * fl, col(47, 100, 74)]]
      : [[w0 * .55, 9 * fl, col(28, 92, 60, .95)], [w0 * .3, 5.5 * fl, col(47, 100, 78)]];
    for (const [lw, lh, c] of layers) {
      ctx.beginPath();
      ctx.moveTo(x - lw / 2, y);
      ctx.quadraticCurveTo(x - lw / 2, y - lh * .55, x + sway, y - lh);
      ctx.quadraticCurveTo(x + lw / 2, y - lh * .55, x + lw / 2, y);
      ctx.closePath(); ctx.fillStyle = css(c); ctx.fill();
    }
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = .06 + .045 * Math.sin(7 * t + ph);
    const spr = getGlowSprite();
    ctx.drawImage(spr, x - glowR, y - glowR * 1.1, glowR * 2, glowR * 2);
    ctx.restore(); ctx.globalAlpha = 1;
  };
}
function fishAnim(it) {
  return (ctx, t) => {
    const fx2 = it.d.fishX, fy2 = it.d.fishY; if (fx2 == null) return;
    const x = fx2 + 4.6 * Math.sin(.7 * t + fx2), flip = Math.cos(.7 * t + fx2) >= 0 ? 1 : -1;
    ell(ctx, x, fy2, 3.2, 2, it.d.fish);
    poly(ctx, [[x - flip * 3, fy2], [x - flip * 6, fy2 - 2], [x - flip * 6, fy2 + 2]], it.d.fish);
  };
}
function catTailAnim(it) {
  return (ctx, t) => {
    const d = it.d; if (d.tailX == null) return;
    const dark = shade(d.c, 10);
    ctx.strokeStyle = css(dark); ctx.lineWidth = 4.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(d.tailX, d.tailY);
    if (d.tailUp) {
      const sw = 4 * Math.sin(1.1 * t + it.x);
      ctx.quadraticCurveTo(d.tailX + 7, d.tailY - 14, d.tailX + 6 + sw, d.tailY - 26);
    } else {
      const sw = 2.4 * Math.sin(1.3 * t + it.x);
      ctx.quadraticCurveTo(d.tailX - 6, d.tailY + 2, d.tailX - 11, d.tailY + 1 + sw);
    }
    ctx.stroke();
  };
}
function recordAnim(it) {
  return (ctx, t) => {
    const a = t * 3.4 + 1;
    ell(ctx, it.d.labelX + Math.cos(a) * 5, it.d.labelY + Math.sin(a) * 1.8, 1.6, 1, col(40, 70, 70, .9));
  };
}
function stringAnim(it) {
  return (ctx, t) => {
    if (!it.d.pts) return;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    it.d.pts.forEach(([bx, by], i) => {
      const a = .35 + .3 * Math.sin(t * 2 + i * .9);
      ell(ctx, bx, by + 2, 5, 5, col(42, 90, 70, .12 * a));
      ell(ctx, bx, by + 2, 2, 2.4, col(45, 95, 82, .5 * a));
    });
    ctx.restore();
  };
}
function rainAnim(wins) {
  return (ctx, t) => {
    for (const win of wins) {
      ctx.save(); glassClip(ctx, win); ctx.clip();
      ctx.strokeStyle = css(col(210, 45, 82, .45)); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      for (let i = 0; i < 34; i++) {
        const sp = 150 + (i % 5) * 34;
        const x = win.x + ((i * 47.3) % win.w);
        const y = win.y + ((t * sp + i * 61) % (win.h + 20)) - 10;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2.4, y + 10); ctx.stroke();
      }
      for (let i = 0; i < 6; i++) {   // clinging droplets
        const x = win.x + ((i * 127) % win.w), y = win.y + ((i * 83) % win.h);
        const a = .3 + .2 * Math.sin(t * .6 + i * 2);
        ell(ctx, x, y, 1.4, 1.8, col(210, 40, 88, a));
      }
      ctx.restore();
    }
  };
}
function snowAnim(wins) {
  return (ctx, t) => {
    for (const win of wins) {
      ctx.save(); glassClip(ctx, win); ctx.clip();
      for (let i = 0; i < 22; i++) {
        const x = win.x + ((i * 43.7) % win.w) + 8 * Math.sin(.6 * t + i);
        const y = win.y + ((t * (14 + (i % 4) * 6) + i * 37) % (win.h + 10)) - 5;
        ell(ctx, x, y, 1 + (i % 3) * .7, 1 + (i % 3) * .7, col(210, 20, 95, .85));
      }
      ctx.restore();
    }
  };
}
function twinkleAnim(wins) {
  return (ctx, t) => {
    for (const win of wins) {
      if (!win.stars) continue;
      ctx.save(); glassClip(ctx, win); ctx.clip();
      for (const s of win.stars) if (s.tw)
        ell(ctx, s.x, s.y, s.r, s.r, col(50, 60, 88, .35 + .35 * Math.sin(2.2 * t + s.ph)));
      ctx.restore();
    }
  };
}
function dustAnim(S, wins) {
  return (ctx, t) => {
    for (const win of wins) {
      const sillY = win.y + win.h, dir = win.cx < SW / 2 ? 1 : -1;
      const slabH = S.shell.yF + 20 - sillY;
      if (slabH < 20) continue;
      for (let i = 0; i < 10; i++) {
        const px = win.x + 8 + ((i * 53.7) % (win.w - 16)) + 9 * Math.sin(.35 * t + i * 1.7) + dir * ((i * 13) % 26);
        const py = sillY + ((i * 37.1 + t * 6) % slabH);
        const a = .10 + .06 * Math.sin(t * 1.1 + i);
        ell(ctx, px, py, 1.3, 1.3, col(46, 70, 88, a));
      }
    }
  };
}
function auroraAnim(win) {
  return (ctx, t) => {
    ctx.save(); glassClip(ctx, win); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const hue = 140 + 60 * Math.sin(.2 * t + i * 1.8);
      const bx = win.x + win.w * (.2 + .3 * i) + 12 * Math.sin(.3 * t + i);
      const g = ctx.createLinearGradient(0, win.y, 0, win.y + win.h * .6);
      g.addColorStop(0, css(col(hue, 70, 60, .22))); g.addColorStop(1, css(col(hue, 70, 60, 0)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx - 12, win.y);
      ctx.quadraticCurveTo(bx + 18 * Math.sin(.4 * t + i), win.y + win.h * .3, bx - 6, win.y + win.h * .62);
      ctx.lineTo(bx + 16, win.y + win.h * .62);
      ctx.quadraticCurveTo(bx + 30 + 14 * Math.sin(.37 * t + i), win.y + win.h * .3, bx + 14, win.y);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  };
}
function shootAnim(win) {
  return (ctx, t) => {
    const tt = t % 26;
    if (tt > .7) return;
    const p = tt / .7;
    ctx.save(); glassClip(ctx, win); ctx.clip();
    const x = win.x + win.w * (.15 + .55 * p), y = win.y + win.h * (.12 + .2 * p);
    line(ctx, x, y, x - 18, y - 7, col(50, 60, 92, .8 * (1 - p)), 2);
    ctx.restore();
  };
}
function fireflyAnim(win) {
  return (ctx, t) => {
    ctx.save(); glassClip(ctx, win); ctx.clip();
    for (let i = 0; i < 6; i++) {
      const x = win.x + win.w * (.5 + .38 * Math.sin(.31 * t + i * 2.4));
      const y = win.y + win.h * (.68 + .18 * Math.sin(.53 * t + i * 1.3));
      const a = Math.max(0, Math.sin(t * 1.4 + i * 2.2)) * .8;
      ell(ctx, x, y, 1.6, 1.6, col(70, 90, 70, a));
    }
    ctx.restore();
  };
}
function balloonAnim(S) {
  const bx = 120 + (xmur3(S.seed)() % 700);
  return (ctx, t) => {
    const y = 34 + 5 * Math.sin(.5 * t), x = bx + 3 * Math.sin(.3 * t);
    ctx.beginPath(); ctx.moveTo(x, y + 14);
    ctx.quadraticCurveTo(x + 6 + 3 * Math.sin(.4 * t), y + 44, x - 2, y + 74);
    ctx.strokeStyle = css(col(0, 0, 88, .6)); ctx.lineWidth = 1.2; ctx.stroke();
    ell(ctx, x, y, 11, 13, S.P.accent);
    ell(ctx, x - 3.4, y - 4, 3, 4.4, withA(lite(S.P.accent, 16), .9));
    poly(ctx, [[x - 3, y + 13], [x + 3, y + 13], [x, y + 17]], S.P.accent);
  };
}

/* ------------------------------ app / ui ------------------------------ */
(function main() {
  const canvas = document.getElementById('room');
  const card = document.getElementById('card');
  const seedInput = document.getElementById('seed');
  const rerollBtn = document.getElementById('reroll');
  const copyBtn = document.getElementById('copy');
  const hintEl = document.getElementById('hint');
  const wrap = document.getElementById('seedwrap');
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* gallery contact-sheet dev mode */
  const gm = location.hash.match(/^#gallery-(\d+)(-hue)?$/);
  if (gm) {
    const N = clamp(parseInt(gm[1], 10) || 24, 4, 200);
    document.body.classList.add('gallery');
    const sheet = document.getElementById('sheet');
    sheet.hidden = false;
    const rooms = [];
    for (let i = 0; i < N; i++) rooms.push(['snug-g' + i, generate('snug-g' + i)]);
    if (gm[2]) rooms.sort((a, b) => a[1].P.H - b[1].P.H);
    for (const [sd, S] of rooms) {
      const cell = document.createElement('div');
      const cv = bakeStill(S, 384, 240);
      cell.appendChild(cv);
      const lbl = document.createElement('div');
      lbl.className = 'lbl'; lbl.textContent = `${sd} · ${S.P.mood} · ${S.P.famName} · ${S.arch} · ${S.weather}`;
      cell.appendChild(lbl);
      sheet.appendChild(cell);
    }
    return;
  }

  let S = null, still = null, prevStill = null, fadeT0 = -1;
  let anims = [];
  let lastInteract = performance.now();
  let frameCount = 0;
  let rebakeTimer = 0;
  let suppressHash = false;
  let pushCount = 0;                 // rooms pushed this session — guards ← from exiting

  const dpr = () => Math.min(devicePixelRatio || 1, 2);
  function sizeCanvas() {
    const w = Math.max(2, Math.round(card.clientWidth * dpr()));
    const h = Math.max(2, Math.round(card.clientHeight * dpr()));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
    return false;
  }
  function rebake() { if (S) { still = bakeStill(S, canvas.width, canvas.height); } }

  function applySeed(seed, { push = true } = {}) {
    seed = (seed || '').trim() || mintSeed();
    S = generate(seed);
    prevStill = still; fadeT0 = performance.now();
    sizeCanvas(); rebake();
    anims = buildAnims(S);
    seedInput.value = seed;
    canvas.setAttribute('aria-label', S.manifest);
    document.title = 'snug · ' + seed;
    if (push) {
      suppressHash = true;
      history.pushState(null, '', '#' + encodeURIComponent(seed));
      pushCount++;
      setTimeout(() => suppressHash = false, 0);
    }
    if (S.jackpot || S.rare.golden) { wrap.classList.remove('glint'); void wrap.offsetWidth; wrap.classList.add('glint'); }
    if (reduced) drawFrame(performance.now());
  }
  function currentSeed() { return seedInput.value; }
  function reroll() {
    hintEl.classList.add('gone');
    lastInteract = performance.now();
    applySeed(mintSeed());
  }

  function drawFrame(now) {
    const t = now / 1000;
    if (!still) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(still, 0, 0, canvas.width, canvas.height);
    if (prevStill && fadeT0 >= 0) {
      const f = (now - fadeT0) / 150;
      if (f < 1) { ctx.globalAlpha = 1 - f; ctx.drawImage(prevStill, 0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1; }
      else { prevStill = null; fadeT0 = -1; }
    }
    ctx.setTransform(S.k, 0, 0, S.k, S.ox, S.oy);
    const tt = reduced ? 1.2 : t;
    for (const a of anims) a(ctx, tt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden || reduced) return;
    frameCount++;
    if (now - lastInteract > 60000 && frameCount % 2) return;   // idle 30fps
    drawFrame(now);
  }

  /* events */
  rerollBtn.addEventListener('click', e => { e.stopPropagation(); reroll(); });
  card.addEventListener('click', reroll);
  copyBtn.addEventListener('click', e => {
    e.stopPropagation();
    const url = location.origin === 'null' || location.protocol === 'file:'
      ? location.href : location.href;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
      .then(() => { copyBtn.classList.add('done'); copyBtn.textContent = '✓'; })
      .catch(() => { seedInput.select(); document.execCommand && document.execCommand('copy'); })
      .finally?.(() => setTimeout(() => { copyBtn.classList.remove('done'); copyBtn.textContent = '⧉'; }, 1200));
  });
  seedInput.addEventListener('focus', () => { seedInput.dataset.prev = seedInput.value; seedInput.select(); });
  seedInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { applySeed(seedInput.value); seedInput.blur(); }
    if (e.key === 'Escape') { seedInput.value = seedInput.dataset.prev || currentSeed(); seedInput.blur(); }
  });
  seedInput.addEventListener('click', e => e.stopPropagation());
  wrap.addEventListener('click', e => e.stopPropagation());

  function savePNG() {
    const out = mkCanvas(canvas.width, canvas.height);
    const octx = out.getContext('2d');
    octx.drawImage(still, 0, 0);
    octx.setTransform(S.k, 0, 0, S.k, S.ox, S.oy);
    for (const a of anims) a(octx, reduced ? 1.2 : performance.now() / 1000);
    out.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'snug-' + currentSeed() + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  }

  const sessionSeeds = [];
  window.addEventListener('keydown', e => {
    if (e.target === seedInput) return;
    lastInteract = performance.now();
    if (e.code === 'Space' || e.key === 'r' || e.key === 'R') { e.preventDefault(); reroll(); }
    else if (e.key === 'c' || e.key === 'C') copyBtn.click();
    else if (e.key === 's' || e.key === 'S') savePNG();
    else if (e.key === 'ArrowLeft') { if (pushCount > 0) { pushCount--; history.back(); } }
    else if (e.key === 'ArrowRight') history.forward();
  });
  const onNav = () => {
    if (suppressHash) return;
    const seed = hashSeed();
    if (seed && seed !== currentSeed()) applySeed(seed, { push: false });
  };
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);
  document.addEventListener('visibilitychange', () => { lastInteract = performance.now(); });
  ['pointerdown', 'pointermove'].forEach(ev =>
    window.addEventListener(ev, () => lastInteract = performance.now(), { passive: true }));

  function hashSeed() {
    try { return decodeURIComponent(location.hash.slice(1)); }
    catch { return location.hash.slice(1); }
  }

  let ro = new ResizeObserver(() => {
    if (sizeCanvas()) {
      clearTimeout(rebakeTimer);
      rebakeTimer = setTimeout(() => { rebake(); if (reduced) drawFrame(performance.now()); }, 150);
    }
  });
  ro.observe(card);

  /* boot */
  const initial = hashSeed();
  applySeed(initial || mintSeed(), { push: false });
  if (!location.hash) { suppressHash = true; history.replaceState(null, '', '#' + encodeURIComponent(currentSeed())); setTimeout(() => suppressHash = false, 0); }
  requestAnimationFrame(loop);
})();
