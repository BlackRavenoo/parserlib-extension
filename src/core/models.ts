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
