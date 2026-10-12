/** Merge values into window.__mill for poking at from the dev console. No-op in production. */
export function devExpose(values: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __mill?: Record<string, unknown> };
  w.__mill = Object.assign(w.__mill ?? {}, values);
}

/** True when a key event is someone typing into a form field, which shortcuts must ignore. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
