/**
 * data-lake.ts — Barrel re-export for backward compatibility.
 *
 * All functionality has been split into focused modules:
 *   pool.ts           — PostgreSQL pool, schema init, quoteIdent, getPool, isPgAvailable
 *   catalog.ts        — Catalog CRUD, uploaded files sync, user auth DB
 *   profiling.ts      — Column profiling, KPI computation, schema definition, FK detection
 *   ingestion.ts      — CSV import, seedCsv, mergeIntoCombined, finance combined table
 *   sql-utils.ts      — SQL validation, column normalization, noise filters, query execution
 *
 * This file re-exports everything so existing `from "../db/data-lake.js"` imports keep working.
 */

export { getPool, isPgAvailable, quoteIdent, buildSslConfig, initDataLake, type DataLakeCatalogEntry } from "./pool.js";
export { getCatalog, getActiveCatalogEntry, canAccessCatalogEntry, ensureUploadedFilesSynced, authenticateUser, createUser } from "./catalog.js";
export { getColumnSamples, getColumnProfile, computeTableKpis, buildSchemaDefinition, detectForeignKeys, getRelationships } from "./profiling.js";
export { seedCsv, mergeIntoCombined, FINANCE_COMBINED_TABLE } from "./ingestion.js";
export { normalizeColumnName, buildNoiseSubcategoryFilter, assertSelectOnly, validateSqlColumns, validateSqlColumnsAgainstCatalog, executeSql } from "./sql-utils.js";
