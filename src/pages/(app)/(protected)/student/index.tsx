// Student home: status of each request. Never shows answers or letters.
// Route: /student, under (app)/(protected), whose _layout wraps AuthGate (sign-in required).
import { useEffect, useState } from "react";
import { api, type RequestSummary } from "../../../../lib/api";
import { fmtDate } from "../../../../core/invite";
import "../../../../styles/reccer.css";

const STATUS: Record<string, string> = {
  "draft-intake": "Questions not chosen yet",
  "questions-ready": "Questions ready to send",
  invited: "Invite sent",
  "in-progress": "Your recommender is answering",
  finished: "Your recommender has a draft",
};

export default function StudentHome() {
  const [rows, setRows] = useState<RequestSummary[] | null>(null);
  const [error, setError] = useState("");
  const load = () => api.listMyRequests().then((r) => (r.ok ? setRows(r.data) : setError(r.error)));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  // Polling, not realtime: every collection is client-none (HANDOFF rule 2), so there is nothing to subscribe to.

  return (
    <main className="rc"><div className="rc-wrap">
      <h1>Your letter requests</h1>
      <p className="muted">You will see progress here. Your recommender's answers and letter stay private to them.</p>
      <div className="actions"><a href="/student/new"><button className="primary">Request a letter</button></a></div>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted" style={{ marginTop: "2rem" }}>No requests yet. Start one for each person you are asking.</p>}
      {rows && rows.length > 0 && (
        <ul className="list" style={{ marginTop: "2rem" }}>
          {rows.map((r) => (
            <li key={r.requestId}>
              <div>
                <strong>{r.recommenderName}</strong>
                <div className="muted">{r.programs.map((p) => `${p.name}, due ${fmtDate(p.dueDate)}`).join("; ")}</div>
              </div>
              <div>{r.status === "draft-intake" || r.status === "questions-ready"
                ? <a href={`/student/new?id=${r.requestId}`}>{STATUS[r.status]}</a>
                : STATUS[r.status] ?? r.status}</div>
            </li>
          ))}
        </ul>
      )}
    </div></main>
  );
}
