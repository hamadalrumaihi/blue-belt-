import { siteUrl } from "@/lib/studio/queries";
import { esignProviderName, type Env } from "./config";
import { createDocusignProvider } from "./docusign";
import { createInternalProvider } from "./internal";
import { createMockProvider } from "./mock";
import type { EsignProvider, EsignProviderName } from "./types";

export type { EsignProvider, EsignEvent, EsignEventType, EsignProviderName } from "./types";

/**
 * The provider selected by ESIGN_PROVIDER (or an explicit name, e.g. when a
 * stored document says which provider created its envelope). Built per call:
 * every provider reads its settings lazily, so tests can flip variables.
 */
export function getEsignProvider(name?: EsignProviderName, env: Env = process.env): EsignProvider {
  const selected = name ?? esignProviderName(env);
  if (selected === "docusign") return createDocusignProvider({ env });
  if (selected === "mock") return createMockProvider();
  return createInternalProvider({ siteUrl });
}
