// Renders the shared agreement content as a clean A4 PDF (pdf-lib — pure JS,
// no binaries, Vercel-safe) and reports where the client's signature field
// belongs so the adapter can place a Documenso SIGNATURE field there.
// Documenso field coordinates are PERCENTAGES of the page, origin TOP-left;
// pdf-lib's origin is bottom-left — converted at the end.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AgreementContent } from "@/lib/integrations/contracts/agreement-content";
import { entityConfig, formatMoney } from "@/lib/config";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const WIDTH = A4[0] - MARGIN * 2;
const NAVY = rgb(0.043, 0.122, 0.227); // #0B1F3A
const INK = rgb(0.12, 0.14, 0.17);
const GREY = rgb(0.42, 0.45, 0.5);
const HAIR = rgb(0.88, 0.88, 0.86);

export interface SignatureAnchor {
  pageNumber: number; // 1-based
  pageX: number; // % from left
  pageY: number; // % from top
  pageWidth: number; // % of page width
  pageHeight: number; // % of page height
}

export async function renderAgreementPdf(
  content: AgreementContent,
  clientCompany: string,
): Promise<{ pdfBytes: Uint8Array; signature: SignatureAnchor }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;

  const wrap = (text: string, f: PDFFont, size: number, width = WIDTH): string[] => {
    const out: string[] = [];
    for (const para of text.split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); continue; }
      let line = "";
      for (const w of words) {
        const probe = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(probe, size) > width && line) {
          out.push(line);
          line = w;
        } else {
          line = probe;
        }
      }
      out.push(line);
    }
    return out;
  };

  const ensure = (needed: number): void => {
    if (y - needed < MARGIN) {
      page = doc.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };

  const text = (s: string, f: PDFFont, size: number, color = INK, gapAfter = 4, width = WIDTH, x = MARGIN) => {
    for (const line of wrap(s, f, size, width)) {
      ensure(size + 2);
      page.drawText(line, { x, y: y - size, size, font: f, color });
      y -= size + 3;
    }
    y -= gapAfter;
  };

  // ---- Header ----
  page.drawText((entityConfig.brandName || "PPC Mastery").toUpperCase(), {
    x: MARGIN, y: y - 11, size: 11, font: bold, color: NAVY,
  });
  const numText = content.number;
  page.drawText(numText, {
    x: A4[0] - MARGIN - font.widthOfTextAtSize(numText, 9), y: y - 10, size: 9, font, color: GREY,
  });
  y -= 24;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 1.5, color: NAVY });
  y -= 26;

  // ---- Title + intro ----
  text(content.title, bold, 20, NAVY, 10);
  text(content.intro, font, 10.5, INK, 14);

  // ---- Investment ----
  text("Investment", bold, 13, NAVY, 6);
  for (const p of content.pricing) {
    ensure(34);
    const amount = typeof p.amount === "number"
      ? `${formatMoney(p.amount)}${p.period === "monthly" ? " /month" : p.period === "once" ? " one-time" : ""}`
      : String(p.amount);
    page.drawText(amount, {
      x: A4[0] - MARGIN - bold.widthOfTextAtSize(amount, 10.5), y: y - 10.5, size: 10.5, font: bold, color: INK,
    });
    text(p.label, bold, 10.5, INK, 0, WIDTH - 170);
    text(p.detail, font, 9, GREY, 6, WIDTH - 170);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 0.5, color: HAIR });
    y -= 8;
  }
  text(content.pricingNote, font, 9, GREY, 14);

  // ---- Terms ----
  text("Terms", bold, 13, NAVY, 6);
  content.terms.forEach((t, i) => {
    text(`${i + 1}. ${t}`, font, 9.5, INK, 7);
  });

  // ---- Signature block (keep together; new page if tight) ----
  ensure(170);
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 1, color: NAVY });
  y -= 22;
  text("Acceptance and signature", bold, 13, NAVY, 4);
  text(`Signed for and on behalf of ${clientCompany}:`, font, 10, INK, 8);

  const boxW = 220;
  const boxH = 64;
  ensure(boxH + 40);
  const boxTopY = y;
  page.drawRectangle({
    x: MARGIN, y: boxTopY - boxH, width: boxW, height: boxH,
    borderColor: HAIR, borderWidth: 1,
  });
  page.drawText("Signature", { x: MARGIN + 6, y: boxTopY - boxH + 6, size: 8, font, color: GREY });
  y = boxTopY - boxH - 16;
  text(`Name and date are recorded electronically at signing. ${content.acceptNote}`, font, 8.5, GREY, 0);

  const pageIndex = doc.getPageCount() - 1;
  const sigPage: PDFPage = doc.getPage(pageIndex);
  const { width: pw, height: ph } = sigPage.getSize();
  const signature: SignatureAnchor = {
    pageNumber: pageIndex + 1,
    pageX: (MARGIN / pw) * 100,
    pageY: ((ph - boxTopY) / ph) * 100, // top-left origin
    pageWidth: (boxW / pw) * 100,
    pageHeight: (boxH / ph) * 100,
  };

  return { pdfBytes: await doc.save(), signature };
}
