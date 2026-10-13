import type { EventEmitter } from 'node:events';

// Ends the process once nothing is using it. Closing stdin means the client
// is gone. idleMinutes (from MCP_IDLE_EXIT_MINUTES) covers clients such as the
// Codex app that start one server per thread and keep them all alive until
// the app quits; without it they accumulate and run stale builds.
export function exitWhenUnused(
  stdin: EventEmitter,
  idleMinutes: number | undefined,
  exit: () => void = () => process.exit(0),
): void {
  stdin.on('end', exit);
  if (!idleMinutes || idleMinutes <= 0) return;
  let timer: NodeJS.Timeout;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(exit, idleMinutes * 60_000);
  };
  stdin.on('data', arm);
  arm();
}
