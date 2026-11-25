// Invite tokens and email bodies. The raw token goes only in the email link;
// the database stores its SHA-256 hash, so a leaked table cannot claim an invite.

import type { Program, StudentIntake } from "./types";

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

export function sortedByDue(programs: Program[]): Program[] {
  return [...programs].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function inviteEmail(intake: StudentIntake, link: string, questionCount: number) {
  const lines = sortedByDue(intake.programs).map((p) => `  - ${p.name}, ${p.school}: due ${fmtDate(p.dueDate)}`);
  const subject = `${intake.studentName} asked you for a letter of recommendation`;
  const text = `Hi ${intake.recommenderName},

${intake.studentName} asked you for a letter of recommendation for:
${lines.join("\n")}

Reccer turns your spoken or typed answers into a draft letter in your own words. There are ${questionCount} short questions; most people finish in 20 to 30 minutes, and you can stop and come back anytime.

${intake.studentName} cannot see your answers or your letter.

Start here: ${link}

Sign in with your Google or GitHub account.`;
  return { subject, text };
}

export function completionEmail(intake: StudentIntake) {
  return {
    subject: `${intake.recommenderName} finished your recommendation draft`,
    text: `Hi ${intake.preferredName || intake.studentName},

${intake.recommenderName} finished the Reccer interview and has a draft of your letter. They will review it and submit it to each program themselves.

This message is a status update only. You will not receive the letter.`,
  };
}
