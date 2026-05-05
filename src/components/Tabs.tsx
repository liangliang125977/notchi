import { type ReactNode } from "react";

// Apple-flavoured segmented tab strip. We avoid pulling Radix in just
// for five tabs — simple buttons + role="tab" do the job.

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface Props {
  items: ReadonlyArray<TabItem>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ items, active, onChange, className }: Props) {
  return (
    <div
      className={"tabs-strip " + (className ?? "")}
      role="tablist"
      aria-orientation="horizontal"
    >
      {items.map((it) => {
        const selected = it.id === active;
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={selected}
            aria-disabled={it.disabled || false}
            disabled={it.disabled}
            type="button"
            className={
              "tabs-tab" +
              (selected ? " is-active" : "") +
              (it.disabled ? " is-disabled" : "")
            }
            title={it.hint}
            onClick={() => {
              if (!it.disabled) onChange(it.id);
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  active,
  id,
  children,
}: {
  active: string;
  id: string;
  children: ReactNode;
}) {
  if (active !== id) return null;
  return (
    <div role="tabpanel" className="tabs-panel">
      {children}
    </div>
  );
}
