// Quota from Claude Code's stream-json output (`-p --output-format stream-json --verbose`).
//
// Seen in Claude Code 2.1.330 (docs/spike, finding 8):
//   { "type": "rate_limit_event",
//     "rate_limit_info": { "status", "resetsAt", "rateLimitType", ...,
//       "unifiedWindows": { "seven_day": { "utilization": 0..1, "resetsAt": <unix s>, "status" } } } }
// Only utilization and reset time per window are kept; account and overage details are dropped.

/** Windows of the last rate_limit_event in the text, as [{ name, used_pct, resets_at }], or null when there is none. */
export function windowsFromStreamJson(text) {
  let last = null;
  for (const line of text.split('\n')) {
    if (!line.includes('rate_limit_event')) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === 'rate_limit_event' && event.rate_limit_info && typeof event.rate_limit_info === 'object') last = event.rate_limit_info;
    } catch {
      // other output lines
    }
  }
  if (!last) return null;
  const windows = [];
  for (const [name, w] of Object.entries(last.unifiedWindows ?? {})) {
    if (!w || typeof w.utilization !== 'number') continue;
    const out = { name, used_pct: w.utilization * 100 };
    if (typeof w.resetsAt === 'number') out.resets_at = new Date(w.resetsAt * 1000).toISOString();
    windows.push(out);
  }
  return windows;
}
