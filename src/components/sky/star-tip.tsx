import type { Ref } from "react";

/** The star tooltip's shell. Its three lines are filled, shown and placed by the focus controller. */
export function StarTip({ tipRef }: { tipRef: Ref<HTMLDivElement> }) {
  return (
    <div ref={tipRef} className="sky-tip" role="tooltip" hidden>
      <span className="r" />
      <b />
      <span className="s" />
    </div>
  );
}
