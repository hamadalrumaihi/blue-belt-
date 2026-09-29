import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeftIcon } from "./icons";
import { Logo } from "./Logo";

type Props = {
  title?: string;
  subtitle?: string;
  backHref?: string;
  actions?: ReactNode;
};

/**
 * Top bar. On mobile it carries the logo (or a back arrow + title); on
 * desktop it becomes the page heading next to the sidebar.
 */
export function BrandHeader({ title, subtitle, backHref, actions }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-page/90 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4 lg:px-8">
        {backHref ? (
          <Link href={backHref} className="btn-ghost -ml-2 h-10 w-10 rounded-full p-0 lg:hidden" aria-label="Back">
            <ChevronLeftIcon />
          </Link>
        ) : (
          <div className="lg:hidden">
            <Logo variant="mark" size={34} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {title ? (
            <>
              <h1 className="truncate text-base font-extrabold text-ink lg:text-2xl">{title}</h1>
              {subtitle && <p className="hidden truncate text-sm text-muted lg:block">{subtitle}</p>}
            </>
          ) : (
            <span className="text-sm font-bold text-navy lg:hidden">Blue Belt Media</span>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
