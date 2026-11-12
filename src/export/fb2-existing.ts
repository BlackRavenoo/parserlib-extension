import { SaxesParser } from "saxes";
import type { BookIdentity } from "../core/models";
import { isBookIdentity } from "./types";

const FB2_NAMESPACE = "http://www.gribuser.ru/xml/fictionbook/2.0";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

interface ExistingFb2 {
  prefix: Blob;
  chapters: Map<number, Blob>;
  binaries: Blob[];
  xmlIds: Set<string>;
}

export async function openExistingFb2(file: Blob, title: string, identity?: BookIdentity): Promise<ExistingFb2> {
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = [];
  const chapters = new Map<number, Blob>();
  const binaries: Blob[] = [];
  const xmlIds = new Set<string>();
  const binaryIds = new Set<string>();
  const imageRefs = new Set<string>();
  let prefix: Blob | undefined;
  let descriptionSeen = false;
  let bodyClosed = false;
  let titleText = "";
  let metadataText: string | undefined;
  let capture: "title" | "metadata" | undefined;
  let section: { id: number; start: number } | undefined;
  let binaryStart = 0;
  let tagStart = 0;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let chunk = "";
  let charOffset = 0;
  let byteOffset = 0;
  let previousTail = "";
  let tailCharOffset = 0;
  let tailByteOffset = 0;

  // Позиции SAX измеряются в UTF-16, а Blob.slice принимает смещения в байтах.
  const bytePosition = (position: number): number => {
    if (position >= charOffset) {
      return byteOffset + encoder.encode(chunk.slice(0, position - charOffset)).length;
    }
    return tailByteOffset + encoder.encode(previousTail.slice(0, position - tailCharOffset)).length;
  };
  const characterAt = (position: number): string => position >= charOffset
    ? chunk.charAt(position - charOffset)
    : previousTail.charAt(position - tailCharOffset);
  const consume = (bytes: Uint8Array, stream: boolean): void => {
    try {
      chunk = decoder.decode(bytes, { stream });
    } catch {
      throw new Error("Не удалось прочитать FB2: требуется файл в кодировке UTF-8.");
    }
    parser.write(chunk);
    const tail = previousTail + chunk;
    let start = Math.max(0, tail.length - 16);
    if (tail.charCodeAt(start) >= 0xdc00 && tail.charCodeAt(start) <= 0xdfff) start--;
    charOffset += chunk.length;
    byteOffset += encoder.encode(chunk).length;
    previousTail = tail.slice(start);
    tailCharOffset = charOffset - previousTail.length;
    tailByteOffset = byteOffset - encoder.encode(previousTail).length;
  };

  const collectText = (text: string): void => {
    if (capture === "title") titleText += text;
    else if (capture === "metadata") metadataText += text;
    else if ((stack.at(-1) === "body" || stack.at(-1) === "FictionBook") && text.trim()) {
      throw new Error("FB2 повреждён: текст находится вне секций книги.");
    }
  };
  parser.on("text", collectText);
  parser.on("cdata", collectText);
  parser.on("error", () => { throw new Error("FB2 повреждён: некорректный XML."); });
  parser.on("doctype", () => { throw new Error("Докачка FB2 с DTD не поддерживается."); });
  parser.on("xmldecl", (declaration) => {
    if (declaration.encoding && declaration.encoding.toLowerCase() !== "utf-8") {
      throw new Error("Для докачки нужен FB2 в кодировке UTF-8.");
    }
  });
  parser.on("opentagstart", (tag) => {
    if ((tag.name === "section" && stack.length === 2 && stack[1] === "body") ||
      (tag.name === "binary" && stack.length === 1)) {
      const delimiterLength = characterAt(parser.position - 2) === "\r" && characterAt(parser.position - 1) === "\n" ? 2 : 1;
      tagStart = bytePosition(parser.position - tag.name.length - 1 - delimiterLength);
    }
  });
  parser.on("opentag", (tag) => {
    if (tag.uri !== FB2_NAMESPACE || tag.prefix) throw new Error("Не удалось распознать структуру FB2 этого расширения.");
    const parent = stack.at(-1);
    const id = tag.attributes.id?.value;
    if (id) {
      if (xmlIds.has(id)) throw new Error(`FB2 повреждён: идентификатор «${id}» повторяется.`);
      xmlIds.add(id);
    }
    if (stack.length === 0) {
      if (tag.name !== "FictionBook" || tag.attributes["xmlns:l"]?.value !== XLINK_NAMESPACE) {
        throw new Error("Выбранный файл не является FB2 этого расширения.");
      }
    } else if (stack.length === 1) {
      switch (tag.name) {
        case "description":
          if (descriptionSeen || prefix) throw new Error("FB2 повреждён: неверный порядок описания книги.");
          descriptionSeen = true;
          break;
        case "body": {
          if (!descriptionSeen || prefix || tag.isSelfClosing) throw new Error("FB2 повреждён: неверная структура глав.");
          if (metadataText === undefined) {
            throw new Error("В FB2 нет сведений для докачки. Скачайте книгу заново, чтобы сохранялись ID глав и ветка перевода.");
          }
          let metadata: { version?: number; identity?: unknown };
          try {
            metadata = JSON.parse(metadataText);
            if (metadata?.version !== 1 || (metadata.identity !== undefined && !isBookIdentity(metadata.identity))) throw new Error();
          } catch {
            throw new Error("FB2 повреждён: некорректные сведения для докачки.");
          }
          const actual = metadata.identity as BookIdentity | undefined;
          if ((identity && !isBookIdentity(identity)) || actual?.sourceKey !== identity?.sourceKey ||
            actual?.titleId !== identity?.titleId || actual?.branchId !== identity?.branchId) {
            throw new Error("Источник, тайтл или ветка перевода в FB2 не совпадают с выбранными. Выберите подходящий файл.");
          }
          if (titleText !== title) throw new Error("Название книги в FB2 не совпадает с текущим тайтлом.");
          prefix = file.slice(0, bytePosition(parser.position));
          break;
        }
        case "binary":
          if (!bodyClosed || !id || !tag.attributes["content-type"]?.value) throw new Error("FB2 повреждён: неверная структура изображений.");
          binaryStart = tagStart;
          binaryIds.add(id);
          parser.off("text");
          break;
        default:
          throw new Error("Не удалось распознать структуру FB2 этого расширения.");
      }
    } else if (parent === "body") {
      const match = /^chapter_(0|[1-9]\d*)$/.exec(id ?? "");
      if (tag.name !== "section" || !match || !Number.isSafeInteger(Number(match[1]))) {
        throw new Error("FB2 не содержит корректных ID глав для докачки. Скачайте книгу заново.");
      }
      section = { id: Number(match[1]), start: tagStart };
      parser.off("text");
    }
    if (tag.name === "book-title" && stack.join("/") === "FictionBook/description/title-info") capture = "title";
    if (tag.name === "custom-info" && parent === "description" && tag.attributes["info-type"]?.value === "parserlib") {
      if (metadataText !== undefined) throw new Error("FB2 повреждён: сведения для докачки повторяются.");
      metadataText = "";
      capture = "metadata";
    }
    if (tag.name === "image") {
      const href = Object.values(tag.attributes).find((attribute) => attribute.uri === XLINK_NAMESPACE && attribute.local === "href")?.value;
      if (!href?.startsWith("#")) throw new Error("FB2 повреждён: некорректная ссылка на изображение.");
      imageRefs.add(href.slice(1));
    }
    stack.push(tag.name);
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "book-title" || tag.name === "custom-info") capture = undefined;
    if (stack.length === 3 && stack[1] === "body" && section) {
      chapters.set(section.id, file.slice(section.start, bytePosition(parser.position)));
      section = undefined;
      parser.on("text", collectText);
    }
    if (stack.length === 2 && tag.name === "body") bodyClosed = true;
    if (stack.length === 2 && tag.name === "binary") {
      binaries.push(file.slice(binaryStart, bytePosition(parser.position)));
      parser.on("text", collectText);
    }
    stack.pop();
  });

  const reader = file.stream().getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      consume(result.value, true);
    }
    consume(new Uint8Array(), false);
    parser.close();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (!prefix || !bodyClosed || chapters.size === 0) throw new Error("FB2 не содержит глав для докачки.");
  if ([...imageRefs].some((id) => !binaryIds.has(id))) throw new Error("FB2 повреждён: не найдено изображение по ссылке.");
  return { prefix, chapters, binaries, xmlIds };
}
