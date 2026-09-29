"use client";

import { RefreshIcon } from "./icons";
import { cn } from "@/lib/utils";

type Props = {
  onClick: () => void;
  loading?: boolean;
  label?: string;
  variant?: "primary" | "secondary" | "ghost" | "icon";
  className?: string;
  disabled?: boolean;
};

export function RefreshButton({ onClick, loading, label = "Refresh", variant = "secondary", className, disabled }: Props) {
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        aria-label={label}
        title={label}
        className={cn("btn-ghost h-11 w-11 rounded-full p-0", className)}
      >
        <RefreshIcon className={cn(loading && "animate-spin")} />
      </button>
    );
  }
  const base = variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : "btn-secondary";
  return (
    <button type="button" onClick={onClick} disabled={loading || disabled} className={cn(base, className)} aria-busy={loading}>
      <RefreshIcon size={18} className={cn(loading && "animate-spin")} />
      {loading ? "Refreshing…" : label}
    </button>
  );
}
