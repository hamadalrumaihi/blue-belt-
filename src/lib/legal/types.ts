/** A legal page as data: the pages render it with a table of contents and anchored headings. */
export type LegalSection = {
  /** Anchor id, stable across wording changes. */
  id: string;
  title: string;
  paragraphs: string[];
  /** Optional list rendered after the paragraphs. */
  bullets?: string[];
};

export type LegalDocument = {
  title: string;
  version: string;
  updatedLabel: string;
  intro: string[];
  sections: LegalSection[];
};
