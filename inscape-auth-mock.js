/**
 * INSCAPE local invite DB auth — always exposes INSCAPE_LOCAL_REDEEM when DB is loaded.
 * Full INSCAPE_MOCK (API bypass) activates only when INSCAPE_CLIENT_MOCK is true.
 */
(function (global) {
  'use strict';

  if (!global.INSCAPE_INVITE_DB) {
    if (global.INSCAPE_CLIENT_MOCK && global.console && global.console.error) {
      global.console.error('[Invite System] INSCAPE_INVITE_DB not loaded — include inscape-invite-db.js before inscape-auth-mock.js');
    }
    return;
  }

  var DB = global.INSCAPE_INVITE_DB;

  function randomToken() {
    var arr = new Uint8Array(16);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(arr, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function saveAccessPayload(data) {
    var payload = {
      ok: true,
      token: data.token,
      origin_route: data.origin_route,
      invite_code: data.invite_code,
      saved_at: new Date().toISOString(),
      auth_source: 'local'
    };
    global.localStorage.setItem('inscape_atelier_access_v1', JSON.stringify(payload));
    if (data.origin_route) {
      global.localStorage.setItem('inscape_origin_route_v1', data.origin_route);
    }
    if (global.INSCAPE_DATA && global.INSCAPE_DATA.syncAuth) {
      global.INSCAPE_DATA.syncAuth(data.invite_code, data.origin_route);
    }
  }

  function redeemViaLocalDb(rawCode) {
    var code = DB.normalizeCode(rawCode);

    if (!DB.isValidCodeFormat(code)) {
      return Promise.reject(new Error('招待コードはアルファベットとハイフンのみ使用できます'));
    }

    var lookup = DB.lookupForRedeem(code);
    if (!lookup.ok || !lookup.item) {
      return Promise.reject(new Error('このコードは無効、または既に使用されています'));
    }

    var item = lookup.item;
    if (!item.is_reusable) {
      DB.markUsed(item.code);
    }

    var token = randomToken();
    var issued = DB.issueChildCodes(item.origin_route, item.code, 3);
    DB.saveSessionChildren(token, item.code, issued.keys);

    return Promise.resolve({
      ok: true,
      token: token,
      origin_route: item.origin_route,
      invite_code: item.code,
      child_codes: DB.codesToDisplay(issued.list, issued.keys),
      _local: true
    });
  }

  function fetchMyCodesViaLocalDb() {
    var accessRaw = global.localStorage.getItem('inscape_atelier_access_v1');
    var access = null;
    try {
      access = accessRaw ? JSON.parse(accessRaw) : null;
    } catch (e) { /* ignore */ }
    if (!access || !access.ok || !access.token) {
      return Promise.reject(new Error('認証が必要です'));
    }

    var token = access.token;
    var list = DB.loadAll();
    var childKeys = DB.getSessionChildKeys(token);

    if (!childKeys.length) {
      var origin = access.origin_route || 'TEST';
      var inviteCode = access.invite_code || '';
      var issued = DB.issueChildCodes(origin, inviteCode || null, 3);
      childKeys = issued.keys;
      DB.saveSessionChildren(token, inviteCode || 'UNKNOWN', childKeys);
      list = issued.list;
    } else {
      list = DB.repairSessionCodes(
        childKeys,
        access.origin_route || 'TEST',
        access.invite_code || null
      );
    }

    return Promise.resolve(DB.codesToDisplay(list, childKeys));
  }

  function verifyLocalSession() {
    try {
      var raw = global.localStorage.getItem('inscape_atelier_access_v1');
      if (!raw) return Promise.resolve(false);
      var data = JSON.parse(raw);
      return Promise.resolve(!!(data && data.ok && data.token));
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function redeemInviteLocal(rawCode) {
    return redeemViaLocalDb(rawCode).then(function (data) {
      saveAccessPayload(data);
      return data;
    });
  }

  global.INSCAPE_LOCAL_REDEEM = {
    redeemInvite: redeemInviteLocal,
    fetchMyInviteCodes: fetchMyCodesViaLocalDb,
    verifySession: verifyLocalSession
  };

  if (!global.INSCAPE_CLIENT_MOCK) return;

  global.INSCAPE_MOCK = {
    redeemInvite: redeemInviteLocal,
    fetchMyInviteCodes: fetchMyCodesViaLocalDb,
    verifySession: verifyLocalSession
  };
})(typeof window !== 'undefined' ? window : globalThis);
