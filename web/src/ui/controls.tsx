import type { ReactNode } from "react";
import css from "./controls.module.css";

export { css as controls };

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className={css.eyebrow}>{children}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={css.segmented} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value}
          className={o.value === value ? css.segmentOn + " " + css.segment : css.segment} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
