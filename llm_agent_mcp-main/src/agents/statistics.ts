export interface ColumnStats {
  count: number;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
  outliers: number[];
  outlierPct: string;
}

export function computeColumnStats(values: number[]): ColumnStats | null {
  const vals = values.filter(v => !isNaN(v));
  if (vals.length === 0) return null;
  const n = vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const min = sorted[0];
  const max = sorted[n - 1];
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = vals.reduce((sq, v) => sq + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const threeSigma = vals.filter(v => Math.abs(v - mean) > 3 * std);
  const iqrOutliers = vals.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
  const allOutliers = [...new Set([...threeSigma, ...iqrOutliers])];
  const outlierPct = ((allOutliers.length / n) * 100).toFixed(1);
  return { count: n, mean, median, std, min, max, q1, q3, iqr, outliers: allOutliers, outlierPct };
}

export interface ColumnStatsResult {
  lines: string[];
  outlierLines: string[];
}

export function computeAllStats(
  data: any[],
  numericCols: string[],
  minDataFraction: number = 0.5
): ColumnStatsResult {
  const lines: string[] = [];
  const outlierLines: string[] = [];
  for (const col of numericCols) {
    const vals = data.map(r => Number(r[col])).filter(v => !isNaN(v));
    if (vals.length < data.length * minDataFraction) continue;
    const stats = computeColumnStats(vals);
    if (!stats) continue;
    lines.push(`- ${col}: count=${stats.count}, mean=${stats.mean.toFixed(2)}, median=${stats.median.toFixed(2)}, std=${stats.std.toFixed(2)}, min=${stats.min.toFixed(2)}, max=${stats.max.toFixed(2)}, q1=${stats.q1.toFixed(2)}, q3=${stats.q3.toFixed(2)}, iqr=${stats.iqr.toFixed(2)}`);
    if (stats.outliers.length > 0) {
      const outlierVals = [...new Set(stats.outliers.map(v => v.toFixed(2)))].slice(0, 5).join(", ");
      outlierLines.push(`  Outliers in "${col}": ${outlierVals} (${stats.outliers.length}/${stats.count} = ${stats.outlierPct}%, 3σ+IQR method)`);
    }
  }
  return { lines, outlierLines };
}
