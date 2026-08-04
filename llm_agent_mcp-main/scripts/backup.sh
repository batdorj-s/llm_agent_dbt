#!/usr/bin/env bash
# scripts/backup.sh — Daily PostgreSQL backup with N-day retention (RPO = 24h).
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/db ./scripts/backup.sh
#   ./scripts/backup.sh                                   # reads DATABASE_URL from .env
#
# Cron (daily 02:00):
#   0 2 * * * /abs/path/llm_agent_mcp-main/scripts/backup.sh >> /var/log/llm-agent-backup.log 2>&1
#
# Restore (see docs/DEPLOYMENT.md):
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/postgres_<stamp>.dump

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"

# Resolve DATABASE_URL from env, else from repo .env (comment/quote/space stripped).
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f "${REPO_ROOT}/.env" ]]; then
    RAW="$(grep -E '^DATABASE_URL=' "${REPO_ROOT}/.env" | head -n 1 | cut -d '=' -f2-)"
    RAW="${RAW%%#*}"
    DATABASE_URL="$(printf '%s' "${RAW}" | tr -d '"' | xargs)"
  else
    echo "ERROR: DATABASE_URL is not set and no .env found in ${REPO_ROOT}" >&2
    exit 1
  fi
fi

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="${BACKUP_DIR}/postgres_${STAMP}.dump"

# Remove the partial file if the dump fails, so a corrupt backup is never kept.
trap 'rm -f "${FILE}"' ERR

run_pg_dump() {
  pg_dump --format=custom --no-owner --no-privileges "${DATABASE_URL}"
}

echo "[backup] pg_dump -> ${FILE}"
if command -v pg_dump >/dev/null 2>&1; then
  run_pg_dump > "${FILE}"
else
  # No local pg client: stream pg_dump from the postgres container (127.0.0.1
  # inside that container resolves to postgres itself).
  PG_CONTAINER="$(docker ps --filter "name=postgres" --format "{{.Names}}" 2>/dev/null | head -n 1)"
  if [[ -n "${PG_CONTAINER}" ]] && command -v docker >/dev/null 2>&1; then
    echo "[backup] pg_dump not on PATH — using docker container: ${PG_CONTAINER}"
    docker exec "${PG_CONTAINER}" pg_dump --format=custom --no-owner --no-privileges "${DATABASE_URL}" > "${FILE}"
  else
    echo "ERROR: pg_dump not found on PATH and no postgres container available" >&2
    exit 1
  fi
fi

SIZE="$(du -h "${FILE}" | cut -f1)"
echo "[backup] completed ${FILE} (${SIZE})"

# Retention: drop backups older than KEEP_DAYS.
OLD="$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'postgres_*.dump' -mtime "+$((KEEP_DAYS - 1))" -print)"
if [[ -n "${OLD}" ]]; then
  echo "[backup] pruning backups older than ${KEEP_DAYS} days:"
  echo "${OLD}" | sed 's/^/  /'
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'postgres_*.dump' -mtime "+$((KEEP_DAYS - 1))" -delete
fi

echo "[backup] done — latest: ${FILE}"