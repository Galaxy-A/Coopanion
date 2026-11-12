/** In-process display contributions owned and stopped by their World. */
export interface PetDisplay {
  id: string;
  /** Only these named files are served; entry exports createDisplay(context). */
  files: Record<string, string>;
  entry: string;
  snapshot(): unknown;
  onAction?(action: unknown): void | Promise<void>;
}

// Linked source extensions and packaged Worlds share one process registry.
const key = Symbol.for('cortico.desktop-pet.display.v1');
const processState = globalThis as unknown as Record<symbol, {
  displays: Map<string, PetDisplay>;
  listeners: Set<(id?: string) => void>;
}>;
const { displays, listeners } = processState[key] ??= {
  displays: new Map<string, PetDisplay>(),
  listeners: new Set<(id?: string) => void>(),
};

export function petDisplays(): readonly PetDisplay[] { return [...displays.values()]; }

export function watchPetDisplays(listener: (id?: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function registerPetDisplay(display: PetDisplay): { publish(): void; dispose(): void } {
  if (!/^[a-z][a-z0-9-]*$/.test(display.id) || displays.has(display.id)) {
    throw new Error(`Invalid or duplicate pet display: ${display.id}`);
  }
  if (!Object.hasOwn(display.files, display.entry)
    || Object.keys(display.files).some((name) => !/^[a-zA-Z0-9._-]+$/.test(name))) {
    throw new Error(`Invalid pet display files: ${display.id}`);
  }
  displays.set(display.id, display);
  const notify = (id?: string) => { for (const listener of listeners) listener(id); };
  notify();
  return {
    publish() { if (displays.get(display.id) === display) notify(display.id); },
    dispose() {
      if (displays.get(display.id) !== display) return;
      displays.delete(display.id);
      notify();
    },
  };
}
