// A PDF writer for exactly what QR sheets need: filled rectangles, one
// built-in font, no images, no embedded fonts, no compression.
//
// Uncompressed streams are legal PDF and stay human-readable, so a reviewer
// can open a generated sheet in a text editor and two sheets can be diffed.
// That matters more here than file size: this project's premise is that you
// can check what it produced without trusting the thing that produced it.

// PDF user space is 1/72 inch. Every dimension in this project is authored in
// millimetres because print specs are.
export const MM = 72 / 25.4;
export const PAGE = { width: 210 * MM, height: 297 * MM } as const;

export type Op = string;

// PDF numbers must not use exponent notation, which String() produces for
// small values. Three decimals is ~0.01mm — far below print resolution.
function num(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '') || '0';
}

export function fill(x: number, y: number, w: number, h: number): Op {
  return `${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`;
}

export function text(x: number, y: number, size: number, value: string): Op {
  return `BT /F1 ${num(size)} Tf ${num(x)} ${num(y)} Td (${escape(value)}) Tj ET`;
}

// Base-14 Helvetica is guaranteed present in every reader, so there is nothing
// to embed and no font licence to carry. Its encoding is single-byte, so
// anything outside printable ASCII is dropped rather than mojibaked — asset
// tags and location names are ASCII, and a silent '?' beats a wrong glyph.
function escape(value: string): string {
  return value
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/([\\()])/g, '\\$1');
}

export function document(pages: readonly (readonly Op[])[]): Blob {
  // Object 1 catalog, 2 page tree, 3 font; then one page object and one
  // content stream per page.
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  pages.forEach((ops, i) => {
    const stream = ops.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE.width)} ${num(PAGE.height)}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });

  const startxref = byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return new Blob([body + xref], { type: 'application/pdf' });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
