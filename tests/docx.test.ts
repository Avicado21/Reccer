import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuestionSet, defaultMiddle, deterministicAssembly, buildLetters } from "../app/src/core/index";
import { letterToDocx, docxToBuffer } from "../app/src/core/export/docx";
import { intake, answers } from "../fixtures/demo";

test("docx export produces a valid Word file", async () => {
  const qs = buildQuestionSet(intake, defaultMiddle(intake));
  const [letter] = buildLetters(intake, deterministicAssembly(qs, answers));
  const buf = await docxToBuffer(letterToDocx(letter, "November 25, 2026", { name: "Priya Nair", titleLine: "Principal Engineer, Harbor Labs", email: "priya.nair@example.com" }));
  assert.equal(buf.subarray(0, 2).toString(), "PK"); // docx is a zip
  assert.ok(buf.length > 3000);
});
