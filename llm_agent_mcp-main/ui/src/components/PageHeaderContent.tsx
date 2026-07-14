import React from "react";
import { User } from "lucide-react";

interface CurrentUser {
  avatar?: string;
  name?: string;
  title?: string;
  group?: string;
}

interface PageHeaderContentProps {
  currentUser: Partial<CurrentUser>;
}

const PageHeaderContent: React.FC<PageHeaderContentProps> = ({ currentUser }) => {
  const loading = currentUser && Object.keys(currentUser).length === 0;

  if (loading) {
    return (
      <div className="flex items-center gap-4 animate-pulse">
        <div className="w-12 h-12 rounded-full bg-foreground/10" />
        <div className="space-y-2">
          <div className="h-4 w-40 rounded bg-foreground/10" />
          <div className="h-3 w-60 rounded bg-foreground/10" />
        </div>
      </div>
    );
  }

  const initials = currentUser.name?.charAt(0)?.toUpperCase();

  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
        {currentUser.avatar ? (
          <img src={currentUser.avatar} alt="" className="w-full h-full rounded-full object-cover" />
        ) : (
          initials || <User size={20} />
        )}
      </div>
      <div>
        <div className="text-base font-semibold">
          Сайн уу, {currentUser.name} — танд амжилттай өдөр байх болтугай!
        </div>
        <div className="text-sm text-foreground/60">
          {[currentUser.title, currentUser.group].filter(Boolean).join(" | ") || ""}
        </div>
      </div>
    </div>
  );
};

export default PageHeaderContent;
