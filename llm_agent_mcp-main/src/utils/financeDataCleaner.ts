/**
 * "₮2,000,000" → 2000000
 */
export function cleanMNTAmount(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;

  const cleaned = raw
    .replace(/₮/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * "5-Jan" → "2026-01-05" (ISO format)
 * Жилийг parameter-аар авах (default: одоогийн жил)
 */
export function parseMonthDayDate(
  raw: string,
  year: number = new Date().getFullYear(),
): string | null {
  if (!raw) return null;

  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04",
    may: "05", jun: "06", jul: "07", aug: "08",
    sep: "09", oct: "10", nov: "11", dec: "12",
  };

  const match = raw.match(/^(\d{1,2})-([a-zA-Z]+)$/);
  if (!match) return null;

  const day = match[1].padStart(2, "0");
  const monthKey = match[2].toLowerCase().slice(0, 3);
  const month = months[monthKey];

  if (!month) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Бүтэн гүйлгээний мөрийг цэвэрлэж стандарт форматад оруулна
 */
export function cleanTransactionRow(row: Record<string, string>) {
  return {
    огноо:       parseMonthDayDate(row["Өдөр"] || row["өдөр"] || row["огноо"]),
    харилцагч:   (row["Харилцагч"] || row["харилцагч"] || "").trim(),
    дүн:         cleanMNTAmount(row["Дүн"] || row["дүн"]),
    ангилал:     (row["Ангилал"] || row["ангилал"] || "").trim(),
    дэд_ангилал: (row["Дэд ангилал"] || row["дэд_ангилал"] || "").trim(),
    тайлбар:     (row["Тайлбар"] || row["тайлбар"] || "").trim(),
  };
}
