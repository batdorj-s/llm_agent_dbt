# Enterprise AI Orchestrator — Ажиллуулах гарын авлага (Developer Manual)

Энэхүү төсөл нь **LangGraph Multi-Agent System** (Ухаалаг чиглүүлэгч + 4 агент), **PostgreSQL Data Lake**, **E2B/Local Python Sandbox**, **ChromaDB RAG**, болон **Next.js Dashboard UI**-г нэгтгэсэн AI өгөгдөлд шинжилгээ хийх платформ юм. Монгол хэлний UI, 4 үйлчилгээ үзүүлэгчийн failover chain (groq→gemini→anthropic→openai), Langfuse tracing зэрэг production-ready боломжуудтай.

---

## Architecture (Системийн бүтэц)

### 1. Multi-Agent Orchestration

```mermaid
graph TD
  subgraph UI[Client Layer]
    Browser(Browser) -->|"serves React app, mounts dashboard"| NextUI[Next.js UI<br/>port 3000]
  end

  subgraph API[API Gateway :3001]
    NextUI -->|"/api proxy rewrite to NEXT_PUBLIC_API_URL"| Api[Express API Server<br/>helmet + cors + json 5mb]
    Api -->|"passes request"| Jwt[Auth Middleware<br/>requireAuth / requirePermission]
    Jwt -->|"verifyToken() — JWT, hard-fail in prod"| AuthSvc[JWT Auth<br/>src/auth.ts]
    Jwt -->|"role + permission gate (RBAC)"| Rbac[RBAC Middleware<br/>src/middleware/rbac.ts]
    Jwt -->|"agentLimiter.check(userId) → 429"| RateLim[Rate Limiter<br/>src/rate-limiter.ts]
    Jwt -->|"routes dispatch"| Routers[REST Routers<br/>chat · auth · admin/upload · kpi · finance<br/>dashboard · alerts · whatif · conversations<br/>glossary · data-quality · lineage · scheduler<br/>sharing · unified-search · notifications<br/>history · feedback · metrics · api-keys]
    Api -->|"serves spec"| Swagger[/api-docs<br/>Swagger UI/]
  end

  subgraph ORCH[Multi-Agent Orchestration — LangGraph StateGraph]
    Routers -->|"POST /api/chat · POST /api/chat/stream (SSE)"| MultiAgent[runMultiAgent / runMultiAgentStream<br/>src/multi-agent.ts + MemorySaver checkpointer]
    MultiAgent -->|"invoke graph (thread_id)"| Supervisor[Supervisor Node<br/>keyword routing → LLM RouteSchema → keyword fallback]
    Supervisor -->|"FinanceAgent"| Finance[FinanceAgent<br/>RAG + live KPI context]
    Supervisor -->|"TechAgent"| Tech[TechAgent<br/>SQL gen → exec → explain]
    Supervisor -->|"DataScientistAgent"| DS[DataScientistAgent<br/>forecast / regression / clustering]
    Supervisor -->|"END (greeting)"| End(END)
    Finance -->|"fallthrough on failure"| Tech
    Tech -->|"finish"| End
    DS -->|"finish"| End
  end

  subgraph RAG[Retrieval Layer]
    Finance -->|"searchKnowledgeBase / selfQueryTransform"| Hybrid[Hybrid Search<br/>self-query + query expansion + cache]
    Hybrid -->|"ChromaDB query (nResults, where filter)"| ChromaClient[Chroma Client<br/>getChromaCollection singleton]
    Hybrid -->|"run internal fusion: Chroma + BM25 + recency scoring"| Hybrid
    Hybrid -->|"BM25 index over docs"| Semantic[Semantic Search<br/>gemini-embedding-001 · cosine · BATCH_SIZE 50]
    Semantic -->|"embedDocuments / embedQuery"| GeminiEF{{Gemini Embeddings API}}
    ChromaClient -->|"add/query vectors + documents"| Chroma[(ChromaDB<br/>enterprise-kb)]
    ChromaClient -->|"null → in-memory fallback (NODE_ENV=test / unreachable)"| Semantic
    Knowledge[Knowledge Base<br/>setupKnowledgeBase · chunking] -->|"persist/load docs"| RagDocs[(PostgreSQL<br/>rag_documents)]
    Knowledge -->|"index when count=0"| ChromaClient
    DbtSync[DBT-Sync<br/>src/dbt-sync.ts] -->|"manifest + run_results → quality RAG docs"| RagDocs
  end

  subgraph AGENTS[Agent Tool Layer]
    Finance -->|"buildFinanceKpiContext (live data)"| KpiRepo[KPI Repository<br/>Supabase / SQLite factory]
    Tech -->|"deterministic SQL → LLM retry (MAX 2) → fallback query"| SqlGen[SQL Generation<br/>src/agents/sqlGeneration.ts]
    SqlGen -->|"executeSql (read-only tx)"| DataLake[(PostgreSQL Data Lake<br/>catalog + marts · read-only)]
    Tech -->|"runPythonCode"| Sandbox[Python Sandbox<br/>E2B / local python3]
    DS -->|"forecast SQL via executeSql"| DataLake
    DS -->|"stats/ML Python"| Sandbox
    Tech -->|"dashboardBuilder → widget SQL"| DataLake
  end

  subgraph DBT[dbt Pipeline]
    DataLake -->|"superstore_sales · stg · int · marts"| DbtRun[dbt run + test<br/>npm run dbt:run / dbt:test]
    DbtRun -->|"writes run_results.json + manifest.json"| DbtTarget[dbt target/]
    DbtTarget -->|"read on boot"| DbtSync
    DbtSync -->|"runs internal pass: failed/skipped test summary"| DbtSync
  end

  subgraph LLM[LLM Provider Failover]
    Supervisor -->|"invokeWithFallback (structured output)"| Llm[LLM Router<br/>groq → gemini → anthropic → openai]
    Finance -->|"invokeWithFallback"| Llm
    Tech -->|"invokeWithFallback"| Llm
    Llm -->|"429 / quota → next provider"| Groq{{Groq API}}
    Llm -->|"failover"| Gemini{{Gemini API}}
    Llm -->|"failover"| Claude{{Anthropic API}}
    Llm -->|"failover"| OpenAi{{OpenAI API}}
  end

  subgraph SERVICES[Support Services]
    Scheduler[Scheduler Service<br/>report generation · cron] -->|"triggers"| Tech
    Notif[Notifications Service<br/>src/services/notifications.ts] -->|"events"| NextUI
    AlertSvc[Alerts Service<br/>src/services/alerts.ts] -->|"polls data quality"| DataLake
    ConvSvc[Conversation Service<br/>src/services/conversation.ts] -->|"persist messages/titles"| RagDocs
    Export[Export Service<br/>PDF/XLSX via reportExport] -->|"dashboard router"| NextUI
  end

  subgraph OBS[Observability]
    Tracer[Langfuse Tracer<br/>src/observability/tracer.ts] -.->|"CallbackHandler + traceToolCall"| MultiAgent
    Tracer -.->|"tool traces"| SqlGen
    Tracer -.->|"tool traces"| Sandbox
  end

  Admin[Admin Upload<br/>CSV/Excel/DOC] -->|"POST /api/admin/upload-*"| Routers
  Routers -->|"ingest → data_lake_catalog"| DataLake
  Routers -->|"DOC → RAG documents"| RagDocs
```

### 2. Module hierarchy (файлын бүтэц)

```
src/
  multi-agent.ts              ← 98 lines — Graph.compile + runMultiAgent*
  agents/
    agentState.ts             ← 78 lines — AgentState type, trimMessages, withTimeout
    prompts.ts                ← 5 lines — YAML loader (src/prompts.yaml)
    supervisorNode.ts         ← 182 lines — keyword routing + hasSignal() + RouteSchema
    financeAgentNode.ts       ← 128 lines — RAG + KPI + LLM, fallthrough to Tech
    techAgentNode.ts          ← 152 lines — SQL retry loop + explanation + orchestration
    sqlGeneration.ts          ← 315 lines — deterministic SQL, fallback, stats, visual tags
    pythonExecution.ts        ← 57 lines — E2B/local Python sandbox execution
    dashboardBuilder.ts       ← 105 lines — dashboard widget generation + data fetch
    data-scientist.ts         ← 501 lines — forecast, regression, clustering, statistics
  db/
    data-lake.ts              ← PostgreSQL read-only transactions + catalog
    kpi-repository.ts         ← Supabase/SQLite factory pattern
  tools/
    enterprise-tools.ts       ← MCP tools (executeSql, buildFinanceKpiContext, etc.)
  tests/                      ← 699 tests across 54 files
  observability/
    tracer.ts                 ← Langfuse init + CallbackHandler + traceToolCall
```

### 3. Өмнөх god файлуудын хуваагдал

| Хуучин файл | Мөр | Шинэ файлууд | Мөр |
|---|---|---|---|
| `ui/src/app/page.tsx` | 2049 | 12 component файл (`ui/src/components/`) | ~300 (page.tsx) |
| `src/multi-agent.ts` | 1171 | 5 файл (`agentState.ts`, `prompts.ts`, `supervisorNode.ts`, `financeAgentNode.ts`, `techAgentNode.ts`) | 98 (multi-agent.ts) |
| `src/agents/techAgentNode.ts` | 697 | `sqlGeneration.ts`, `pythonExecution.ts`, `dashboardBuilder.ts` | 152 (techAgentNode.ts) |

---

## Системийн гол онцлогууд

### Multi-Agent routing

Супервайзер (supervisorNode.ts) нь хэрэглэгчийн асуултыг 3 аргаар чиглүүлнэ:

1. **Keyword routing** — Англи сигналд `\bword\b` regex (word-boundary), Монгол сигналд `.includes()` (Cyrillic `\b` ажилдаггүй)
2. **LLM routing** — `LangChain.withStructuredOutput(RouteSchema)` JSON чиглүүлэлт
3. **Keyword fallback** — LLM алдаа гарвал keyword-р буцаана

4 агент:
- **FinanceAgent** — ChromaDB RAG + KPI repository хайлт, fallthrough to TechAgent
- **TechAgent** — SQL generation (deterministic + LLM retry loop + fallback query), Python sandbox, Dashboard builder
- **DataScientistAgent** — Forecast, regression, clustering, statistics summary
- **END** — greeting (LLM эсвэл Монгол default), active catalog байвал TechAgent руу override

### SQL generation pipeline

```
buildActiveSchemaContext → buildDeterministicTechSql (top-5, count)
  ↓ (null)
LLM SQL gen (retry loop, MAX_SQL_RETRIES=2)
  ↓ (all fail)
buildFallbackQuery (outlier/income/sample)
  ↓ (success)
computeResultStats (median, Q1, Q3, IQR, 3σ)
  ↓
generateVisualTag (<visual> tag for Recharts)
```

### LLM Fallback chain

```
invokeWithFallback: groq → gemini → anthropic → openai
  (rate limit / 429 / quota exceeded → next provider)
```

Тус тусад нь providerOrder тохируулах боломжтой:
- SQL gen fallback: `["groq", "gemini", "openai"]`
- Explanation fallback: `["groq", "anthropic", "openai"]`

### Security

- **JWT**: `NODE_ENV=production` үед `JWT_SECRET` байхгүй бол `process.exit(1)` (hard fail)
- **Read-only transactions**: SELECT бүр `BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE` + `ROLLBACK`-оор ороосон
- **SQLite fallback (dev)**: `DATABASE_URL` localhost эсвэл байхгүй бол SQLite ашиглана

### Observability (Langfuse)

- **Multi-agent chain**: `CallbackHandler` — `runMultiAgent()` / `runMultiAgentStream()` бүрэн trace
- **Tool calls**: `traceToolCall()` — `executeSql()`, `runPythonCode()` standalone trace
- **Configuration**: `.env`-д `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_HOST`

---

## Шаардлагатай зүйлс (Prerequisites)

1. **Node.js** (v18+)
2. **npm** (Node Package Manager)
3. **Docker Desktop** — PostgreSQL + ChromaDB локал ажиллуулахад (заавал биш, SQLite mode ашиглаж болно)
4. **Python 3** — Local sandbox fallback (pandas, matplotlib, scikit-learn суусан байх)

---

## 1. Орчны хувьсагчид тохируулах (.env)

```env
# LLM API Түлхүүрүүд (дор хаяж нэг байх шаардлагатай)
GOOGLE_API_KEY=your_google_api_key_here
GROQ_API_KEY=your_groq_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENAI_API_KEY=your_openai_api_key_here

# Code Execution Sandbox (заавал биш — байхгүй бол local python3 ашиглана)
E2B_API_KEY=your_e2b_api_key_here

# PostgreSQL (заавал биш — байхгүй бол SQLite)
DATABASE_URL=postgresql://user:pass@localhost:5432/db

# Chroma Vector DB (RAG хайлт)
CHROMA_URL=http://localhost:8000

# JWT Authentication (PRODUCTION-Д ЗААВАЛ)
JWT_SECRET=your_super_secret_jwt_key_here

# Langfuse Observability (сонголтоор)
LANGFUSE_SECRET_KEY=your_langfuse_secret_key
LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
LANGFUSE_HOST=https://cloud.langfuse.com
```

---

## 2. Сангууд суулгах

```bash
npm install --legacy-peer-deps
cd ui && npm install --legacy-peer-deps && cd ..
```

---

## 3. Тест ажиллуулах

```bash
# Бүх тест (699 тест, 54 файл)
npm test

# TypeScript typecheck
npx tsc --noEmit
```

### Тест файлууд

| Файл | Тест | Шалгадаг |
|---|---|---|
| `sql-validate.test.ts` | 14 | SQL generation, retry logic, fallback query |
| `analysis.test.ts` | 15 | computeResultStats, outlier detection, visual tags |
| `date-type-casting.test.ts` | 10 | Date type detection, Excel serial dates, TO_DATE casting |
| `mongolian-mapping.test.ts` | 10 | Mongolian column name mapping (Rule 23) |
| `auth.test.ts` | 7 | JWT token create/verify, hard fail in production |
| `kpi-repository.test.ts` | 8 | Supabase/SQLite factory, placeholder detection |
| `supervisor-routing.test.ts` | 31 | 31 routing scenarios — keyword, LLM, word-boundary |
| `multi-agent-integration.test.ts` | 16 | Full graph invoke — all 4 agents + END + DataScientist |

---

## 4. Төслийг ажиллуулах

```bash
# API Server (port 3001) + Next.js UI (port 3000)
npm run dev
```

---

## 5. UI-ийн гол компонентууд

`ui/src/components/`:
- `Header.tsx` — Дээд мөр, хэрэглэгчийн мэдээлэл
- `LoginForm.tsx` — Нэвтрэх форм
- `DashboardPanel.tsx` — KPI үзүүлэлт, хянах самбар
- `AdminPanel.tsx` — KPI удирдлага (Target Manager)
- `ChatMessage.tsx` — Чат message render (Markdown + ActionCards)
- `ChatInput.tsx` — Чат оролт
- `PreviewDrawer.tsx` — JSON/CSV preview drawer
- `CodeBlock.tsx` — SQL syntax highlight + line numbers
- `ActionCard.tsx` — Код болон үр дүнг нэг картанд бүлэглэх
- `ResultPreview.tsx` — JSON массиваас HTML table render
- `VisualMessage.tsx` — Recharts chart (line/bar/pie) render
- `types.ts` — TypeScript type definitions

---

## 6. ChromaDB Production Verification

Энэ хэсэг нь ChromaDB-г production / remote орчноосоо (өөрийн машинаас) шалгах manual командуудыг багтаана. Доорх командууд нь локал орчинд баталгаажсан.

### 6.1 ChromaDB хүртээмж шалгах (ямар ч машинаас)

```bash
# 1) Alive-check — тоон timestamp буцаавал амьд байна
curl -s http://<CHROMA_HOST>:8000/api/v2/heartbeat

# 2) Collections жагсаалт — enterprise-kb байх ёстой
curl -s http://<CHROMA_HOST>:8000/api/v2/tenants/default_tenant/databases/default_database/collections

# 3) Документ count — хүлээгдэв: 207 (эсвэл re-index-ын дараах бодит тоо)
curl -s http://<CHROMA_HOST>:8000/api/v2/tenants/default_tenant/databases/default_database/collections/<COLLECTION_ID>/count
```

- Chroma Cloud / auth-тай сервер бол `-H "X-Chroma-Token: <token>"` header нэмнэ.
- `GET /api/v1/*` нь `501 Unimplemented` ("v1 API is deprecated") буцаана — **зөвхөн v2 API** ашиглана.
- Collection ID-г 2-р алхамын үр дүнгээс авна.

### 6.2 RAG query нь ChromaDB-р явж байгаа эсэх

```bash
# API серверээс бодит query хийх
curl -s http://<APP_HOST>:3001/api/chat -X POST -H "Content-Type: application/json" \
  -d '{"message":"profit margin formula"}'

# API серверийн лог-т Mode=ChromaDB байгаа эсэх
grep "Mode=ChromaDB" <APP_LOG>
```

Хүлээгдэх үр дүн: `[RAG][Debug] Mode=ChromaDB | embedded ...` — query бодитоор ChromaDB vector search-оор явсан баталгаа.

- `Mode=ChromaDB` харагдахгүй бол ChromaDB хүртээмжгүй → boot лог-т `ChromaDB unavailable, using in-memory fallback` гарч in-memory fallback идэвхжсэн байна.
- `NODE_ENV=test` үед ChromaDB зориуд skip болно (`ChromaDB skipped in NODE_ENV=test`) — тестийн орчны үр дүн production баталгаа болохгүй.

---

## Чухал тэмдэглэл (Critical Context)

- `superstore_sales` хүснэгтийн `date` багана нь **INTEGER** (Excel serial dates, e.g. 43537). Өөрчлөх: `'1899-12-30'::date + "date"::integer`.
- Groq free tier: 100K tokens/day. 4-provider fallback chain: groq→gemini→anthropic→openai.
- Word-boundary regex (`\bword\b`) зөвхөн ASCII сигналд. Монгол сигналд `.includes()` ашиглана (`\b` Cyrillic дээр ажилдаггүй).
- `getActiveCatalogEntry()` нь `file.id`-аар хайдаг — Excel upload-ын fix.
- `executeSql()` SELECT бүрийг read-only transaction-д ороодог.
- `requireJwtSecret()` — production-д `JWT_SECRET` байхгүй бол `process.exit(1)`.
- `buildFallbackQuery()` 2σ (3σ биш) threshold ашигладаг.
- `hasSignal()` helper нь supervisorNode.ts-д — 3 signal array бүгд ижил helper-ээр дамждаг.
