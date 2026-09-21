"use client";

import { useState } from "react";

interface CauseNode {
  eventId: string;
  year: number;
  kind: string;
  prose: string;
  causes: CauseNode[];
}

function CauseTree({ node, depth }: { node: CauseNode; depth: number }) {
  return (
    <li className="relative pl-4" style={{ marginLeft: depth > 0 ? "0.75rem" : 0 }}>
      <div className="border-l-2 border-border pl-3">
        <p className="text-sm">
          <span className="font-label text-xs text-muted-foreground">{node.year}</span> — {node.prose}
        </p>
        {node.causes.length > 0 && (
          <ul className="mt-1 space-y-1">
            {node.causes.map((c) => (
              <CauseTree key={c.eventId} node={c} depth={depth + 1} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function CauseChainButton({ worldId, branchId, eventId }: { worldId: string; branchId: string; eventId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chain, setChain] = useState<CauseNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (chain) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/worlds/${worldId}/causes?branchId=${branchId}&eventId=${eventId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the causal chain.");
      setChain(data.chain);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={toggle} className="cursor-pointer font-label text-[11px] uppercase tracking-widest text-brass underline-offset-4 hover:underline">
        {open ? "Hide why" : "Why?"}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-background-alt/60 p-3">
          {loading && <p className="text-sm text-muted-foreground">Tracing causes...</p>}
          {error && <p className="text-sm text-crimson">{error}</p>}
          {chain && chain.causes.length === 0 && !loading && <p className="text-sm text-muted-foreground">No recorded prior cause — this appears to be a root event.</p>}
          {chain && chain.causes.length > 0 && (
            <ul className="space-y-1">
              {chain.causes.map((c) => (
                <CauseTree key={c.eventId} node={c} depth={0} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
