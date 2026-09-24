# llm_agent_dbt — AI Finance Data Platform

Монгол хэлний UI-тай, **санхүү/борлуулалтын өгөгдөлд LLM-д суурилсан шинжилгээ** хийдэг AI платформ.

Төсөл нь гурван бүрэлдэхүүнээс тогтоно:

| Бүрэлдэхүүн | Үүрэг | Технологи | Git state |
|---|---|---|---|
| [`llm_agent_mcp-main/`](llm_agent_mcp-main/README.md) | **Гол систем** — multi-agent Q&A, RAG, SQL/Python шинжилгээ, dbt pipeline, Dashboard/Report/Admin UI | TypeScript, LangGraph, Next.js 16, PostgreSQL, ChromaDB, Redis | Гол репо |
| [`noat-tulgalt/`](noat-tulgalt/) | **НӨАТ тулгалтын систем** — татварын/банкны файлыг 6 шаттай алгоритмаар тааруулж тайлан гаргах | Python/FastAPI, pandas, React/Vite, Groq AI | **Тусдаа git repo** (nested) |
| [`dbt_project/`](dbt_project/) | dbt starter проект — суурь/лавлах жишээ (тодорхой model байхгүй) | dbt | Гол репо |

---

## Гол чадварууд (Main capabilities)

### `llm_agent_mcp-main`
- **Multi-agent Q&A (Chat)** — LangGraph `StateGraph` дээрх Supervisor + 4 агент:
  **FinanceAgent** (RAG + амьд KPI), **TechAgent** (SQL + Python), **DataScientistAgent** (forecast/regression/clustering), **END** (greeting).
- **4 талын LLM failover** — `groq → gemini → anthropic → openai`. Rate-limit / quota алдаа гарвал автоматаар дараагийн provider руу шилждэг (`invokeWithFallback`).
- **RAG семантик хайлт** — ChromaDB vector store + BM25 + recency score `hybrid-search`-аар нэгтгэгдэнэ; self-query transform + 60s cache. Chroma хүртээмжгүй бол in-memory fallback.
- **Детерминист SQL generation pipeline** — `schema context → deterministic SQL → LLM retry (MAX 2) → fallback query`; үр дүнд median/IQR/3σ статистик, `<visual>` Recharts tag.
- **Python sandbox** — E2B MicroVM эсвэл local `python3` subprocess (pandas/matplotlib/scikit-learn).
- **Dashboard/Тайлан** — KPI cards, computed metrics (AOV, growth rate, top category), PDF/XLSX экспорт, `<dashboard>` widget.
- **dbt pipeline** — Medallion (staging→intermediate→marts) загварчлал; `run_results/manifest`-аас RAG баримт автомат үүсгэх (`dbt-sync`).
- **MCP server** — stdio дээр `get_kpi`, `get_sales_history`, `get_data_lake_catalog`, `execute_sql`.
- **Auth & Admin** — JWT (HS256) + RBAC (viewer/analyst/admin), Redis sliding-window rate-limit, audit logging, KPI target, alerts, scheduler, notifications, sharing, feedback.
- **Observability** — Langfuse tracing (multi-agent + tool calls), Sentry.

### `noat-tulgalt`
- **НӨАТ тулгалт** — ДДТД-бараа материал / банкны экспортыг **6 шаттай** тааруулагчаар reconcile: ДДТД exact → registry+date+amount → ±5₮/±1 өдөр tolerance → 1:N aggregate → AI fuzzy (RapidFuzz ≥0.85) → classification + balance gate.
- **AI explain** — Groq (`llama-3.3-70b-versatile`) тайлбар, auto-tag, risk score; API key байхгүй/алдаатай үед rule-based fallback.
- **Экспорт** — өнгө-кодтой openpyxl тайлан + консолидэйтд хуудас.

### `finance-mapper` (llm_agent_mcp-main дотор)
- Хэдэн ч санамсаргүй CSV/Excel санхүүгийн файлын баганыг зорилтот Монгол схемд (`Өдөр, Харилцагч, Дүн, Ангилал, Дэд ангилал, Тайлбар`) маппинг хийж `sar_N.xlsx` гаргадаг; API болон standalone CLI хоёулаа.

---

## Архитектур

```
┌─────────────────────────── UI (Next.js 16) :3000 ────────────────────────────┐
│ Ask | Dashboard | Report | Noat | Glossary | Quality | Lineage | Publisher  │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ /api proxy
┌──────────────▼──────────────── Express API :3001 ────────────────────────────┐
│ helmet · cors · json 5mb · request-timeout                                   │
│ JWT auth (requireAuth) → RBAC → Redis rate-limit → audit (writes)            │
│ 29 REST routers · Swagger /api-docs                                          │
└──────┬───────────────────────────────────────────────────────┬───────────────┘
       │ POST /api/chat , /api/chat/stream (SSE)               │ /api/noat/*
       ▼                                                        ▼
┌─── LangGraph Multi-Agent ────┐                    ┌─── Python FastAPI :8000 ──┐
│ Supervisor ─────────────► END │                    │ preview / reconcile /     │
│   ├─► FinanceAgent (RAG+KPI) │                    │ status / result / export  │
│   └─► TechAgent (SQL+Py)     │                    │ ai/explain                │
│   └─► DataScientistAgent     │                    └───────────────────────────┘
└───┬──────────┬──────────┬────┘
    ▼          ▼          ▼
  RAG        Data Lake   Sandbox          LLM Failover
  ChromaDB   PostgreSQL  E2B / python3    groq→gemini→
  + BM25     Supabase    (pandas, mpl,    anthropic→openai
  + self-    SQLite      sklearn)
  query      (fallback)
```

### Port хүснэгт

| Port | Service | Тайлбар |
|---|---|---|
| 3000 | Next.js UI | `npm run ui:dev` |
| 3001 | Express API | `npm run api` |
| 8000 | Python FastAPI (noat-tulgalt) | `/api/noat/*` проксигаар хүрдэг |
| 8001 | ChromaDB (docker host) | контейнер дотор 8000 |
| 5432 | PostgreSQL (docker) | локал SQLite fallback боломжтой |
| 6379 | Redis | distributed rate-limit + scheduler lock |

---

## Бүрэлдэхүүн тус бүр

### 1. `llm_agent_mcp-main/` — гол систем

#### Backend (`src/`)

```
src/
├── multi-agent.ts        LangGraph compile, Postgres/Memory checkpointer, runMultiAgent*
├── api-server.ts         Express app — 29 router mount, Swagger, error handler
├── index.ts              MCP stdio server (get_kpi, get_sales_history, get_catalog, execute_sql)
├── auth.ts               JWT (HS256, timing-safe), scrypt password, RBAC roleAtLeast
├── llm-provider.ts       4-provider failover + invokeWithFallback (429→next)
├── rate-limiter.ts       sliding-window (agent 20/60s, auth 10/60s, sandbox 5/60s)
├── agents/               22 файл — supervisor, finance, tech, data-scientist,
│                         sqlGeneration, pythonExecution, dashboardBuilder,
│                         reportExport, sanitize, columnSynonyms, dateColumnHelper г.м.
├── db/                   data-lake (read-only tx), kpi-repository (factory:
│                         Marts/Supabase/SQLite), ingestion, catalog, pool (SSL)
├── routes/               29 router — chat, auth, kpi, finance, dashboard, report,
│                         admin-*(users/documents/summary/analytics/analysis/api-keys),
│                         audit, alerts, whatif, conversations, feedback, export,
│                         metrics, glossary, data-quality, lineage, scheduler,
│                         sharing, unified-search, notification, history, finance-mapper
├── rag/                  chroma-client, hybrid-search (Chroma+BM25+recency),
│                         semantic-search (gemini-embedding-001), knowledge-base
├── services/             alerts, conversation, notifications, scheduler, sql
├── middleware/           rbac, audit
├── observability/        tracer (Langfuse), sentry
├── tools/                enterprise-tools (executeSql, buildFinanceKpiContext)
└── tests/                80 test файл (vitest, forks pool, env NODE_ENV=test)
```

#### dbt pipeline (`dbt/`)

```
superstore_sales ──> stg_sales ──> int_sales_enriched ──┐
                                                         ├──> kpi_sales, user_metrics (marts)
finance_combined ──> stg_transactions ──> int_transactions_classified
                                         (Орлого/Зарлага/Шилжүүлэг/Зээл) ──> finance_summary,
                                         finance_by_party
```

- Adapter: `postgres` (profile: `datalake_transformations`, `DBT_PASSWORD` env); CI-д `dbt-sqlite` ашиглана.
- `profiles.yml` нь gitignore'd — коммитлохгүй (DB password агуулна).

#### Frontend (`ui/`, Next.js 16)

- **Анхаар:** Next.js 16 — training data-гаас өөр breaking changes; `ui/AGENTS.md`-ыг уншина уу.
- Гол SPA (`ui/src/app/page.tsx`) — 10 tab (ask/dashboard/report/noat/glossary/quality/lineage/scheduler/sharing/history), keyboard shortcuts (Ctrl+Shift+E export, Ctrl+F chat search, Esc close), сүүлийн conversation auto-restore.
- **Admin CMS** — Refine (`@refinedev/core`) 12 page; `AdminRefineProvider` → `/api/admin/*`; accessControl зөвхөн `admin`.
- 7 hook: `useChat` (SSE + agent metadata), `useAuth`, `useAdmin`, `useDashboard`, `useConversation`, `usePreview`, `useTheme`.
- `NoatTab` — NӨАТ урсгалыг `preview → reconcile → poll → result` хэлбэрээр интеграциялсан (`/api/noat/*` → FastAPI :8000).
- E2E: Playwright (auth, admin, rbac, security, anonymous, llm).

### 2. `noat-tulgalt/` — НӨАТ тулгалтын систем

> Тусдаа git repo — тусдаа development түүхтэй. Гол системээсээ `/api/noat/*` проксигаар холбогдоно.

#### Backend (`backend/`, FastAPI)

| Endpoint | Үүрэг |
|---|---|
| `POST /api/v1/preview` | Файл шалгаж, баганын таамаглал (50MB / 150k row хязгаар) |
| `POST /api/v1/reconcile` | Background job (thread) эхлүүлнэ |
| `GET /api/v1/status/{job_id}` | Ажлын төлөв |
| `GET /api/v1/result/{job_id}` | Үр дүн |
| `POST /api/v1/export` | `tulgalt_{jobId}.xlsx` тайлан |
| `POST /api/v1/ai/explain` | Мөрийн тайлбар (Groq) |
| `GET /health` | Health check |

- `engine/`: `cleaner` (column aliasing `config/column_aliases.json`, registry/дата/дүн нормализаци), `matcher` (6-шаттай), `aggregator` (monthly/customer/VAT), `exporter` (openpyxl).
- `ai/`: Groq explainer, RapidFuzz fuzzy match (≥0.85), auto_tag, risk_scorer; key/алдаа байхгүй үед rule-based.
- Env: `GROQ_API_KEY`, `GROQ_MODEL` (хоосон байвал rule-based горим).

#### Frontend (`frontend/`, React 18 + Vite 6 + Tailwind 4)

- `UploadPage`, `ResultsPage`, 13 `ui/` primitive, results компонентууд (SummarySection, BalancePanel, VatReturnCard, RiskPanel, MonthlyChart, CustomerTable, ItemsTable), `useJobPolling`, `useTheme`.
- Dev proxy: `/api`, `/health` → `127.0.0.1:8000`.

### 3. `dbt_project/` — starter

- Суурь dbt starter (example model 2 ширхэг). Гол pipeline `llm_agent_mcp-main/dbt/`-д байна. Холбоослолт/ашиглалтыг `llm_agent_mcp-main/DBT_GUIDE.md`-с үзнэ.

---

## Шаардлага (Prerequisites)

1. **Node.js v18+** (CI нь 22 ашигладаг) + npm
2. **Python 3** — local sandbox fallback болон noat backend-д
3. **Docker Desktop** — PostgreSQL + ChromaDB + Redis локал ажиллуулахад (заавал биш — SQLite + in-memory RAG mode ашиглаж болно)
4. Дор хаяж **нэг LLM API key** (groq/gemini/anthropic/openai)

---

## Суулгах

```bash
# Гол систем
cd llm_agent_mcp-main
cp .env.example .env       # API key-уудаа бөглөнө
npm install --legacy-peer-deps
cd ui && npm install --legacy-peer-deps && cd ..

# (Заавал биш) noat-tulgalt
cd noat-tulgalt/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # эсвэл .venv нь аль хэдийн бэлэн
cd ../frontend && npm install
```

---

## Ажиллуулах

```bash
# Гол систем (UI :3000 + API :3001) — setup (seed/initDataLake) автоматаар
cd llm_agent_mcp-main
npm run dev

# Тусд нь
npm run api        # зөвхөн API
npm run ui:dev     # зөвхөн UI

# Docker инфраструктур (Postgres + ChromaDB + Redis)
npm run docker:up           # == docker-compose up -d

# dbt
npm run dbt:run             # dbt run
npm run dbt:test            # dbt test

# noat-tulgalt (тусдаа)
uvicorn main:app --reload --port 8000        # backend
npm run dev                                    # frontend (Vite)
```

---

## Тест

```bash
cd llm_agent_mcp-main

npm test                  # vitest — src/tests/** (80 файл)
npm run typecheck         # tsc --noEmit
npm run lint              # eslint "src/**/*.ts" (max-warnings=450)
npm run test:ci           # unit-only (integration/stress исключено) — CI-д ашиглана

# Coverage thresholds (vitest.config.ts): statements 60 / branches 50 / functions 60 / lines 60
npm run test:coverage

# UI
cd ui
npm test                  # vitest
npm run lint -- --max-warnings=200
npm run e2e               # Playwright (auth, admin, rbac, security, anonymous, llm)
cd ..

# noat-tulgalt (backend)
cd noat-tulgalt/backend
python -m pytest          # tests/ — GROQ_API_KEY-г хүчээр хоосон болгож, AI-г mock хийдэг

# dbt
cd llm_agent_mcp-main/dbt
dbt deps --profiles-dir .
dbt build --profiles-dir .
```

**Тайлбар:** Локальд langchain core major version-ууд холилдсон тул `npm ci --legacy-peer-deps` шаардлагатай (CI-д TODO тэмдэглэсэн).

---

## Environment variables (гол системийн `.env`)

| Хувьсагч | Үүрэг | Заавал |
|---|---|---|
| `GROQ_API_KEY` | Groq LLM (Llama 3.3 70B) | Тийм (дор хаяж нэг LLM key) |
| `GOOGLE_API_KEY` | Gemini failover/embedding | Сонголт |
| `ANTHROPIC_API_KEY` | Claude failover | Сонголт |
| `OPENAI_API_KEY` | OpenAI failover | Сонголт |
| `E2B_API_KEY` | Python sandbox (байхгүй бол local python3) | Сонголт |
| `DATABASE_URL` | PostgreSQL Data Lake (байхгүй бол SQLite) | Сонголт |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Production Supabase KPI | Сонголт |
| `CHROMA_URL` | ChromaDB (байхгүй бол in-memory RAG) | Сонголт |
| `REDIS_URL` | Distributed rate-limit + scheduler lock | Сонголт (локал default) |
| `JWT_SECRET` | Token гарын үсэг (**production-д заавал**, байхгүй бол exit) | Production |
| `JWT_EXPIRES_IN` | Жишээ: `1h`, `2d` | Default `1h` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin хэрэглэгч seed | Тийм |
| `DBT_PASSWORD` | dbt `profiles.yml`-ийн DB password | dbt-д |
| `DBT_PATH` | dbt binary path | Сонголт |
| `ALLOW_DEV_AUTH` | `true` бол dev-д unauthenticated requests → default admin | **Зөвхөн dev** |
| `MCP_USER_ID` | MCP stdio server-ийн identity (1 process = 1 user) | Default `system` |
| `API_PORT` | API port | Default 3001 |
| `LANGFUSE_*` | Langfuse tracing (secret/public/host) | Сонголт |

noat-tulgalt: `GROQ_API_KEY`, `GROQ_MODEL` (`backend/.env`).

---

## Deploy ба CI

- **Workflows** (`.github/workflows/`):
  - `ci.yml` — backend (typecheck + lint + unit tests, Postgres service) × frontend (lint + test + build)
  - `dbt_ci.yml` — dbt-sqlite, `DBT_PROFILES_YML` secret-аар `dbt build` + `source freshness`
  - `deploy.yml` — `v*` tag дээр GHCR-д API/UI image build+push, SSH-ээр `docker compose pull && up`
- **Docker compose** (`docker-compose.yml`): postgres:16, chromadb, redis:7, api (`NODE_ENV=production`), ui. API healthcheck `GET /api/health`.
- **TLS/Operations**: `llm_agent_mcp-main/docs/DEPLOYMENT.md` — nginx/caddy TLS-terminating reverse proxy, ChromaDB зөвхөн loopback.

---

## Аюулгүй байдал

- **JWT**: `production`-д `JWT_SECRET` байхгүй бол hard-fail (`process.exit(1)`); timing-safe signature compare; token-ийг `base64url`, password-ийг `scrypt (salt:hash)`.
- **SQL**: Бүх SELECT `SERIALIZABLE READ ONLY` transaction-д ороосон; параметржүүлсэн query.
- **RBAC**: `viewer / analyst / admin` — зөвшөөрөл каждый route-д; admin CMS зөвхөн `admin`.
- **Rate-limits**: agent 20/60s, auth 10/60s, sandbox 5/60s (Redis sliding-window).
- **SSRF guard**: notification webhook-д (private IP хаалт) — commit 2535d52.
- **Audit log**: POST/PUT/PATCH/DELETE-г бүртгэнэ (`/api/admin/audit`).
- **Prompt injection**: `sanitize.ts` код/судалгааны гаралтыг цэвэрлэнэ.
- **MCP**: stdio transport (1 process = 1 user); SSE/WebSocket нэмэхэд per-request auth заавал.

---

## Чухал тэмдэглэл / Тодорхой асуудлууд

- `superstore_sales.date` багана нь **INTEGER (Excel serial, e.g. 43537)** — `'1899-12-30'::date + "date"::integer`-ээр хөрвүүлэх.
- **Cyrillic `\b` word-boundary ажилладаггүй** — Монгол сигналд `.includes()` ашиглана; `LOWER()` Cyrillic-ийг fold хийдэггүй тул `%Орлого%/%орлого%` гэх мэт.
- **Groq free tier: 100K tokens/day** — 4-provider failover chain үргэлж дараалалтай.
- RAG-ийн `Mode=ChromaDB` лог харагдахгүй бол Chroma хүртээмжгүй → in-memory fallback. `NODE_ENV=test`-д Chroma зориуд skip (production баталгаа болохгүй).
- **НӨАТ тааруулалт**: `Нийт дүн/amount`-оор тааруулна (НӨАТ-оор биш); registry-г string-ээр тааруулна (leading-zero алдахаас сэргийлнэ). `НӨАТ_тулгалтын_заавар.docx`-ыг үзнэ.
- **Known bug (main)**: `src/tools/enterprise-tools.ts:93` — `ийт_гүйлгээ` гэж буруу (эхний "н" дутуу) → засах, regression test нэмэх.
- **Known dead code (noat)**: `backend/engine/matcher.py` Step 4 нь `ai.smart_matcher`-ыг импортлож байгаа боловч файл байхгүй → AI fuzzy шат хэзээ ч ажиллахгүй (try/except-д шингэсэн).

---

## Баримт бичгийн индекс

| Баримт | Агуулга |
|---|---|
| `llm_agent_mcp-main/README.md` | Гол системийн ажиллуулах гарын авлага, ChromaDB verification |
| `llm_agent_mcp-main/TEHNIK-BARIMT.md` | Техникийн дэлгэрэнгүй баримт бичиг (модуль, endpoint, асуудлууд) |
| `llm_agent_mcp-main/DBT_GUIDE.md` | dbt заавар |
| `llm_agent_mcp-main/docs/DEPLOYMENT.md` | Deploy/operations runbook (TLS, nginx) |
| `noat-tulgalt/НӨАТ_idea_v2.docx` | НӨАТ системийн техникийн spec (v2) |
| `noat-tulgalt/НӨАТ_тулгалтын_заавар.docx` | Бодит файлд суурилсан тулгалтын заавар |