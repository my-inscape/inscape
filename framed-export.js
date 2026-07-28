/* INSCAPE framed export v8
 * Capture the LIVE HTML/CSS gold frame via html2canvas.
 * Canvas hand-drawn frame painting is abolished. */
(function (global) {
  'use strict';

  var EXPORT_W = 1080;
  var EXPORT_H = 1920;

  function toPngBlob(cv) {
    return new Promise(function (resolve, reject) {
      if (!cv || !cv.width) {
        reject(new Error('empty canvas'));
        return;
      }
      if (cv.toBlob) {
        cv.toBlob(function (b) {
          if (b) resolve(b);
          else reject(new Error('toBlob failed'));
        }, 'image/png');
      } else {
        try {
          var data = cv.toDataURL('image/png');
          var bin = atob(data.split(',')[1]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: 'image/png' }));
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  function toPngFile(blob, filename) {
    var name = filename || 'INSCAPE_Artwork.png';
    try {
      return new File([blob], name, { type: 'image/png' });
    } catch (e) {
      blob.name = name;
      return blob;
    }
  }

  function drawLogo(ctx, cx, cy) {
    var text = 'INSCAPE';
    var tracking = 14;
    ctx.save();
    ctx.font = '300 32px Times New Roman, Georgia, serif';
    ctx.fillStyle = 'rgba(190,190,190,0.65)';
    ctx.textBaseline = 'middle';
    var chars = text.split('');
    var widths = chars.map(function (ch) { return ctx.measureText(ch).width; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + tracking * (chars.length - 1);
    var x = cx - total / 2;
    for (var i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], x, cy);
      x += widths[i] + tracking;
    }
    ctx.restore();
  }

  function prepareCloneForCapture(clonedEl) {
    if (!clonedEl) return;
    clonedEl.querySelectorAll(
      '.art-date, .save-art-btn, .detail-save-btn, .modal-art-actions, ' +
      '.museum-brand-logo, .memory-popover, [data-export-hide], .privacy-export-hidden, ' +
      '.artwork-caption-block, .art-period-caption, .gallery-bottle-wrap'
    ).forEach(function (node) { node.remove(); });

    /* .gallery-art-image starts at opacity:0 + CSS fade — html2canvas would snap a white mat. */
    clonedEl.querySelectorAll('.gallery-art-image, .gallery-art-canvas, img, canvas').forEach(function (el) {
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      el.style.setProperty('animation', 'none', 'important');
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('filter', 'none', 'important');
    });
    clonedEl.querySelectorAll('.art-surface').forEach(function (el) {
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('background-color', '#f7f4eb', 'important');
    });
    /* Freeze frame chrome so capture matches final framed look */
    if (clonedEl.classList && clonedEl.classList.contains('museum-frame-sculpted')) {
      clonedEl.style.setProperty('transition', 'none', 'important');
    }
    clonedEl.querySelectorAll('.museum-frame-sculpted').forEach(function (el) {
      el.style.setProperty('transition', 'none', 'important');
    });
  }

  function waitForMedia(rootEl) {
    if (!rootEl) return Promise.resolve();
    var imgs = rootEl.querySelectorAll('img');
    return Promise.all(Array.prototype.map.call(imgs, function (img) {
      if (img.complete && (img.naturalWidth || 0) > 0) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 1500);
      });
    }));
  }

  function resolveCaptureScale(requested) {
    if (typeof requested === 'number' && requested > 0) return requested;
    var dpr = global.devicePixelRatio || 1;
    return Math.min(3, Math.max(2, dpr * 2));
  }

  /**
   * Place a CSS-captured frame bitmap onto the dark museum poster board + logo.
   * Does NOT re-draw the gold frame — only composes atmosphere around the snapshot.
   */
  function mountOnMuseumBoard(shotCanvas) {
    var out = document.createElement('canvas');
    out.width = EXPORT_W;
    out.height = EXPORT_H;
    var ctx = out.getContext('2d');

    var wall = ctx.createRadialGradient(
      EXPORT_W * 0.5, EXPORT_H * 0.28, 40,
      EXPORT_W * 0.5, EXPORT_H * 0.48, EXPORT_H * 0.72
    );
    wall.addColorStop(0, '#24201c');
    wall.addColorStop(0.55, '#0e0e0e');
    wall.addColorStop(1, '#050505');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

    var logoReserve = 140;
    var topMargin = 160;
    var sidePad = 72;
    var maxW = EXPORT_W - sidePad * 2;
    var maxH = EXPORT_H - topMargin - logoReserve - 80;
    var s = Math.min(maxW / shotCanvas.width, maxH / shotCanvas.height);
    var dw = shotCanvas.width * s;
    var dh = shotCanvas.height * s;
    var dx = (EXPORT_W - dw) / 2;
    var dy = topMargin + (maxH - dh) / 2;

    ctx.drawImage(shotCanvas, dx, dy, dw, dh);
    drawLogo(ctx, EXPORT_W / 2, EXPORT_H - 90);

    out.__inscapeFramed = true;
    out.__inscapeCapture = 'html2canvas';
    return out;
  }

  function requireHtml2Canvas() {
    if (typeof global.html2canvas !== 'function') {
      throw new Error('html2canvas not loaded');
    }
  }

  /**
   * Snapshot a live framed DOM node (e.g. .museum-frame-sculpted) at high DPI.
   */
  async function captureDomFrame(element, options) {
    requireHtml2Canvas();
    if (!element) throw new Error('capture target missing');
    var opts = options || {};
    await waitForMedia(element);

    var scale = resolveCaptureScale(opts.scale);
    var bg = opts.backgroundColor === undefined ? null : opts.backgroundColor;

    var shot = await global.html2canvas(element, {
      scale: scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: bg,
      logging: false,
      imageTimeout: 15000,
      foreignObjectRendering: false,
      onclone: function (doc, clonedEl) {
        prepareCloneForCapture(clonedEl);
        if (typeof opts.onclone === 'function') opts.onclone(doc, clonedEl);
      }
    });

    if (!shot || shot.width < 2 || shot.height < 2) {
      throw new Error('html2canvas produced empty image');
    }
    return shot;
  }

  async function captureDomFrameToFile(element, filename, options) {
    if (!element || !element.parentNode) {
      var shotBare = await captureDomFrame(element, options);
      var boardBare = mountOnMuseumBoard(shotBare);
      var blobBare = await toPngBlob(boardBare);
      var fileBare = toPngFile(blobBare, filename || 'INSCAPE_Artwork.png');
      return { canvas: boardBare, shot: shotBare, file: fileBare, previewUrl: boardBare.toDataURL('image/png'), blob: blobBare };
    }

    /* Soft drop shadows sit outside the border box — pad so html2canvas keeps them. */
    var parent = element.parentNode;
    var wrap = document.createElement('div');
    wrap.setAttribute('data-inscape-capture-pad', '1');
    wrap.style.cssText = 'display:inline-block;padding:72px;margin:0;background:transparent;line-height:0;box-sizing:content-box;';
    parent.insertBefore(wrap, element);
    wrap.appendChild(element);

    try {
      var shot = await captureDomFrame(wrap, options);
      var board = mountOnMuseumBoard(shot);
      var blob = await toPngBlob(board);
      var file = toPngFile(blob, filename || 'INSCAPE_Artwork.png');
      return { canvas: board, shot: shot, file: file, previewUrl: board.toDataURL('image/png'), blob: blob };
    } finally {
      try {
        parent.insertBefore(element, wrap);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      } catch (e) {
        console.warn('[INSCAPE] capture pad restore failed', e);
      }
    }
  }

  /** CSS gold frame twin for offscreen capture when live framed DOM is unavailable. */
  function applySculptedFrameStyles(el) {
    el.style.cssText = [
      'position:relative',
      'box-sizing:border-box',
      'display:inline-block',
      'width:fit-content',
      'height:auto',
      'margin:0',
      'padding:28px 22px 32px',
      'background:#fbf9f5',
      'border:20px solid #1c110a',
      'border-top-color:#f3e5ab',
      'border-left-color:#d4af37',
      'border-right-color:#8a640f',
      'border-bottom-color:#5c430a',
      'outline:3px solid #aa7c11',
      'outline-offset:-20px',
      'box-shadow:inset 0 4px 0 rgba(255,255,255,0.15),inset 0 -4px 8px rgba(0,0,0,0.8),0 50px 100px rgba(0,0,0,0.95),0 15px 30px rgba(0,0,0,0.7)',
      'overflow:visible'
    ].join(';');
  }

  function isVisiblyFramed(el) {
    if (!el) return false;
    try {
      var cs = global.getComputedStyle(el);
      var bw = parseFloat(cs.borderTopWidth) || 0;
      return bw >= 8;
    } catch (e) {
      return false;
    }
  }

  function findLiveFramedTarget() {
    var candidates = [
      document.querySelector('#museumFrame .museum-frame-sculpted'),
      document.querySelector('.canvas-wrap.is-framed .museum-frame-sculpted'),
      document.querySelector('.gallery-item--detail .museum-frame-sculpted'),
      document.querySelector('.museum-wall-display .museum-frame-sculpted'),
      document.querySelector('.museum-frame-sculpted')
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && isVisiblyFramed(candidates[i])) return candidates[i];
    }
    return null;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (!src) {
        reject(new Error('empty src'));
        return;
      }
      if (typeof src !== 'string' && src.tagName === 'CANVAS') {
        resolve(src);
        return;
      }
      if (typeof src !== 'string' && src.tagName === 'IMG' && src.complete && src.naturalWidth > 0) {
        resolve(src);
        return;
      }
      var img = new Image();
      var done = false;
      function ok() {
        if (done) return;
        done = true;
        if ((img.naturalWidth || 0) < 2) reject(new Error('empty image'));
        else resolve(img);
      }
      function fail() {
        if (done) return;
        done = true;
        reject(new Error('image load failed'));
      }
      img.onload = ok;
      img.onerror = fail;
      img.src = typeof src === 'string' ? src : (src.src || '');
      if (img.complete && img.naturalWidth > 0) ok();
    });
  }

  /**
   * Build an offscreen DOM twin with the same gold CSS frame, host the artwork, capture it.
   */
  async function captureOffscreenCssFrame(artSource, filename) {
    requireHtml2Canvas();
    var art = await loadImage(artSource);
    var host = document.createElement('div');
    host.setAttribute('data-inscape-export-host', '1');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;pointer-events:none;';

    var frame = document.createElement('div');
    frame.className = 'museum-frame-sculpted';
    applySculptedFrameStyles(frame);

    var surface = document.createElement('div');
    surface.className = 'art-surface';
    surface.style.cssText = 'position:relative;display:block;width:270px;aspect-ratio:9/16;overflow:hidden;background:#f7f4eb;line-height:0;';

    var img = document.createElement('img');
    img.alt = '';
    img.crossOrigin = 'anonymous';
    img.style.cssText = 'display:block;width:100%;height:100%;object-fit:fill;opacity:1;';
    if (art.tagName === 'CANVAS') {
      img.src = art.toDataURL('image/png');
    } else {
      img.src = art.src || artSource;
    }

    surface.appendChild(img);
    frame.appendChild(surface);
    host.appendChild(frame);
    document.body.appendChild(host);

    try {
      await waitForMedia(frame);
      return await captureDomFrameToFile(frame, filename, { scale: 3, backgroundColor: null });
    } finally {
      if (host.parentNode) host.parentNode.removeChild(host);
    }
  }

  /**
   * Preferred export entry: capture live framed DOM if present, else offscreen CSS twin.
   * Never hand-draws the gold molding on Canvas 2D.
   */
  async function composeFramedPngFile(source, filename) {
    var live = findLiveFramedTarget();
    if (live) {
      try {
        return await captureDomFrameToFile(live, filename, { scale: 3, backgroundColor: null });
      } catch (err) {
        console.warn('[INSCAPE] live html2canvas failed, trying offscreen CSS frame:', err);
      }
    }
    if (!source) throw new Error('no artwork source for framed export');
    return captureOffscreenCssFrame(source, filename);
  }

  global.INSCAPE_FRAME_EXPORT = {
    version: 8,
    captureDomFrame: captureDomFrame,
    captureDomFrameToFile: captureDomFrameToFile,
    captureOffscreenCssFrame: captureOffscreenCssFrame,
    composeFramedPngFile: composeFramedPngFile,
    findLiveFramedTarget: findLiveFramedTarget,
    isVisiblyFramed: isVisiblyFramed,
    prepareCloneForCapture: prepareCloneForCapture,
    mountOnMuseumBoard: mountOnMuseumBoard
  };
})(typeof window !== 'undefined' ? window : this);
