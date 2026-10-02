"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { Chronicle, CreateLifeRequest } from "@/contracts/life";
import { createLifeStream } from "@/lib/life-client";
import { initialLive, liveChronicle, liveReducer } from "@/lib/sky/live-model";

/**
 * A life being written, as the sky wants it: `chronicle` is a stand-in that grows with every tick and becomes the
 * saved chronicle at done; `frontier` is how far the clock may run. `start` streams the life, folds each event
 * into the model and calls `onSaved` once, with the saved chronicle. It rejects when the stream errors, so the
 * caller decides what to show; the model is reset first on every start.
 */
export function useLiveLife() {
  const [state, dispatch] = useReducer(liveReducer, initialLive);
  const chronicle = useMemo(() => liveChronicle(state), [state]);

  const start = useCallback(async (request: CreateLifeRequest, onSaved: (saved: Chronicle) => void): Promise<void> => {
    dispatch({ type: "reset" });
    await createLifeStream(request, (event) => {
      if (event.type === "start" || event.type === "tick") dispatch(event);
      else if (event.type === "done") {
        dispatch(event);
        onSaved(event.chronicle);
      } else if (event.type === "error") throw new Error(event.message);
    });
  }, []);

  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  return { chronicle, frontier: state.model?.frontier, saved: state.saved !== null, start, reset };
}
