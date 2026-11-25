// Optional browser dictation via the Web Speech API. Audio never reaches our server.
// Where unsupported (e.g. Firefox), the button hides and device dictation still works in the textarea.
import { useEffect, useRef, useState } from "react";

export function useDictation(onText: (chunk: string) => void) {
  const Rec = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  // Results arrive asynchronously; always deliver them to the latest handler (the current question).
  const handler = useRef(onText);
  handler.current = onText;

  useEffect(() => () => rec.current?.stop(), []);

  function stop() {
    rec.current?.stop();
    rec.current = null;
    setListening(false);
  }

  function toggle() {
    if (!Rec) return;
    if (listening) { stop(); return; }
    const r = new Rec();
    r.continuous = true;
    r.interimResults = false;
    r.lang = "en-US";
    r.onresult = (e: any) => {
      if (rec.current !== r) return; // stopped (e.g. the question changed); drop late results
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) handler.current(e.results[i][0].transcript.trim());
    };
    r.onend = () => { if (rec.current === r) rec.current = null; setListening(false); };
    r.onerror = () => { if (rec.current === r) rec.current = null; setListening(false); };
    rec.current = r;
    r.start();
    setListening(true);
  }
  return { supported: !!Rec, listening, toggle, stop };
}
