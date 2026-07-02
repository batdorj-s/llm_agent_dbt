"use client";

import React, { useRef, useState, useEffect } from "react";

export type MenuItem = {
  key: string;
  icon?: React.ReactNode;
  label: React.ReactNode;
  danger?: boolean;
  divider?: boolean;
};

export interface HeaderDropdownProps {
  items: MenuItem[];
  onItemClick?: (key: string) => void;
  children?: React.ReactNode;
  placement?: "bottomLeft" | "bottomRight";
}

const HeaderDropdown: React.FC<HeaderDropdownProps> = ({
  items,
  onItemClick,
  children,
  placement = "bottomLeft",
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <div onClick={() => setOpen((v) => !v)} className="cursor-pointer">
        {children}
      </div>
      {open && (
        <div
          className={[
            "absolute z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-lg",
            placement === "bottomRight" ? "right-0" : "left-0",
          ].join(" ")}
        >
          {items.map((item, i) => {
            if (item.divider) {
              return (
                <div
                  key={`div-${i}`}
                  className="my-1 border-t border-border/60"
                />
              );
            }
            return (
              <button
                key={item.key}
                onClick={() => {
                  onItemClick?.(item.key);
                  setOpen(false);
                }}
                className={[
                  "flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors cursor-pointer border-none text-left",
                  item.danger
                    ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
                ].join(" ")}
              >
                {item.icon && (
                  <span className="inline-flex items-center w-4 h-4">
                    {item.icon}
                  </span>
                )}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HeaderDropdown;
