// The draft: letter on a sheet, proofreader's notes in the margin, source answer on click.
import { useEffect, useMemo, useState } from "react";
import { api, type Draft } from "../../../lib/api";
import { copyLetter, downloadDocx, printLetter } from "../../../lib/exports";
import "../../../styles/reccer.css";

export default function DraftPage() {
  const requestId = new URLSearchParams(location.search).get("id") ?? "";
  const [d, setD] = useState<Draft | null>(null);
  const [tab, setTab] = useState(0);
  const [active, setActive] = useState<{ p: number; s: number } | null>(null);
  const [editText, setEditText] = useState("");
  const [msg, setMsg] = useState("");
  const [sig, setSig] = useState({ name: "", titleLine: "", email: "" });

  const load = () => api.getDraft(requestId).then((r) => (r.ok ? setD(r.data) : setMsg(r.error)));
  useEffect(() => { load(); }, [requestId]);

  // Map each assembled sentence to its flags, keyed by its position in the assembly.
  const flagsAt = useMemo(() => {
    const m = new Map<string, Draft["flags"]>();
    d?.flags.forEach((f) => { if (f.paragraph !== null) { const k = `${f.paragraph}:${f.sentence}`; m.set(k, [...(m.get(k) ?? []), f]); } });
    return m;
  }, [d]);

  if (!d) return <main className="rc"><div className="rc-wrap">{msg ? <p className="error">{msg}</p> : <p className="muted">Loading your draft…</p>}</div></main>;

  const letter = d.letters[tab];
  // Locate a letter sentence back in the assembly so edits and flags line up.
  const locate = (text: string) => {
    for (let p = 0; p < d.assembly.paragraphs.length; p++)
      for (let s = 0; s < d.assembly.paragraphs[p].sentences.length; s++)
        if (d.assembly.paragraphs[p].sentences[s].text === text) return { p, s };
    return null;
  };
  const sentenceFlags = (pos: { p: number; s: number } | null) => (pos ? flagsAt.get(`${pos.p}:${pos.s}`) ?? [] : []);
  const activeSentence = active ? d.assembly.paragraphs[active.p].sentences[active.s] : null;
  const unused = d.flags.filter((f) => f.kind === "unused-answer");
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
    const r = await api.saveEdit({ requestId, paragraph: active.p, sentence: active.s, text: editText });
    if (r.ok) { setActive(null); setMsg("Edit saved"); load(); } else setMsg(r.error);
  }

  const sigReady = sig.name && sig.email;
  const run = async (f: () => unknown, done: string) => { try { await f(); setMsg(done); } catch { setMsg("That did not work. Try again."); } };

  return (
    <main className="rc"><div className="rc-wrap rc-wide">
      <h1>Your draft</h1>
      <p className="muted">Every sentence comes from your answers. Click a sentence to see the answer it came from or to rewrite it. Highlighted words are ones the check could not find in your answers; keep them only if you meant them.</p>

      <div className="tabs" role="tablist">
        {d.letters.map((l, k) => <button key={l.programId} role="tab" aria-selected={k === tab} onClick={() => setTab(k)}>{l.title}</button>)}
      </div>

      <div className="draft">
        <article className="sheet" aria-label={`Letter for ${letter.title}`}>
          <p>Dear Members of the Admissions Committee,</p>
          {letter.paragraphs.map((para, pi) => (
            <p key={pi}>{para.map((s, si) => {
              const pos = s.sources.includes("TEMPLATE") ? null : locate(s.text);
              const on = active && pos && active.p === pos.p && active.s === pos.s;
              return <span key={si}>
                <span className={pos ? `sentence${on ? " active" : ""}` : undefined} tabIndex={pos ? 0 : -1}
                  onClick={() => { if (pos) { setActive(pos); setEditText(s.text); } }}
                  onKeyDown={(e) => { if (pos && e.key === "Enter") { setActive(pos); setEditText(s.text); } }}>
                  {highlight(s.text, sentenceFlags(pos))}
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
              {sentenceFlags(active).map((f, k) => <div key={k} className="note">{f.message}</div>)}
              <label htmlFor="edit">Rewrite in your words</label>
              <textarea id="edit" rows={4} value={editText} onChange={(e) => setEditText(e.target.value)} />
              <div className="actions"><button className="primary" onClick={saveEdit}>Save edit</button><button className="quiet" onClick={() => setActive(null)}>Close</button></div>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>Check</h2>
              {d.flags.filter((f) => f.paragraph !== null).length === 0
                ? <p className="muted">Nothing in this draft is missing from your answers.</p>
                : d.flags.filter((f) => f.paragraph !== null).map((f, k) => <div key={k} className="note">{f.message}</div>)}
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
