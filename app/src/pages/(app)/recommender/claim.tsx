// Landing page from the invite email: /recommender/claim?token=...
// Must sit inside the (app) auth boundary so the recommender signs in first.
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import "../../../styles/reccer.css";

export default function Claim() {
  const [error, setError] = useState("");
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token") ?? "";
    api.claimInvite(token).then((r) => {
      if (r.ok) location.replace(`/recommender/interview?id=${r.data.requestId}`);
      else setError(r.error);
    });
  }, []);
  return (
    <main className="rc"><div className="rc-wrap">
      {error ? <><h1>This invite cannot be opened</h1><p className="error">{error}</p></> : <p className="muted">Opening your invite…</p>}
    </div></main>
  );
}
