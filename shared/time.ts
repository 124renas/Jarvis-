// Time helpers that respect the user's IANA timezone.

export function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** "+03:00" style offset of `tz` at instant `at`. */
export function tzOffset(tz: string, at = Date.now()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: safeTimeZone(tz), timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = part?.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+00:00";
}

/**
 * Parse an ISO-8601 date/time. Strings without an explicit offset are
 * interpreted in the user's timezone. Returns epoch ms, or null if invalid.
 */
export function parseUserDate(value: string | null | undefined, tz: string): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return parseUserDate(`${v}T09:00:00`, tz);
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(v);
  let ms = Date.parse(hasOffset ? v : `${v}${tzOffset(tz)}`);
  if (!hasOffset && !Number.isNaN(ms)) {
    // Re-evaluate the offset at the target instant to handle DST changes.
    ms = Date.parse(`${v}${tzOffset(tz, ms)}`);
  }
  return Number.isNaN(ms) ? null : ms;
}

export function formatUserTime(ms: number | null, tz: string): string | null {
  if (ms == null) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTimeZone(tz),
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** ISO string with the user's local offset, e.g. 2026-10-28T17:00:00+03:00 */
export function isoInZone(ms: number, tz: string): string {
  const zone = safeTimeZone(tz);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${tzOffset(zone, ms)}`;
}
