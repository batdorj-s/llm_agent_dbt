import React from "react";

interface StatItem {
  title: string;
  value: number;
  suffix?: string;
}

interface ExtraContentProps {
  stats?: StatItem[];
}

const ExtraContent: React.FC<ExtraContentProps> = ({ stats }) => {
  if (!stats || stats.length === 0) return null;

  return (
    <div className="flex items-center gap-8">
      {stats.map((stat) => (
        <div key={stat.title} className="text-center">
          <div className="text-xs text-foreground/50 mb-1">{stat.title}</div>
          <div className="text-xl font-semibold">
            {stat.value.toLocaleString()}
            {stat.suffix && (
              <span className="text-sm font-normal text-foreground/50 ml-0.5">
                {stat.suffix}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ExtraContent;
