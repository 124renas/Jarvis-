import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { EmptyState, ErrorState, PageHeader, Sheet, Spinner } from "../components/ui";
import { api, download, STANDALONE } from "../lib/api";
import { fmtDay, fmtTime, fromLocalInput, startOfDay, toLocalInput } from "../lib/format";
import { haptic } from "../lib/haptics";
import { useApp, useData } from "../lib/store";
import type { CalendarEvent, ParsedItem } from "../lib/types";

const DAY = 864e5;

export function CalendarView() {
  const { toast, bump, online } = useApp();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [selected, setSelected] = useState(() => startOfDay(Date.now()));
  const [editing, setEditing] = useState<Partial<CalendarEvent> | null>(null);
  const [quick, setQuick] = useState("");
  const [adding, setAdding] = useState(false);

  const monthDate = new Date(month);
  const gridStart = startOfDay(month - ((monthDate.getDay() + 6) % 7) * DAY); // Monday start
  const gridEnd = gridStart + 42 * DAY;
  const { data, loading, error, reload } = useData<{ events: CalendarEvent[] }>(`/events?from=${gridStart}&to=${gridEnd}`, "events", { events: [] });
  // Rounded to the minute so the request URL is stable across renders.
  const [nowMinute] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const upcomingData = useData<{ events: CalendarEvent[] }>(`/events?from=${nowMinute}&to=${nowMinute + 30 * DAY}`, "events", { events: [] });

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (const e of data.events) {
      const k = startOfDay(e.start_at);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [data.events]);

  const days = Array.from({ length: 42 }, (_, i) => startOfDay(gridStart + i * DAY + DAY / 2));
  const dayEvents = byDay.get(selected) ?? [];

  const quickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quick.trim()) return;
    setAdding(true);
    try {
      const { item } = await api<{ item: ParsedItem }>("/assist/parse", { body: { text: quick, kind: "event" } });
      if (!item.at) {
        setEditing({ title: item.title, start_at: selected + 9 * 3600_000, location: item.location, notes: item.notes });
        toast("I couldn't find a time. Please pick one.");
      } else {
        await api("/events", { body: { title: item.title, start_at: item.at, end_at: item.end, location: item.location, notes: item.notes } });
        haptic("success");
        bump("events");
        setSelected(startOfDay(item.at));
        toast(`Event added: ${item.title}`, "success");
      }
      setQuick("");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setAdding(false);
    }
  };

  const save = async (ev: Partial<CalendarEvent>) => {
    try {
      const body = {
        title: ev.title,
        start_at: ev.start_at,
        end_at: ev.end_at ?? null,
        all_day: !!ev.all_day,
        location: ev.location ?? "",
        notes: ev.notes ?? "",
      };
      if (ev.id) await api(`/events/${ev.id}`, { method: "PATCH", body });
      else await api("/events", { body });
      setEditing(null);
      bump("events");
      haptic("success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const remove = async (ev: Partial<CalendarEvent>) => {
    try {
      await api(`/events/${ev.id}`, { method: "DELETE" });
      setEditing(null);
      bump("events");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const shiftMonth = (n: number) => setMonth(new Date(monthDate.getFullYear(), monthDate.getMonth() + n, 1).getTime());

  return (
    <section className="page" aria-label="Calendar">
      <PageHeader
        title="Calendar"
        subtitle={STANDALONE ? "Your JARVIS calendar · send events to Apple Calendar with “Add to Calendar”" : "Your JARVIS calendar · syncs to Apple Calendar via subscription"}
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing({ title: "", start_at: selected + 9 * 3600_000, end_at: selected + 10 * 3600_000 })}>
            <Icon name="plus" size={18} /> Event
          </button>
        }
      />

      <form className="quick-add glass" onSubmit={quickAdd}>
        <Icon name="sparkle" size={18} />
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="e.g. Lunch with Sara Thursday 1pm at Café Lumière"
          aria-label="Add an event in natural language"
          disabled={adding}
        />
        <button type="submit" className="btn small primary" disabled={adding || !quick.trim() || !online}>
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      <div className="calendar-layout">
        <div className="month glass">
          <div className="month-head">
            <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <Icon name="left" />
            </button>
            <h2>{monthDate.toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
            <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
              <Icon name="right" />
            </button>
          </div>
          <div className="month-grid" role="grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d} className="dow" role="columnheader">
                {d.slice(0, 1)}
              </span>
            ))}
            {days.map((d) => {
              const date = new Date(d);
              const count = byDay.get(d)?.length ?? 0;
              const cls = [
                "day",
                date.getMonth() !== monthDate.getMonth() ? "out" : "",
                d === startOfDay(Date.now()) ? "today" : "",
                d === selected ? "selected" : "",
              ].join(" ");
              return (
                <button key={d} type="button" className={cls} onClick={() => setSelected(d)} aria-label={`${fmtDay(d)}, ${count} events`} aria-pressed={d === selected}>
                  {date.getDate()}
                  {count > 0 && <span className="dots" aria-hidden="true">{"•".repeat(Math.min(count, 3))}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="agenda">
          <h2 className="group-title">{fmtDay(selected)}</h2>
          {loading ? (
            <Spinner />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : dayEvents.length === 0 ? (
            <p className="muted small">Nothing scheduled.</p>
          ) : (
            <EventList events={dayEvents} onOpen={setEditing} />
          )}

          <h2 className="group-title">Next 30 days</h2>
          {upcomingData.loading ? (
            <Spinner />
          ) : upcomingData.data.events.length === 0 ? (
            <EmptyState icon="calendar" title="No upcoming events">
              Add one above or ask JARVIS: “Schedule a dentist appointment next Tuesday at 3.”
            </EmptyState>
          ) : (
            <EventList events={upcomingData.data.events.slice(0, 20)} onOpen={setEditing} showDate />
          )}
        </div>
      </div>

      {editing && (
        <EventSheet event={editing} onClose={() => setEditing(null)} onSave={save} onDelete={remove} />
      )}
    </section>
  );
}

function EventList({ events, onOpen, showDate }: { events: CalendarEvent[]; onOpen(e: CalendarEvent): void; showDate?: boolean }) {
  return (
    <ul className="event-list">
      {events.map((e) => (
        <li key={e.id}>
          <button type="button" className="event glass" onClick={() => onOpen(e)}>
            <span className="event-time">
              {showDate && <small>{new Date(e.start_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</small>}
              {e.all_day ? "All day" : fmtTime(e.start_at)}
            </span>
            <span className="event-main">
              <span className="event-title">{e.title}</span>
              {e.location && (
                <span className="event-loc">
                  <Icon name="pin" size={13} /> {e.location}
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EventSheet({
  event,
  onClose,
  onSave,
  onDelete,
}: {
  event: Partial<CalendarEvent>;
  onClose(): void;
  onSave(e: Partial<CalendarEvent>): void;
  onDelete(e: Partial<CalendarEvent>): void;
}) {
  const [e, setE] = useState(event);
  return (
    <Sheet title={e.id ? "Edit event" : "New event"} onClose={onClose}>
      <form
        className="form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (e.title?.trim() && e.start_at) onSave(e);
        }}
      >
        <label>
          Title
          <input value={e.title ?? ""} onChange={(x) => setE({ ...e, title: x.target.value })} required maxLength={300} />
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={!!e.all_day} onChange={(x) => setE({ ...e, all_day: x.target.checked })} /> All day
        </label>
        <div className="form-2col">
          <label>
            Starts
            <input
              type="datetime-local"
              required
              value={toLocalInput(e.start_at ?? null)}
              onChange={(x) => {
                const start = fromLocalInput(x.target.value);
                const dur = e.end_at && e.start_at ? e.end_at - e.start_at : 3600_000;
                setE({ ...e, start_at: start ?? undefined, end_at: start ? start + dur : e.end_at });
              }}
            />
          </label>
          <label>
            Ends
            <input type="datetime-local" value={toLocalInput(e.end_at ?? null)} onChange={(x) => setE({ ...e, end_at: fromLocalInput(x.target.value) })} />
          </label>
        </div>
        <label>
          Location
          <input value={e.location ?? ""} onChange={(x) => setE({ ...e, location: x.target.value })} maxLength={300} />
        </label>
        <label>
          Notes
          <textarea rows={3} value={e.notes ?? ""} onChange={(x) => setE({ ...e, notes: x.target.value })} />
        </label>
        <div className="row-between">
          <div className="row">
            {e.id && (
              <button type="button" className="btn danger ghost" onClick={() => onDelete(e)}>
                <Icon name="trash" size={18} /> Delete
              </button>
            )}
            {e.id && (
              <button type="button" className="btn ghost" onClick={() => download(`/api/events/${e.id}/ics`)} title="Opens in Apple Calendar">
                <Icon name="download" size={18} /> Add to Calendar
              </button>
            )}
          </div>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}
