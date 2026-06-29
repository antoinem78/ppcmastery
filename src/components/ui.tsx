"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "gradient" | "danger";
export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  const variants: Record<Variant, string> = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "border border-border bg-card text-foreground hover:bg-muted",
    ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
    gradient: "bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-95",
    danger: "border border-destructive/40 text-destructive hover:bg-destructive/10",
  };
  return <button className={cx(base, variants[variant], className)} {...props} />;
}

export function Chip({
  selected,
  onClick,
  children,
  removable,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  removable?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-muted",
      )}
    >
      {selected && !removable && <span className="text-xs">✓</span>}
      {children}
      {removable && <span className="text-xs opacity-70">✕</span>}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-2xl border border-border bg-card text-card-foreground shadow-sm", className)}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30";

const STEP_LABELS = ["Campaign Setup", "Keywords", "Create Ads", "Sitelinks", "Callouts", "Review & Publish"];
export function Stepper({ current, onStep }: { current: number; onStep?: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-1 py-2">
      {STEP_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-1">
            <button
              type="button"
              disabled={!onStep || i > current}
              onClick={() => onStep && i <= current && onStep(i)}
              className="flex items-center gap-2 disabled:cursor-default"
            >
              <span
                className={cx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  done && "bg-success text-success-foreground",
                  active && "bg-primary text-primary-foreground",
                  !done && !active && "bg-muted text-muted-foreground",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={cx("hidden text-sm sm:inline", active ? "font-semibold text-primary" : done ? "text-foreground" : "text-muted-foreground")}>
                {label}
              </span>
            </button>
            {i < STEP_LABELS.length - 1 && <span className="mx-1 hidden h-px w-6 bg-border sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

export function Counter({ value, max }: { value: number; max: number }) {
  return <span className={cx("text-[10px] tabular-nums", value > max ? "text-destructive" : "text-muted-foreground")}>{value}/{max}</span>;
}
