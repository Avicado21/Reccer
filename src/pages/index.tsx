/**
 * Landing page — a STATIC page (top level of src/pages/): no auth fetch, no
 * records WebSocket, prerendered at build. The app lives under /home.
 * Keep it renderable without a browser (no window/document during render).
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import '../styles/reccer.css'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <main data-testid="static-landing" className="rc">
        <div className="rc-wrap">
          <p className="muted">Reccer</p>
          <h1>AI assisted, not AI generated, letters of recommendation.</h1>
          <p>
            A student sets up the request. Their recommender answers a short interview, by voice or by
            typing. Reccer turns those answers into a draft letter made of the recommender&apos;s own
            words, checks that nothing in it was invented, and lets them edit and export it.
          </p>
          <h2>How it works</h2>
          <ol style={{ paddingLeft: '1.25rem' }}>
            <li>The student lists the programs and due dates and reviews the interview questions.</li>
            <li>The recommender gets an email invite and signs in with their own account.</li>
            <li>They answer one question at a time. Answers save as they go.</li>
            <li>
              Reccer drafts one letter per program from those answers and highlights anything it could
              not trace back to what they said.
            </li>
          </ol>
          <p className="muted">
            The student sees progress only. The answers, the draft, and the letter stay with the
            recommender.
          </p>
          <div className="actions">
            <Link to="/home">
              <button className="primary">Open Reccer</button>
            </Link>
          </div>
        </div>
      </main>
    </>
  )
}
