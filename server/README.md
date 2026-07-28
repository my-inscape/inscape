# INSCAPE Invite API

One-time alphabet invitation code redeem + anonymous session tokens.

**Important:** Diary text, colors, and artwork are never sent to this server.

## Setup

```bash
cd server
npm install
npm start
```

Server runs at `http://localhost:8787` and serves static files from the project root.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INSCAPE_ADMIN_ROUTE` | `/x9k2-pvw8-m4rt` | Stealth admin URL path |
| `INSCAPE_ADMIN_SECRET_KEY` | `YourSecretPass` | Query key for first access (`?key=...`) |
| `PORT` | `8787` | Server port |

## Stealth admin dashboard

Unauthorized access returns **404 Not Found** (page existence is hidden).

**First access (issues HttpOnly cookie, then redirects without key in URL):**

```
http://localhost:8787/x9k2-pvw8-m4rt?key=YourSecretPass
```

**Subsequent access (cookie only):**

```
http://localhost:8787/x9k2-pvw8-m4rt
```

Features:
- `origin_route` stats: active count, consumption rate
- Full `invitation_codes` table
- Manual master code issuance

Legacy route `/secret-inscape-dashboard-777` always returns 404.

## Public API

- `POST /api/invite/redeem`
- `GET /api/invite/my-codes` (Bearer session token)
- `GET /api/session/verify`

## Seed codes

| code | origin_route |
|------|--------------|
| `SILENT-XQZ` | `SILENT` |
| `VIP-ISC-LKNW` | `VIP-ISC` |
| `TEST-UNLIMITED` | `TEST` (無制限・テスト専用) |

One-time codes are consumed on first use. `TEST-UNLIMITED` has `is_reusable = 1` and never invalidates.

Do **not** open HTML via `file://` — use the server URL.
