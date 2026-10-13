import type { Source } from "../sources/types";

const RULE_ID = 1;
const ADDITIONAL_RULE_ID = 2;

export interface HeaderRule {
  header: string;
  operation: "set" | "append" | "remove";
  value?: string;
}

export interface RequestPatch {
  requestDomains: string[];
  headers: HeaderRule[];
  excludedInitiatorDomains: string[];
  additionalRules?: Array<{
    requestDomains: string[];
    headers: HeaderRule[];
    excludedInitiatorDomains: string[];
  }>;
}

type RequestRulePatch = Omit<RequestPatch, "additionalRules">;

function makeRule(patch: RequestRulePatch, id: number) {
  return {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: patch.headers,
    },
    condition: {
      requestDomains: patch.requestDomains,
      resourceTypes: ["xmlhttprequest"],
      excludedInitiatorDomains: patch.excludedInitiatorDomains,
    },
  } as unknown as chrome.declarativeNetRequest.Rule;
}

export async function patchApiHeaders(source: Source, pageUrl: string): Promise<boolean> {
  const dnr = chrome.declarativeNetRequest;

  if (!dnr) {
    console.warn("[headers] chrome.declarativeNetRequest недоступен.");
    return false;
  }

  const patch = source.requestPatch ? source.requestPatch(pageUrl) : null;

  try {
    await dnr.updateDynamicRules({ removeRuleIds: [RULE_ID, ADDITIONAL_RULE_ID] });
    if (!patch) {
      await dnr.updateSessionRules({ removeRuleIds: [RULE_ID, ADDITIONAL_RULE_ID] });
      console.info("[headers] источнику заголовки не нужны, правило снято");
      return true;
    }

    const rulePatches: RequestRulePatch[] = [
      { requestDomains: patch.requestDomains, headers: patch.headers, excludedInitiatorDomains: patch.excludedInitiatorDomains },
      ...(patch.additionalRules ?? []),
    ];
    if (rulePatches.length > 2) throw new Error("Слишком много правил подстановки заголовков.");

    await dnr.updateSessionRules({
      removeRuleIds: [RULE_ID, ADDITIONAL_RULE_ID],
      addRules: rulePatches.map((rule, index) => makeRule(rule, RULE_ID + index)),
    });
    const headerCount = rulePatches.reduce((count, rule) => count + rule.headers.length, 0);
    console.info(`[headers] подставлено заголовков: ${headerCount} для ${source.key}`);
    return true;
  } catch (err) {
    console.warn("[headers] не удалось обновить правило", err);
  }

  return false;
}
