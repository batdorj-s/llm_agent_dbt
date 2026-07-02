import React, { createElement } from "react";
import { Plus } from "lucide-react";

export type EditableLink = {
  title: string;
  href: string;
  id?: string;
};

type EditableLinkGroupProps = {
  onAdd?: () => void;
  links?: EditableLink[];
  linkElement?: string | React.ComponentType<any>;
};

const EditableLinkGroup: React.FC<EditableLinkGroupProps> = ({
  links = [],
  linkElement = "a",
  onAdd = () => {},
}) => (
  <div className="flex flex-wrap gap-2">
    {links.map((link) =>
      createElement(
        linkElement,
        {
          key: `linkGroup-item-${link.id || link.title}`,
          to: link.href,
          href: link.href,
          className:
            "text-xs text-primary hover:text-primary/80 transition-colors border border-primary/20 rounded px-2.5 py-1",
        },
        link.title,
      ),
    )}
    <button
      type="button"
      onClick={onAdd}
      className="inline-flex items-center gap-1 text-xs text-primary border border-dashed border-primary/30 rounded px-2.5 py-1 hover:border-primary transition-colors"
    >
      <Plus size={12} /> Нэмэх
    </button>
  </div>
);

export default EditableLinkGroup;
