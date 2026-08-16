export function imageToHeightmap(
  img: ImageData
): { h: number[][]; w: number; hPx: number } {
  const w = img.width;
  const hPx = img.height;
  const out: number[][] = [];

  for (let y = 0; y < hPx; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];

      // luminance (0..1)
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      row.push(lum);
    }
    out.push(row);
  }

  return { h: out, w, hPx };
}
