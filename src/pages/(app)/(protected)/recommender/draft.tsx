// The draft: letter on a sheet, proofreader's notes in the margin, source answer on click.
import { useEffect, useMemo, useState } from "react";
import { api, type Draft } from "../../../../lib/api";
import { copyLetter, downloadDocx, printLetter } from "../../../../lib/exports";
import "../../../../styles/reccer.css";

export default function DraftPage() {
  const requestId = new URLSearchParams(location.search).get("id") ?? "";
  const [d, setD] = useState<Draft | null>(null);
  const [tab, setTab] = useState(0);
  const [active, setActive] = useState<string | null>(null); // a sentence id
  const [editText, setEditText] = useState("");
  const [msg, setMsg] = useState("");
  const [sig, setSig] = useState({ name: "", titleLine: "", email: "" });

  const load = () => api.getDraft(requestId).then((r) => (r.ok ? setD(r.data) : setMsg(r.error)));
  useEffect(() => { load(); }, [requestId]);

  // Every assembled sentence by its stable id, and its flags (or, once edited, advisory notes).
  const byId = useMemo(() => new Map((d?.assembly.paragraphs ?? []).flatMap((p) => p.sentences.map((s) => [s.id, s] as const))), [d]);
  const flagsAt = useMemo(() => {
    const m = new Map<string, Draft["flags"]>();
    [...(d?.flags ?? []), ...(d?.advisories ?? [])].forEach((f) => { if (f.sentenceId) m.set(f.sentenceId, [...(m.get(f.sentenceId) ?? []), f]); });
    return m;
  }, [d]);

  if (!d) return <main className="rc"><div className="rc-wrap">{msg ? <p className="error">{msg}</p> : <p className="muted">Loading your draft…</p>}</div></main>;

  const letter = d.letters[tab];
  // Letter sentences carry the assembly's sentence ids, so duplicates never collide.
  const sentenceFlags = (id: string | null) => (id ? flagsAt.get(id) ?? [] : []);
  const activeSentence = active ? byId.get(active) ?? null : null;
  const unused = d.flags.filter((f) => f.kind === "unused-answer");
  const sentenceLevel = d.flags.filter((f) => f.sentenceId);
  const open = (id: string, text: string) => { setActive(id); setEditText(text); };
  const form = d.forms[tab];

  function highlight(text: string, flags: Draft["flags"]) {
    const tokens = flags.map((f) => f.token).filter(Boolean) as string[];
    if (!tokens.length) return text;
    const lower = new Set(tokens.map((t) => t.toLowerCase()));
    const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(re).map((part, k) => (lower.has(part.toLowerCase()) ? <mark key={k} className="flag">{part}</mark> : part));
  }

  async function saveEdit() {
    if (!active) return;
    const r = await api.saveEdit({ requestId, sentenceId: active, text: editText });
    if (r.ok) { setActive(null); setMsg(r.data.reverted ? "Back to the drafted sentence" : "Edit saved"); load(); } else setMsg(r.error);
  }
  async function revert() {
    if (!active) return;
    const r = await api.saveEdit({ requestId, sentenceId: active, text: "" });
    if (r.ok) { setActive(null); setMsg("Back to the drafted sentence"); load(); } else setMsg(r.error);
  }

  const sigReady = sig.name && sig.email;
  const run = async (f: () => unknown, done: string) => { try { await f(); setMsg(done); } catch { setMsg("That did not work. Try again."); } };

  return (
    <main className="rc"><div className="rc-wrap rc-wide">
      <h1>Your draft</h1>
      <p className="muted">Every sentence comes from your answers. Click a sentence to see the answer it came from or to rewrite it. Highlighted words are ones the check could not find in your answers; keep them only if you meant them.</p>
      {d.notes.length > 0 && <div className="memory" role="status">{d.notes.map((n, k) => <p key={k} style={{ margin: "0 0 0.5rem" }}>{n}</p>)}</div>}

      <div className="tabs" role="tablist">
        {d.letters.map((l, k) => <button key={l.programId} role="tab" aria-selected={k === tab} onClick={() => setTab(k)}>{l.title}</button>)}
      </div>

      <div className="draft">
        <article className="sheet" aria-label={`Letter for ${letter.title}`}>
          <p>Dear Members of the Admissions Committee,</p>
          {letter.paragraphs.map((para, pi) => (
            <p key={pi}>{para.map((s, si) => {
              const id = s.sources.includes("TEMPLATE") || !byId.has(s.id) ? null : s.id;
              const on = !!id && active === id;
              return <span key={s.id || si}>
                <span className={id ? `sentence${on ? " active" : ""}` : undefined} tabIndex={id ? 0 : -1}
                  style={id && d.edits[id] !== undefined ? { textDecoration: "underline dotted", textUnderlineOffset: "0.2em" } : undefined}
                  title={id && d.edits[id] !== undefined ? "You edited this sentence" : undefined}
                  onClick={() => { if (id) open(id, s.text); }}
                  onKeyDown={(e) => { if (id && e.key === "Enter") open(id, s.text); }}>
                  {highlight(s.text, sentenceFlags(id))}
                </span>{" "}
              </span>;
            })}</p>
          ))}
          <p>Sincerely,<br />{sig.name || "Your name"}<br />{sig.titleLine}<br />{sig.email}</p>
        </article>

        <aside className="margin">
          {activeSentence ? (
            <>
              <h2 style={{ marginTop: 0 }}>Where this came from</h2>
              {activeSentence.sources.map((id) => {
                const q = d.questions.find((x) => x.id === id);
                const a = d.answers[id];
                return <div key={id} className="source" style={{ marginBottom: "0.75rem" }}>
                  <div className="muted" style={{ fontFamily: "var(--sans)", fontSize: "0.85rem" }}>{q?.prompt ?? id}</div>
                  {a && a !== "SKIPPED" ? a.text : "No answer"}
                </div>;
              })}
              {sentenceFlags(active).map((f, k) => <div key={k} className="note" style={f.advisory ? { borderLeftStyle: "dashed" } : undefined}>{f.advisory ? `Note on your edit: ${f.message}.` : f.message}</div>)}
              <label htmlFor="edit">Rewrite in your words</label>
              <textarea id="edit" rows={4} value={editText} onChange={(e) => setEditText(e.target.value)} />
              <div className="actions">
                <button className="primary" onClick={saveEdit}>Save edit</button>
                {active && d.edits[active] !== undefined && <button onClick={revert}>Undo my edit</button>}
                <button className="quiet" onClick={() => setActive(null)}>Close</button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>Check</h2>
              {sentenceLevel.length === 0
                ? <p className="muted">Nothing in this draft is missing from your answers.</p>
                : sentenceLevel.map((f, k) => <div key={k} className="note">{f.message}</div>)}
              {d.advisories.length > 0 && <p className="muted">{d.advisories.length === 1 ? "One note" : `${d.advisories.length} notes`} on your own edits. Your edits stand; click an edited sentence to see them.</p>}
              {unused.length > 0 && <p className="muted">{unused.length} of your answers did not make it into the draft. Click any sentence to compare.</p>}
            </>
          )}

          <h2>Sign and export</h2>
          <label>Your name<input value={sig.name} onChange={(e) => setSig({ ...sig, name: e.target.value })} /></label>
          <label>Title and organization<input value={sig.titleLine} onChange={(e) => setSig({ ...sig, titleLine: e.target.value })} /></label>
          <label>Email<input type="email" value={sig.email} onChange={(e) => setSig({ ...sig, email: e.target.value })} /></label>
          <div className="actions">
            <button disabled={!sigReady} onClick={() => run(() => copyLetter(letter, sig), "Letter copied")}>Copy text</button>
            <button disabled={!sigReady} onClick={() => run(() => { if (!printLetter(letter, sig)) throw new Error(); }, "Choose “Save as PDF” in the print dialog")}>Save as PDF</button>
            <button disabled={!sigReady} onClick={() => run(() => downloadDocx(letter, sig), "Word file downloaded")}>Download Word file</button>
          </div>
          {!sigReady && <p className="hint">Add your name and email to export.</p>}
          <p className="saved" aria-live="polite">{msg}</p>
        </aside>
      </div>

      {form.answers.length > 0 && (
        <section>
          <h2>{form.title}: recommender form answers</h2>
          <p className="muted">Paste these into the school's form. They use your answers as written, with filler removed.</p>
          {form.answers.map((x) => <div key={x.label} style={{ marginBottom: "1.25rem" }}><strong>{x.label}</strong><p style={{ fontFamily: "var(--serif)" }}>{x.answer}</p></div>)}
        </section>
      )}
    </div></main>
  );
}
