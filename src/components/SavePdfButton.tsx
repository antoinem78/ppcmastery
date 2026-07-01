"use client";

// Opens the browser print dialog (Save as PDF). Hidden in the printed output.
export function SavePdfButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90 print:hidden"
    >
      ⬇ Save as PDF
    </button>
  );
}
