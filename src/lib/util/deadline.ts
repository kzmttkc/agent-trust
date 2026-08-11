/**
 * Deadlines — turning slowness into something the degradation path can catch.
 *
 * WHY (2026-08-12 incident). The scoring engine wraps every optional chain
 * signal in try/catch so an unavailable upstream degrades to an
 * `*_unavailable` flag and a more cautious verdict — the documented
 * "fail-closed, not fail-wrong" contract. That handler only ever fires on a
 * REJECTION. A dependency that is merely SLOW is invisible to it: the await
 * simply sits there, the honest degradation never runs, and the caller's whole
 * time budget is consumed. In production a 7-day eth_getLogs scan took ~30s
 * against an 8s budget, so /api/demo/score and /agent/[id] both returned
 * "unavailable" by timeout rather than by the designed fallback.
 *
 * A deadline converts "too slow" into "rejected", which is the only shape the
 * existing fail-closed logic can act on. It never makes a verdict more
 * permissive — a missing signal is penalized, not assumed good.
 */

export class DeadlineExceededError extends Error {
  readonly label: string;
  readonly budgetMs: number;

  constructor(label: string, budgetMs: number) {
    super(`deadline_exceeded:${label}:${budgetMs}ms`);
    this.name = "DeadlineExceededError";
    this.label = label;
    this.budgetMs = budgetMs;
  }
}

/**
 * Resolve `work` if it settles within `budgetMs`, otherwise reject with
 * DeadlineExceededError. An underlying rejection is passed through untouched
 * so a real error is never mislabelled as a timeout.
 *
 * The timer is always cleared — a leaked handle would keep a serverless
 * invocation (or a test run) alive past its work.
 */
export function withDeadline<T>(work: Promise<T>, budgetMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DeadlineExceededError(label, budgetMs)),
      Math.max(0, budgetMs),
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type Deadline = {
  /** Milliseconds left, clamped at 0. Infinity when unbounded. */
  remaining(): number;
  expired(): boolean;
  /** Budget for one step: the smaller of its own allowance and what's left overall. */
  budgetFor(stepMs: number): number;
  throwIfExpired(label: string): void;
};

/**
 * A shared wall-clock budget for a multi-step operation.
 *
 * Per-step timeouts alone do not bound a SEQUENCE: six steps at 2s each is a
 * 12s worst case inside an 8s request. Steps take their budget from this
 * shared deadline so the total can never exceed it.
 */
export function createDeadline(totalMs?: number): Deadline {
  const expiresAt = totalMs === undefined ? null : Date.now() + Math.max(0, totalMs);

  const remaining = () => (expiresAt === null ? Infinity : Math.max(0, expiresAt - Date.now()));

  return {
    remaining,
    expired: () => remaining() <= 0,
    budgetFor: (stepMs: number) => Math.min(stepMs, remaining()),
    throwIfExpired(label: string) {
      if (remaining() <= 0) {
        throw new DeadlineExceededError(label, totalMs ?? 0);
      }
    },
  };
}
