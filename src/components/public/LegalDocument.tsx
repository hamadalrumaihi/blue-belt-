import Link from "next/link";
import type { ReactNode } from "react";
import type { LegalDocument } from "@/lib/legal/types";

/**
 * Renders a legal text from its sections: intro, a table of contents that
 * jumps to anchored headings, and short numbered sections that read well on
 * a phone. Pure presentation; the content lives in `src/lib/legal`.
 */
export function LegalDocumentView({ doc, eyebrow, footer }: { doc: LegalDocument; eyebrow: string; footer?: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-14 lg:px-8 lg:py-20">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">{doc.title}</h1>
      <div className="mt-4 space-y-3 text-base leading-relaxed text-ink">
        {doc.intro.map((p, i) => (
          <p key={i} className={i === 0 ? "text-sm font-semibold text-muted" : i === doc.intro.length - 1 && doc.intro.length > 2 ? "rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning" : undefined}>
            {p}
          </p>
        ))}
      </div>

      <nav aria-labelledby="toc-heading" className="mt-8 rounded-card border border-line bg-page p-4 sm:p-5">
        <h2 id="toc-heading" className="text-sm font-bold uppercase tracking-[0.14em] text-muted">Contents</h2>
        <ol className="mt-3 grid gap-x-6 sm:grid-cols-2">
          {doc.sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink hover:text-primary">
                <span className="w-6 shrink-0 text-right text-muted">{i + 1}.</span>
                <span>{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {doc.sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="scroll-mt-24">
            <h2 id={`${s.id}-heading`} className="text-xl font-extrabold tracking-tight text-navy">
              {i + 1}. {s.title}
            </h2>
            <div className="mt-3 space-y-3 text-base leading-relaxed text-ink">
              {s.paragraphs.map((p, j) => (
                <p key={j}>{p}</p>
              ))}
              {s.bullets && (
                <ul className="list-disc space-y-2 pl-5">
                  {s.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-3">
              <a href="#toc-heading" className="inline-flex min-h-11 items-center text-xs font-semibold text-muted hover:text-primary">Back to contents</a>
            </p>
          </section>
        ))}
      </div>

      <p className="mt-10 text-xs text-muted">Version {doc.version}.</p>
      {footer && <p className="mt-4 text-sm text-muted">{footer}</p>}
      <p className="mt-2 text-sm text-muted">
        <Link href="/" className="font-semibold text-primary">Back to home</Link>
      </p>
    </main>
  );
}
