export interface Message {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: Date;
  agentName?: string;
  isError?: boolean;
}

export interface KpiData {
  name: string;
  current: number;
  target: number;
  unit: string;
  updatedAt: string;
}

export interface SalesHistory {
  month: string;
  revenue: number;
}

export interface UploadedFile {
  id: string;
  type: string;
  filename: string;
  description?: string;
}

export interface ServerStatus {
  status: string;
  llm: {
    provider: string;
    model: string;
    isFree: boolean;
    rateLimit: string;
  };
  timestamp: string;
}

import { CHART_COLORS } from "./chartTheme";

export const DEFAULT_COLORS = CHART_COLORS;
