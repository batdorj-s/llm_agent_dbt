# Enterprise AI Orchestrator — Ажиллуулах гарын авлага (Developer Manual)

Энэхүү төсөл нь **LangGraph Multi-Agent System** (Ухаалаг чиглүүлэгч + 4 агент), **PostgreSQL Data Lake**, **E2B/Local Python Sandbox**, **ChromaDB RAG**, болон **Next.js Dashboard UI**-г нэгтгэсэн AI өгөгдөлд шинжилгээ хийх платформ юм. Монгол хэлний UI, 4 үйлчилгээ үзүүлэгчийн failover chain (groq→gemini→anthropic→openai), Langfuse tracing зэрэг production-ready боломжуудтай.

---

## Architecture (Системийн бүтэц)

### 1. Multi-Agent Orchestration

```mermaid
graph TD
    subgraph "Frontend (Next.js ui/")"
        UI[Dashboard / Chat UI]
        Components[ActionCard, CodeBlock, ChatMessage, VisualMessage, etc.]
    end

    subgraph "Orchestration (src/multi-agent.ts — 98 lines)"
        Graph[StateGraph.compile]
        State[(AgentState messages, nextAgent)]
        Supervisor[supervisorNode.ts — Keyword + LLM routing]
    end

    subgraph "Agent Nodes (src/agents/)"
        Finance[financeAgentNode.ts — RAG + KPI lookup]
        Tech[techAgentNode.ts — SQL gen + Python + Dashboard]
        DS[data-scientist.ts — Forecast + Statistics + ML]
        subgraph "TechAgent internals"
            SQL[sqlGeneration.ts — SQL helpers + retry + stats]
            Python[pythonExecution.ts — E2B/local sandbox]
            Dashboard[dashboardBuilder.ts — widget gen + queries]
        end
    end

    subgraph "Data & Tool Layer"
        DL[(PostgreSQL Data Lake)]
        Vector[(ChromaDB Vector Store)]
        MCP[MCP execute_sql → Data Lake]
        Sandbox[E2B API / Local python3 Sandbox]
        KPI[KPI Repository — Supabase / SQLite]
    end

    subgraph "Infrastructure"
        LLM[LLM Provider — groq→gemini→anthropic→openai]
        Trace[Langfuse Observability]
        JWT[JWT Auth — hard fail in production]
        CI[GitHub Actions — npm ci → typecheck → test]
    end

    UI -->|User Query| Graph
    State --> Supervisor
    Supervisor --> Finance
    Supervisor --> Tech
    Supervisor --> DS
    Supervisor -->|END + active catalog → override| Tech

    Finance -->|Semantic Search| Vector
    Finance -->|KPI query| KPI
    Finance -->|fallthrough| Tech

    Tech --> SQL
    Tech --> Python
    Tech --> Dashboard
    SQL -->|execute_sql| MCP
    MCP --> DL
    Python --> Sandbox
    Dashboard -->|widget SQL| MCP

    DS -->|forecast SQL| MCP
    DS -->|Python code| Sandbox

    LLM -.->|invokeWithFallback| Finance
    LLM -.->|invokeWithFallback| Tech
    LLM -.->|invokeWithFallback| DS

    Trace -.-> Graph
    Trace -.-> MCP
    Trace -.-> Sandbox
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
  tests/                      ← 111 tests across 8 files
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
# Бүх тест (111 тест, 8 файл)
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

## Чухал тэмдэглэл (Critical Context)

- `superstore_sales` хүснэгтийн `date` багана нь **INTEGER** (Excel serial dates, e.g. 43537). Өөрчлөх: `'1899-12-30'::date + "date"::integer`.
- Groq free tier: 100K tokens/day. 4-provider fallback chain: groq→gemini→anthropic→openai.
- Word-boundary regex (`\bword\b`) зөвхөн ASCII сигналд. Монгол сигналд `.includes()` ашиглана (`\b` Cyrillic дээр ажилдаггүй).
- `getActiveCatalogEntry()` нь `file.id`-аар хайдаг — Excel upload-ын fix.
- `executeSql()` SELECT бүрийг read-only transaction-д ороодог.
- `requireJwtSecret()` — production-д `JWT_SECRET` байхгүй бол `process.exit(1)`.
- `buildFallbackQuery()` 2σ (3σ биш) threshold ашигладаг.
- `hasSignal()` helper нь supervisorNode.ts-д — 3 signal array бүгд ижил helper-ээр дамждаг.
