// Deadline reminders. remindersDue is pure: given request rows and the time, it says who needs a
// reminder now. The scheduled job (logic.sendDeadlineReminders) sends the emails and records
// what it sent, so each reminder goes out at most once per due date, window, and recipient.

import type { Program, StudentIntake } from "./types";
import { fmtDate, sortedByDue } from "./invite";

/** Remind this many days before the earliest upcoming due date. Tightest window wins. */
export const REMINDER_WINDOWS_DAYS = [7, 2];

export type ReminderRecipient = "student" | "recommender";
export type RemindableStatus = "invited" | "in-progress";

export interface ReminderRequest {
  id: string;
  status: string;
  intake: StudentIntake;
  /** Keys of reminders already sent, from reminderKey(). */
  remindersSent?: string[];
}

export interface DueReminder {
  requestId: string;
  status: RemindableStatus;
  program: Program; // the earliest upcoming deadline
  daysLeft: number;
  window: number;
  /** Recipients not yet reminded for this window. Never empty. */
  recipients: ReminderRecipient[];
}

/** Whole calendar days from `now` (UTC date) to an ISO date. Negative once it has passed. */
export function daysUntil(isoDate: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - today) / 86_400_000);
}

export const reminderKey = (dueDate: string, window: number, who: ReminderRecipient) => `${dueDate}:${window}d:${who}`;

/**
 * Which requests need a reminder now: status invited or in-progress, earliest due date that has
 * not passed is within the largest window, and this window was not already sent to that person.
 */
export function remindersDue(requests: ReminderRequest[], now: Date, windows: number[] = REMINDER_WINDOWS_DAYS): DueReminder[] {
  const ascending = [...new Set(windows)].filter((w) => w >= 0).sort((a, b) => a - b);
  const out: DueReminder[] = [];
  for (const r of requests) {
    if (r.status !== "invited" && r.status !== "in-progress") continue;
    const upcoming = sortedByDue(r.intake?.programs ?? []).filter((p) => daysUntil(p.dueDate, now) >= 0);
    const program = upcoming[0];
    if (!program) continue;
    const daysLeft = daysUntil(program.dueDate, now);
    const window = ascending.find((w) => daysLeft <= w);
    if (window === undefined) continue;
    const sent = new Set(r.remindersSent ?? []);
    const recipients = (["student", "recommender"] as const).filter((who) => !sent.has(reminderKey(program.dueDate, window, who)));
    if (recipients.length) out.push({ requestId: r.id, status: r.status, program, daysLeft, window, recipients });
  }
  return out;
}

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

/** To the student. Status only: their own programs and dates, never answers or letter content. */
export function studentReminderEmail(intake: StudentIntake, due: Pick<DueReminder, "status" | "program" | "daysLeft">, opts: { inviteExpired?: boolean } = {}) {
  const status = due.status !== "invited"
    ? `${intake.recommenderName} has started the interview and has not finished it yet.`
    : opts.inviteExpired
      ? `The invite link expired before ${intake.recommenderName} opened it. Resend it from your requests page so they get a working link.`
      : `${intake.recommenderName} has not opened your invite yet. You can resend it from your requests page, or check in with them yourself.`;
  return {
    subject: `${due.program.name} letter due ${inDays(due.daysLeft)}: status of your request to ${intake.recommenderName}`,
    text: `Hi ${intake.preferredName || intake.studentName},

Your earliest letter deadline is ${due.program.name} at ${due.program.school}, due ${fmtDate(due.program.dueDate)} (${inDays(due.daysLeft)}).

${status}

This message is a status update only. You will not receive the letter.`,
  };
}

/** To the recommender. A gentle nudge with every upcoming due date; `link` resumes the interview. */
export function recommenderReminderEmail(intake: StudentIntake, due: Pick<DueReminder, "status" | "daysLeft">, now: Date, link: string | null) {
  const lines = sortedByDue(intake.programs)
    .filter((p) => daysUntil(p.dueDate, now) >= 0)
    .map((p) => `  - ${p.name}, ${p.school}: due ${fmtDate(p.dueDate)}`);
  const how = due.status === "in-progress" && link
    ? `Your answers so far are saved. Pick up where you left off: ${link}`
    : `To start, use the link in the email titled "${intake.studentName} asked you for a letter of recommendation". If you cannot find it, ask ${intake.preferredName || intake.studentName} to resend it.`;
  return {
    subject: `Reminder: ${intake.studentName}'s recommendation, first deadline ${inDays(due.daysLeft)}`,
    text: `Hi ${intake.recommenderName},

A gentle reminder about the letter of recommendation for ${intake.studentName}. The deadlines are:
${lines.join("\n")}

${how}

If you have already sent your letters, you can ignore this message. ${intake.studentName} cannot see your answers or your letter.`,
  };
}
