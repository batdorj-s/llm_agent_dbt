function fixedZero(val: number) {
  return val < 10 ? `0${val}` : String(val);
}

export function getTimeDistance(
  type: "today" | "week" | "month" | "year",
): [Date, Date] {
  const now = new Date();
  const oneDay = 1000 * 60 * 60 * 24;

  if (type === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + oneDay - 1000);
    return [start, end];
  }

  if (type === "week") {
    let day = now.getDay();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (day === 0) day = 6;
    else day -= 1;
    const beginTime = start.getTime() - day * oneDay;
    return [new Date(beginTime), new Date(beginTime + 7 * oneDay - 1000)];
  }

  const year = now.getFullYear();

  if (type === "month") {
    const month = now.getMonth();
    const start = new Date(`${year}-${fixedZero(month + 1)}-01 00:00:00`);
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const end = new Date(
      new Date(`${nextYear}-${fixedZero(nextMonth + 1)}-01 00:00:00`).getTime() -
        1000,
    );
    return [start, end];
  }

  return [
    new Date(`${year}-01-01 00:00:00`),
    new Date(`${year}-12-31 23:59:59`),
  ];
}
