import React from "react";

interface FieldProps {
  label: React.ReactNode;
  value: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, value }) => (
  <div className="flex items-baseline justify-between text-[11px]">
    <span className="text-foreground/50">{label}</span>
    <span className="font-semibold text-foreground/80">{value}</span>
  </div>
);
