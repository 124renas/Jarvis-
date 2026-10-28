// Voice input (Web Speech API recognition) and output (speechSynthesis).
//
// iOS notes:
// - Speech recognition uses Apple's on-device/Siri dictation service. Safari asks
//   for microphone and speech-recognition permission the first time.
// - Speech output must first be started from a user gesture; unlockSpeech() is
//   called on the first tap of the mic or send button.
// - Nothing here listens in the background: recognition only runs while the
//   microphone button is active and the app is open.

type Recognition = any;

const SR: (new () => Recognition) | undefined =
  typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

export const sttSupported = () => !!SR;
export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export interface ListenHandlers {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onEnd(): void;
  onError(message: string): void;
}

export function startListening(h: ListenHandlers, lang = navigator.language || "en-US"): () => void {
  if (!SR) {
    h.onError("Voice input isn't supported in this browser. Use the keyboard's dictation microphone instead.");
    h.onEnd();
    return () => {};
  }
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  let delivered = false;

  rec.onresult = (event: any) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    h.onInterim((finalText + interim).trim());
  };
  rec.onerror = (event: any) => {
    const map: Record<string, string> = {
      "not-allowed": "Microphone or speech-recognition access was denied. Enable it in Settings › Safari (or Settings › JARVIS) › Microphone, then try again.",
      "service-not-allowed": "Speech recognition is unavailable. On iPhone/iPad make sure Siri & Dictation are enabled in Settings.",
      "no-speech": "I didn't catch anything. Tap the microphone and try again.",
      "audio-capture": "No microphone was found.",
      network: "Speech recognition needs a network connection.",
    };
    if (event.error !== "aborted") h.onError(map[event.error] ?? `Voice input error: ${event.error}`);
  };
  rec.onend = () => {
    if (!delivered && finalText.trim()) {
      delivered = true;
      h.onFinal(finalText.trim());
    }
    h.onEnd();
  };
  try {
    rec.start();
  } catch (err) {
    h.onError("Couldn't start voice input.");
    h.onEnd();
  }
  return () => {
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  };
}

// ---------------------------------------------------------------------------
// Speech output

export function listVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  return speechSynthesis.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

export function onVoicesChanged(cb: () => void): () => void {
  if (!ttsSupported()) return () => {};
  speechSynthesis.addEventListener("voiceschanged", cb);
  return () => speechSynthesis.removeEventListener("voiceschanged", cb);
}

/** Prefer a British English voice, in keeping with the JARVIS character. */
export function defaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return (
    voices.find((v) => /daniel/i.test(v.name) && v.lang.startsWith("en-GB")) ??
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang.startsWith(navigator.language.slice(0, 2)) && v.default) ??
    voices.find((v) => v.default)
  );
}

let unlocked = false;
export function unlockSpeech() {
  if (unlocked || !ttsSupported()) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}

/** Turns Markdown into something pleasant to hear. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, " (code shown on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>|#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SpeakerOptions {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
}

type SpeakerState = "idle" | "speaking";

/**
 * Speaks streamed text sentence by sentence so playback starts while the
 * reply is still being generated.
 */
export class Speaker {
  private buffer = "";
  private sentence = "";
  private inCode = false;
  private pending = 0;
  private listeners = new Set<(s: SpeakerState) => void>();
  private boundaryListeners = new Set<() => void>();
  opts: SpeakerOptions = {};

  onState(cb: (s: SpeakerState) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  onBoundary(cb: () => void) {
    this.boundaryListeners.add(cb);
    return () => void this.boundaryListeners.delete(cb);
  }
  private emit(s: SpeakerState) {
    this.listeners.forEach((l) => l(s));
  }

  get speaking() {
    return this.pending > 0;
  }

  /** Feed a streamed delta; complete sentences outside code fences are spoken immediately. */
  feed(delta: string) {
    this.buffer += delta;
    let i = 0;
    while (i < this.buffer.length) {
      if (this.buffer[i] === "`") {
        const ahead = this.buffer.slice(i, i + 3);
        if (ahead.length < 3 && /^`+$/.test(ahead)) break; // maybe a fence split across deltas
        if (ahead === "```") {
          this.inCode = !this.inCode;
          if (!this.inCode) this.sentence += " (code shown on screen). ";
          i += 3;
          continue;
        }
      }
      const ch = this.buffer[i++];
      if (this.inCode) continue;
      this.sentence += ch;
      if (/[.!?]\s$/.test(this.sentence) || /\n\n$/.test(this.sentence)) {
        this.say(this.sentence);
        this.sentence = "";
      }
    }
    this.buffer = this.buffer.slice(i);
  }

  /** Speak whatever remains. */
  flush() {
    if (!this.inCode) this.say(this.sentence + this.buffer.replace(/`/g, ""));
    this.buffer = "";
    this.sentence = "";
    this.inCode = false;
  }

  speakAll(text: string) {
    this.stop();
    this.feed(text);
    this.flush();
  }

  private say(raw: string) {
    const text = speakable(raw);
    if (!text || !ttsSupported()) return;
    const u = new SpeechSynthesisUtterance(text);
    const voice = listVoices().find((v) => v.voiceURI === this.opts.voiceURI) ?? defaultVoice(listVoices());
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = this.opts.rate ?? 1;
    u.pitch = this.opts.pitch ?? 1;
    u.onboundary = () => this.boundaryListeners.forEach((l) => l());
    const done = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) this.emit("idle");
    };
    u.onend = done;
    u.onerror = done;
    this.pending++;
    if (this.pending === 1) this.emit("speaking");
    speechSynthesis.speak(u);
  }

  stop() {
    this.buffer = "";
    this.sentence = "";
    this.inCode = false;
    if (ttsSupported()) speechSynthesis.cancel();
    if (this.pending) {
      this.pending = 0;
      this.emit("idle");
    }
  }
}

export const speaker = new Speaker();
