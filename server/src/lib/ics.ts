// Minimal RFC 5545 calendar generation for Apple Calendar subscriptions and
// one-off "Add to Calendar" downloads.
import type { CalendarEvent, Task } from "./store.js";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const stamp = (ms: number) =>
  new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

/** Fold lines longer than 75 octets as required by the spec. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

function eventLines(e: CalendarEvent, host: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:jarvis-event-${e.id}@${host}`, `DTSTAMP:${stamp(e.created_at)}`];
  if (e.all_day) {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.start_at)}`);
    lines.push(`DTEND;VALUE=DATE:${dateOnly((e.end_at ?? e.start_at) + 864e5)}`);
  } else {
    lines.push(`DTSTART:${stamp(e.start_at)}`, `DTEND:${stamp(e.end_at ?? e.start_at + 3600_000)}`);
  }
  lines.push(`SUMMARY:${esc(e.title)}`);
  if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
  if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
  lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, "TRIGGER:-PT10M", "END:VALARM", "END:VEVENT");
  return lines;
}

function taskLines(t: Task, host: string): string[] {
  if (t.due_at == null) return [];
  // Tasks with due dates appear as short events so they show up in Apple Calendar.
  return [
    "BEGIN:VEVENT",
    `UID:jarvis-task-${t.id}@${host}`,
    `DTSTAMP:${stamp(t.created_at)}`,
    `DTSTART:${stamp(t.due_at)}`,
    `DTEND:${stamp(t.due_at + 15 * 60_000)}`,
    `SUMMARY:${esc("☐ " + t.title)}`,
    ...(t.notes ? [`DESCRIPTION:${esc(t.notes)}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(t.title)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
  ];
}

export function buildCalendar(name: string, host: string, events: CalendarEvent[], tasks: Task[] = []): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JARVIS AI//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-PUBLISHED-TTL:PT15M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    ...events.flatMap((e) => eventLines(e, host)),
    ...tasks.flatMap((t) => taskLines(t, host)),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
