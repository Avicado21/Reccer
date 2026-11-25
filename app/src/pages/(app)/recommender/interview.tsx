// One question at a time. Answers save on every pause in typing and on each move.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Interview } from "../../../lib/api";
import { useDictation } from "../../../lib/useDictation";
import { fmtDate } from "../../../core/invite";
import "../../../styles/reccer.css";

const FOLLOW_UP = "Can you give me a specific moment?";
const needsFollowUp = (t: string) => (t.match(/[.!?](\s|$)/g)?.length ?? 0) < 2 && t.trim().split(/\s+/).length < 30;

export default function InterviewPage() {
  const requestId = new URLSearchParams(location.search).get("id") ?? "";
  const [data, setData] = useState<Interview | null>(null);
  const [i, setI] = useState(0);
  const [text, setText] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [askFollowUp, setAskFollowUp] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.getInterview(requestId).then((r) => {
      if (!r.ok) return setError(r.error);
      setData(r.data);
      const first = r.data.questions.findIndex((q) => !r.data.answers[q.id]);
      setI(first === -1 ? 0 : first);
    });
  }, [requestId]);

  const q = data?.questions[i];

  useEffect(() => {
    if (!data || !q) return;
    const a = data.answers[q.id];
    setText(a && a !== "SKIPPED" ? a.text : "");
    setFollowUp(a && a !== "SKIPPED" ? a.followUp ?? "" : "");
    setAskFollowUp(!!(a && a !== "SKIPPED" && a.followUp));
    setShowFacts(false);
  }, [i, data?.questions.length]);

  const save = useCallback(async (patch: { text?: string; followUp?: string; skipped?: boolean }) => {
    if (!q) return;
    const r = await api.saveAnswer({ requestId, questionId: q.id, text, followUp, ...patch });
    if (r.ok) {
      setSaved("Saved");
      setData((d) => d && { ...d, answers: { ...d.answers, [q.id]: patch.skipped ? "SKIPPED" : { text: patch.text ?? text, followUp: patch.followUp ?? followUp } } });
    } else setError(r.error);
  }, [q, requestId, text, followUp]);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (!q || !text) return;
    setSaved("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save({}), 1200);
    return () => clearTimeout(timer.current);
  }, [text, followUp]);

  const dictation = useDictation((chunk) => (askFollowUp ? setFollowUp((t) => `${t} ${chunk}`.trim()) : setText((t) => `${t} ${chunk}`.trim())));

  async function next() {
    if (!q) return;
    if (text.trim() && !askFollowUp && needsFollowUp(text)) { setAskFollowUp(true); return; } // one follow-up, then move on
    await save({});
    setI((n) => Math.min(n + 1, data!.questions.length - 1));
  }
  async function skip() { await save({ skipped: true, text: "" }); setI((n) => Math.min(n + 1, data!.questions.length - 1)); }
  async function finish() {
    setFinishing(true); await save({});
    const r = await api.finishInterview(requestId);
    if (r.ok) location.assign(`/recommender/draft?id=${requestId}`); else { setError(r.error); setFinishing(false); }
  }

  if (error && !data) return <main className="rc"><div className="rc-wrap"><h1>This interview cannot be opened</h1><p className="error">{error}</p></div></main>;
  if (!data || !q) return <main className="rc"><div className="rc-wrap"><p className="muted">Loading your questions…</p></div></main>;

  const answered = data.questions.filter((x) => data.answers[x.id]).length;
  const isLast = i === data.questions.length - 1;

  return (
    <main className="rc"><div className="rc-wrap">
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
      <textarea id="answer" className="answer" value={askFollowUp ? followUp : text}
        onChange={(e) => (askFollowUp ? setFollowUp(e.target.value) : setText(e.target.value))} />

      <div className="actions">
        {isLast
          ? <button className="primary" disabled={finishing || answered === 0} onClick={finish}>{finishing ? "Building your draft…" : "Finish and build draft"}</button>
          : <button className="primary" onClick={next}>{askFollowUp ? "Next question" : "Save and continue"}</button>}
        {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
        {!askFollowUp && <button className="quiet" onClick={skip}>Skip</button>}
        {q.memoryJog && !showFacts && <button className="quiet" onClick={() => setShowFacts(true)}>Show the student's notes</button>}
        {dictation.supported && <button className="quiet" aria-pressed={dictation.listening} onClick={dictation.toggle}>{dictation.listening ? "Stop dictation" : "Dictate"}</button>}
        <span className="saved" aria-live="polite">{saved}</span>
      </div>
      {!isLast && answered > 0 && <p style={{ marginTop: "2rem" }}><button className="quiet" onClick={() => setI(data.questions.length - 1)}>Jump to the last question</button></p>}
      {error && <p className="error">{error}</p>}
    </div></main>
  );
}
