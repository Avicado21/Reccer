// Student flow: intake -> generate questions -> review -> send invite -> manage the invite.
// /student/new?id=<requestId> reopens a saved request (getMyRequestIntake): details stay
// editable until the invite goes out; after that the page shows invite status, resend, cancel.
// The student never sees answers, drafts, or letters here or anywhere else.
import { useEffect, useState } from "react";
import { api, type MyRequest } from "../../../../lib/api";
import { describeInvite, fmtDate } from "../../../../core/invite";
import { MAX_NOTE_CHARS } from "../../../../core/email";
import type { Program, Question, StudentIntake } from "../../../../core/types";
import "../../../../styles/reccer.css";

type Step = "loading" | "intake" | "review" | "status";
const blankProgram = (): Program => ({ id: "", school: "", name: "", dueDate: "", submission: "upload", description: "" });
const blankForm = { studentName: "", preferredName: "", pronouns: "", recommenderName: "", recommenderEmail: "", relationship: "", factSheet: "", noteToRecommender: "" };

export default function NewRequest() {
  const [requestId, setRequestId] = useState(new URLSearchParams(location.search).get("id") ?? "");
  const [step, setStep] = useState<Step>(requestId ? "loading" : "intake");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [mine, setMine] = useState<MyRequest | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [f, setF] = useState(blankForm);
  const [programs, setPrograms] = useState<Program[]>([blankProgram()]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const setP = (i: number, k: keyof Program) => (e: { target: { value: string } }) =>
    setPrograms(programs.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)));
  // Built on the saved intake, so fields this form does not show are never dropped by an edit.
  const intake = () => ({ ...(mine?.intake ?? {}), ...f, programs });

  /** Loads the saved request and picks the step it belongs on. */
  async function load(id: string, prefer?: Step) {
    const r = await api.getMyRequestIntake(id);
    if (!r.ok) { setError(r.error); setStep("intake"); return null; }
    const m = r.data;
    setMine(m);
    const i: StudentIntake = m.intake;
    setF({
      studentName: i.studentName, preferredName: i.preferredName ?? "", pronouns: i.pronouns ?? "", recommenderName: i.recommenderName,
      recommenderEmail: i.recommenderEmail, relationship: i.relationship, factSheet: i.factSheet, noteToRecommender: i.noteToRecommender ?? "",
    });
    setPrograms(i.programs.map((p) => ({ ...p, description: p.description ?? "" })));
    setQuestions(m.questions);
    const hasFreshQuestions = m.questions.length > 0 && !m.questionsStale;
    setStep(!m.editable ? "status" : prefer ?? (m.status === "questions-ready" && hasFreshQuestions ? "review" : "intake"));
    return m;
  }
  useEffect(() => { if (requestId) load(requestId); }, []);

  async function generate(id: string) {
    const g = await api.generateQuestions(id);
    if (!g.ok) { setError(g.error); return false; }
    setQuestions(g.data.questions); setNotes((n) => [...n, ...g.data.notes]); setStep("review");
    return true;
  }

  /** New request: create, then write questions. Saved request: save edits, rewrite questions only if they went stale. */
  async function saveAndContinue() {
    setBusy(true); setError(""); setNotes([]); setSaved("");
    try {
      if (!requestId) {
        const c = await api.createRequest(intake());
        if (!c.ok) return setError(c.error);
        setRequestId(c.data.requestId);
        history.replaceState(null, "", `?id=${c.data.requestId}`); // a reload reopens this request
        await generate(c.data.requestId);
        return;
      }
      const u = await api.updateIntake(requestId, intake());
      if (!u.ok) return setError(u.error);
      setNotes(u.data.notes);
      const m = await load(requestId, "intake");
      if (!m) return;
      if (u.data.questionsStale || m.questions.length === 0) await generate(requestId);
      else setStep("review");
    } finally { setBusy(false); }
  }

  async function saveOnly() {
    setBusy(true); setError(""); setSaved("");
    const u = await api.updateIntake(requestId, intake());
    setBusy(false);
    if (!u.ok) return setError(u.error);
    setNotes(u.data.notes);
    setSaved("Changes saved");
    await load(requestId, "intake");
  }

  async function regenerate() {
    setBusy(true); setError(""); setNotes([]);
    await generate(requestId);
    setBusy(false);
  }

  async function remove(qid: string) {
    const r = await api.removeQuestion(requestId, qid);
    if (r.ok) setQuestions(r.data.questions); else setError(r.error);
  }

  async function invite() {
    setBusy(true); setError("");
    const r = await api.sendInvite(requestId);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSaved(`Invite sent to ${r.data.sentTo}`);
    await load(requestId);
  }

  async function cancel() {
    if (!confirm("Cancel this invite? The link in the email will stop working. You can edit the request and send a new one.")) return;
    setBusy(true); setError("");
    const r = await api.cancelInvite(requestId);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSaved("Invite cancelled. You can edit the details and send it again.");
    await load(requestId);
  }

  if (step === "loading") return <main className="rc"><div className="rc-wrap"><p className="muted">Loading your request…</p></div></main>;

  if (step === "status" && mine) {
    const inv = mine.invite;
    const open = mine.status === "invited" && inv && !inv.claimed;
    return (
      <main className="rc"><div className="rc-wrap">
        <h1>{open ? `Invite sent to ${f.recommenderName || "your recommender"}` : `Your request to ${f.recommenderName || "your recommender"}`}</h1>
        <p>{describeInvite(inv)}{inv && !inv.claimed && !inv.cancelled && !inv.expired ? `. The link works until ${fmtDate(inv.expiresAt.slice(0, 10))}.` : "."}</p>
        <ul className="muted" style={{ paddingLeft: "1.25rem" }}>
          {[...programs].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((p) => <li key={p.id}>{p.name}, {p.school}: due {fmtDate(p.dueDate)}</li>)}
        </ul>
        {mine.status === "in-progress" && <p>Your recommender has accepted the invite and is answering the questions.</p>}
        {mine.status === "finished" && <p>Your recommender has a draft. They will review it and submit it to each program themselves.</p>}
        <p className="muted">You get an email when their draft is ready. You will not see the answers or the letter.</p>
        {open && (
          <>
            <div className="actions">
              <button className="primary" disabled={busy || inv.sendsLeft === 0} onClick={invite}>{busy ? "Working…" : "Resend invite"}</button>
              <button disabled={busy} onClick={cancel}>Cancel invite</button>
            </div>
            <p className="hint">
              Resending emails a new link and turns off the old one{inv.sendsLeft > 0 ? ` (${inv.sendsLeft} more ${inv.sendsLeft === 1 ? "send" : "sends"} allowed)` : "; the resend limit is reached"}.
              Cancel to fix the details, such as the email address.
            </p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <p className="saved" aria-live="polite">{saved}</p>
        <a href="/student">Back to your requests</a>
      </div></main>
    );
  }

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
        <button className="primary" disabled={busy} onClick={invite}>{busy ? "Working…" : `Send invite to ${f.recommenderEmail || "your recommender"}`}</button>
        <button disabled={busy} onClick={regenerate}>Generate new questions</button>
        <button className="quiet" disabled={busy} onClick={() => { setError(""); setStep("intake"); }}>Edit details</button>
      </div>
      <p className="saved" aria-live="polite">{saved}</p>
    </div></main>
  );

  return (
    <main className="rc"><div className="rc-wrap">
      <h1>{requestId ? "Edit your request" : "Request a letter"}</h1>
      <p className="muted">One request per recommender. List every program they are writing for.</p>
      {requestId && mine?.questionsStale && notes.length === 0 && <div className="memory">Your changes affect the questions. Save and continue to create them again before sending the invite.</div>}
      {notes.length > 0 && <div className="memory">{notes.join("\n")}</div>}

      <label>Your full name<input value={f.studentName} onChange={set("studentName")} autoComplete="name" /></label>
      <label>What they call you <span className="hint">Optional</span><input value={f.preferredName} onChange={set("preferredName")} /></label>
      <label>Your pronouns <span className="hint">Optional. Used in the questions, e.g. they/them.</span><input value={f.pronouns} onChange={set("pronouns")} /></label>
      <label>Recommender's name<input value={f.recommenderName} onChange={set("recommenderName")} /></label>
      <label>Recommender's email<input type="email" value={f.recommenderEmail} onChange={set("recommenderEmail")} /></label>
      <label>How you know them<input value={f.relationship} onChange={set("relationship")} placeholder="My supervisor at my internship" /></label>
      <label>Background they might want to look up
        <span className="hint">Projects, dates, numbers. Your recommender sees these only if they ask for a reminder. They are never put into the questions or the letter.</span>
        <textarea rows={7} value={f.factSheet} onChange={set("factSheet")} />
      </label>
      <label>A note to your recommender <span className="hint">Optional. Your recommender sees this in the invite email, quoted as a note from you. It is never put into the questions or the letter.</span>
        <textarea rows={4} maxLength={MAX_NOTE_CHARS} value={f.noteToRecommender} onChange={set("noteToRecommender")} placeholder="Thank you for doing this. The first deadline is in December." />
        {f.noteToRecommender.length > MAX_NOTE_CHARS * 0.8 && <span className="hint">{f.noteToRecommender.length.toLocaleString("en-US")} of {MAX_NOTE_CHARS.toLocaleString("en-US")} characters</span>}
      </label>

      <h2>Programs</h2>
      {programs.map((p, i) => (
        <fieldset key={p.id || `new-${i}`} style={{ border: "1px solid var(--rule)", borderRadius: 6, padding: "0.5rem 1rem 1rem", marginBottom: "1rem" }}>
          <label>School<input value={p.school} onChange={setP(i, "school")} /></label>
          <label>Program<input value={p.name} onChange={setP(i, "name")} /></label>
          <label>Letter due<input type="date" value={p.dueDate} onChange={setP(i, "dueDate")} /></label>
          <label>What the program is about <span className="hint">Optional. Helps tailor the fit question.</span><input value={p.description ?? ""} onChange={setP(i, "description")} /></label>
          {programs.length > 1 && <button className="quiet" onClick={() => setPrograms(programs.filter((_, j) => j !== i))}>Remove program</button>}
        </fieldset>
      ))}
      <button onClick={() => setPrograms([...programs, blankProgram()])}>Add another program</button>

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={saveAndContinue}>
          {busy ? "Working…" : !requestId ? "Create questions" : mine?.questionsStale || !mine?.questions.length ? "Save and create questions" : "Save and review questions"}
        </button>
        {requestId && <button disabled={busy} onClick={saveOnly}>Save changes</button>}
        {requestId && <a href="/student"><button className="quiet" disabled={busy}>Back to your requests</button></a>}
      </div>
      <p className="saved" aria-live="polite">{saved}</p>
    </div></main>
  );
}
