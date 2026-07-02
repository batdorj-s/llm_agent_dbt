const numberFormatter = new Intl.NumberFormat("en-US");

export const formatNumber = (val: number | string): string => {
  const parsed = Number(val);
  return Number.isFinite(parsed) ? numberFormatter.format(parsed) : "";
};

export const formatCurrency = (val: number | string, symbol = "$") =>
  `${symbol} ${formatNumber(val)}`;
