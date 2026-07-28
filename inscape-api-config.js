/**
 * INSCAPE API endpoint — production (Render / GitHub Pages / my-inscape.com)
 * Loaded before inscape-auth.js on every gated page.
 */
(function (global) {
  'use strict';

  var PRODUCTION_API = 'https://inscape.onrender.com';
  var LOCAL_API = 'http://localhost:8787';
  var host = (global.location && global.location.hostname) || '';
  var isFile = global.location && global.location.protocol === 'file:';
  var isLocal = host === 'localhost' || host === '127.0.0.1';

  if (typeof global.INSCAPE_API_BASE === 'string' && global.INSCAPE_API_BASE) {
    return;
  }

  if (host === 'inscape.onrender.com') {
    global.INSCAPE_API_BASE = '';
    return;
  }

  if (host && host.endsWith('.github.io')) {
    global.INSCAPE_API_BASE = PRODUCTION_API;
    return;
  }

  if (host === 'my-inscape.com' || host === 'www.my-inscape.com') {
    global.INSCAPE_API_BASE = PRODUCTION_API;
    return;
  }

  if (isFile || isLocal) {
    global.INSCAPE_API_BASE = LOCAL_API;
    return;
  }

  global.INSCAPE_API_BASE = PRODUCTION_API;
})(typeof window !== 'undefined' ? window : globalThis);
