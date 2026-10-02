import type { Dictionary } from "@/i18n/dictionary";
import type { RewriteState } from "@/lib/sky/rewrite";

/**
 * What the rewrite says about itself, over the sky: in A the divergence (original against new), in B and C that the
 * life is being rewritten and how far it has got, and the reason when it failed (the old life is back by then).
 */
export function RewriteCard({ state, firstName, dict }: { state: RewriteState; firstName: string; dict: Dictionary["chronicle"] }) {
  const { phase, fork, live, error } = state;
  if (phase === "idle" && error) {
    return (
      <p className="sky-rewrite error" role="alert">
        {error}
      </p>
    );
  }
  if (!fork) return null;
  if (phase === "A") {
    return (
      <div className="sky-rewrite" role="status">
        <div className="mark">{dict.modal.diverges}</div>
        <div className="row">
          <b>{dict.modal.original}</b>
          <span>{fork.originalLabel}</span>
        </div>
        <div className="row new">
          <b>{dict.modal.new}</b>
          <span>{fork.newLabel}</span>
        </div>
      </div>
    );
  }
  if (phase === "B" || phase === "C") {
    const now = Math.max(fork.year, Math.floor(live?.frontier ?? fork.year) - 1);
    return (
      <p className="sky-rewrite" role="status">
        <span>
          <span className="dot" />
          {dict.regenerating(firstName, fork.year, now)}
        </span>
      </p>
    );
  }
  return null;
}
