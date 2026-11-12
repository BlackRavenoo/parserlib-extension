export interface TextChunk {
  kind: "text";
  text: string;
  styles: TextStyle[];
  startsParagraph: boolean;
  headingLevel?: number;
}

export type TextStyle = "emphasis" | "strong";

export interface ImageChunk {
  kind: "image";
  data: Uint8Array;
  mime: string;
}

export type DataChunk = TextChunk | ImageChunk;

export interface BookIdentity {
  sourceKey: string;
  titleId: string;
  branchId: number | null;
}
