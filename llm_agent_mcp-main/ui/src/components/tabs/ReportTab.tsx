"use client";

import React from "react";
import { ReportView } from "../ReportView";
import { FinanceReportView } from "../FinanceReportView";

interface ReportTabProps {
  reportMode: "finance" | "sales";
  setReportMode: (v: "finance" | "sales") => void;
}

const ReportTabInner: React.FC<ReportTabProps> = ({ reportMode, setReportMode }) => {
  return (
    <main key="tab-report" className="flex-1 flex flex-col overflow-hidden min-h-0 animate-fade-in-up">
      <div className="border-b border-border px-6 py-2 flex items-center gap-2 bg-sidebar/30">
        <span className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Тайлангийн төрөл:</span>
        <div className="flex items-center border border-border rounded overflow-hidden text-[10px] font-bold">
          <button onClick={() => setReportMode("finance")}
            className={`px-2.5 py-1 uppercase tracking-wider transition-colors cursor-pointer ${reportMode === "finance" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}>
            Санхүү
          </button>
          <button onClick={() => setReportMode("sales")}
            className={`px-2.5 py-1 uppercase tracking-wider transition-colors cursor-pointer ${reportMode === "sales" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}>
            Борлуулалт
          </button>
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {reportMode === "finance" ? <FinanceReportView /> : <ReportView />}
      </div>
    </main>
  );
};

export const ReportTab = React.memo(ReportTabInner);
