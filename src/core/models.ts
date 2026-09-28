export interface TextChunk {
  kind: "text";
  text: string;
}

export interface ImageChunk {
  kind: "image";
  data: Uint8Array;
  mime: string;
}

export type DataChunk = TextChunk | ImageChunk;

export function textChunk(text: string): TextChunk {
  return { kind: "text", text };
}

export function imageChunk(data: Uint8Array, mime: string): ImageChunk {
  return { kind: "image", data, mime };
}
