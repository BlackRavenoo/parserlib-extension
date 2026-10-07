import type { Source } from "../sources/types";

const RULE_ID = 1;

export interface HeaderRule {
  header: string;
  operation: "set" | "append" | "remove";
  value?: string;
}

export interface RequestPatch {
  urlFilter: string;
  headers: HeaderRule[];
  excludedInitiatorDomains: string[];
}

function makeRule(patch: RequestPatch) {
  return {
    id: RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: patch.headers,
    },
    condition: {
      urlFilter: patch.urlFilter,
      resourceTypes: ["xmlhttprequest"],
      excludedInitiatorDomains: patch.excludedInitiatorDomains,
    },
  } as unknown as chrome.declarativeNetRequest.Rule;
}

export async function patchApiHeaders(source: Source): Promise<boolean> {
  const dnr = chrome.declarativeNetRequest;

  if (!dnr) {
    console.warn("[headers] chrome.declarativeNetRequest недоступен.");
    return false;
  }

  const patch = source.requestPatch ? source.requestPatch() : null;

  if (!patch) {
    try {
      await dnr.updateDynamicRules({ removeRuleIds: [RULE_ID] });
      console.info("[headers] источнику заголовки не нужны, правило снято");
      return true;
    } catch (err) {
      console.warn("[headers] не удалось снять правило", err);
      return false;
    }
  }

  try {
    await dnr.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules: [makeRule(patch)] });
    console.info(`[headers] подставлено заголовков: ${patch.headers.length} для ${source.key}`);
    return true;
  } catch (err) {
    console.warn(`[headers] правило на ${patch.headers.length} заголовков отвергнуто`, err);
  }

  return false;
}