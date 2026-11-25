// Optional browser dictation via the Web Speech API. Audio never reaches our server.
// Where unsupported (e.g. Firefox), the button hides and device dictation still works in the textarea.
import { useEffect, useRef, useState } from "react";

export function useDictation(onText: (chunk: string) => void) {
  const Rec = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);

  useEffect(() => () => rec.current?.stop(), []);

  function toggle() {
    if (!Rec) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new Rec();
    r.continuous = true;
    r.interimResults = false;
    r.lang = "en-US";
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }
  return { supported: !!Rec, listening, toggle };
}
