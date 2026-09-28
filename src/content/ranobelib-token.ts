import { extractToken } from "./extract-token";

const token = extractToken();
if (token) {
  chrome.runtime.sendMessage({
    type: "token-captured",
    source: "ranobelib",
    token,
  });
}

export {};
