// Plain-text and HTML renderings of a letter. Used for copy-to-clipboard (many portals
// are text boxes) and for PDF via the browser's print dialog (no PDF library needed).

import type { Letter } from "../types";

export interface Signature {
  name: string;
  titleLine: string; // "Solutions Architect, Example Org"
  email: string;
}

export function letterToPlainText(letter: Letter, date: string, sig: Signature): string {
  const body = letter.paragraphs.map((p) => p.map((s) => s.text).join(" ")).join("\n\n");
  return `${date}\n\nDear Members of the Admissions Committee,\n\n${body}\n\nSincerely,\n\n${sig.name}\n${sig.titleLine}\n${sig.email}\n`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Standalone printable HTML. Open in a new window and call print(); "Save as PDF" does the rest. */
export function letterToPrintHtml(letter: Letter, date: string, sig: Signature): string {
  const paras = letter.paragraphs.map((p) => `<p>${esc(p.map((s) => s.text).join(" "))}</p>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(letter.title)}</title>
<style>
  @page { size: letter; margin: 1in; }
  body { font-family: "Source Serif 4", Georgia, "Times New Roman", serif; font-size: 11.5pt; line-height: 1.45; color: #000; max-width: 6.5in; margin: 0 auto; }
  p { margin: 0 0 0.8em; text-align: left; }
  .sig { margin-top: 1.6em; }
</style></head><body>
<p>${esc(date)}</p>
<p>Dear Members of the Admissions Committee,</p>
${paras}
<div class="sig"><p>Sincerely,</p><p>${esc(sig.name)}<br>${esc(sig.titleLine)}<br>${esc(sig.email)}</p></div>
</body></html>`;
}
