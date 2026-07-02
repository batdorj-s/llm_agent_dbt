"use client";

import React from "react";

export type AvatarItemProps = {
  tips?: React.ReactNode;
  src?: string;
  name?: string;
  size?: "large" | "default" | "small" | "mini";
  onClick?: () => void;
};

export type AvatarListProps = {
  size?: "large" | "default" | "small" | "mini";
  maxLength?: number;
  children:
    | React.ReactElement<AvatarItemProps>
    | React.ReactElement<AvatarItemProps>[];
};

const sizeMap = {
  large: "w-10 h-10 text-xs",
  default: "w-8 h-8 text-[10px]",
  small: "w-6 h-6 text-[9px]",
  mini: "w-5 h-5 text-[8px]",
};

const Item: React.FC<AvatarItemProps> = ({ src, name, size = "default", tips, onClick }) => {
  const sizeClass = sizeMap[size];
  const avatar = src ? (
    <img
      src={src}
      alt={name || ""}
      className={`${sizeClass} rounded-full object-cover border-2 border-card`}
    />
  ) : (
    <div
      className={`${sizeClass} rounded-full bg-foreground/10 flex items-center justify-center font-bold text-foreground/50 border-2 border-card`}
    >
      {(name || "?")[0]}
    </div>
  );

  const content = tips ? (
    <span title={typeof tips === "string" ? tips : undefined}>
      {avatar}
    </span>
  ) : (
    avatar
  );

  return (
    <li className="inline-block -ml-2 first:ml-0">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="p-0 border-0 bg-transparent cursor-pointer"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
};

const AvatarList: React.FC<AvatarListProps> & {
  Item: typeof Item;
} = ({ children, size = "default", maxLength = 5 }) => {
  const numOfChildren = React.Children.count(children);
  const numToShow = maxLength >= numOfChildren ? numOfChildren : maxLength;
  const childrenArray = React.Children.toArray(children) as React.ReactElement<AvatarItemProps>[];
  const childrenWithProps = childrenArray.slice(0, numToShow).map((child) =>
    React.cloneElement(child, { size }),
  );

  if (numToShow < numOfChildren) {
    const sizeClass = sizeMap[size];
    childrenWithProps.push(
      <li key="exceed" className="inline-block -ml-2">
        <div className={`${sizeClass} rounded-full bg-foreground/10 flex items-center justify-center text-[10px] font-bold text-foreground/50 border-2 border-card`}>
          +{numOfChildren - maxLength}
        </div>
      </li>,
    );
  }

  return (
    <div className="inline-block">
      <ul className="inline-block ml-2 text-[0]">{childrenWithProps}</ul>
    </div>
  );
};

AvatarList.Item = Item;
export default AvatarList;
