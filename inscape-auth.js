/* INSCAPE invite / atelier access gate (one-time server redeem) */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'inscape_atelier_access_v1';
  var ORIGIN_ROUTE_KEY = 'inscape_origin_route_v1';
  var SESSION_CHILDREN_KEY = 'inscape_invite_session_children_v1';
  var LP_PATH = 'index.html';
  var ATELIER_PATH = 'atelier.html';

  var API_BASE = (typeof global.INSCAPE_API_BASE === 'string' && global.INSCAPE_API_BASE) ||
    (global.location && global.location.protocol === 'file:' ? 'http://localhost:8787' : '');

  function normalizeCode(raw) {
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[\s＿ー]+/g, '')
      .replace(/－/g, '-');
  }

  function isAlphabetInviteCode(code) {
    if (!code || code.length < 4 || code.length > 64) return false;
    return /^[A-Z]+(-[A-Z]+)*$/.test(code);
  }

  function readAccess() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.ok || !data.token) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function saveAccess(token, originRoute, inviteCode) {
    var payload = {
      ok: true,
      token: token,
      origin_route: originRoute || '',
      invite_code: inviteCode || '',
      saved_at: new Date().toISOString()
    };
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (originRoute) {
      global.localStorage.setItem(ORIGIN_ROUTE_KEY, originRoute);
    }
    if (global.INSCAPE_DATA && global.INSCAPE_DATA.syncAuth) {
      global.INSCAPE_DATA.syncAuth(inviteCode, originRoute);
    }
  }

  function clearAccess() {
    var token = getToken();
    global.localStorage.removeItem(STORAGE_KEY);
    global.localStorage.removeItem(ORIGIN_ROUTE_KEY);
    if (token) {
      try {
        var raw = global.localStorage.getItem(SESSION_CHILDREN_KEY);
        if (raw) {
          var sessions = JSON.parse(raw);
          if (sessions && typeof sessions === 'object' && sessions[token]) {
            delete sessions[token];
            global.localStorage.setItem(SESSION_CHILDREN_KEY, JSON.stringify(sessions));
          }
        }
      } catch (e) { /* ignore */ }
    }
  }

  /** Clear login session only — keeps inscape_invite_codes_db and diary data */
  function logoutToLp() {
    clearAccess();
    global.location.href = LP_PATH;
  }

  function isAuthenticated() {
    return !!readAccess();
  }

  function getOriginRoute() {
    var access = readAccess();
    if (access && access.origin_route) return access.origin_route;
    try {
      return global.localStorage.getItem(ORIGIN_ROUTE_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function getToken() {
    var access = readAccess();
    return access && access.token ? access.token : '';
  }

  function getAuthHeaders() {
    var token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function apiUrl(path) {
    var base = (API_BASE || '').replace(/\/$/, '');
    return base + path;
  }

  function fetchErrorMessage(err) {
    if (err && err.message === 'Failed to fetch') {
      return 'サーバーに接続できません。API が起動しているか確認してください。';
    }
    return (err && err.message) || '認証に失敗しました';
  }

  function fetchWithTimeout(url, opts, timeoutMs) {
    timeoutMs = timeoutMs || 12000;
    if (typeof global.AbortController === 'undefined') {
      return fetch(url, opts);
    }
    var controller = new global.AbortController();
    var timer = global.setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    var merged = {};
    if (opts) {
      Object.keys(opts).forEach(function (key) { merged[key] = opts[key]; });
    }
    merged.signal = controller.signal;
    return fetch(url, merged).finally(function () {
      global.clearTimeout(timer);
    });
  }

  function isApiFallbackEligible(err) {
    if (!err) return false;
    if (err instanceof TypeError) return true;
    if (err.name === 'AbortError') return true;
    var msg = String(err.message || '');
    if (/failed to fetch|network|abort|timeout|load failed/i.test(msg)) return true;
    if (err._apiStatus === 404 || err._apiStatus === 502 || err._apiStatus === 503) return true;
    return false;
  }

  function tryLocalRedeem(rawCode) {
    if (global.INSCAPE_LOCAL_REDEEM && global.INSCAPE_LOCAL_REDEEM.redeemInvite) {
      return global.INSCAPE_LOCAL_REDEEM.redeemInvite(rawCode);
    }
    return Promise.reject(new Error('オフライン認証を利用できません'));
  }

  function tryLocalFetchMyCodes() {
    if (global.INSCAPE_LOCAL_REDEEM && global.INSCAPE_LOCAL_REDEEM.fetchMyInviteCodes) {
      return global.INSCAPE_LOCAL_REDEEM.fetchMyInviteCodes();
    }
    return Promise.reject(new Error('オフライン認証を利用できません'));
  }

  function redeemInvite(rawCode) {
    if (global.INSCAPE_MOCK && global.INSCAPE_MOCK.redeemInvite) {
      return global.INSCAPE_MOCK.redeemInvite(rawCode);
    }

    var code = normalizeCode(rawCode);
    if (!isAlphabetInviteCode(code)) {
      return Promise.reject(new Error('招待コードはアルファベットとハイフンのみ使用できます'));
    }

    return fetchWithTimeout(apiUrl('/api/invite/redeem'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok || !data || !data.ok) {
          var apiErr = new Error((data && data.error) || 'このコードは無効、または既に使用されています');
          apiErr._apiStatus = res.status;
          throw apiErr;
        }
        saveAccess(data.token, data.origin_route, data.invite_code);
        return data;
      });
    }).catch(function (err) {
      if (isApiFallbackEligible(err)) {
        return tryLocalRedeem(rawCode);
      }
      if (global.INSCAPE_INVITE_DB) {
        var lookup = global.INSCAPE_INVITE_DB.lookupForRedeem(code);
        if (lookup.ok && lookup.item) {
          return tryLocalRedeem(rawCode);
        }
      }
      if (err instanceof TypeError) {
        return tryLocalRedeem(rawCode).catch(function () {
          throw new Error(fetchErrorMessage(err));
        });
      }
      throw err;
    });
  }

  function fetchMyInviteCodes() {
    if (global.INSCAPE_MOCK && global.INSCAPE_MOCK.fetchMyInviteCodes) {
      return global.INSCAPE_MOCK.fetchMyInviteCodes();
    }

    var token = getToken();
    if (!token) {
      return Promise.reject(new Error('認証が必要です'));
    }
    return fetchWithTimeout(apiUrl('/api/invite/my-codes'), {
      headers: getAuthHeaders()
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok || !data || !data.ok) {
          var apiErr = new Error((data && data.error) || '招待コードの取得に失敗しました');
          apiErr._apiStatus = res.status;
          throw apiErr;
        }
        return data.codes || [];
      });
    }).catch(function (err) {
      if (isApiFallbackEligible(err)) {
        return tryLocalFetchMyCodes();
      }
      if (err instanceof TypeError) {
        return tryLocalFetchMyCodes().catch(function () {
          throw new Error(fetchErrorMessage(err));
        });
      }
      throw err;
    });
  }

  function verifySession() {
    if (global.INSCAPE_MOCK && global.INSCAPE_MOCK.verifySession) {
      return global.INSCAPE_MOCK.verifySession();
    }

    var access = readAccess();
    if (!access) {
      return Promise.resolve(false);
    }
    return fetch(apiUrl('/api/session/verify'), {
      headers: getAuthHeaders()
    }).then(function (res) {
      if (!res.ok) {
        clearAccess();
        return false;
      }
      return true;
    }).catch(function () {
      return isAuthenticated();
    });
  }

  function redirectToLp() {
    var path = global.location.pathname || '';
    if (path.endsWith('/' + LP_PATH) || path.endsWith('/')) return;
    global.location.replace(LP_PATH);
  }

  function requireAtelierAccess() {
    if (!isAuthenticated()) {
      redirectToLp();
      return;
    }
    verifySession().then(function (ok) {
      if (!ok) redirectToLp();
    });
  }

  function redirectIfAuthenticated() {
    if (!isAuthenticated()) return;
    var path = global.location.pathname || '';
    if (path.endsWith('/' + ATELIER_PATH)) return;
    global.location.replace(ATELIER_PATH);
  }

  global.INSCAPE_AUTH = {
    normalizeCode: normalizeCode,
    isAlphabetInviteCode: isAlphabetInviteCode,
    isAuthenticated: isAuthenticated,
    getOriginRoute: getOriginRoute,
    getToken: getToken,
    getAuthHeaders: getAuthHeaders,
    redeemInvite: redeemInvite,
    fetchMyInviteCodes: fetchMyInviteCodes,
    verifySession: verifySession,
    requireAtelierAccess: requireAtelierAccess,
    redirectIfAuthenticated: redirectIfAuthenticated,
    clearAccess: clearAccess,
    logoutToLp: logoutToLp,
    isClientMock: function () {
      return !!(global.INSCAPE_MOCK);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
