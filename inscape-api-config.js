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
  var params = null;

  try {
    if (global.location && global.location.search) {
      params = new URLSearchParams(global.location.search);
    }
  } catch (e) { /* ignore */ }

  if (params && params.get('mock') === '1') {
    try {
      global.sessionStorage.setItem('inscape_test_mock', '1');
    } catch (e) { /* ignore */ }
  }

  var testMock = false;
  try {
    testMock = global.sessionStorage.getItem('inscape_test_mock') === '1';
  } catch (e) { /* ignore */ }

  if (typeof global.INSCAPE_CLIENT_MOCK === 'boolean') {
    return;
  }

  // Client mock (localStorage invite DB) — ?mock=1 persists for the session
  if (testMock || isFile || isLocal) {
    global.INSCAPE_CLIENT_MOCK = true;
    global.INSCAPE_API_BASE = '';
    return;
  }

  if (typeof global.INSCAPE_API_BASE === 'string' && global.INSCAPE_API_BASE) {
    return;
  }

  // Same-origin only when static + API are served together on Render
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
