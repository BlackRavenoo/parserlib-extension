import { ext } from "../lib/browser";
import { patchApiHeaders } from "../lib/headers";

type Message = { type: "token-captured"; source: string; token: string };

patchApiHeaders();

ext.runtime.onMessage((message: unknown) => {
  const msg = message as Message;
  if (msg?.type === "token-captured" && msg.source && msg.token) {
    return ext.storage.session.set({ [`token:${msg.source}`]: msg.token });
  }
  return undefined;
});
