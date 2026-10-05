const RULE_ID = 1;

const HEADERS = [
  { header: "user-agent", operation: "set", value: "Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0" },
  { header: "referer", operation: "set", value: "https://mangalib.me/" },
  { header: "origin", operation: "set", value: "https://mangalib.me" },
  { header: "sec-gpc", operation: "set", value: "1" },
  { header: "sec-fetch-dest", operation: "set", value: "empty" },
  { header: "sec-fetch-mode", operation: "set", value: "cors" },
  { header: "sec-fetch-site", operation: "set", value: "cross-site" },
];

function makeRule(headers: typeof HEADERS) {
  return {
    id: RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: headers,
    },
    condition: {
      urlFilter: "||api.cdnlibs.org ||cover.cdnlibs.org",
      resourceTypes: ["xmlhttprequest"],
      excludedInitiatorDomains: ["mangalib.me", "mangalib.org", "ranobelib.me"],
    },
  } as unknown as chrome.declarativeNetRequest.Rule;
}

export async function patchApiHeaders(): Promise<boolean> {
  const dnr = chrome.declarativeNetRequest;

  if (!dnr) {
    console.warn("[headers] chrome.declarativeNetRequest недоступен. ");
    return false;
  }

  try {
    await dnr.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules: [makeRule(HEADERS)] });
    console.info(`[headers] подставлено заголовков: ${HEADERS.length}`);
    return true;
  } catch (err) {
    console.warn(`[headers] правило на ${HEADERS.length} заголовков отвергнуто`, err);
  }

  return false;
}
