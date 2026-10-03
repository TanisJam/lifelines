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
  if (sel.includes(",")) return sel.split(",").some((part) => matches(el, part.trim()));
  const m = /^([a-z]*)(?:\[([a-z-]+)\])?$/.exec(sel);
  if (!m) return false;
  const [, tag, attr] = m;
  if (tag && el.tag !== tag) return false;
  if (attr && !(attr in el.attrs)) return false;
  return true;
};

export class FakeText {
  parentElement: FakeEl | null = null;
  constructor(public textContent: string) {}
}

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
  childNodes: (FakeEl | FakeText)[] = [];
  dataset: Record<string, string> = {};
  private html = "";
  get children(): FakeEl[] {
    return this.childNodes.filter((node): node is FakeEl => node instanceof FakeEl);
  }
  set children(nodes: FakeEl[]) {
    this.replaceChildren(...nodes);
  }
  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(text: string) {
    this.replaceChildren(...(text ? [new FakeText(text)] : []));
  }
  // Deliberately no HTML parser: controller text must use literal DOM operations.
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(html: string) {
    this.replaceChildren();
    this.html = html;
  }
  hidden = false;
  offsetHeight = 0;
  rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };

  constructor(
    readonly tag = "div",
    attrs: Record<string, string> = {},
    public parentElement: FakeEl | null = null,
  ) {
    Object.entries(attrs).forEach(([name, value]) => this.setAttribute(name, value));
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  append(...nodes: (FakeEl | FakeText)[]) {
    for (const node of nodes) {
      if (node.parentElement) node.parentElement.childNodes = node.parentElement.childNodes.filter((child) => child !== node);
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes: (FakeEl | FakeText)[]) {
    this.childNodes.forEach((node) => (node.parentElement = null));
    this.childNodes = [];
    this.html = "";
    this.append(...nodes);
  }
  /** One cached node per selector, so a controller and the test see the same element. */
  querySelector(sel: string): FakeEl {
    if (!this.found.has(sel)) {
      const child = new FakeEl();
      this.append(child);
      this.found.set(sel, child);
    }
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
  /** Click and key events bubble; hover/focus events remain local like their DOM counterparts. */
  fire(type: string, init: Partial<FakeEvent> = {}, target: FakeEl = this): FakeEvent {
    const ev: FakeEvent = { target, prevented: false, preventDefault() { this.prevented = true; }, ...init };
    this.dispatch(type, ev);
    return ev;
  }
  private dispatch(type: string, ev: FakeEvent) {
    this.listeners.get(type)?.forEach((fn) => fn(ev));
    if (type === "click" || type === "keydown") this.parentElement?.dispatch(type, ev);
  }
  listenerCount(): number {
    let n = 0;
    this.listeners.forEach((set) => (n += set.size));
    return n;
  }
}
