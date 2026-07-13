/*
 * INSCAPE_BOTTLE — 自己完結型のガラスボトル・レンダラー
 * index.html の drawGlassBottle / renderLiquidBuffer と同一アルゴリズムを移植し、
 * gallery.html でも「みずみずしく透明感のあるリアルなボトル」を flower の色から再現する。
 * 画像 bottle.png は embedded-assets.js のデータURI（同一オリジン扱い）を用いるため
 * getImageData（内部マスク生成）が使え、汚染も起きない。
 */
(function (global) {
  'use strict';

  // ── 定数（index.html と一致） ──
  const BOTTLE_CROP_FRACTIONS = { sx: 0.376, sy: 0.12, sw: 0.247, sh: 0.805 };
  const BOTTLE_BODY_TOP_FRAC = 0.34;
  const BOTTLE_BODY_BOTTOM_FRAC = 0.955;
  const BOTTLE_AIR_GAP_FRAC = 0.18;
  const CHARGE_OPACITY_MIN = 0.4;
  const CHARGE_OPACITY_MAX = 1.0;

  // ── 色ユーティリティ ──
  function extractHexColor(text) {
    if (!text) return null;
    const m = String(text).match(/#?[0-9a-fA-F]{6}/);
    if (!m) return null;
    let s = m[0];
    if (s[0] !== '#') s = '#' + s;
    return s.toLowerCase();
  }
  function hexToRgb(hex) {
    const n0 = extractHexColor(hex);
    if (!n0) return { r: 184, g: 58, b: 90 };
    const n = parseInt(n0.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    const h = (c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }
  function rgbaFromHex(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function lightenHex(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    const mix = (c) => Math.round(c + (255 - c) * amt);
    return rgbToHex(mix(r), mix(g), mix(b));
  }
  function saturateHex(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const push = (c) => Math.round(Math.max(0, Math.min(255, lum + (c - lum) * (1 + amt))));
    return rgbToHex(push(r), push(g), push(b));
  }
  function deepenHex(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    const rr = r / 255, gg = g / 255, bb = b / 255;
    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
    let hh = 0, ss = 0; let ll = (max + min) / 2;
    if (max !== min) {
      const dd = max - min;
      ss = ll > 0.5 ? dd / (2 - max - min) : dd / (max + min);
      if (max === rr) hh = (gg - bb) / dd + (gg < bb ? 6 : 0);
      else if (max === gg) hh = (bb - rr) / dd + 2;
      else hh = (rr - gg) / dd + 4;
      hh /= 6;
    }
    ll = Math.max(0.06, ll * (1 - amt));
    ss = Math.max(0, Math.min(1, ss * (1 - amt * 0.25)));
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let R, G, B;
    if (ss === 0) { R = G = B = ll; }
    else {
      const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
      const p = 2 * ll - q;
      R = hue2rgb(p, q, hh + 1 / 3); G = hue2rgb(p, q, hh); B = hue2rgb(p, q, hh - 1 / 3);
    }
    return rgbToHex(R * 255, G * 255, B * 255);
  }
  function mulberry32(a) {
    return function rng() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── 濃淡（長押し=感情の重さ）→ インク色 ──
  function bottleDensity(drop) {
    const o = (drop && drop.opacity != null) ? drop.opacity : CHARGE_OPACITY_MIN;
    return Math.min(1, Math.max(0, (o - CHARGE_OPACITY_MIN) / Math.max(0.0001, CHARGE_OPACITY_MAX - CHARGE_OPACITY_MIN)));
  }
  function bottleLayerAlpha() { return 0.97; }
  function bottleInkColor(hex, d) {
    const base = extractHexColor(hex) || '#b83a5a';
    const t = Math.min(1, Math.max(0, d));
    const vivid = saturateHex(base, 0.18 + t * 0.22);
    const whiten = Math.pow(1 - t, 0.82) * 0.68;
    return lightenHex(vivid, whiten);
  }

  // ── オフスクリーンバッファ ──
  const _liquidBuf = document.createElement('canvas');
  const _compBuf = document.createElement('canvas');
  const _bandBuf = document.createElement('canvas');
  function sizeBuf(cv, w, h) {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    return cv;
  }

  // ── ボトル画像とマスク ──
  const bottleImg = new Image();
  let bottleReady = false;
  let bottleCrop = null;
  let bottleMaskCanvas = null;
  let loadPromise = null;

  function buildBottleMask() {
    try {
      const iw = bottleImg.naturalWidth, ih = bottleImg.naturalHeight;
      if (!iw || !ih) return;
      const src = document.createElement('canvas');
      src.width = iw; src.height = ih;
      const sctx = src.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(bottleImg, 0, 0);
      const data = sctx.getImageData(0, 0, iw, ih);
      const px = data.data;
      const corner = [0, (iw - 1) * 4, (ih - 1) * iw * 4, (ih * iw - 1) * 4];
      let bgA = 0, bgR = 0, bgG = 0, bgB = 0;
      corner.forEach((o) => { bgA += px[o + 3]; bgR += px[o]; bgG += px[o + 1]; bgB += px[o + 2]; });
      bgA /= 4; bgR /= 4; bgG /= 4; bgB /= 4;
      const transparentBg = bgA < 40;
      const isBg = (o) => {
        const a = px[o + 3];
        if (transparentBg) return a < 40;
        const dr = px[o] - bgR, dg = px[o + 1] - bgG, db = px[o + 2] - bgB;
        return a > 40 && (dr * dr + dg * dg + db * db) < 900;
      };
      const visited = new Uint8Array(iw * ih);
      const stack = [];
      const pushIf = (x, y) => {
        if (x < 0 || y < 0 || x >= iw || y >= ih) return;
        const idx = y * iw + x;
        if (visited[idx]) return;
        visited[idx] = 1;
        if (isBg(idx * 4)) stack.push(idx);
      };
      for (let x = 0; x < iw; x++) { pushIf(x, 0); pushIf(x, ih - 1); }
      for (let y = 0; y < ih; y++) { pushIf(0, y); pushIf(iw - 1, y); }
      while (stack.length) {
        const idx = stack.pop();
        const x = idx % iw, y = (idx / iw) | 0;
        pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
      }
      const full = document.createElement('canvas');
      full.width = iw; full.height = ih;
      const fctx = full.getContext('2d');
      const out = fctx.createImageData(iw, ih);
      let minX = iw, minY = ih, maxX = 0, maxY = 0, any = false;
      for (let i = 0; i < iw * ih; i++) {
        const outside = visited[i] && isBg(i * 4);
        out.data[i * 4 + 3] = outside ? 0 : 255;
        if (!outside) {
          const x = i % iw, y = (i / iw) | 0;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          any = true;
        }
      }
      fctx.putImageData(out, 0, 0);
      if (!any) { bottleMaskCanvas = full; bottleCrop = { sx: 0, sy: 0, sw: iw, sh: ih }; return; }
      const pad = Math.round(Math.min(iw, ih) * 0.01);
      const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
      const sw = Math.min(iw - sx, maxX - minX + 1 + pad * 2);
      const sh = Math.min(ih - sy, maxY - minY + 1 + pad * 2);
      const mask = document.createElement('canvas');
      mask.width = sw; mask.height = sh;
      mask.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
      bottleMaskCanvas = mask;
      bottleCrop = { sx, sy, sw, sh };
    } catch (e) {
      bottleMaskCanvas = null;
    }
  }

  function assetSrc() {
    const e = (typeof global !== 'undefined') && global.EMBEDDED_ASSETS;
    return (e && e['bottle.png']) ? e['bottle.png'] : 'bottle.png';
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve) => {
      const finish = (ok) => {
        if (ok) {
          bottleReady = true;
          const iw = bottleImg.naturalWidth, ih = bottleImg.naturalHeight;
          bottleCrop = {
            sx: Math.round(iw * BOTTLE_CROP_FRACTIONS.sx),
            sy: Math.round(ih * BOTTLE_CROP_FRACTIONS.sy),
            sw: Math.round(iw * BOTTLE_CROP_FRACTIONS.sw),
            sh: Math.round(ih * BOTTLE_CROP_FRACTIONS.sh)
          };
          buildBottleMask();
          resolve(true);
        } else {
          resolve(false);
        }
      };
      bottleImg.onload = () => finish(bottleImg.naturalWidth > 0);
      bottleImg.onerror = () => finish(false);
      bottleImg.src = assetSrc();
      if (bottleImg.complete && bottleImg.naturalWidth > 0) finish(true);
    });
    return loadPromise;
  }

  function getBottleRect(w, h) {
    const crop = bottleCrop || {
      sx: 0, sy: 0,
      sw: bottleImg.naturalWidth || 9,
      sh: bottleImg.naturalHeight || 16
    };
    const scale = Math.min(w / crop.sw, h / crop.sh);
    const rw = crop.sw * scale, rh = crop.sh * scale;
    return { x: (w - rw) * 0.5, y: (h - rh) * 0.5, w: rw, h: rh, crop };
  }

  // 液体（静止版: waveAmt=0, tilt=0, reveal=1）
  function renderLiquidBuffer(rw, rh, drops, seed) {
    const cv = sizeBuf(_liquidBuf, rw, rh);
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none';
    c.clearRect(0, 0, cv.width, cv.height);
    const N = drops.length;
    const bw = cv.width, bh = cv.height;
    const bodyBottomY = bh * BOTTLE_BODY_BOTTOM_FRAC;
    const bodyTopY = bh * BOTTLE_BODY_TOP_FRAC;
    const bodyH = bodyBottomY - bodyTopY;
    const usableH = bodyH * (1 - BOTTLE_AIR_GAP_FRAC);
    const filledH = usableH;
    const fillTopY = bodyBottomY - filledH;
    const M = Math.max(1, N);
    const unit = filledH / M;

    let heights = [];
    if (N <= 1) heights = [filledH];
    else {
      const each = filledH / N;
      for (let i = 0; i < N; i++) heights.push(each);
    }
    const baseYs = [];
    { let acc = 0; for (let s = 0; s < M; s++) { acc += heights[s]; baseYs.push(bodyBottomY - acc); } }

    const bandCv = sizeBuf(_bandBuf, bw, bh);
    const bc = bandCv.getContext('2d');
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.globalAlpha = 1; bc.globalCompositeOperation = 'source-over'; bc.filter = 'none';
    bc.clearRect(0, 0, bw, bh);

    const rng = mulberry32((seed >>> 0) + 101);
    const bnd = [];
    for (let s = 0; s < M; s++) {
      bnd.push({
        baseY: baseYs[s],
        amp: Math.min(unit * 0.2, 8) * (0.4 + rng() * 0.5),
        freq: 0.6 + rng() * 1.2,
        phase: rng() * Math.PI * 2,
        amp2: Math.min(unit * 0.1, 4) * (0.3 + rng() * 0.6),
        freq2: 1.6 + rng() * 2.0,
        phase2: rng() * Math.PI * 2,
        tiltPx: (rng() * 2 - 1) * Math.min(unit * 0.28, 10),
        sag: Math.min(unit * 0.5, 18) * (0.5 + rng() * 0.5)
      });
    }
    // 静止: 液面は完全にフラット（wv=0）。内部境界のみオーガニック。
    const wv = 0;
    const bY = (s, x) => {
      if (s < 0) return bodyBottomY + unit * 0.6;
      const d = bnd[s];
      const u = Math.max(0, Math.min(1, x / bw));
      const isSurface = (s === M - 1);
      const wgt = isSurface ? wv : 1;
      let y = d.baseY + (d.tiltPx * (u - 0.5)
        + d.sag * Math.sin(u * Math.PI)
        + d.amp * Math.sin(u * d.freq * Math.PI * 2 + d.phase)
        + d.amp2 * Math.sin(u * d.freq2 * Math.PI * 2 + d.phase2)) * wgt;
      return y;
    };
    const step = Math.max(5, bw / 30);
    const xL = -bw * 0.4, xR = bw * 1.4;

    // 水ベース
    {
      const topS = M - 1;
      bc.beginPath();
      bc.moveTo(xL, bY(topS, xL));
      for (let x = xL; x <= xR; x += step) bc.lineTo(x, bY(topS, x));
      bc.lineTo(xR, bodyBottomY + unit * 0.6);
      for (let x = xR; x >= xL; x -= step) bc.lineTo(x, bodyBottomY + unit * 0.6);
      bc.closePath();
      const wg = bc.createLinearGradient(0, fillTopY, 0, bodyBottomY);
      wg.addColorStop(0.0, 'rgba(228,234,242,0.22)');
      wg.addColorStop(0.5, 'rgba(212,222,234,0.13)');
      wg.addColorStop(1.0, 'rgba(202,214,228,0.17)');
      bc.fillStyle = wg;
      bc.fill();
    }

    for (let i = 0; i < N; i++) {
      const topS = i;
      const botS = i - 1;
      bc.beginPath();
      bc.moveTo(xL, bY(topS, xL));
      for (let x = xL; x <= xR; x += step) bc.lineTo(x, bY(topS, x));
      bc.lineTo(xR, bY(topS, xR));
      bc.lineTo(xR, bY(botS, xR));
      for (let x = xR; x >= xL; x -= step) bc.lineTo(x, bY(botS, x));
      bc.closePath();

      const drop = drops[i];
      const dens = bottleDensity(drop);
      const color = bottleInkColor(drop.color, dens);
      const a = bottleLayerAlpha();
      bc.fillStyle = rgbaFromHex(color, a);
      bc.fill();

      bc.save();
      bc.clip();
      const yTop = bnd[i].baseY;
      const yBot = (i === 0) ? bodyBottomY : bnd[i - 1].baseY;
      const yMid = (yTop + yBot) * 0.5;
      const bandThick = Math.max(8, Math.abs(yBot - yTop));
      for (let k = 0; k < 2; k++) {
        const mx = bw * (0.18 + rng() * 0.64);
        const my = yMid + (rng() * 2 - 1) * bandThick * 0.5;
        const mr = bw * (0.2 + rng() * 0.26);
        const light = rng() > 0.5;
        const rg = bc.createRadialGradient(mx, my, 0, mx, my, mr);
        if (light) {
          rg.addColorStop(0, rgbaFromHex(lightenHex(color, 0.2), a * 0.16));
          rg.addColorStop(1, rgbaFromHex(lightenHex(color, 0.2), 0));
        } else {
          rg.addColorStop(0, rgbaFromHex(deepenHex(color, 0.16), a * 0.14));
          rg.addColorStop(1, rgbaFromHex(deepenHex(color, 0.16), 0));
        }
        bc.fillStyle = rg;
        bc.fillRect(0, yTop - bandThick, bw, bandThick * 3);
      }
      bc.restore();
    }

    c.save();
    const feather = Math.max(9, Math.min(20, unit * 0.28));
    c.save();
    c.filter = `blur(${feather}px)`;
    c.drawImage(bandCv, 0, 0);
    c.restore();

    // 最上部液面をシャープに断つ
    {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.beginPath();
      c.moveTo(xL, -bh);
      c.lineTo(xR, -bh);
      c.lineTo(xR, bY(M - 1, xR));
      for (let x = xR; x >= xL; x -= step) c.lineTo(x, bY(M - 1, x));
      c.closePath();
      c.fillStyle = 'rgba(0,0,0,1)';
      c.fill();
      c.restore();
    }

    // 中央の光の透過／フチの密度
    c.globalCompositeOperation = 'source-atop';
    const edgeG = c.createLinearGradient(0, 0, bw, 0);
    edgeG.addColorStop(0.00, 'rgba(14,8,24,0.42)');
    edgeG.addColorStop(0.15, 'rgba(14,8,24,0.00)');
    edgeG.addColorStop(0.85, 'rgba(14,8,24,0.00)');
    edgeG.addColorStop(1.00, 'rgba(14,8,24,0.42)');
    c.fillStyle = edgeG;
    c.fillRect(-bw * 0.5, fillTopY - 12, bw * 2, filledH + 24);

    {
      const curtains = 3 + Math.floor(rng() * 2);
      for (let k = 0; k < curtains; k++) {
        const halfW = bw * (0.03 + rng() * 0.08);
        const cx = bw * (0.16 + rng() * 0.68);
        const peak = 0.08 + rng() * 0.13;
        const cg = c.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
        cg.addColorStop(0.0, 'rgba(255,255,255,0)');
        cg.addColorStop(0.5, `rgba(250,252,255,${peak.toFixed(3)})`);
        cg.addColorStop(1.0, 'rgba(255,255,255,0)');
        c.fillStyle = cg;
        c.fillRect(cx - halfW, fillTopY - 12, halfW * 2, filledH + 24);
      }
    }

    c.globalCompositeOperation = 'screen';
    const colGl = c.createLinearGradient(bw * 0.4, 0, bw * 0.56, 0);
    colGl.addColorStop(0.0, 'rgba(255,255,255,0)');
    colGl.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    colGl.addColorStop(1.0, 'rgba(255,255,255,0)');
    c.fillStyle = colGl;
    c.fillRect(-bw * 0.5, fillTopY - 12, bw * 2, filledH + 24);
    c.globalCompositeOperation = 'source-over';
    c.restore();

    return cv;
  }

  // ボトル本体（ガラス＋液体）を論理サイズ w×h に描く
  function drawGlassBottle(c, w, h, drops, seed) {
    c.save();
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none';
    c.clearRect(0, 0, w, h);
    c.restore();

    if (!bottleReady || !bottleImg.naturalWidth) {
      const rx = w * 0.28, ry = h * 0.2, rw = w * 0.44, rh = h * 0.62;
      const liquid = renderLiquidBuffer(rw, rh, drops, seed);
      c.drawImage(liquid, rx, ry, rw, rh);
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.strokeRect(rx, ry, rw, rh);
      return;
    }

    const rect = getBottleRect(w, h);
    const cr = rect.crop;

    // 影
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.14)';
    c.beginPath();
    c.ellipse(w * 0.5, rect.y + rect.h * 0.97, rect.w * 0.3, rect.h * 0.02, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // (A) ガラス実体
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1; c.filter = 'none';
    c.drawImage(bottleImg, cr.sx, cr.sy, cr.sw, cr.sh, rect.x, rect.y, rect.w, rect.h);
    c.restore();

    // (A2) 内部を暗く沈める
    {
      const dk = sizeBuf(_compBuf, rect.w, rect.h);
      const dc = dk.getContext('2d');
      dc.setTransform(1, 0, 0, 1, 0, 0);
      dc.globalAlpha = 1; dc.globalCompositeOperation = 'source-over'; dc.filter = 'none';
      dc.clearRect(0, 0, dk.width, dk.height);
      dc.fillStyle = 'rgba(8,6,12,1)';
      dc.fillRect(0, 0, dk.width, dk.height);
      dc.globalCompositeOperation = 'destination-in';
      if (bottleMaskCanvas) dc.drawImage(bottleMaskCanvas, 0, 0, dk.width, dk.height);
      else dc.drawImage(bottleImg, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, dk.width, dk.height);
      c.save();
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 0.72;
      c.drawImage(dk, rect.x, rect.y, rect.w, rect.h);
      c.restore();
    }

    // (B) 液体（内側にクリップ）
    {
      const liquid = renderLiquidBuffer(rect.w, rect.h, drops, seed);
      const comp = sizeBuf(_compBuf, rect.w, rect.h);
      const cc = comp.getContext('2d');
      cc.setTransform(1, 0, 0, 1, 0, 0);
      cc.globalAlpha = 1; cc.globalCompositeOperation = 'source-over'; cc.filter = 'none';
      cc.clearRect(0, 0, comp.width, comp.height);
      cc.drawImage(liquid, 0, 0, comp.width, comp.height);
      cc.globalCompositeOperation = 'destination-in';
      const insX = comp.width * 0.05;
      const insBottom = comp.height * 0.045;
      const mdx = insX, mdy = 0;
      const mdw = comp.width - insX * 2;
      const mdh = comp.height - insBottom;
      if (bottleMaskCanvas) cc.drawImage(bottleMaskCanvas, 0, 0, bottleMaskCanvas.width, bottleMaskCanvas.height, mdx, mdy, mdw, mdh);
      else cc.drawImage(bottleImg, cr.sx, cr.sy, cr.sw, cr.sh, mdx, mdy, mdw, mdh);
      cc.globalCompositeOperation = 'source-over';
      c.save();
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 0.94;
      c.drawImage(comp, rect.x, rect.y, rect.w, rect.h);
      c.restore();
    }

    // (C) ハイライト・屈折を screen で
    c.save();
    c.globalCompositeOperation = 'screen';
    c.globalAlpha = 0.34; c.filter = 'none';
    c.drawImage(bottleImg, cr.sx, cr.sy, cr.sw, cr.sh, rect.x, rect.y, rect.w, rect.h);
    c.restore();

    // (C2) overlay でガラスの明暗をインクへ焼き込み
    c.save();
    c.globalCompositeOperation = 'overlay';
    c.globalAlpha = 0.4; c.filter = 'none';
    c.drawImage(bottleImg, cr.sx, cr.sy, cr.sw, cr.sh, rect.x, rect.y, rect.w, rect.h);
    c.restore();
  }

  // 公開API: canvas に flower の drops からボトルを描画（内部解像度は dpr 対応）
  //  drops: [{ color, opacity }]（時系列。最新が末尾＝一番上に積まれる）
  function renderInto(canvas, drops, seed, logicalW, logicalH) {
    if (!canvas) return false;
    const dpr = Math.max(2, global.devicePixelRatio || 1);
    const W = logicalW || 180, H = logicalH || 320;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGlassBottle(c, W, H, Array.isArray(drops) ? drops : [], (seed >>> 0) || 7);
    return true;
  }

  global.INSCAPE_BOTTLE = {
    load,
    ready: () => bottleReady,
    renderInto,
    LOGICAL_W: 180,
    LOGICAL_H: 320
  };
})(window);
