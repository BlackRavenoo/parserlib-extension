export interface TextChunk {
  kind: "text";
  text: string;
  styles: TextStyle[];
  startsParagraph: boolean;
}

export type TextStyle = "emphasis" | "strong";

export interface ImageChunk {
  kind: "image";
  data: Uint8Array;
  mime: string;
}

export type DataChunk = TextChunk | ImageChunk;
