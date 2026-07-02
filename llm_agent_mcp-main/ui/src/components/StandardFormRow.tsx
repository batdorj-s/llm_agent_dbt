import React from "react";

type StandardFormRowProps = {
  title?: string;
  last?: boolean;
  block?: boolean;
  grid?: boolean;
  children?: React.ReactNode;
};

const StandardFormRow: React.FC<StandardFormRowProps> = ({
  title,
  children,
  last,
  block,
  grid,
}) => {
  return (
    <div
      className={[
        "flex w-full mb-4 pb-4",
        !last && "border-b border-dashed border-gray-200 dark:border-gray-700",
        last && "mb-0 pb-0",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {title && (
        <div className="flex-none mr-6 text-right">
          <span className="inline-block h-8 leading-8 text-sm font-medium text-gray-700 dark:text-gray-300 after:content-[':']">
            {title}
          </span>
        </div>
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
};

export default StandardFormRow;
