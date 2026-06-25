export interface DateColumnInfo {
    sqlCast: string;
    detectedAs: "native" | "text-iso" | "text-us" | "text-eu" | "int-serial" | "int-year" | "name-heuristic";
}

export function detectDateColumn(
    columnName: string,
    columnType: string,
    options?: { min?: string; max?: string; sampleValues?: string[] },
): DateColumnInfo | null {
    const lowerType = (columnType || "").toLowerCase();

    if (lowerType.includes("date") || lowerType.includes("timestamp")) {
        return {
            sqlCast: `CAST("${columnName}" AS DATE)`,
            detectedAs: "native",
        };
    }

    const isIntegerLike = /^(int|integer|bigint|smallint|serial|bigserial|smallserial)$/i.test(columnType);

    if (isIntegerLike && options?.min !== undefined && options?.max !== undefined) {
        const min = Number(options.min);
        const max = Number(options.max);
        if (!isNaN(min) && !isNaN(max)) {
            const allNegative = min < 0 && max < 0;
            if (allNegative) {
                return null;
            }
            if (min >= 1900 && max <= 2100) {
                return {
                    sqlCast: `MAKE_DATE("${columnName}"::integer, 1, 1)`,
                    detectedAs: "int-year",
                };
            }
            if (min >= 20000 && max <= 50000) {
                return {
                    sqlCast: `'1899-12-30'::date + "${columnName}"::integer`,
                    detectedAs: "int-serial",
                };
            }
            const range = max - min;
            if (range <= 100) {
                return null;
            }
            return null;
        }
    }

    const isTextLike = /^(text|varchar|character varying|char|character)$/i.test(columnType);

    if (isTextLike) {
        const samples = options?.sampleValues?.filter((v) => v && v.trim().length > 0) || [];
        if (samples.length > 0) {
            const first = samples[0].trim();
            let matchFn: ((s: string) => boolean) | null = null;
            let format: DateColumnInfo | null = null;

            if (/^\d{4}-\d{2}-\d{2}/.test(first)) {
                matchFn = (s) => /^\d{4}-\d{2}-\d{2}/.test(s);
                format = { sqlCast: `CAST("${columnName}" AS DATE)`, detectedAs: "text-iso" };
            } else if (/^\d{2}[\/-]\d{2}[\/-]\d{4}$/.test(first)) {
                const sep = first.includes("/") ? "/" : "-";
                matchFn = (s) => /^\d{2}[\/-]\d{2}[\/-]\d{4}$/.test(s);
                format = { sqlCast: `TO_DATE("${columnName}", 'MM${sep}DD${sep}YYYY')`, detectedAs: "text-us" };
            } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(first)) {
                matchFn = (s) => /^\d{2}\.\d{2}\.\d{4}$/.test(s);
                format = { sqlCast: `TO_DATE("${columnName}", 'DD.MM.YYYY')`, detectedAs: "text-eu" };
            } else if (/^\d{4}\/\d{2}\/\d{2}/.test(first)) {
                matchFn = (s) => /^\d{4}\/\d{2}\/\d{2}/.test(s);
                format = { sqlCast: `TO_DATE("${columnName}", 'YYYY/MM/DD')`, detectedAs: "text-iso" };
            }

            if (format && matchFn) {
                if (samples.every((s) => matchFn(s.trim()))) {
                    return format;
                }
                return null;
            }
        }
        if (/\b(date|time|timestamp|month|year)\b|_(?:date|time|at|timestamp|month|year)$|invoice/i.test(columnName)) {
            return {
                sqlCast: `CAST("${columnName}" AS DATE)`,
                detectedAs: "text-iso",
            };
        }
        return null;
    }

    if (/\b(date|time|timestamp|month|year)\b|_(?:date|time|at|timestamp|month|year)$|invoice/i.test(columnName)) {
        return {
            sqlCast: `CAST("${columnName}" AS DATE)`,
            detectedAs: "name-heuristic",
        };
    }

    return null;
}

export function extractProfileFromSchemaDef(
    schemaDef: string,
    columnName: string,
): { min?: string; max?: string; sampleValues?: string[] } | null {
    const lines = schemaDef.split("\n");
    let colIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`- ${columnName} (`)) {
            colIdx = i;
            break;
        }
    }
    if (colIdx === -1) return null;

    const colLine = lines[colIdx];
    const rangeMatch = colLine.match(/\[(\d+\.?\d*)\s*\.\.\s*(\d+\.?\d*)\]/);
    let min: string | undefined;
    let max: string | undefined;
    if (rangeMatch) {
        min = rangeMatch[1];
        max = rangeMatch[2];
    }

    let sampleValues: string[] | undefined;
    if (colIdx + 1 < lines.length) {
        const nextLine = lines[colIdx + 1].trim();
        if (nextLine.startsWith("Sample values:")) {
            sampleValues = nextLine
                .replace("Sample values:", "")
                .trim()
                .split(/,\s*/)
                .filter((v) => v.length > 0);
        }
    }

    return { min, max, sampleValues };
}

export function findDateColumnWithCast(
    columns: string[],
    columnTypes: Record<string, string>,
    schemaDef: string,
): { column: string; sqlCast: string } | null {
    for (const col of columns) {
        const colType = columnTypes[col] || "unknown";
        const profile = extractProfileFromSchemaDef(schemaDef, col);
        const result = detectDateColumn(col, colType, profile ?? undefined);
        if (result) {
            return { column: col, sqlCast: result.sqlCast };
        }
    }
    return null;
}
