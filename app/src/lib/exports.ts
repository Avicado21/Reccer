// Downloads happen on the recommender's device. The letter is never stored as a file server-side.
import { letterToPlainText, letterToPrintHtml, type Signature } from "../core/export/text";
import { letterToDocx, docxToBlob } from "../core/export/docx";
import type { Letter } from "../core/types";

const today = () => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export async function copyLetter(l: Letter, sig: Signature) {
  await navigator.clipboard.writeText(letterToPlainText(l, today(), sig));
}

export function printLetter(l: Letter, sig: Signature) {
  const w = window.open("", "_blank");
  if (!w) return false; // popup blocked; caller shows a message
  w.document.write(letterToPrintHtml(l, today(), sig));
  w.document.close();
  w.focus();
  w.print();
  return true;
}

export async function downloadDocx(l: Letter, sig: Signature) {
  const blob = await docxToBlob(letterToDocx(l, today(), sig));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `recommendation-${slug(l.title)}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
