'use strict';

/**
 * INSCAPE Invite API
 * - One-time invitation_codes redeem (atomic)
 * - Viral loop: 3 child codes issued on successful auth
 * - Anonymous session token issuance
 * - Stealth admin dashboard (404 camouflage)
 * - NEVER stores diary / color / artwork payloads
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./db');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN_BYTES = 32;
const CHILD_CODES_PER_SESSION = 3;
const ADMIN_ROUTE = process.env.INSCAPE_ADMIN_ROUTE || '/x9k2-pvw8-m4rt';
const ADMIN_SECRET_KEY = process.env.INSCAPE_ADMIN_SECRET_KEY || 'YourSecretPass';
const ADMIN_COOKIE_NAME = '_isc_h';
const ADMIN_COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;
const ROOT_DIR = path.join(__dirname, '..');
const PRIVATE_DIR = path.join(__dirname, 'private');
const DASHBOARD_PAGE = path.join(PRIVATE_DIR, 'hide-dashboard.html');
const NOT_FOUND_PAGE = path.join(PRIVATE_DIR, 'not-found.html');
const NOT_FOUND_HTML = fs.readFileSync(NOT_FOUND_PAGE, 'utf8');
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const db = initDatabase();

function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s＿ー]+/g, '')
    .replace(/－/g, '-');
}

/** Alphabet + hyphen only (e.g. SILENT-XQZ, VIP-ISC-LKNW) */
function isAlphabetInviteCode(code) {
  if (!code || code.length < 4 || code.length > 64) return false;
  return /^[A-Z]+(-[A-Z]+)*$/.test(code);
}

function nowIso() {
  return new Date().toISOString();
}

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function newId() {
  return crypto.randomUUID();
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

function signAdminCookieValue() {
  const exp = String(Date.now() + ADMIN_COOKIE_MAX_AGE_SEC * 1000);
  const sig = crypto.createHmac('sha256', ADMIN_SECRET_KEY).update(exp).digest('hex');
  return `${exp}.${sig}`;
}

function verifyAdminCookieValue(value) {
  if (!value || typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  if (dot === -1) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = crypto.createHmac('sha256', ADMIN_SECRET_KEY).update(exp).digest('hex');
  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  } catch (e) {
    return false;
  }
  const expMs = Number(exp);
  return Number.isFinite(expMs) && expMs > Date.now();
}

function isAdminAuthenticated(req) {
  const cookies = parseCookies(req);
  return verifyAdminCookieValue(cookies[ADMIN_COOKIE_NAME]);
}

function setAdminCookie(res) {
  const value = signAdminCookieValue();
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=' + ADMIN_ROUTE,
    `Max-Age=${ADMIN_COOKIE_MAX_AGE_SEC}`,
    'SameSite=Strict'
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function wantsJson(req) {
  const accept = req.headers.accept || '';
  return accept.includes('application/json') || (req.path && req.path.includes('/api/'));
}

function sendNotFound(req, res) {
  if (wantsJson(req)) {
    return res.status(404).json({ error: 'Not Found' });
  }
  return res.status(404).type('html').send(NOT_FOUND_HTML);
}

function formatCodeRow(row) {
  return {
    code: row.code,
    origin_route: row.origin_route,
    is_used: !!row.is_used,
    used_at: row.used_at || null
  };
}

function getOriginRouteStats() {
  const rows = db.prepare(`
    SELECT
      origin_route,
      COUNT(*) AS total,
      SUM(CASE WHEN is_used = 0 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN is_used = 1 THEN 1 ELSE 0 END) AS used
    FROM invitation_codes
    GROUP BY origin_route
    ORDER BY origin_route ASC
  `).all();

  return rows.map((r) => {
    const total = Number(r.total) || 0;
    const used = Number(r.used) || 0;
    const active = Number(r.active) || 0;
    const rate = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
    return {
      origin_route: r.origin_route,
      total,
      active,
      used,
      consumption_rate: rate
    };
  });
}

function getAllInvitationCodes() {
  return db.prepare(`
    SELECT code, origin_route, is_used, used_at, issued_by_session_id
    FROM invitation_codes
    ORDER BY origin_route ASC, code ASC
  `).all().map((r) => ({
    code: r.code,
    origin_route: r.origin_route,
    is_used: !!r.is_used,
    used_at: r.used_at,
    issued_by_session_id: r.issued_by_session_id || null
  }));
}

function randomAlphaSuffix(minLen, maxLen) {
  const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  const bytes = crypto.randomBytes(len);
  let suffix = '';
  for (let i = 0; i < len; i += 1) {
    suffix += ALPHA[bytes[i] % ALPHA.length];
  }
  return suffix;
}

function generateUniqueChildCode(originRoute, attempt = 0) {
  if (attempt > 24) {
    throw new Error('Failed to generate unique invite code');
  }
  const code = `${originRoute}-${randomAlphaSuffix(4, 6)}`;
  if (!isAlphabetInviteCode(code)) {
    return generateUniqueChildCode(originRoute, attempt + 1);
  }
  const exists = db.prepare('SELECT 1 AS n FROM invitation_codes WHERE code = ? COLLATE NOCASE').get(code);
  if (exists) {
    return generateUniqueChildCode(originRoute, attempt + 1);
  }
  return code;
}

function issueChildCodes(sessionId, originRoute, count = CHILD_CODES_PER_SESSION) {
  const insert = db.prepare(`
    INSERT INTO invitation_codes (code, origin_route, is_used, used_at, issued_by_session_id)
    VALUES (?, ?, 0, NULL, ?)
  `);
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const code = generateUniqueChildCode(originRoute);
    insert.run(code, originRoute, sessionId);
    codes.push({
      code,
      origin_route: originRoute,
      is_used: false,
      used_at: null
    });
  }
  return codes;
}

function getChildCodesForSession(sessionId) {
  return db.prepare(`
    SELECT code, origin_route, is_used, used_at
    FROM invitation_codes
    WHERE issued_by_session_id = ?
    ORDER BY rowid ASC
  `).all(sessionId).map(formatCodeRow);
}

function getSessionByToken(token) {
  if (!token) return null;
  return db.prepare(
    'SELECT id, token, origin_route, invite_code, created_at FROM sessions WHERE token = ?'
  ).get(token);
}

function redeemInviteCode(code) {
  const normalized = normalizeCode(code);
  if (!isAlphabetInviteCode(normalized)) {
    return { ok: false, error: 'このコードは無効、または既に使用されています' };
  }

  const redeem = db.transaction((inviteCode) => {
    const row = db.prepare(
      'SELECT code, origin_route, is_used, is_reusable FROM invitation_codes WHERE code = ? COLLATE NOCASE'
    ).get(inviteCode);

    if (!row) {
      return null;
    }

    const isReusable = !!row.is_reusable;
    if (!isReusable && row.is_used) {
      return null;
    }

    const usedAt = nowIso();
    if (!isReusable) {
      const updated = db.prepare(
        'UPDATE invitation_codes SET is_used = 1, used_at = ? WHERE code = ? AND is_used = 0'
      ).run(usedAt, row.code);

      if (!updated.changes) {
        return null;
      }
    }

    const token = newToken();
    const sessionId = newId();
    db.prepare(`
      INSERT INTO sessions (id, token, origin_route, invite_code, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, token, row.origin_route, row.code, usedAt);

    const childCodes = issueChildCodes(sessionId, row.origin_route, CHILD_CODES_PER_SESSION);

    return {
      token,
      origin_route: row.origin_route,
      invite_code: row.code,
      child_codes: childCodes
    };
  });

  const result = redeem(normalized);
  if (!result) {
    return { ok: false, error: 'このコードは無効、または既に使用されています' };
  }

  return { ok: true, ...result };
}

function generateInviteCode(originRoute) {
  const route = String(originRoute || '')
    .trim()
    .toUpperCase()
    .replace(/[\s＿ー]+/g, '')
    .replace(/－/g, '-');

  if (!/^[A-Z]+(-[A-Z]+)*$/.test(route) || route.length < 2) {
    throw new Error('origin_route must be alphabet and hyphens only');
  }

  return generateUniqueChildCode(route);
}

function createMasterInviteCode(originRoute, customCode) {
  let code = customCode ? normalizeCode(customCode) : generateInviteCode(originRoute);
  if (!isAlphabetInviteCode(code)) {
    throw new Error('Invalid code format');
  }
  const route = originRoute
    ? normalizeCode(originRoute)
    : code.split('-').slice(0, -1).join('-') || code;

  db.prepare(`
    INSERT INTO invitation_codes (code, origin_route, is_used, used_at, issued_by_session_id)
    VALUES (?, ?, 0, NULL, NULL)
  `).run(code, route);

  return { code, origin_route: route };
}

function requireAdminStealth(req, res, next) {
  if (!isAdminAuthenticated(req)) {
    return sendNotFound(req, res);
  }
  next();
}

function requireSession(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || '');
  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  req.session = session;
  next();
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '16kb' }));

app.post('/api/invite/redeem', (req, res) => {
  const code = req.body && req.body.code;
  const result = redeemInviteCode(code);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

app.get('/api/invite/my-codes', requireSession, (req, res) => {
  let codes = getChildCodesForSession(req.session.id);
  if (codes.length === 0) {
    codes = issueChildCodes(req.session.id, req.session.origin_route, CHILD_CODES_PER_SESSION);
  }
  return res.json({ ok: true, codes });
});

app.get('/api/session/verify', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || '');
  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Invalid session' });
  }
  return res.json({
    ok: true,
    origin_route: session.origin_route,
    invite_code: session.invite_code,
    created_at: session.created_at
  });
});

/** Legacy admin endpoints — always 404 (existence hidden) */
app.all('/api/admin/*', (req, res) => sendNotFound(req, res));
app.all('/secret-inscape-dashboard-777', (req, res) => sendNotFound(req, res));
app.all('/secret-inscape-dashboard-777/*', (req, res) => sendNotFound(req, res));

/** Stealth admin dashboard */
app.get(ADMIN_ROUTE, (req, res) => {
  const queryKey = req.query.key;
  if (typeof queryKey === 'string' && queryKey.length > 0) {
    const a = Buffer.from(queryKey, 'utf8');
    const b = Buffer.from(ADMIN_SECRET_KEY, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      setAdminCookie(res);
      return res.redirect(302, ADMIN_ROUTE);
    }
    return sendNotFound(req, res);
  }

  if (isAdminAuthenticated(req)) {
    return res.sendFile(DASHBOARD_PAGE);
  }

  return sendNotFound(req, res);
});

app.get(`${ADMIN_ROUTE}/api/overview`, requireAdminStealth, (req, res) => {
  return res.json({ ok: true, routes: getOriginRouteStats() });
});

app.get(`${ADMIN_ROUTE}/api/codes`, requireAdminStealth, (req, res) => {
  return res.json({ ok: true, codes: getAllInvitationCodes() });
});

app.post(`${ADMIN_ROUTE}/api/codes`, requireAdminStealth, (req, res) => {
  try {
    const originRoute = req.body && req.body.origin_route;
    const customCode = req.body && req.body.code;
    if (!originRoute && !customCode) {
      return res.status(400).json({ ok: false, error: 'origin_route or code required' });
    }
    const created = createMasterInviteCode(originRoute, customCode);
    return res.json({ ok: true, ...created });
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Code already exists' });
    }
    return res.status(400).json({ ok: false, error: err.message || 'Failed to create code' });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith(ADMIN_ROUTE + '/') && req.path !== `${ADMIN_ROUTE}/api/overview` && req.path !== `${ADMIN_ROUTE}/api/codes`) {
    return sendNotFound(req, res);
  }
  next();
});

app.use(express.static(ROOT_DIR));

app.listen(PORT, HOST, () => {
  console.log(`INSCAPE server listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Stealth admin (set INSCAPE_ADMIN_SECRET_KEY): ${ADMIN_ROUTE}?key=***`);
});
