/** Game-level commands the UI can call; the scene fills in the implementations. */
export interface ActionStatus {
  undoLabel: string | null;
  redoLabel: string | null;
  /** Last save/load outcome, shown briefly in the toolbar. */
  message: string | null;
  hasSave: boolean;
}

export class GameActions {
  undo: () => void = () => {};
  redo: () => void = () => {};
  save: () => Promise<void> = async () => {};
  load: () => Promise<void> = async () => {};

  private status: ActionStatus = { undoLabel: null, redoLabel: null, message: null, hasSave: false };
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.status;

  setStatus(patch: Partial<ActionStatus>) {
    const next = { ...this.status, ...patch };
    if (
      next.undoLabel === this.status.undoLabel &&
      next.redoLabel === this.status.redoLabel &&
      next.message === this.status.message &&
      next.hasSave === this.status.hasSave
    )
      return;
    this.status = next;
    for (const fn of this.listeners) fn();
  }
}
