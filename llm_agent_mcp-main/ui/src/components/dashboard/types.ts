export interface DataItem {
  x: string;
  y: number;
  [key: string]: string | number | undefined;
}

export interface SearchDataItem {
  index: number;
  keyword: string;
  count: number;
  range: number;
  status: number;
}
