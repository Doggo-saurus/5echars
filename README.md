# Action Surge (Vanilla SPA)

Single-page character builder with curated source catalogs and modal-based advanced pickers.

## Data dependency (no submodule)

This project vendors source data into `data/` using a pinned clone workflow.

Run the vendor script:

```bash
bash ./scripts/vendor-catalog-data.sh <repo-url>
```

By default, the import is filtered to SRD-tagged content only.

Optionally pin to a tag/branch:

```bash
bash ./scripts/vendor-catalog-data.sh <repo-url> v2.25.4
```

To import the full dataset (no SRD filter), pass the explicit legal opt-in flag:

```bash
bash ./scripts/vendor-catalog-data.sh <repo-url> v2.25.4 --i-am-legally-allowed-to-use-everything
```

## Run locally (Node service)

This project now runs as a Node web service that serves the frontend and `/api` routes.

```bash
cd server
npm install
npm start
```

Then open:

[http://localhost:3000](http://localhost:3000)

### Redis toggle (optional for now)

- `REDIS_ENABLED=false` (default) uses in-memory storage
- `REDIS_ENABLED=true` enables Redis
- Use either `REDIS_URL` or `REDIS_HOST` + `REDIS_PORT`

Example:

```bash
REDIS_ENABLED=true REDIS_URL=redis://127.0.0.1:6379 npm start
```

## Included workflow

- Source preset selection (`core`, `expanded`)
- Basics (name, level, notes)
- Ancestry/background selection
- Class/subclass + multiclass modal
- Ability score editing with derived stats
- Equipment modal picker
- Spell modal picker
- Review/import/export JSON
- UUID permalink workflow for permanent character links
- Onboarding home screen when no `?char=<uuid>` is present

## Deployment notes

- Serve only `public/` as the browser-facing app shell.
- Run the Node service from `server/` on Render.
- If frontend and API are split across services, set `window.__CHAR_API_BASE__` in `public/index.html` to your API origin.

## Self-hosting with Docker (free DNS + certs + Redis)

This repo now includes a hardened `docker-compose.yml` stack for your own hardware:

- `duckdns` keeps a free DuckDNS hostname updated to your public IP
- `caddy` serves traffic over HTTPS with automatic Let's Encrypt certificates
- `app` runs the Node server via `npm start` behind Caddy
- `redis` runs with append-only persistence and password authentication

### 1) Configure environment secrets

```bash
cp .env.example .env
```

Update `.env` with real values:

- `DUCKDNS_SUBDOMAIN` and `DUCKDNS_TOKEN`
- `DOMAIN` (for example `mybuilder.duckdns.org`)
- `ACME_EMAIL`
- `REDIS_PASSWORD` (use a strong random value)
- `MANUAL_BASE_URL` (manual link host to your favourite 5e tools)

### 2) Router + firewall

- Forward TCP `80` and `443` from your router to the Docker host
- Allow inbound `80/443` on your host firewall
- Keep Redis private (do not publish `6379` externally)

### 3) Launch

```bash
docker compose up -d
docker compose ps
```

Optional log checks:

```bash
docker compose logs caddy --tail=100
docker compose logs redis --tail=100
```

### Security defaults included

- Least privilege container settings (`no-new-privileges`, dropped capabilities)
- Redis isolated on an internal Docker network
- App is not published directly; only Caddy exposes `80/443`
- Secure HTTP response headers via Caddy
- Automatic certificate renewal handled by Caddy
- If Redis is unavailable, the API now falls back to in-memory mode so the app still boots

### Persistence behavior

- The UI shows a light warning when server persistence is not durable
- Browser state remains available via local storage when server sync is temporarily unavailable
- Character sync metadata uses version + timestamp so the app can pick the newest copy when local and server state differ

## Notes

- The app loads data from the configured root in `src/data-loader.js`.
- If data is unavailable, it falls back to a minimal sample catalog.
