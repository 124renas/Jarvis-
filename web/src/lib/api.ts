import type { ChatEvent } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[];

const offlineMessage = () => (navigator.onLine ? "Can't reach the JARVIS server." : "You're offline.");

export async function api<T = any>(path: string, opts: { method?: string; body?: Json; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, offlineMessage());
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("jarvis:unauthorized"));
    throw new ApiError(res.status, (data as any).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** POSTs a chat message and delivers Server-Sent Events as they arrive. */
export async function streamChat(body: Json, onEvent: (e: ChatEvent) => void, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw new ApiError(0, offlineMessage());
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event("jarvis:unauthorized"));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* ignore a malformed chunk */
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw new ApiError(0, "The connection was interrupted.");
  }
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Downscale photos before upload (also converts HEIC to JPEG on iOS). */
export async function prepareImage(file: File, maxSide = 1568): Promise<{ data: string; mediaType: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg" };
  } catch {
    return { data: await fileToBase64(file), mediaType: file.type || "image/jpeg" };
  }
}

export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
