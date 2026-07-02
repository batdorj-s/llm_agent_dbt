"use client";

import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface TagSelectOptionProps {
  value: string | number;
  checked?: boolean;
  onChange?: (value: string | number, state: boolean) => void;
  children?: React.ReactNode;
}

const TagSelectOption: React.FC<TagSelectOptionProps> = ({
  children,
  checked,
  onChange,
  value,
}) => (
  <button
    onClick={() => onChange?.(value, !checked)}
    className={[
      "inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors cursor-pointer border",
      checked
        ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700 dark:hover:bg-gray-700",
    ].join(" ")}
  >
    {children}
  </button>
);

type TagSelectOptionElement = React.ReactElement<
  TagSelectOptionProps,
  typeof TagSelectOption
>;

const isTagSelectOption = (node: React.ReactNode): node is TagSelectOptionElement =>
  React.isValidElement(node) && node.type === TagSelectOption;

function useMergedState<T>(
  defaultState: T,
  options?: { value?: T; onChange?: (value: T) => void },
): [T, (value: T) => void] {
  const { value: controlledValue, onChange } = options || {};
  const isControlled = controlledValue !== undefined;
  const [localState, setLocalState] = useState<T>(defaultState);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!isControlled) {
      onChange?.(localState);
    }
  }, [localState]); // eslint-disable-line react-hooks/exhaustive-deps

  const state = isControlled ? controlledValue : localState;
  const setState = useCallback(
    (value: T) => {
      if (!isControlled) {
        setLocalState(value);
      }
      onChange?.(value);
    },
    [isControlled, onChange],
  );

  return [state, setState];
}

interface TagSelectProps {
  onChange?: (value: (string | number)[]) => void;
  expandable?: boolean;
  value?: (string | number)[];
  defaultValue?: (string | number)[];
  hideCheckAll?: boolean;
  actionsText?: {
    expandText?: React.ReactNode;
    collapseText?: React.ReactNode;
    selectAllText?: React.ReactNode;
  };
  children?: React.ReactNode;
}

const TagSelect: React.FC<TagSelectProps> & {
  Option: typeof TagSelectOption;
} = (props) => {
  const {
    children,
    hideCheckAll = false,
    expandable,
    actionsText = {},
  } = props;
  const [expand, setExpand] = useState(false);

  const [value, setValue] = useMergedState<(string | number)[]>(
    props.defaultValue || [],
    { value: props.value, onChange: props.onChange },
  );

  const allTags = useMemo(() => {
    const childrenArray = React.Children.toArray(children);
    return childrenArray.reduce<(string | number)[]>((acc, child) => {
      if (isTagSelectOption(child)) acc.push(child.props.value);
      return acc;
    }, []);
  }, [children]);

  const valueSet = useMemo(() => new Set(value || []), [value]);

  const onSelectAll = useCallback(
    (checked: boolean) => {
      setValue(checked ? [...allTags] : []);
    },
    [allTags, setValue],
  );

  const handleTagChange = useCallback(
    (tag: string | number, checked: boolean) => {
      const checkedTags = new Set(value || []);
      if (checked) {
        checkedTags.add(tag);
      } else {
        checkedTags.delete(tag);
      }
      setValue([...checkedTags]);
    },
    [value, setValue],
  );

  const checkedAll = allTags.length === value?.length && allTags.length > 0;
  const { expandText = "Expand", collapseText = "Collapse", selectAllText = "All" } = actionsText;

  return (
    <div
      className={[
        "relative",
        expandable && "pr-[50px]",
        !expand && expandable ? "max-h-8 overflow-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        transition: "max-height 0.3s, overflow 0.3s",
        maxHeight: expand ? "200px" : "32px",
      }}
    >
      {!hideCheckAll && (
        <button
          onClick={() => onSelectAll(!checkedAll)}
          className={[
            "inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors cursor-pointer border mr-6",
            checkedAll
              ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
              : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700 dark:hover:bg-gray-700",
          ].join(" ")}
        >
          {selectAllText}
        </button>
      )}
      {children &&
        React.Children.map(children, (child) => {
          if (isTagSelectOption(child)) {
            return React.cloneElement(child, {
              key: `tag-select-${child.props.value}`,
              value: child.props.value,
              checked: valueSet.has(child.props.value),
              onChange: handleTagChange,
            });
          }
          return child;
        })}
      {expandable && (
        <button
          onClick={() => setExpand((prev) => !prev)}
          className="absolute top-0 right-0 text-blue-600 dark:text-blue-400 text-xs font-medium hover:underline inline-flex items-center gap-1 cursor-pointer bg-transparent border-none"
        >
          {expand ? (
            <>
              {collapseText} <ChevronUp className="w-3 h-3" />
            </>
          ) : (
            <>
              {expandText} <ChevronDown className="w-3 h-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
};

TagSelect.Option = TagSelectOption;
export default TagSelect;
