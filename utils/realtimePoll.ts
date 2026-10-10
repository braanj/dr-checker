// When to fall back from Realtime broadcasts to polling /api/status:
// only for an unfinished batch, and only when the channel failed or has
// been silent for a while (websockets blocked, or a broadcast-config switch).

export const POLL_SILENCE_MS = 10_000;
export const POLL_INTERVAL_MS = 5_000;

export function shouldPoll(s: {
  status: string | undefined;
  channelFailed: boolean;
  lastBroadcastAt: number;
  now: number;
}): boolean {
  if (s.status === "completed" || s.status === "failed") return false;
  return s.channelFailed || s.now - s.lastBroadcastAt >= POLL_SILENCE_MS;
}
