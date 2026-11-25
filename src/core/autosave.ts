// Interview autosave, without React, so it can be tested. Every pending save carries the
// question id it was typed for. Switching questions flushes the old question's text to the
// old question; nothing that was typed for one question is ever saved against another.

export interface AnswerDraft {
  questionId: string;
  text: string;
  followUp: string;
}

export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const sameAs = (d: AnswerDraft) => `${d.text}\u0000${d.followUp}`;

export function createAutosaver(opts: { delayMs: number; save: (d: AnswerDraft) => Promise<void> | void; scheduler?: Scheduler }) {
  const timers = opts.scheduler ?? realTimers;
  let pending: AnswerDraft | null = null;
  let handle: unknown = null;
  const lastSaved = new Map<string, string>();
  // Saves run one at a time, in order, and flush() waits for any that is still in flight.
  let inflight: Promise<void> = Promise.resolve();

  const stopTimer = () => { if (handle !== null) timers.clear(handle); handle = null; };

  function flush(): Promise<void> {
    stopTimer();
    const d = pending;
    pending = null;
    if (d && lastSaved.get(d.questionId) !== sameAs(d)) {
      lastSaved.set(d.questionId, sameAs(d));
      inflight = inflight.then(() => opts.save(d)).catch(() => {});
    }
    return inflight;
  }

  return {
    /** Call on every user edit (typing, dictation), with the question the edit belongs to. */
    change(d: AnswerDraft): Promise<void> | undefined {
      // A different question's unsaved text is saved now, to that question, before we move on.
      const previous = pending && pending.questionId !== d.questionId ? flush() : undefined;
      stopTimer();
      // Empty answers are not autosaved, as before; Skip is the explicit way to clear one.
      pending = d.text.trim() || d.followUp.trim() ? { ...d } : null;
      if (pending) handle = timers.set(() => { void flush(); }, opts.delayMs);
      return previous;
    },
    /** Save whatever is pending now. Await before switching questions or finishing. */
    flush,
    /** Drop a pending save (e.g. the recommender pressed Skip for that question). */
    discard(questionId?: string) {
      if (pending && (!questionId || pending.questionId === questionId)) { stopTimer(); pending = null; }
      // The server copy is about to change (skipped), so the next real edit must save.
      if (questionId) lastSaved.delete(questionId); else lastSaved.clear();
    },
    /** Record what the server already has, so an unchanged answer is not re-saved. */
    markSaved(d: AnswerDraft) { lastSaved.set(d.questionId, sameAs(d)); },
    pending: () => (pending ? { ...pending } : null),
  };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
