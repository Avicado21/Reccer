// Student flow: intake -> generate questions -> review -> send invite.
import { useState } from "react";
import { api } from "../../../lib/api";
import type { Program, Question } from "../../../core/types";
import "../../../styles/reccer.css";

type Step = "intake" | "review" | "sent";
const blankProgram = (): Program => ({ id: "", school: "", name: "", dueDate: "", submission: "upload", description: "" });

export default function NewRequest() {
  const [step, setStep] = useState<Step>("intake");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(new URLSearchParams(location.search).get("id") ?? "");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [f, setF] = useState({ studentName: "", preferredName: "", recommenderName: "", recommenderEmail: "", relationship: "", factSheet: "" });
  const [programs, setPrograms] = useState<Program[]>([blankProgram()]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const setP = (i: number, k: keyof Program) => (e: { target: { value: string } }) =>
    setPrograms(programs.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)));

  async function createAndGenerate() {
    setBusy(true); setError("");
    let id = requestId;
    if (!id) {
      const c = await api.createRequest({ ...f, programs });
      if (!c.ok) { setError(c.error); setBusy(false); return; }
      id = c.data.requestId; setRequestId(id);
    }
    const g = await api.generateQuestions(id);
    setBusy(false);
    if (!g.ok) return setError(g.error);
    setQuestions(g.data.questions); setNotes(g.data.notes); setStep("review");
  }

  async function remove(qid: string) {
    const r = await api.removeQuestion(requestId, qid);
    if (r.ok) setQuestions(r.data.questions); else setError(r.error);
  }

  async function invite() {
    setBusy(true); setError("");
    const r = await api.sendInvite(requestId);
    setBusy(false);
    if (r.ok) setStep("sent"); else setError(r.error);
  }

  if (step === "sent") return (
    <main className="rc"><div className="rc-wrap">
      <h1>Invite sent to {f.recommenderName || "your recommender"}</h1>
      <p>They will get an email with the programs, due dates, and a sign-in link. You will get an email when their draft is ready. You will not see the letter.</p>
      <a href="/student">Back to your requests</a>
    </div></main>
  );

  if (step === "review") return (
    <main className="rc"><div className="rc-wrap">
      <h1>Review the questions</h1>
      <p className="muted">Your recommender answers these out loud or by typing. You can remove questions that do not fit. Required ones stay.</p>
      {notes.length > 0 && <div className="memory">{notes.join("\n")}</div>}
      <ol style={{ paddingLeft: "1.25rem" }}>
        {questions.map((q) => (
          <li key={q.id} style={{ marginBottom: "0.9rem" }}>
            <span style={{ fontFamily: "var(--serif)", fontSize: "1.05rem" }}>{q.prompt}</span>
            {q.programScope !== "all" && <span className="hint">For one program only</span>}
            {q.source !== "fixed" && <button className="quiet" onClick={() => remove(q.id)}>Remove</button>}
          </li>
        ))}
      </ol>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={invite}>{busy ? "Sending invite…" : "Send invite"}</button>
        <button disabled={busy} onClick={createAndGenerate}>Generate new questions</button>
      </div>
    </div></main>
  );

  return (
    <main className="rc"><div className="rc-wrap">
      <h1>Request a letter</h1>
      <p className="muted">One request per recommender. List every program they are writing for.</p>

      <label>Your full name<input value={f.studentName} onChange={set("studentName")} autoComplete="name" /></label>
      <label>What they call you <span className="hint">Optional</span><input value={f.preferredName} onChange={set("preferredName")} /></label>
      <label>Recommender's name<input value={f.recommenderName} onChange={set("recommenderName")} /></label>
      <label>Recommender's email<input type="email" value={f.recommenderEmail} onChange={set("recommenderEmail")} /></label>
      <label>How you know them<input value={f.relationship} onChange={set("relationship")} placeholder="My supervisor at my internship" /></label>
      <label>Background they might want to look up
        <span className="hint">Projects, dates, numbers. Your recommender sees these only if they ask for a reminder. They are never put into the questions or the letter.</span>
        <textarea rows={7} value={f.factSheet} onChange={set("factSheet")} />
      </label>

      <h2>Programs</h2>
      {programs.map((p, i) => (
        <fieldset key={i} style={{ border: "1px solid var(--rule)", borderRadius: 6, padding: "0.5rem 1rem 1rem", marginBottom: "1rem" }}>
          <label>School<input value={p.school} onChange={setP(i, "school")} /></label>
          <label>Program<input value={p.name} onChange={setP(i, "name")} /></label>
          <label>Letter due<input type="date" value={p.dueDate} onChange={setP(i, "dueDate")} /></label>
          <label>What the program is about <span className="hint">Optional. Helps tailor the fit question.</span><input value={p.description} onChange={setP(i, "description")} /></label>
          {programs.length > 1 && <button className="quiet" onClick={() => setPrograms(programs.filter((_, j) => j !== i))}>Remove program</button>}
        </fieldset>
      ))}
      <button onClick={() => setPrograms([...programs, blankProgram()])}>Add another program</button>

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={createAndGenerate}>{busy ? "Writing questions…" : "Create questions"}</button>
      </div>
    </div></main>
  );
}
