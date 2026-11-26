// Shared pieces for Reccer's emails. Every email has a plain-text body (the fallback) and a
// simple HTML body built from the same parts. The HTML is deliberately conservative so it
// renders in every client: one table layout, inline styles only, no images, no web fonts,
// no external assets. Every interpolated value goes through esc().

/** The student's optional note to the recommender, shown in the invite email only. */
export const MAX_NOTE_CHARS = 1000;

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
  /** Where replies go. Set on recommender-facing mail (the student's sign-in email). */
  replyTo?: string;
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** A usable reply-to address, or nothing. Never lets a malformed value into the header. */
export function replyToField(email: string | null | undefined): { replyTo?: string } {
  const e = typeof email === "string" ? email.trim() : "";
  return EMAIL_RE.test(e) ? { replyTo: e } : {};
}

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Normalized note text: line endings unified, outer whitespace trimmed, capped. "" when absent. */
export function cleanNote(note: string | null | undefined): string {
  if (typeof note !== "string") return "";
  return note.replace(/\r\n?/g, "\n").trim().slice(0, MAX_NOTE_CHARS);
}

// Palette and type from src/styles/reccer.css (light scheme), with safe fallbacks for mail.
const C = { paper: "#f7f8fa", sheet: "#ffffff", ink: "#18212c", graphite: "#5a6473", rule: "#d8dde4", pen: "#24478f", penInk: "#ffffff" };
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

/** One paragraph. `inner` must already be escaped HTML. */
export const pHtml = (inner: string) =>
  `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.5;color:${C.ink};">${inner}</p>`;

/** A quiet footnote paragraph. `inner` must already be escaped HTML. */
export const smallHtml = (inner: string) =>
  `<p style="margin:0 0 12px;font-family:${SANS};font-size:14px;line-height:1.5;color:${C.graphite};">${inner}</p>`;

/** A bulleted list of plain-text items (escaped here). */
export const listHtml = (items: string[]) =>
  `<ul style="margin:0 0 16px;padding-left:22px;font-family:${SANS};font-size:16px;line-height:1.5;color:${C.ink};">${items
    .map((i) => `<li style="margin:0 0 4px;">${esc(i)}</li>`)
    .join("")}</ul>`;

/** A bulletproof (table-based) button. Label and URL are escaped here. */
export const buttonHtml = (label: string, url: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td bgcolor="${C.pen}" style="border-radius:6px;background:${C.pen};"><a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${SANS};font-size:16px;font-weight:600;line-height:1.2;color:${C.penInk};text-decoration:none;border-radius:6px;">${esc(label)}</a></td></tr></table>` +
  smallHtml(`If the button does not work, paste this link into your browser:<br><a href="${esc(url)}" style="color:${C.pen};word-break:break-all;">${esc(url)}</a>`);

/** The student's note as an attributed quote, set in the serif like a letter. "" when empty. */
export function noteHtml(attribution: string, note: string): string {
  const n = cleanNote(note);
  if (!n) return "";
  return `<p style="margin:0 0 6px;font-family:${SANS};font-size:14px;font-weight:600;line-height:1.4;color:${C.graphite};">${esc(attribution)}</p>` +
    `<blockquote style="margin:0 0 20px;padding:4px 0 4px 16px;border-left:3px solid ${C.rule};font-family:${SERIF};font-size:17px;line-height:1.55;color:${C.ink};">${esc(n).replace(/\n/g, "<br>")}</blockquote>`;
}

/** The same note for the text body: an attribution line, then the note quoted with "> ". */
export function noteText(attribution: string, note: string): string {
  const n = cleanNote(note);
  if (!n) return "";
  return `${attribution}\n${n.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}`;
}

/**
 * Wraps body HTML (already escaped) in the email shell. `preheader` is the inbox preview line;
 * `footer` is a plain-text line under the card (escaped here).
 */
export function layoutHtml(title: string, body: string, opts: { preheader?: string; footer?: string } = {}): string {
  const { preheader = "", footer = "Sent by Reccer." } = opts;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background:${C.paper};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 12px;font-family:${SERIF};font-size:20px;font-weight:600;color:${C.ink};">Reccer</td></tr>
<tr><td bgcolor="${C.sheet}" style="background:${C.sheet};border:1px solid ${C.rule};border-radius:8px;padding:28px 28px 12px;">
${body}
</td></tr>
<tr><td style="padding:12px 4px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.graphite};">${esc(footer)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
