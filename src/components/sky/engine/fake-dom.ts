/**
 * A tiny stand-in for the DOM, enough for the imperative controllers (reel, focus) under vitest's node
 * environment: events with listener bookkeeping, `closest`, cached `querySelector` children, a style bag
 * and a class list. Not a general DOM: only what those controllers touch.
 */
type Listener = (ev: FakeEvent) => void;

export interface FakeEvent {
  target: FakeEl;
  key?: string;
  clientX?: number;
  clientY?: number;
  deltaY?: number;
  deltaMode?: number;
  prevented: boolean;
  preventDefault(): void;
}

const matches = (el: FakeEl, sel: string): boolean => {
  const m = /^([a-z]*)(?:\[([a-z-]+)\])?$/.exec(sel);
  if (!m) return false;
  const [, tag, attr] = m;
  if (tag && el.tag !== tag) return false;
  if (attr && !(attr in el.attrs)) return false;
  return true;
};

export class FakeEl {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly attrs: Record<string, string> = {};
  readonly classes = new Set<string>();
  readonly found = new Map<string, FakeEl>();
  readonly style: Record<string, unknown> & { setProperty(name: string, value: string): void } = {
    setProperty(name: string, value: string) {
      this[name] = value;
    },
  };
  readonly classList = {
    contains: (n: string) => this.classes.has(n),
    toggle: (n: string, force?: boolean) => {
      const on = force ?? !this.classes.has(n);
      if (on) this.classes.add(n);
      else this.classes.delete(n);
      return on;
    },
  };
  children: FakeEl[] = [];
  dataset: Record<string, string> = {};
  innerHTML = "";
  textContent = "";
  hidden = false;
  offsetHeight = 0;
  rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };

  constructor(
    readonly tag = "div",
    attrs: Record<string, string> = {},
    public parentElement: FakeEl | null = null,
  ) {
    Object.assign(this.attrs, attrs);
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  append(...nodes: FakeEl[]) {
    this.children.push(...nodes);
  }
  replaceChildren() {
    this.children = [];
  }
  /** One cached node per selector, so a controller and the test see the same element. */
  querySelector(sel: string): FakeEl {
    if (!this.found.has(sel)) this.found.set(sel, new FakeEl());
    return this.found.get(sel)!;
  }
  closest(sel: string): FakeEl | null {
    if (matches(this, sel)) return this;
    return this.parentElement?.closest(sel) ?? null;
  }
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  /** Dispatches to this element's listeners (no bubbling: tests target the element that holds them). */
  fire(type: string, init: Partial<FakeEvent> = {}, target: FakeEl = this): FakeEvent {
    const ev: FakeEvent = { target, prevented: false, preventDefault() { this.prevented = true; }, ...init };
    this.listeners.get(type)?.forEach((fn) => fn(ev));
    return ev;
  }
  listenerCount(): number {
    let n = 0;
    this.listeners.forEach((set) => (n += set.size));
    return n;
  }
}
