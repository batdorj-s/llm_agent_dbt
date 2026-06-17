# dbt Data Transformation Guide

Энэхүү хавтас нь **llm_agent_mcp** системийн өгөгдлийн загварчлал, цэвэрлэгээ болон KPI тооцооллын логикийг агуулж байна.

## Архитектур (Multi-hop)

1.  **Staging (Bronze):** Түүхий өгөгдлийг цэвэрлэх, төрлийг стандартлах. (`models/staging/`)
2.  **Intermediate (Silver):** Бизнесийн нарийн логик, инкрементал тооцоолол. (`models/intermediate/`)
3.  **Marts (Gold):** AI Агентад зориулсан баталгаажсан KPI-ууд. (`models/marts/`)

## Тушаалууд (Commands)

Төслийг ажиллуулахын тулд `llm_agent_mcp-main/dbt` хавтас руу орно уу:

```bash
# Хамааралтай багцуудыг суулгах (dbt-utils г.м)
dbt deps --profiles-dir .

# Бүх моделиудыг байгуулах
dbt run --profiles-dir .

# Өгөгдлийн чанарыг тестлэх
dbt test --profiles-dir .

# Бүгдийг нэг дор ажиллуулах (run + test)
dbt build --profiles-dir .

# Баримтжуулалт үүсгэх
dbt docs generate --profiles-dir .
dbt docs serve --profiles-dir .
```

## Ирээдүйн сайжруулалт

### 1. Snapshots (SCD Type 2)
Одоогоор SQLite-д `md5` функц байхгүй тул Snapshot идэвхгүй байгаа. Postgres эсвэл өөр платформ руу шилжих үед `snapshots/` хавтас дотор файлыг үүсгэн идэвхжүүлэх боломжтой.

### 2. CI/CD
GitHub Actions тохиргоо `.github/workflows/dbt_ci.yml` файлд бэлэн байгаа. Код `main` салбарт орох бүрд автомат тестүүд ажиллана.

### 3. AI Agent Integration
AI агент нь `src/db/sqlite-repository.ts` файлаар дамжуулан dbt-ийн `kpi_sales` болон `user_metrics` view-үүдтэй холбогдсон. Шинэ KPI нэмэхдээ эхлээд dbt дээр модел үүсгэж, дараа нь репозитор дээр нэмэх нь зүйтэй.
