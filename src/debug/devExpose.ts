/** Merge values into window.__mill for poking at from the dev console. No-op in production. */
export function devExpose(values: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __mill?: Record<string, unknown> };
  w.__mill = Object.assign(w.__mill ?? {}, values);
}

/** Input types where keys are text, not shortcuts. Sliders and buttons aren't among them. */
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'password', 'tel', 'url']);

/**
 * True when a key event is someone typing into a text field, which shortcuts must ignore.
 * A focused slider (e.g. the head gate) must not swallow shortcuts: it keeps focus after a
 * drag, and clicking the 3D view doesn't take focus away from it.
 */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  if (t instanceof HTMLInputElement) return TEXT_INPUTS.has(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
}
