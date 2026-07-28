/**
 * INSCAPE invite codes — unified localStorage DB (mock / client-only)
 * Single source of truth: localStorage key `inscape_invite_codes_db`
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'inscape_invite_codes_db';
  var SESSIONS_KEY = 'inscape_invite_session_children_v1';
  var LEGACY_KEYS = ['inscape_mock_codes', 'inscape_mock_invite_db_v1'];
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  var SEED_CODES = [
    { code: 'TEST-UNLIMITED', origin_route: 'TEST', is_reusable: true, is_used: false },
    { code: 'SILENT-XQZ', origin_route: 'SILENT', is_reusable: false, is_used: false },
    { code: 'VIP-ISC-LKNW', origin_route: 'VIP-ISC', is_reusable: false, is_used: false }
  ];

  function log(msg, data) {
    /* production: invite DB debug logs disabled */
  }

  function normalizeCode(raw) {
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[\s＿ー]+/g, '')
      .replace(/－/g, '-');
  }

  function isValidCodeFormat(code) {
    if (!code || code.length < 4 || code.length > 64) return false;
    return /^[A-Z]+(-[A-Z]+)*$/.test(code);
  }

  function entryFromParts(code, originRoute, opts) {
    opts = opts || {};
    return {
      code: normalizeCode(code),
      origin_route: originRoute || '',
      is_reusable: !!opts.is_reusable,
      is_used: !!opts.is_used,
      used_at: opts.used_at || null,
      is_child: !!opts.is_child,
      parent_code: opts.parent_code || null,
      issued_at: opts.issued_at || new Date().toISOString()
    };
  }

  function loadAll() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (item) { return item && item.code; });
    } catch (e) {
      log('Failed to load DB', e);
      return [];
    }
  }

  function saveAll(list) {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    log('Current DB:', list.map(function (item) {
      return { code: item.code, is_used: item.is_used, origin_route: item.origin_route };
    }));
  }

  function findInList(list, rawCode) {
    var key = normalizeCode(rawCode);
    if (!key) return null;
    for (var i = 0; i < list.length; i++) {
      if (normalizeCode(list[i].code) === key) {
        return { index: i, item: list[i] };
      }
    }
    return null;
  }

  function upsert(list, code, originRoute, opts) {
    opts = opts || {};
    var key = normalizeCode(code);
    if (!key) return list;

    var found = findInList(list, key);
    var next = entryFromParts(key, originRoute, opts);

    if (found) {
      if (opts.is_used != null) next.is_used = !!opts.is_used;
      else next.is_used = !!found.item.is_used;
      if (opts.used_at !== undefined) next.used_at = opts.used_at;
      else next.used_at = found.item.used_at || null;
      if (opts.is_reusable != null) next.is_reusable = !!opts.is_reusable;
      else next.is_reusable = !!found.item.is_reusable;
      if (opts.is_child != null) next.is_child = !!opts.is_child;
      else next.is_child = !!found.item.is_child;
      if (opts.parent_code !== undefined) next.parent_code = opts.parent_code;
      else next.parent_code = found.item.parent_code || null;
      list[found.index] = next;
      log('Code updated: ' + key, next);
    } else {
      list.push(next);
      log('Code added: ' + key, next);
    }

    saveAll(list);
    return list;
  }

  function migrateLegacyOnce() {
    var list = loadAll();
    var changed = false;

    LEGACY_KEYS.forEach(function (legacyKey) {
      try {
        var raw = global.localStorage.getItem(legacyKey);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(function (item) {
            if (!item || !item.code) return;
            if (!findInList(list, item.code)) {
              list.push(entryFromParts(item.code, item.origin_route, {
                is_reusable: !!item.is_reusable,
                is_used: !!item.is_used,
                used_at: item.used_at,
                is_child: !!item.is_child,
                parent_code: item.parent_code
              }));
              changed = true;
            }
          });
        } else if (parsed && typeof parsed === 'object') {
          Object.keys(parsed).forEach(function (code) {
            var row = parsed[code];
            if (!findInList(list, code)) {
              list.push(entryFromParts(code, row.origin_route, {
                is_reusable: !!row.is_reusable,
                is_used: !!row.is_used,
                used_at: row.used_at,
                is_child: !!row.is_child,
                parent_code: row.parent_code
              }));
              changed = true;
            }
          });
        }
      } catch (e) { /* ignore */ }
    });

    if (changed) {
      saveAll(list);
      log('Merged legacy codes into ' + STORAGE_KEY);
    }
    return list;
  }

  function ensureSeedsOnly() {
    var list = loadAll();
    var changed = false;

    SEED_CODES.forEach(function (seed) {
      var found = findInList(list, seed.code);
      if (!found) {
        list.push(entryFromParts(seed.code, seed.origin_route, {
          is_reusable: !!seed.is_reusable,
          is_used: false,
          used_at: null
        }));
        changed = true;
        log('Seed code registered: ' + seed.code);
      }
    });

    var unlimited = findInList(list, 'TEST-UNLIMITED');
    if (unlimited) {
      if (!unlimited.item.is_reusable || unlimited.item.origin_route !== 'TEST') {
        unlimited.item.is_reusable = true;
        unlimited.item.origin_route = 'TEST';
        list[unlimited.index] = unlimited.item;
        changed = true;
      }
    }

    if (changed) saveAll(list);
    return list;
  }

  function initDb() {
    migrateLegacyOnce();
    var list = ensureSeedsOnly();
    log('DB initialized (' + list.length + ' codes)');
    return list;
  }

  function randomAlphaSuffix(minLen, maxLen) {
    var len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
    var suffix = '';
    for (var i = 0; i < len; i++) {
      suffix += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    }
    return suffix;
  }

  function uniqueChildCode(list, originRoute) {
    for (var attempt = 0; attempt < 64; attempt++) {
      var code = normalizeCode(originRoute + '-' + randomAlphaSuffix(4, 6));
      if (!findInList(list, code)) return code;
    }
    return normalizeCode(originRoute + '-' + randomAlphaSuffix(6, 6));
  }

  function issueChildCodes(originRoute, parentCode, count) {
    var list = loadAll();
    var keys = [];
    var n = count || 3;

    for (var i = 0; i < n; i++) {
      var codeKey = uniqueChildCode(list, originRoute);
      list = upsert(list, codeKey, originRoute, {
        is_reusable: false,
        is_used: false,
        used_at: null,
        is_child: true,
        parent_code: parentCode || null
      });
      keys.push(codeKey);
    }

    log('Issued ' + keys.length + ' child codes from ' + (parentCode || originRoute), keys);
    return { list: list, keys: keys };
  }

  function issueMasterCode(originRoute, customCode) {
    var list = loadAll();
    var route = normalizeCode(originRoute || '');
    var code = customCode ? normalizeCode(customCode) : '';

    if (!code) {
      if (!route) throw new Error('origin_route or code is required');
      code = uniqueChildCode(list, route);
    }

    if (!route) {
      route = code.split('-').slice(0, -1).join('-') || code;
    }

    if (!isValidCodeFormat(code)) {
      throw new Error('Invalid code format');
    }

    if (findInList(list, code)) {
      throw new Error('Code already exists');
    }

    list = upsert(list, code, route, {
      is_reusable: false,
      is_used: false,
      is_child: false,
      parent_code: null
    });

    log('Master code issued: ' + code, { origin_route: route });
    return { code: code, origin_route: route };
  }

  function computeRouteStats(list) {
    var map = {};
    (list || []).forEach(function (item) {
      var route = item.origin_route || 'UNKNOWN';
      if (!map[route]) {
        map[route] = { origin_route: route, total: 0, active: 0, used: 0 };
      }
      map[route].total += 1;
      if (item.is_used) map[route].used += 1;
      else map[route].active += 1;
    });
    return Object.keys(map).sort().map(function (route) {
      var r = map[route];
      var rate = r.total > 0 ? Math.round((r.used / r.total) * 1000) / 10 : 0;
      return {
        origin_route: r.origin_route,
        total: r.total,
        active: r.active,
        used: r.used,
        consumption_rate: rate
      };
    });
  }

  function markUsed(code) {
    var list = loadAll();
    var found = findInList(list, code);
    if (!found) return list;
    if (found.item.is_reusable) return list;

    list = upsert(list, found.item.code, found.item.origin_route, {
      is_reusable: false,
      is_used: true,
      used_at: new Date().toISOString(),
      is_child: found.item.is_child,
      parent_code: found.item.parent_code
    });
    return list;
  }

  function lookupForRedeem(rawCode) {
    var list = loadAll();
    var found = findInList(list, rawCode);
    if (!found) {
      log('Redeem failed — code not in DB: ' + normalizeCode(rawCode));
      return { ok: false, list: list };
    }
    var item = found.item;
    if (!item.is_reusable && item.is_used) {
      log('Redeem failed — already used: ' + item.code);
      return { ok: false, list: list, item: item };
    }
    return { ok: true, list: list, item: item, index: found.index };
  }

  function codesToDisplay(list, codeKeys) {
    return codeKeys.map(function (key) {
      var found = findInList(list, key);
      if (!found) {
        return { code: normalizeCode(key), origin_route: '', is_used: true, used_at: null };
      }
      return {
        code: found.item.code,
        origin_route: found.item.origin_route,
        is_used: !!found.item.is_used,
        used_at: found.item.used_at || null
      };
    });
  }

  function loadSessions() {
    try {
      var raw = global.localStorage.getItem(SESSIONS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveSessions(sessions) {
    global.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }

  function saveSessionChildren(token, inviteCode, childKeys) {
    var sessions = loadSessions();
    sessions[token] = {
      invite_code: normalizeCode(inviteCode),
      child_codes: childKeys.slice(),
      issued_at: new Date().toISOString()
    };
    saveSessions(sessions);
  }

  function getSessionChildKeys(token) {
    var sessions = loadSessions();
    var session = sessions[token];
    if (!session || !Array.isArray(session.child_codes)) return [];
    return session.child_codes.map(normalizeCode);
  }

  function repairSessionCodes(childKeys, originRoute, parentCode) {
    var list = loadAll();
    childKeys.forEach(function (key) {
      if (!findInList(list, key)) {
        list = upsert(list, key, originRoute, {
          is_reusable: false,
          is_used: false,
          used_at: null,
          is_child: true,
          parent_code: parentCode || null
        });
        log('Repaired missing session code in DB: ' + key);
      }
    });
    return list;
  }

  global.INSCAPE_INVITE_DB = {
    STORAGE_KEY: STORAGE_KEY,
    normalizeCode: normalizeCode,
    isValidCodeFormat: isValidCodeFormat,
    initDb: initDb,
    loadAll: loadAll,
    saveAll: saveAll,
    upsert: upsert,
    find: function (code) { return findInList(loadAll(), code); },
    lookupForRedeem: lookupForRedeem,
    markUsed: markUsed,
    issueChildCodes: issueChildCodes,
    issueMasterCode: issueMasterCode,
    computeRouteStats: computeRouteStats,
    codesToDisplay: codesToDisplay,
    saveSessionChildren: saveSessionChildren,
    getSessionChildKeys: getSessionChildKeys,
    repairSessionCodes: repairSessionCodes,
    log: log
  };

  initDb();
})(typeof window !== 'undefined' ? window : globalThis);
