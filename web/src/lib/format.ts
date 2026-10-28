export function greeting(name: string, addressAs: string): string {
  const h = new Date().getHours();
  const part = h < 5 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const who = addressAs.trim() || name.split(" ")[0];
  return `Good ${part}${who ? `, ${who}` : ""}.`;
}

export function relativeDue(ms: number | null): { text: string; tone: "overdue" | "soon" | "later" | "none" } {
  if (ms == null) return { text: "No due date", tone: "none" };
  const diff = ms - Date.now();
  const d = new Date(ms);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const today = new Date();
  const tomorrow = new Date(Date.now() + 864e5);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  let text: string;
  if (sameDay(d, today)) text = `Today ${time}`;
  else if (sameDay(d, tomorrow)) text = `Tomorrow ${time}`;
  else text = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ` ${time}`;
  if (diff < 0) return { text: `Overdue · ${text}`, tone: "overdue" };
  return { text, tone: diff < 864e5 ? "soon" : "later" };
}

export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const fmtDay = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
export const fmtShort = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + fmtTime(ms);

/** Value for <input type="datetime-local"> in device local time. */
export function toLocalInput(ms: number | null): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
