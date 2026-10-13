import type { TextChunk } from "../core/models";
import { escapeXml } from "./types";

export type TextMarkup = "fb2" | "xhtml";

const STYLE_TAGS: Record<TextMarkup, Record<TextChunk["styles"][number], string>> = {
  fb2: { emphasis: "emphasis", strong: "strong" },
  xhtml: { emphasis: "em", strong: "strong" },
};

export function renderTextChunk(chunk: TextChunk, markup: TextMarkup): string {
  let result = escapeXml(chunk.text);
  for (const style of [...chunk.styles].reverse()) {
    const tag = STYLE_TAGS[markup][style];
    result = `<${tag}>${result}</${tag}>`;
  }
  return result;
}
