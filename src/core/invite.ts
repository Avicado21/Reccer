// Invite tokens and email bodies. The raw token goes only in the email link;
// the database stores its SHA-256 hash, so a leaked table cannot claim an invite.

import type { Program, StudentIntake } from "./types";
import { type EmailMessage, esc, layoutHtml, listHtml, noteHtml, noteText, pHtml, buttonHtml, replyToField, smallHtml } from "./email";

export function newInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "November 25, 3:10 PM". Uses the viewer's time zone unless one is given. */
export const fmtDateTime = (iso: string, timeZone?: string) => {
  const d = new Date(iso);
  // Joined by hand: engines disagree on the combined format ("November 25 at 3:10 PM").
  return `${d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })}`;
};

/** One status line about an invite, for the student. Status only: never who claimed it. */
export function describeInvite(
  i: { sentAt: string | null; claimed: boolean; claimedAt: string | null; cancelled: boolean; expired: boolean } | null,
  timeZone?: string,
): string {
  if (!i) return "No invite sent yet";
  const when = (iso: string | null) => (iso ? ` ${fmtDateTime(iso, timeZone)}` : "");
  if (i.claimed) return `Accepted${when(i.claimedAt)}`;
  if (i.cancelled) return "Invite cancelled";
  if (i.expired) return `Invite sent${when(i.sentAt)}; the link has expired`;
  return `Invite sent${when(i.sentAt)}; not opened yet`;
}

export function sortedByDue(programs: Program[]): Program[] {
  return [...programs].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Recommender-facing. Replies go to the student (`studentEmail`, their sign-in address). */
export function inviteEmail(intake: StudentIntake, link: string, questionCount: number, studentEmail?: string | null): EmailMessage {
  const progs = sortedByDue(intake.programs).map((p) => `${p.name}, ${p.school}: due ${fmtDate(p.dueDate)}`);
  const caller = intake.preferredName || intake.studentName;
  const attribution = `A note from ${caller}:`;
  const nText = noteText(attribution, intake.noteToRecommender ?? "");
  const subject = `${intake.studentName} asked you for a letter of recommendation`;
  const about = `Reccer turns your spoken or typed answers into a draft letter in your own words. There are ${questionCount} short questions; most people finish in 20 to 30 minutes, and you can stop and come back anytime.`;
  const privacy = `${intake.studentName} cannot see your answers or your letter.`;
  const text = `Hi ${intake.recommenderName},

${intake.studentName} asked you for a letter of recommendation for:
${progs.map((l) => `  - ${l}`).join("\n")}
${nText ? `\n${nText}\n` : ""}
${about}

${privacy}

Start here: ${link}

Sign in with your Google or GitHub account.`;
  const html = layoutHtml(subject, [
    pHtml(`Hi ${esc(intake.recommenderName)},`),
    pHtml(`${esc(intake.studentName)} asked you for a letter of recommendation for:`),
    listHtml(progs),
    noteHtml(attribution, intake.noteToRecommender ?? ""),
    pHtml(esc(about)),
    pHtml(esc(privacy)),
    buttonHtml("Start your letter", link),
    smallHtml("Sign in with your Google or GitHub account."),
  ].join("\n"), {
    preheader: `${questionCount} short questions, about 20 to 30 minutes.`,
    footer: `Sent by Reccer for ${intake.studentName}. Replying to this email reaches ${caller}.`,
  });
  return { subject, text, html, ...replyToField(studentEmail) };
}

/** Student-facing. Status only: never answers or letter content. */
export function completionEmail(intake: StudentIntake): EmailMessage {
  const subject = `${intake.recommenderName} finished your recommendation draft`;
  const hi = `Hi ${intake.preferredName || intake.studentName},`;
  const body = `${intake.recommenderName} finished the Reccer interview and has a draft of your letter. They will review it and submit it to each program themselves.`;
  const status = "This message is a status update only. You will not receive the letter.";
  return {
    subject,
    text: `${hi}\n\n${body}\n\n${status}`,
    html: layoutHtml(subject, [pHtml(esc(hi)), pHtml(esc(body)), smallHtml(esc(status))].join("\n")),
  };
}
