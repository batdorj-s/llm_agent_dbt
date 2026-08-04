# Deployment & Operations Runbook

Production Readiness runbook for the AI Finance Q&A system (Шинжээч.ai).
Target: **single instance behind a TLS-terminating reverse proxy**, with Redis
for distributed rate limiting and scheduler safety.

## Topology

| Component | Address | Notes |
|-----------|---------|-------|
| UI (Next.js) | `:3000` | Served by the app; terminate TLS on the proxy |
| API (Express) | `:3001` | JWT auth; health probes on `/api/health`, `/api/status` (auth-free) |
| PostgreSQL | `127.0.0.1:5432` | `postgres:16-alpine`, Docker volume `postgres-data` |
| ChromaDB | `127.0.0.1:8000` | **Bound to loopback only** (not exposed to the network) |
| Redis | `127.0.0.1:6379` | Rate limiting (distributed) + scheduler safety |

## TLS (required for production)

The application itself serves plain HTTP. Put it behind **nginx** or **Caddy**
that terminates TLS. Do not expose port 3000/3001 directly to the internet.

### nginx + certbot (recommended)

```nginx
# /etc/nginx/sites-available/your-domain
server {
    listen 80;
    server_name your-domain.example;
    return 301 https://$host$request_uri;   # redirect HTTP -> HTTPS
}

server {
    listen 443 ssl http2;
    server_name your-domain.example;

    ssl_certificate     /etc/letsencrypt/live/your-domain.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.example/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # UI
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $request_id;
        proxy_read_timeout 75s;   # > the app's 60s request timeout
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.example
```

Verify TLS and that probes return 200 without a token:
```bash
curl -k https://your-domain.example/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://your-domain.example/api/health   # expect 200
```

### Caddy (simpler alternative)

```caddyfile
your-domain.example {
    reverse_proxy /api/* 127.0.0.1:3001
    reverse_proxy /*     127.0.0.1:3000
}
```

## Build & Deploy (current flow)

Push a tag (`v*`) → GitHub Actions (`deploy.yml`):
1. Builds `ghcr.io/<owner>/llm-agent-...-api` and `...-ui` images.
2. SSHes to the server: `git pull`, `docker compose pull`, `docker compose up -d`,
   runs db/rag bootstrap (`npx tsx src/db/pool.ts`, `npx tsx src/rag/knowledge-base.ts`).

### Zero-downtime / safe redeploy

For a single instance, minimize blast radius:

```bash
# Pin the exact previous image tag so you can roll back deterministically:
git log -1 --format='%h'                                # app rev deployed
docker compose images                                   # current image digests
docker tag ghcr.io/<owner>/llm-agent-api:latest ghcr.io/<owner>/llm-agent-api:<old-sha>

# Redeploy from a specific tag (instead of :latest drift):
docker compose up -d --no-deps --force-recreate api
```

Check health before/after:
```bash
curl -fsS http://localhost:3001/api/health   # expect "status":"ok"
docker compose ps                            # all healthy
```

### Rollback

1. Identify the previous good image: `docker images | grep llm-agent-api`.
2. Retag/point compose to it and `docker compose up -d --no-deps api`.
3. Verify `/api/health`; if the rollback target has no `scheduled_reports`
   schema drift, verify one scheduler run produces output under
   `generated_reports/`.

> `deploy.yml` currently does `git pull origin main` on the server, which can
> drift the compose file away from the tagged image. Prefer checking out a
> pinned tag (e.g. `git fetch && git checkout vX.Y.Z`) before `docker compose up`.

## Backups & Restore

Backup runs daily at 02:00 via `scripts/backup.sh` (custom-format `pg_dump`,
7-day retention, RPO = 24h).

```bash
# Install the cron job (edit crontab -e):
0 2 * * * /abs/path/llm_agent_mcp-main/scripts/backup.sh >> /var/log/llm-agent-backup.log 2>&1

# Run once to verify (and test cron's side):
./scripts/backup.sh
ls -la backups/
```

Verify backup integrity:
```bash
pg_restore --list backups/postgres_<stamp>.dump | head
```

### Restore (drill at least once before go-live)

```bash
# Stop writes, then restore over the target database:
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/postgres_<stamp>.dump

# Optional: restore into a scratch DB first to verify without touching prod:
createdb restore_check
pg_restore --no-owner -d restore_check backups/postgres_<stamp>.dump
```

### ChromaDB data

ChromaDB persists to the `chroma-data` Docker volume. Snapshot it when backing
up the vector store:

```bash
docker run --rm -v llm_agent_mcp-main_chroma-data:/data -v "$PWD/backups":/backup \
  alpine tar czf /backup/chroma_$(date +%Y%m%d).tar.gz -C /data .
# Rebuild alternative: npx tsx src/rag/knowledge-base.ts  (re-indexes from rag_documents)
```

## Health & Probes

- `/api/health` — PostgreSQL + ChromaDB + catalog counts + LLM provider + memory.
  **Auth-free** (exempt in `requireAuth`), usable by Docker/LB healthchecks.
- Docker installs healthchecks for `api`, `ui`, `postgres`, `chromadb`, `redis`.

```bash
curl -fsS http://localhost:3001/api/health
```

## Security checklist (must hold in production)

- [ ] TLS enabled at the proxy; ports 3000/3001 not exposed to the internet
- [ ] `ALLOW_DEV_AUTH=false` (or unset) — `.env` sets it false; dev bypass never
      grants admin in `NODE_ENV=production`
- [ ] ChromaDB bound to `127.0.0.1:8000` only
- [ ] Redis bound to `127.0.0.1:6379` only
- [ ] JWT: `JWT_SECRET` set (a 32+ char random value), `JWT_EXPIRES_IN` set
- [ ] LLM API keys in env / GitHub Secrets, never committed
- [ ] `CORS_ORIGIN` set to your production UI origin
- [ ] Rate limiting uses Redis (`REDIS_URL=redis://redis:6379` in compose) so
      limits survive restarts
- [ ] Daily DB backup cron + at least one restore drill performed

## Known limitations (accepted for single-instance launch)

- LangGraph conversation state lives in-memory (`MemorySaver`) — thread history
  is lost on restart. Move to a Postgres/Redis checkpointer before scaling out.
- `node-cron` runs in-process; a second app instance would duplicate scheduled
  reports without the claim lock already added (claims are now atomic via
  `FOR UPDATE SKIP LOCKED`).
- No APM / error tracker (Sentry). Add before a public multi-tenant launch.