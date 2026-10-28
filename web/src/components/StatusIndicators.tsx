import { useApp } from "../lib/store";
import { sttSupported, ttsSupported } from "../lib/voice";

/** Real, verifiable status only — no simulated device telemetry. */
export function StatusIndicators() {
  const { online, status, settings } = useApp();
  const notif = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  const items = [
    { label: online ? "Online" : "Offline", ok: online, title: "Network connection" },
    {
      label: status ? (status.ai === "anthropic" ? "AI linked" : "Demo AI") : "AI …",
      ok: status?.ai === "anthropic",
      warn: status?.ai === "demo",
      title: status?.ai === "demo" ? "No API key on the server: replies are scripted" : "Connected to Claude",
    },
    {
      label: settings.textOnly ? "Text only" : sttSupported() ? "Voice ready" : ttsSupported() ? "Voice out" : "No voice",
      ok: !settings.textOnly && sttSupported(),
      title: "Voice input/output availability in this browser",
    },
    { label: settings.memoryEnabled ? "Memory on" : "Memory off", ok: settings.memoryEnabled, title: "Personal memory" },
    { label: notif === "granted" ? "Alerts on" : "Alerts off", ok: notif === "granted", title: "Notifications permission" },
  ];
  return (
    <ul className="status-row" aria-label="System status">
      {items.map((i) => (
        <li key={i.title} title={i.title} className={i.ok ? "ok" : i.warn ? "warn" : "off"}>
          <span className="dot" aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
