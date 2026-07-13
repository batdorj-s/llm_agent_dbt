/**
 * profiling.ts — Column profiling, KPI computation, schema definition, and FK detection.
 */

import { getPool, isPgAvailable, quoteIdent, type DataLakeCatalogEntry } from "./pool.js";
import { buildSemanticGroups, formatSemanticGroups } from "../utils.js";

// ── Column sampling ───────────────────────────────────────────

export async function getColumnSamples(
  tableName: string,
  columns: string[],
  limit: number = 3
): Promise<Record<string, string[]>> {
  if (!isPgAvailable() || columns.length === 0) return {};
  try {
    if (columns.length === 1) {
      const col = columns[0];
      const result = await getPool().query(
        `SELECT DISTINCT "${col}" AS val FROM ${quoteIdent(tableName)} WHERE "${col}" IS NOT NULL AND "${col}" != '' LIMIT $1`,
        [limit]
      );
      return { [col]: result.rows.map((r: any) => String(r.val)).filter(Boolean) };
    }
    const result = await getPool().query(
      `SELECT key, jsonb_agg(DISTINCT val) FILTER (WHERE val IS NOT NULL AND val::text != '') AS vals
       FROM (SELECT row_to_json(t) AS r FROM ${quoteIdent(tableName)} LIMIT 100) data,
       jsonb_each_text(r::jsonb) AS cols(key, val)
       GROUP BY key`
    );
    const samples: Record<string, string[]> = {};
    for (const col of columns) {
      const row = result.rows.find((r: any) => r.key === col);
      samples[col] = row ? (row.vals as string[]).filter(Boolean).slice(0, limit) : [];
    }
    return samples;
  } catch {
    return {};
  }
}

// ── Column profiling ──────────────────────────────────────────

export async function getColumnProfile(
  tableName: string,
  columns: string[]
): Promise<Record<string, { type: string; min?: string; max?: string; distinct: number }>> {
  if (!isPgAvailable() || columns.length === 0) return {};
  try {
    const typeResult = await getPool().query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
      [tableName]
    );
    const typeMap: Record<string, string> = {};
    for (const row of typeResult.rows) {
      typeMap[row.column_name] = row.data_type;
    }

    const distinctExprs = columns.map((c, i) => `COUNT(DISTINCT "${c}") AS d${i}`);
    const distinctResult = await getPool().query(
      `SELECT ${distinctExprs.join(", ")} FROM ${quoteIdent(tableName)}`
    );
    const distinctRow = distinctResult.rows[0] || {};

    const numericCols = columns.filter(c => /int|numeric|decimal|real|float|double/i.test(typeMap[c] || ""));
    const numericExprs: string[] = [];
    numericCols.forEach((c, i) => {
      numericExprs.push(`MIN("${c}")::text AS nmin${i}`, `MAX("${c}")::text AS nmax${i}`);
    });
    let rangeRow: Record<string, any> = {};
    if (numericExprs.length > 0) {
      const rangeResult = await getPool().query(
        `SELECT ${numericExprs.join(", ")} FROM ${quoteIdent(tableName)}`
      );
      rangeRow = rangeResult.rows[0] || {};
    }

    const profile: Record<string, { type: string; min?: string; max?: string; distinct: number }> = {};
    columns.forEach((col, i) => {
      const dataType = typeMap[col] || "unknown";
      const distinct = Number(distinctRow[`d${i}`]) || 0;
      const numIdx = numericCols.indexOf(col);
      let minVal: string | undefined;
      let maxVal: string | undefined;
      if (numIdx >= 0) {
        minVal = rangeRow[`nmin${numIdx}`] != null ? String(rangeRow[`nmin${numIdx}`]) : undefined;
        maxVal = rangeRow[`nmax${numIdx}`] != null ? String(rangeRow[`nmax${numIdx}`]) : undefined;
      }
      profile[col] = { type: dataType, min: minVal, max: maxVal, distinct };
    });
    return profile;
  } catch {
    return {};
  }
}

// ── KPI computation ───────────────────────────────────────────

export async function computeTableKpis(
  tableName: string,
  columns: string[],
  profile: Record<string, { type: string; min?: string; max?: string; distinct: number }>
): Promise<string[]> {
  const kpiLines: string[] = [];
  if (!isPgAvailable()) return kpiLines;

  const numericCols = columns.filter(c => {
    const p = profile[c];
    return p && /int|numeric|decimal|real|float|double|money/i.test(p.type) && p.distinct > 1;
  });
  if (numericCols.length === 0) return kpiLines;

  const dateCols = columns.filter(c => /date|time|month|year/i.test(c) && !/id$/i.test(c));
  const catCols = columns.filter(c => {
    const p = profile[c];
    return p && !numericCols.includes(c) && !dateCols.includes(c) && /text|varchar|char/i.test(p.type) && p.distinct > 1 && p.distinct < 50;
  });

  try {
    const totalResult = await getPool().query(`SELECT COUNT(*) AS cnt FROM ${quoteIdent(tableName)}`);
    const rowCount = Number(totalResult.rows[0]?.cnt || 0);

    // Data quality stats
    const batchCols = columns.slice(0, 10);
    if (batchCols.length > 0) {
      const nullSelects = batchCols.map((col, i) =>
        `COUNT(*) FILTER (WHERE ${quoteIdent(col)} IS NULL) AS c${i}`
      ).join(", ");
      const nullResult = await getPool().query(`SELECT ${nullSelects} FROM ${quoteIdent(tableName)}`);
      const dqParts: string[] = [];
      const nullRow = nullResult.rows[0];
      for (let i = 0; i < batchCols.length; i++) {
        const col = batchCols[i];
        const nullCount = Number(nullRow?.[`c${i}`] || 0);
        const nullPct = rowCount > 0 ? ((nullCount / rowCount) * 100).toFixed(1) : "0";
        const p = profile[col];
        const distinctInfo = p?.distinct !== undefined && rowCount > 0
          ? `, distinct=${p.distinct} (${(p.distinct / rowCount * 100).toFixed(1)}%)` : "";
        const nullLabel = Number(nullPct) > 0 ? `, null=${nullPct}%` : "";
        dqParts.push(`${col}${nullLabel}${distinctInfo}`);
      }
      if (dqParts.length > 0) {
        kpiLines.push(`[DATA QUALITY] Table '${tableName}' (${rowCount} rows): ${dqParts.join("; ")}`);
      }
    }

    // Aggregations
    const topNums = numericCols.slice(0, 5);
    if (topNums.length > 0) {
      const aggSelects = topNums.map((col, i) =>
        `COUNT(${quoteIdent(col)}) AS cnt_${i}, SUM(${quoteIdent(col)}) AS total_${i}, AVG(${quoteIdent(col)}) AS avg_${i}, MIN(${quoteIdent(col)}) AS min_${i}, MAX(${quoteIdent(col)}) AS max_${i}`
      ).join(", ");
      const aggResult = await getPool().query(`SELECT ${aggSelects} FROM ${quoteIdent(tableName)}`);
      const aggParts: string[] = [];
      const aggRow = aggResult.rows[0];
      for (let i = 0; i < topNums.length; i++) {
        const col = topNums[i];
        if (aggRow) {
          aggParts.push(`${col}: count=${aggRow[`cnt_${i}`]}, sum=${Number(aggRow[`total_${i}`]).toFixed(2)}, avg=${Number(aggRow[`avg_${i}`]).toFixed(2)}, min=${Number(aggRow[`min_${i}`]).toFixed(2)}, max=${Number(aggRow[`max_${i}`]).toFixed(2)}`);
        }
      }
      if (aggParts.length > 0) {
        kpiLines.push(`[KPI] Table '${tableName}' aggregations:\n${aggParts.join("\n")}`);
      }
    }

    // Outlier detection
    const topOutliers = numericCols.slice(0, 3);
    if (topOutliers.length > 0) {
      const statsSelects = topOutliers.map((col, i) =>
        `AVG(${quoteIdent(col)}) AS mean_${i}, STDDEV(${quoteIdent(col)}) AS stddev_${i}`
      ).join(", ");
      const statsResult = await getPool().query(`SELECT ${statsSelects} FROM ${quoteIdent(tableName)}`);
      const s = statsResult.rows[0];
      if (s) {
        const outlierConditions: string[] = [];
        const outlierParams: number[] = [];
        const colIndices: number[] = [];
        for (let i = 0; i < topOutliers.length; i++) {
          const col = topOutliers[i];
          const mean = Number(s[`mean_${i}`]);
          const stddev = Number(s[`stddev_${i}`]);
          if (stddev > 0) {
            const upper = mean + 3 * stddev;
            const lower = mean - 3 * stddev;
            outlierConditions.push(
              `COUNT(*) FILTER (WHERE ${quoteIdent(col)} < $${outlierParams.length + 1} OR ${quoteIdent(col)} > $${outlierParams.length + 2}) AS o_${i}`
            );
            outlierParams.push(lower, upper);
            colIndices.push(i);
          }
        }
        if (outlierConditions.length > 0) {
          const outlierResult = await getPool().query(
            `SELECT ${outlierConditions.join(", ")} FROM ${quoteIdent(tableName)}`,
            outlierParams
          );
          const outlierParts: string[] = [];
          const oRow = outlierResult.rows[0];
          for (const idx of colIndices) {
            const col = topOutliers[idx];
            const outlierCount = Number(oRow?.[`o_${idx}`] || 0);
            const outlierPct = rowCount > 0 ? ((outlierCount / rowCount) * 100).toFixed(1) : "0";
            if (Number(outlierPct) > 0) {
              outlierParts.push(`${col}: ${outlierCount} outliers (${outlierPct}%)`);
            }
          }
          if (outlierParts.length > 0) {
            kpiLines.push(`[OUTLIERS] Table '${tableName}': ${outlierParts.join("; ")}`);
          }
        }
      }
    }

    // Top category breakdown
    if (catCols.length > 0 && numericCols.length > 0) {
      for (const cat of catCols.slice(0, 2)) {
        for (const num of numericCols.slice(0, 2)) {
          const result = await getPool().query(
            `SELECT ${quoteIdent(cat)}, SUM(${quoteIdent(num)}) AS total FROM ${quoteIdent(tableName)} WHERE ${quoteIdent(cat)} IS NOT NULL GROUP BY ${quoteIdent(cat)} ORDER BY total DESC LIMIT 5`
          );
          if (result.rows.length > 0) {
            const breakdown = result.rows.map((r: any) => `${r[cat]}=${Number(r.total).toFixed(2)}`).join(", ");
            kpiLines.push(`[KPI] Top ${cat} by ${num}: ${breakdown}`);
          }
        }
      }
    }

    // Monthly trend
    if (dateCols.length > 0 && numericCols.length > 0) {
      const dateCol = dateCols[0];
      for (const num of numericCols.slice(0, 2)) {
        const result = await getPool().query(
          `SELECT DATE_TRUNC('month', ${quoteIdent(dateCol)}::timestamp) AS month, SUM(${quoteIdent(num)}) AS total FROM ${quoteIdent(tableName)} WHERE ${quoteIdent(dateCol)} IS NOT NULL GROUP BY month ORDER BY month DESC LIMIT 6`
        );
        if (result.rows.length > 0) {
          const trend = result.rows.map((r: any) => `${(r.month as Date).toISOString().slice(0, 7)}=${Number(r.total).toFixed(2)}`).join(" → ");
          kpiLines.push(`[KPI] Monthly ${num} trend (last ${result.rows.length} months): ${trend}`);
        }
      }
    }
  } catch (err) {
    console.warn(`[Data Lake] computeTableKpis failed for ${tableName}:`, (err as Error).message);
  }

  return kpiLines;
}

// ── Schema definition ─────────────────────────────────────────

export async function buildSchemaDefinition(entries: DataLakeCatalogEntry | DataLakeCatalogEntry[] | null): Promise<string> {
  if (!entries) return "No active table schema is available.";
  const tables = Array.isArray(entries) ? entries : [entries];
  const parts: string[] = [];
  for (const entry of tables) {
    const columns = JSON.parse(entry.columns_info) as string[];
    const cachedProfiles = entry.column_profiles || {};
    let profile = cachedProfiles;
    let samples: Record<string, string[]> = {};

    if (Object.keys(cachedProfiles).length === 0) {
      const [liveSamples, liveProfile] = await Promise.all([
        getColumnSamples(entry.table_name, columns),
        getColumnProfile(entry.table_name, columns),
      ]);
      samples = liveSamples;
      profile = liveProfile;
    } else {
      samples = await getColumnSamples(entry.table_name, columns);
    }

    const lines: string[] = [
      `Table: ${entry.table_name}`,
      entry.description ? `Description: ${entry.description}` : "Description: N/A",
      `Columns:`,
    ];
    for (const column of columns) {
      const p = profile[column];
      if (p) {
        const typeLabel = p.type === "integer" ? "INT" : p.type === "numeric" ? "DEC" : p.type;
        const rangeInfo = p.min !== undefined && p.max !== undefined ? ` [${p.min}..${p.max}]` : "";
        const distinctInfo = p.distinct !== undefined ? `, ${p.distinct} distinct` : "";
        lines.push(`- ${column} (${typeLabel}${distinctInfo}${rangeInfo})`);
      }
      const vals = samples[column];
      if (vals && vals.length > 0) {
        lines.push(`  Sample values: ${vals.join(", ")}`);
      }
    }
    const semanticGroups = buildSemanticGroups(columns);
    const semanticGroupsText = formatSemanticGroups(semanticGroups);
    if (semanticGroupsText !== "No semantic groups detected.") {
      lines.push(`\nSemantic Groups:\n${semanticGroupsText}`);
    }

    const relationships = await getRelationships(entry.table_name);
    if (relationships.length > 0) {
      lines.push(`\nKnown Relationships:\n${relationships.join("\n")}`);
    }

    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}

// ── Foreign key detection ─────────────────────────────────────

export async function detectForeignKeys(tableName: string, columns: string[]): Promise<void> {
  if (!isPgAvailable()) return;
  try {
    const catalogResult = await getPool().query(
      `SELECT table_name, columns_info FROM data_lake_catalog WHERE table_name != $1`,
      [tableName]
    );
    const otherTables = catalogResult.rows as Array<{ table_name: string; columns_info: string }>;
    if (otherTables.length === 0) return;

    for (const col of columns) {
      const lowerCol = col.toLowerCase();
      const idMatch = lowerCol.match(/^(.+)_id$/);
      if (!idMatch) continue;

      const baseName = idMatch[1];

      for (const other of otherTables) {
        const otherName = other.table_name.toLowerCase();
        const otherCols: string[] = JSON.parse(other.columns_info);

        const matchesTable = otherName === baseName
          || otherName === `${baseName}s`
          || otherName === `${baseName}es`
          || otherName.endsWith(`_${baseName}`)
          || baseName === otherName.replace(/s$/, '')
          || (otherName.endsWith('ies') && baseName === otherName.replace(/ies$/, 'y'));

        if (matchesTable) {
          const hasIdCol = otherCols.some(c => c.toLowerCase() === 'id');
          const matchingCol = hasIdCol ? 'id' : otherCols.find(c => c.toLowerCase() === `${baseName}_id`);

          if (matchingCol) {
            await getPool().query(`
              INSERT INTO table_relationships (source_table, source_column, target_table, target_column, confidence)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (source_table, source_column, target_table, target_column) DO NOTHING
            `, [tableName, col, other.table_name, matchingCol, 0.7]);
            console.log(`[Data Lake] Detected FK: ${tableName}.${col} → ${other.table_name}.${matchingCol}`);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Data Lake] FK detection error for ${tableName}:`, (err as Error).message);
  }
}

export async function getRelationships(tableName: string): Promise<string[]> {
  if (!isPgAvailable()) return [];
  try {
    const result = await getPool().query(`
      SELECT source_table, source_column, target_table, target_column
      FROM table_relationships
      WHERE source_table = $1 OR target_table = $1
      ORDER BY confidence DESC
    `, [tableName]);

    return result.rows.map((r: any) =>
      `${r.source_table}.${r.source_column} → ${r.target_table}.${r.target_column}`
    );
  } catch {
    return [];
  }
}
