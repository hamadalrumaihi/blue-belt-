"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CheckIcon, CloseIcon, CopyIcon } from "./icons";

/*
 * Adapted from the 21st.dev "Copy Button" (ddoemonn/copy-button): same
 * clipboard-with-fallback logic, idle/copied/error states and polite live
 * region, rebuilt on this project's tokens and icons without the `motion`
 * dependency (state changes are instant, so reduced motion needs nothing).
 */

type Status = "idle" | "copied" | "error";

function writeFallback(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

type Props = { value: string; label?: string; copiedLabel?: string; className?: string };

export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", className }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const copy = useCallback(async () => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        ok = true;
      } else ok = writeFallback(value);
    } catch {
      ok = writeFallback(value);
    }
    setStatus(ok ? "copied" : "error");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 2500);
  }, [value]);

  const Icon = status === "copied" ? CheckIcon : status === "error" ? CloseIcon : CopyIcon;
  const text = status === "copied" ? copiedLabel : status === "error" ? "Copy failed. Select the text" : label;

  return (
    <button type="button" onClick={copy} className={cn("btn-secondary min-h-11", status === "copied" && "border-success/40 text-success", status === "error" && "text-danger", className)}>
      <Icon size={16} />
      <span>{text}</span>
      <span role="status" aria-live="polite" className="sr-only">{status === "copied" ? copiedLabel : status === "error" ? "Copy failed" : ""}</span>
    </button>
  );
}
