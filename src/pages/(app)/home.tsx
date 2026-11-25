/**
 * Reccer home (dynamic, inside the (app) data boundary). Signed-in users land
 * here after OAuth; a pending invite link is restored by ClaimReturn in
 * (app)/_layout.tsx before this page matters.
 */

import { useAuthProfileReady } from 'deepspace'
import { Link } from 'react-router-dom'
import '../../styles/reccer.css'

export default function HomePage() {
  const { isSignedIn, user } = useAuthProfileReady({ requireUser: true })

  return (
    <main className="rc">
      <div className="rc-wrap">
        <h1>Reccer</h1>
        {isSignedIn && user && <p className="muted">Signed in as {user.name ?? user.email}</p>}

        <h2>Asking for a letter?</h2>
        <p>
          Set up one request per recommender. List every program they are writing for, review the
          questions, and send the invite. You will see progress, never the letter.
        </p>
        <div className="actions">
          <Link to="/student/new"><button className="primary">Request a letter</button></Link>
          <Link to="/student"><button>My requests</button></Link>
        </div>

        <h2>Writing a letter?</h2>
        <p>
          Open the link in your invite email and sign in with your own Google or GitHub account. Your
          answers and your draft are private to you.
        </p>
      </div>
    </main>
  )
}
