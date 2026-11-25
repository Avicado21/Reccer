// End-to-end pipeline on fictional data, no SDK and no LLM.
// Run: npx tsx scripts/demo.ts   → writes demo-output/
import { mkdirSync, writeFileSync } from "node:fs";
import {
  buildQuestionSet, defaultMiddle, deterministicAssembly, validateAssembly, buildLetters,
  buildFormAnswers, claimCheck, inviteEmail, completionEmail, letterToPlainText, letterToPrintHtml,
} from "../src/core/index";
import { letterToDocx, docxToBuffer } from "../src/core/export/docx";
import { intake, answers, cheatingAssembly } from "../fixtures/demo";

const out = "demo-output";
mkdirSync(out, { recursive: true });
const sig = { name: "Priya Nair", titleLine: "Principal Engineer, Harbor Labs", email: "priya.nair@example.com" };
const date = "November 25, 2026";

const questions = buildQuestionSet(intake, defaultMiddle(intake));
writeFileSync(`${out}/questions.md`, questions.map((q) => `- **${q.id}** [${q.section}${q.programScope !== "all" ? `, ${q.programScope}` : ""}${q.destination !== "letter" ? `, ${q.destination}` : ""}] ${q.prompt}\n  _Start with: "${q.opener}"_`).join("\n"));

const assembly = deterministicAssembly(questions, answers);
const letters = buildLetters(intake, assembly);
for (const l of letters) {
  writeFileSync(`${out}/letter_${l.programId}.txt`, letterToPlainText(l, date, sig));
  writeFileSync(`${out}/letter_${l.programId}.html`, letterToPrintHtml(l, date, sig));
  writeFileSync(`${out}/letter_${l.programId}.docx`, await docxToBuffer(letterToDocx(l, date, sig)));
  console.log(`${l.programId}: ${l.wordCount} words`);
}
for (const p of intake.programs) {
  const f = buildFormAnswers(p, questions, answers);
  if (f.length) writeFileSync(`${out}/form_${p.id}.md`, f.map((x) => `**${x.label}**\n\n${x.answer}`).join("\n\n"));
}
const cheat = validateAssembly(cheatingAssembly, questions).assembly!;
const flags = { deterministic: claimCheck(intake, questions, answers, assembly), simulatedCheatingLLM: claimCheck(intake, questions, answers, cheat) };
writeFileSync(`${out}/claim_check.json`, JSON.stringify(flags, null, 2));
const inv = inviteEmail(intake, "https://reccer.app.space/r/<token>", questions.length);
const done = completionEmail(intake);
writeFileSync(`${out}/emails.txt`, `SUBJECT: ${inv.subject}\n\n${inv.text}\n\n-----\n\nSUBJECT: ${done.subject}\n\n${done.text}\n`);
console.log(`claim check: ${flags.deterministic.length} flags on deterministic draft, ${flags.simulatedCheatingLLM.length} on simulated cheating LLM`);
