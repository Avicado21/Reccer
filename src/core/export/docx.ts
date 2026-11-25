// .docx export with the `docx` package. Runs in the browser (Packer.toBlob) or Node (toBuffer),
// so the letter never needs to be stored as a file on the server.

import { Document, Packer, Paragraph, TextRun } from "docx";
import type { Letter } from "../types";
import type { Signature } from "./text";

const FONT = "Times New Roman";
const run = (text: string) => new TextRun({ text, font: FONT, size: 23 }); // 11.5pt
const para = (text: string, after = 160) => new Paragraph({ children: [run(text)], spacing: { after } });

export function letterToDocx(letter: Letter, date: string, sig: Signature): Document {
  return new Document({
    creator: sig.name,
    title: letter.title,
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [
          para(date, 240),
          para("Dear Members of the Admissions Committee,", 200),
          ...letter.paragraphs.map((p) => para(p.map((s) => s.text).join(" "), 200)),
          para("Sincerely,", 400),
          para(sig.name, 0),
          para(sig.titleLine, 0),
          para(sig.email, 0),
        ],
      },
    ],
  });
}

export const docxToBuffer = (d: Document) => Packer.toBuffer(d);
export const docxToBlob = (d: Document) => Packer.toBlob(d);
