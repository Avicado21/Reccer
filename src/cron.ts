/**
 * Cron task definitions, registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the DO records executions and history itself. Each task
 * declares EITHER `intervalMinutes` OR `schedule` + `timezone` (5-field cron).
 * Verified against deepspace 0.44.2 (CronTask, CronRoom, buildCronContext in
 * node_modules/deepspace/dist/worker.d.ts).
 */

import type { CronTask } from 'deepspace/worker'
import { runDeadlineReminders } from './actions/deepspace'

export const DEADLINE_REMINDERS_TASK = 'deadline-reminders'

export const tasks: CronTask[] = [
  // Once a day, mid-morning US Eastern: reminders for invited or in-progress
  // requests whose earliest due date is within 7, then 2, days (src/core/reminders.ts).
  { name: DEADLINE_REMINDERS_TASK, schedule: '0 9 * * *', timezone: 'America/New_York' },
]

/** The bindings the tasks need. worker.ts passes its full Env, which must satisfy this. */
export type CronTaskEnv = Parameters<typeof runDeadlineReminders>[0]

export async function runTask(name: string, env: CronTaskEnv): Promise<void> {
  if (name === DEADLINE_REMINDERS_TASK) await runDeadlineReminders(env)
}
