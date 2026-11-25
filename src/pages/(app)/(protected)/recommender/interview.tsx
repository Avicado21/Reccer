// One question at a time. Answers save on every pause in typing and on each move.
// Each pending save is bound to the question it was typed for (core/autosave.ts), so moving to
// another question can never save one answer's text against a different question.
import { useEffect, useRef, useState } from "react";
import { api, type Interview } from "../../../../lib/api";
import { useDictation } from "../../../../lib/useDictation";
import { fmtDate } from "../../../../core/invite";
import { createAutosaver, type AnswerDraft } from "../../../../core/autosave";
import "../../../../styles/reccer.css";

const FOLLOW_UP = "Can you give me a specific moment?";
const needsFollowUp = (t: string) => (t.match(/[.!?](\s|$)/g)?.length ?? 0) < 2 && t.trim().split(/\s+/).length < 30;
const EMPTY: AnswerDraft = { questionId: "", text: "", followUp: "" };

export default function InterviewPage() {
  const requestId = new URLSearchParams(location.search).get("id") ?? "";
  const [data, setData] = useState<Interview | null>(null);
  const [i, setI] = useState(0);
  const [entry, setEntry] = useState<AnswerDraft>(EMPTY);
  const entryRef = useRef<AnswerDraft>(EMPTY);
  const [askFollowUp, setAskFollowUp] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);

  // One autosaver for the page. save() receives the question id with the text.
  const saver = useRef(createAutosaver({
    delayMs: 1200,
    save: async (d) => {
      const r = await api.saveAnswer({ requestId, questionId: d.questionId, text: d.text, followUp: d.followUp });
      if (r.ok) {
        setSaved("Saved");
        setData((cur) => cur && { ...cur, answers: { ...cur.answers, [d.questionId]: { text: d.text, followUp: d.followUp || undefined } } });
      } else setError(r.error);
    },
  })).current;

  useEffect(() => {
    api.getInterview(requestId).then((r) => {
      if (!r.ok) return setError(r.error);
      setData(r.data);
      const first = r.data.questions.findIndex((q) => !r.data.answers[q.id]);
      setI(first === -1 ? 0 : first);
    });
  }, [requestId]);

  const q = data?.questions[i];

  // Load the editor for the current question. This never triggers a save; only edits do.
  useEffect(() => {
    if (!data || !q) return;
    const a = data.answers[q.id];
    const loaded: AnswerDraft = { questionId: q.id, text: a && a !== "SKIPPED" ? a.text : "", followUp: a && a !== "SKIPPED" ? a.followUp ?? "" : "" };
    saver.markSaved(loaded);
    entryRef.current = loaded;
    setEntry(loaded);
    setAskFollowUp(!!loaded.followUp);
    setShowFacts(false);
  }, [i, q?.id, data?.questions.length]);

  /** Every user edit goes through here, tagged with the question it belongs to. */
  function edit(patch: Partial<Pick<AnswerDraft, "text" | "followUp">>) {
    const next = { ...entryRef.current, ...patch };
    entryRef.current = next;
    setEntry(next);
    setSaved("");
    saver.change(next);
  }

  const dictation = useDictation((chunk) => {
    const cur = entryRef.current;
    if (askFollowUp) edit({ followUp: `${cur.followUp} ${chunk}`.trim() });
    else edit({ text: `${cur.text} ${chunk}`.trim() });
  });

  /** Saves the current question's pending text to that question, then moves. */
  async function go(n: number) {
    dictation.stop();
    await saver.flush();
    setI(Math.max(0, Math.min(n, data!.questions.length - 1)));
  }

  async function next() {
    if (!q) return;
    if (entry.text.trim() && !askFollowUp && needsFollowUp(entry.text)) { setAskFollowUp(true); return; } // one follow-up, then move on
    await go(i + 1);
  }
  async function skip() {
    if (!q) return;
    dictation.stop();
    saver.discard(q.id);
    const r = await api.saveAnswer({ requestId, questionId: q.id, skipped: true, text: "" });
    if (!r.ok) return setError(r.error);
    setData((d) => d && { ...d, answers: { ...d.answers, [q.id]: "SKIPPED" } });
    setI((n) => Math.min(n + 1, data!.questions.length - 1));
  }
  async function finish() {
    setFinishing(true);
    dictation.stop();
    await saver.flush();
    const r = await api.finishInterview(requestId);
    if (r.ok) location.assign(`/recommender/draft?id=${requestId}`); else { setError(r.error); setFinishing(false); }
  }

  if (error && !data) return <main className="rc"><div className="rc-wrap"><h1>This interview cannot be opened</h1><p className="error">{error}</p></div></main>;
  if (!data || !q) return <main className="rc"><div className="rc-wrap"><p className="muted">Loading your questions…</p></div></main>;

  const answered = data.questions.filter((x) => data.answers[x.id]).length;
  const isLast = i === data.questions.length - 1;
  const ready = entry.questionId === q.id; // the editor has loaded this question

  return (
    <main className="rc"><div className="rc-wrap">
      {data.finished && (
        <p className="memory">
          You already have a draft. <a href={`/recommender/draft?id=${requestId}`}>Open your draft</a>. If you change answers here,
          finish again to rebuild it; your sentence edits are kept wherever the sentence comes out the same.
        </p>
      )}
      {i === 0 && answered === 0 && (
        <p className="muted">
          You are writing for {data.studentName}: {[...data.programs].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((p) => `${p.name} at ${p.school}, due ${fmtDate(p.dueDate)}`).join("; ")}.
          Answer in full sentences, as if you were writing the letter. More detail is better; the draft trims it. {data.studentName} cannot see your answers.
        </p>
      )}
      <div className="progress">Question {i + 1} of {data.questions.length}, {answered} answered</div>
      <p className="question" key={q.id}>{askFollowUp ? FOLLOW_UP : q.prompt}</p>
      {!askFollowUp && <p className="opener">Start with: “{q.opener}”</p>}
      {showFacts && q.memoryJog && <div className="memory">{q.memoryJog}</div>}

      <label htmlFor="answer" className="hint" style={{ margin: 0 }}>{askFollowUp ? "Add a specific moment, or move on." : "Type, or use your device's dictation."}</label>
      <textarea id="answer" className="answer" disabled={!ready} value={ready ? (askFollowUp ? entry.followUp : entry.text) : ""}
        onChange={(e) => (askFollowUp ? edit({ followUp: e.target.value }) : edit({ text: e.target.value }))} />

      <div className="actions">
        {isLast
          ? <button className="primary" disabled={finishing || (answered === 0 && !entry.text.trim())} onClick={finish}>{finishing ? "Building your draft…" : data.finished ? "Rebuild my draft" : "Finish and build draft"}</button>
          : <button className="primary" onClick={next}>{askFollowUp ? "Next question" : "Save and continue"}</button>}
        {i > 0 && <button onClick={() => go(i - 1)}>Back</button>}
        {!askFollowUp && <button className="quiet" onClick={skip}>Skip</button>}
        {q.memoryJog && !showFacts && <button className="quiet" onClick={() => setShowFacts(true)}>Show the student's notes</button>}
        {dictation.supported && <button className="quiet" aria-pressed={dictation.listening} onClick={dictation.toggle}>{dictation.listening ? "Stop dictation" : "Dictate"}</button>}
        <span className="saved" aria-live="polite">{saved}</span>
      </div>
      {!isLast && answered > 0 && <p style={{ marginTop: "2rem" }}><button className="quiet" onClick={() => go(data.questions.length - 1)}>Jump to the last question</button></p>}
      {error && <p className="error">{error}</p>}
    </div></main>
  );
}
