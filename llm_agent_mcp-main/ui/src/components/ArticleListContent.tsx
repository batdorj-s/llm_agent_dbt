import React from "react";

export type ArticleListContentProps = {
  data: {
    content?: React.ReactNode;
    updatedAt?: number;
    avatar?: string;
    owner?: string;
    href?: string;
  };
};

const ArticleListContent: React.FC<ArticleListContentProps> = ({
  data: { content, updatedAt, avatar, owner, href },
}) => {
  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleDateString("mn-MN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div>
      <div className="max-w-[720px] leading-[22px] text-xs text-foreground/80">
        {content}
      </div>
      <div className="mt-4 flex items-center gap-2 text-[11px] text-foreground/50">
        {avatar ? (
          <img
            src={avatar}
            alt={owner || ""}
            className="w-5 h-5 rounded-full object-cover"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center text-[9px] font-bold text-foreground/50">
            {(owner || "?")[0]}
          </div>
        )}
        {href ? (
          <a href={href} className="text-foreground/60 hover:text-foreground/80 transition-colors">
            {owner}
          </a>
        ) : (
          <span>{owner}</span>
        )}
        <span className="text-foreground/30">{formattedDate}</span>
      </div>
    </div>
  );
};

export default ArticleListContent;
