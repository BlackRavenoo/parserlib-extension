export interface PdfJpegInfo {
  width: number;
  height: number;
  colorSpace: "/DeviceGray" | "/DeviceRGB";
}

export function readPdfJpeg(data: Uint8Array): PdfJpegInfo | undefined {
  const end = data.byteLength - 2;
  if (end < 2 || data[0] !== 0xff || data[1] !== 0xd8 || data[end] !== 0xff || data[end + 1] !== 0xd9) return;

  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let frame: PdfJpegInfo | undefined;
  let components = 0;
  let hasQuantization = false;
  let hasHuffman = false;

  for (let offset = 2; offset < end;) {
    if (data[offset++] !== 0xff) return;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (offset + 2 > end) return;
    const length = header.getUint16(offset);
    const next = offset + length;
    if (length < 2 || next > end) return;

    if (marker === 0xda) {
      const scanComponents = data[offset + 2]!;
      if (frame && hasQuantization && hasHuffman && scanComponents > 0 && scanComponents <= components &&
          length === 6 + 2 * scanComponents && next < end) return frame;
      return;
    }

    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || length < 11 || data[offset + 2] !== 8) return;
      const height = header.getUint16(offset + 3);
      const width = header.getUint16(offset + 5);
      components = data[offset + 7]!;
      if (!width || !height || (components !== 1 && components !== 3) || length !== 8 + 3 * components) return;
      if (components === 3 && (data[offset + 8] !== 1 || data[offset + 11] !== 2 || data[offset + 14] !== 3)) return;
      frame = { width, height, colorSpace: components === 1 ? "/DeviceGray" : "/DeviceRGB" };
    } else if (marker === 0xdb && length >= 67) {
      hasQuantization = true;
    } else if (marker === 0xc4 && length >= 20) {
      hasHuffman = true;
    } else if (marker !== 0xe0 && marker !== 0xdd && marker !== 0xfe) {
      return;
    }
    offset = next;
  }
}
