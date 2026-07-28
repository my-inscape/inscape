/**
 * INSCAPE canonical local user data (Web → native migration)
 *
 * Storage:
 *   - localStorage key: inscape_user_data_v1
 *   - IndexedDB: inscape / user_data / canonical_v1
 *
 * Schema:
 * {
 *   "usedInvitationCode": "SILENT-XQZ",
 *   "originRoute": "SILENT",
 *   "history": [{ "day": 1, "color": "#hex", "text": "...", "date": "2026-07-22" }]
 * }
 *
 * Diary text/colors never leave the device except via explicit export/import.
 */
(function (global) {
  'use strict';

  var CANONICAL_KEY = 'inscape_user_data_v1';
  var AUTH_STORAGE_KEY = 'inscape_atelier_access_v1';
  var SCHEMA_VERSION = 1;

  var LEGACY_KEYS = {
    allDiaries: 'inscape_all_diaries',
    history: 'inscape_history',
    splashes: 'inscape_splashes',
    recipes: 'histories'
  };

  var IDB_NAME = 'inscape';
  var IDB_STORE = 'user_data';
  var IDB_KEY = 'canonical_v1';

  function emptyPayload() {
    return {
      usedInvitationCode: '',
      originRoute: '',
      history: []
    };
  }

  function normalizeInviteCode(raw) {
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[\s＿ー]+/g, '')
      .replace(/－/g, '-');
  }

  function normalizeHex(color) {
    if (!color) return '';
    var raw = String(color).trim();
    var matched = raw.match(/#?[0-9a-fA-F]{6}\b/);
    if (!matched) return '';
    var hex = matched[0];
    if (hex[0] !== '#') hex = '#' + hex;
    return hex.toLowerCase();
  }

  function toIsoDate(ts) {
    var n = Number(ts);
    if (!n || n <= 0) return '';
    var d = new Date(n);
    if (Number.isNaN(d.getTime())) return '';
    var shifted = new Date(d.getTime() - (6 * 60 * 60 * 1000));
    var y = shifted.getFullYear();
    var mo = String(shifted.getMonth() + 1).padStart(2, '0');
    var da = String(shifted.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + da;
  }

  function normalizeDateField(dateStr, ts) {
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())) {
      return String(dateStr).trim();
    }
    var fromTs = toIsoDate(ts);
    if (fromTs) return fromTs;
    if (dateStr) {
      var m = String(dateStr).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (m) {
        return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
      }
    }
    return toIsoDate(Date.now());
  }

  function normalizeHistoryEntry(raw, dayIndex) {
    if (!raw || typeof raw !== 'object') return null;
    var color = normalizeHex(raw.color || raw.color1);
    if (!color) return null;
    return {
      day: typeof raw.day === 'number' && raw.day > 0 ? raw.day : dayIndex,
      color: color,
      text: String(raw.text != null ? raw.text : (raw.word || '')).trim(),
      date: normalizeDateField(raw.date, raw.timestamp)
    };
  }

  function normalizePayload(raw) {
    var base = emptyPayload();
    if (!raw || typeof raw !== 'object') return base;

    base.usedInvitationCode = normalizeInviteCode(raw.usedInvitationCode || raw.invite_code || '');
    base.originRoute = normalizeInviteCode(raw.originRoute || raw.origin_route || '');

    var list = Array.isArray(raw.history) ? raw.history : [];
    base.history = list
      .map(function (entry, i) { return normalizeHistoryEntry(entry, i + 1); })
      .filter(Boolean)
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.day - b.day;
      })
      .map(function (entry, i) {
        entry.day = i + 1;
        return entry;
      });

    return base;
  }

  function readAuthFromStorage() {
    try {
      var raw = global.localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return { invite_code: '', origin_route: '' };
      var data = JSON.parse(raw);
      return {
        invite_code: (data && data.invite_code) || '',
        origin_route: (data && data.origin_route) || ''
      };
    } catch (e) {
      return { invite_code: '', origin_route: '' };
    }
  }

  function safeParseJson(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function collectLegacyEntries() {
    var map = new Map();

    function absorb(entry) {
      var normalized = normalizeHistoryEntry(entry, 0);
      if (!normalized) return;
      var ts = entry && entry.timestamp ? Number(entry.timestamp) : Date.parse(normalized.date) || 0;
      var key = (ts || 0) + '|' + normalized.color + '|' + normalized.text;
      if (!map.has(key)) {
        map.set(key, {
          color: normalized.color,
          text: normalized.text,
          date: normalized.date,
          timestamp: ts || Date.parse(normalized.date) || 0
        });
      }
    }

    try {
      var allDiaries = safeParseJson(global.localStorage.getItem(LEGACY_KEYS.allDiaries), []);
      if (Array.isArray(allDiaries)) allDiaries.forEach(absorb);
    } catch (e) { /* ignore */ }

    try {
      var historyRaw = safeParseJson(global.localStorage.getItem(LEGACY_KEYS.history), []);
      if (Array.isArray(historyRaw)) {
        if (historyRaw[0] && Array.isArray(historyRaw[0].history)) {
          historyRaw[0].history.forEach(absorb);
        } else {
          historyRaw.forEach(absorb);
        }
      }
    } catch (e) { /* ignore */ }

    try {
      var splashes = safeParseJson(global.localStorage.getItem(LEGACY_KEYS.splashes), []);
      if (Array.isArray(splashes)) {
        splashes.forEach(function (s) {
          absorb({
            word: s.word,
            color: s.color1 || s.color,
            timestamp: s.timestamp,
            date: s.date
          });
        });
      }
    } catch (e) { /* ignore */ }

    try {
      var recipes = safeParseJson(global.localStorage.getItem(LEGACY_KEYS.recipes), []);
      if (Array.isArray(recipes)) {
        recipes.forEach(function (s) {
          absorb({
            word: s.word,
            color: s.color1 || s.color,
            timestamp: s.timestamp,
            date: s.date
          });
        });
      }
    } catch (e) { /* ignore */ }

    return Array.from(map.values()).sort(function (a, b) {
      return (a.timestamp || 0) - (b.timestamp || 0);
    });
  }

  function idbPut(data) {
    if (!global.indexedDB) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function (ev) {
        var db = ev.target.result;
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ schemaVersion: SCHEMA_VERSION, payload: data }, IDB_KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      };
      req.onerror = function () { reject(req.error); };
    }).catch(function () { /* IndexedDB optional */ });
  }

  function idbGet() {
    if (!global.indexedDB) return Promise.resolve(null);
    return new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function (ev) {
        var db = ev.target.result;
        var tx = db.transaction(IDB_STORE, 'readonly');
        var getReq = tx.objectStore(IDB_STORE).get(IDB_KEY);
        getReq.onsuccess = function () {
          var row = getReq.result;
          resolve(row && row.payload ? row.payload : null);
        };
        getReq.onerror = function () { reject(getReq.error); };
      };
      req.onerror = function () { reject(req.error); };
    }).catch(function () { return null; });
  }

  function save(payload) {
    var normalized = normalizePayload(payload);
    try {
      global.localStorage.setItem(CANONICAL_KEY, JSON.stringify(normalized));
    } catch (e) {
      console.warn('[INSCAPE_DATA] localStorage save failed:', e);
    }
    idbPut(normalized);
    return normalized;
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(CANONICAL_KEY);
      if (!raw) return null;
      return normalizePayload(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function mergeAuthFields(payload) {
    var auth = readAuthFromStorage();
    if (auth.invite_code && !payload.usedInvitationCode) {
      payload.usedInvitationCode = normalizeInviteCode(auth.invite_code);
    }
    if (auth.origin_route && !payload.originRoute) {
      payload.originRoute = normalizeInviteCode(auth.origin_route);
    }
    return payload;
  }

  function buildFromLegacy() {
    var auth = readAuthFromStorage();
    var legacy = collectLegacyEntries();
    var history = legacy.map(function (entry, i) {
      return {
        day: i + 1,
        color: entry.color,
        text: entry.text,
        date: entry.date || toIsoDate(entry.timestamp)
      };
    });
    return normalizePayload({
      usedInvitationCode: auth.invite_code,
      originRoute: auth.origin_route,
      history: history
    });
  }

  function migrateAndLoad() {
    var current = load();
    var legacy = buildFromLegacy();

    if (!current || !current.history || !current.history.length) {
      return save(mergeAuthFields(legacy));
    }

    if (legacy.history.length > current.history.length) {
      current.history = legacy.history;
    }

    return save(mergeAuthFields(current));
  }

  function syncAuth(inviteCode, originRoute) {
    var data = load() || emptyPayload();
    if (inviteCode) data.usedInvitationCode = normalizeInviteCode(inviteCode);
    if (originRoute) data.originRoute = normalizeInviteCode(originRoute);
    return save(data);
  }

  function syncFromSplashes(splashes) {
    var auth = readAuthFromStorage();
    var sorted = (splashes || []).slice().sort(function (a, b) {
      return (a.timestamp || 0) - (b.timestamp || 0);
    });

    var history = sorted.map(function (s, i) {
      return normalizeHistoryEntry({
        day: i + 1,
        color: s.color1 || s.color,
        text: s.word,
        timestamp: s.timestamp,
        date: s.date
      }, i + 1);
    }).filter(Boolean);

    if (!history.length) {
      var existing = load();
      if (existing && existing.history && existing.history.length) {
        return save(mergeAuthFields(existing));
      }
      return migrateAndLoad();
    }

    return save(normalizePayload({
      usedInvitationCode: auth.invite_code,
      originRoute: auth.origin_route,
      history: history
    }));
  }

  function exportUserData() {
    return save(mergeAuthFields(load() || buildFromLegacy()));
  }

  function exportUserDataJson(pretty) {
    var data = exportUserData();
    return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  }

  function validateForImport(data, invitationCode) {
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'データ形式が不正です' };
    }
    if (!Array.isArray(data.history)) {
      return { ok: false, error: 'history が見つかりません' };
    }
    var expected = normalizeInviteCode(invitationCode || data.usedInvitationCode || '');
    var provided = normalizeInviteCode(data.usedInvitationCode || '');
    if (expected && provided && expected !== provided) {
      return { ok: false, error: 'Web版で使用した招待コードが一致しません' };
    }
    if (invitationCode && !provided) {
      return { ok: false, error: 'エクスポートデータに招待コードが含まれていません' };
    }
    return { ok: true };
  }

  function importUserData(input, options) {
    var raw = typeof input === 'string' ? safeParseJson(input, null) : input;
    if (!raw) throw new Error('インポートデータの解析に失敗しました');

    var opts = options || {};
    var check = validateForImport(raw, opts.invitationCode);
    if (!check.ok) throw new Error(check.error);

    var normalized = normalizePayload(raw);
    if (opts.invitationCode && !normalized.usedInvitationCode) {
      normalized.usedInvitationCode = normalizeInviteCode(opts.invitationCode);
    }

    if (opts.merge && load()) {
      var existing = load();
      var merged = new Map();
      (existing.history || []).forEach(function (e) {
        merged.set(e.date + '|' + e.color + '|' + e.text, e);
      });
      (normalized.history || []).forEach(function (e) {
        merged.set(e.date + '|' + e.color + '|' + e.text, e);
      });
      normalized.history = Array.from(merged.values()).sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.day - b.day;
      }).map(function (e, i) {
        e.day = i + 1;
        return e;
      });
      normalized.usedInvitationCode = normalized.usedInvitationCode || existing.usedInvitationCode;
      normalized.originRoute = normalized.originRoute || existing.originRoute;
    }

    return save(normalized);
  }

  function restoreFromIndexedDB() {
    return idbGet().then(function (fromIdb) {
      if (!fromIdb) return load();
      var local = load();
      if (!local || !local.history || !local.history.length) {
        return save(mergeAuthFields(fromIdb));
      }
      return local;
    });
  }

  global.INSCAPE_DATA = {
    CANONICAL_KEY: CANONICAL_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    emptyPayload: emptyPayload,
    load: load,
    save: save,
    migrateAndLoad: migrateAndLoad,
    syncAuth: syncAuth,
    syncFromSplashes: syncFromSplashes,
    exportUserData: exportUserData,
    exportUserDataJson: exportUserDataJson,
    validateForImport: validateForImport,
    importUserData: importUserData,
    restoreFromIndexedDB: restoreFromIndexedDB,
    normalizePayload: normalizePayload
  };
})(typeof window !== 'undefined' ? window : globalThis);
