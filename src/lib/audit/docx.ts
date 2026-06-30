// Branded .docx helpers for the audit document (docx-js). Palette + wordmark are
// the deployment's own (entityConfig.brandName); there is NO hardcoded agency
// identity here. Builders return docx elements; buildDocx assembles + packs.
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow,
  TableCell, WidthType, BorderStyle, Footer, PageNumber, ShadingType,
} from "docx";

// Neutral professional palette (portal navy + blue). Re-tint per brand if wanted.
const NAVY = "0B1F3A";
const BLUE = "3C83F6";
const INK = "1F2937";
const GREY = "6B7280";
const HEADER_FILL = "0B1F3A";
const ZEBRA = "F4F6FA";
export const STATUS = { good: "059669", warn: "B45309", bad: "DC2626" };

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const thin = { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB" } as const;

export function coverPage(brand: string, clientName: string, dateStr: string): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: brand.toUpperCase(), bold: true, size: 40, color: NAVY })] }),
    new Paragraph({ spacing: { before: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE } }, children: [] }),
    new Paragraph({ spacing: { before: 600 }, children: [new TextRun({ text: "Google Ads Account Audit", bold: true, size: 56, color: NAVY })] }),
    new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: clientName, size: 36, color: INK })] }),
    new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: dateStr, size: 24, color: GREY })] }),
    new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: "Private and confidential", italics: true, size: 20, color: GREY })], pageBreakBefore: false }),
    new Paragraph({ children: [], pageBreakBefore: true }),
  ];
}

export const h1 = (text: string): Paragraph =>
  new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 }, children: [new TextRun({ text, bold: true, size: 32, color: NAVY })] });

export const h2 = (text: string): Paragraph =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text, bold: true, size: 26, color: BLUE })] });

export const para = (text: string): Paragraph =>
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, size: 22, color: INK })] });

export const bullets = (items: string[]): Paragraph[] =>
  items.map((t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, size: 22, color: INK })] }));

function cell(text: string, opts: { bold?: boolean; color?: string; fill?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; width?: number } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold, size: 20, color: opts.color ?? INK })] })],
  });
}

export interface ExhibitColumn {
  header: string;
  width: number; // percentage
  align?: "left" | "right";
  color?: (v: string) => string | undefined; // optional per-cell colour
}

// Caption + styled table. `rows` is an array of string cells matching columns.
export function exhibit(caption: string, columns: ExhibitColumn[], rows: string[][]): (Paragraph | Table)[] {
  const align = (a?: "left" | "right") => (a === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT);
  const head = new TableRow({
    tableHeader: true,
    children: columns.map((c) => cell(c.header, { bold: true, color: "FFFFFF", fill: HEADER_FILL, align: align(c.align), width: c.width })),
  });
  const body = rows.map((r, i) =>
    new TableRow({
      children: r.map((v, j) => {
        const col = columns[j];
        return cell(v, { align: align(col?.align), fill: i % 2 ? ZEBRA : undefined, color: col?.color?.(v) });
      }),
    }),
  );
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: thin, bottom: thin, left: noBorder, right: noBorder, insideHorizontal: thin, insideVertical: noBorder },
    rows: [head, ...body],
  });
  return [
    new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: caption, bold: true, italics: true, size: 20, color: GREY })] }),
    table,
  ];
}

export async function buildDocx(brand: string, children: (Paragraph | Table)[]): Promise<Buffer> {
  const doc = new Document({
    creator: brand,
    title: "Google Ads Account Audit",
    sections: [
      {
        properties: { page: { margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `${brand}  ·  Google Ads Account Audit  ·  `, size: 16, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
