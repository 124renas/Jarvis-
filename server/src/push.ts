// Web Push reminders. On iOS/iPadOS 16.4+ these work once JARVIS is added to
// the Home Screen and the user grants notification permission.
import webpush from "web-push";
import { config } from "./config.js";
import type { DB } from "./db.js";
import { kvGet, kvSet, now } from "./db.js";

let vapidPublicKey = "";

export function initPush(db: DB): string {
  let { publicKey, privateKey } = config.vapid;
  if (!publicKey || !privateKey) {
    const stored = kvGet(db, "vapid");
    if (stored) ({ publicKey, privateKey } = JSON.parse(stored));
    else {
      ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
      kvSet(db, "vapid", JSON.stringify({ publicKey, privateKey }));
    }
  }
  webpush.setVapidDetails(config.vapid.subject, publicKey, privateKey);
  vapidPublicKey = publicKey;
  return publicKey;
}

export const getVapidPublicKey = () => vapidPublicKey;

export async function sendToUser(db: DB, userId: number, payload: { title: string; body: string; url?: string; tag?: string }) {
  const subs = db.prepare("SELECT id, json FROM push_subscriptions WHERE user_id = ?").all(userId) as { id: number; json: string }[];
  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(JSON.parse(sub.json), JSON.stringify(payload), { TTL: 3600 });
      delivered++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
      } else {
        console.warn("[push] delivery failed:", err?.statusCode ?? err?.message);
      }
    }
  }
  return delivered;
}

/** Sends due-task and upcoming-event reminders. Runs every 30 seconds. */
export async function runReminderSweep(db: DB) {
  const t = now();
  const dueTasks = db
    .prepare(
      `SELECT t.id, t.user_id, t.title FROM tasks t
       WHERE t.done = 0 AND t.notified = 0 AND t.due_at IS NOT NULL AND t.due_at <= ? AND t.due_at > ?
       AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = t.user_id)`,
    )
    .all(t, t - 6 * 3600_000) as { id: number; user_id: number; title: string }[];
  for (const task of dueTasks) {
    db.prepare("UPDATE tasks SET notified = 1 WHERE id = ?").run(task.id);
    await sendToUser(db, task.user_id, { title: "Task due", body: task.title, url: "/?view=tasks", tag: `task-${task.id}` });
  }
  const soonEvents = db
    .prepare(
      `SELECT e.id, e.user_id, e.title, e.start_at FROM events e
       WHERE e.notified = 0 AND e.start_at <= ? AND e.start_at > ?
       AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = e.user_id)`,
    )
    .all(t + 10 * 60_000, t - 5 * 60_000) as { id: number; user_id: number; title: string; start_at: number }[];
  for (const e of soonEvents) {
    db.prepare("UPDATE events SET notified = 1 WHERE id = ?").run(e.id);
    const mins = Math.max(0, Math.round((e.start_at - t) / 60_000));
    await sendToUser(db, e.user_id, {
      title: e.title,
      body: mins > 0 ? `Starts in ${mins} minute${mins === 1 ? "" : "s"}` : "Starting now",
      url: "/?view=calendar",
      tag: `event-${e.id}`,
    });
  }
}

export function startReminderLoop(db: DB) {
  const timer = setInterval(() => runReminderSweep(db).catch((e) => console.warn("[push] sweep failed", e)), 30_000);
  timer.unref();
  return timer;
}
