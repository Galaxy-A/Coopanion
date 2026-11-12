/** A display exports receive, merge, step, layout, elements and dispose. */
export function createDisplays(context) {
  const slots = new Map();
  let phase = { blocked: false, enabled: true };
  let position = null;
  let currentLanguage = context.language();
  const syncBody = () => context.body()?.set(merge(context.nativeState()));
  const elements = () => [...slots.values()].flatMap(({ instance }) => instance?.elements || []);
  function mark() { for (const element of elements()) element.dataset.petDisplay = ''; }
  function remove(id) {
    const slot = slots.get(id);
    slots.delete(id);
    slot?.instance?.dispose();
  }
  function catalog(items) {
    const ids = new Set(items.map((item) => item.id));
    for (const id of slots.keys()) if (!ids.has(id)) remove(id);
    for (const item of items) {
      const previous = slots.get(item.id);
      if (previous?.entry === item.entry) {
        previous.packet = item.snapshot;
        previous.instance?.receive(item.snapshot);
        continue;
      }
      remove(item.id);
      const slot = { entry: item.entry, packet: item.snapshot, instance: null };
      slots.set(item.id, slot);
      void import(item.entry).then(({ createDisplay }) => {
        if (slots.get(item.id) !== slot) return;
        slot.instance = createDisplay({ ...context, send: (action) => context.send({ t: 'pet-display', id: item.id, action }) });
        slot.instance.receive(slot.packet);
        slot.instance.step(phase);
        if (position) slot.instance.layout(position);
        mark();
        syncBody();
      }).catch((error) => {
        if (slots.get(item.id) === slot) remove(item.id);
        console.error('Pet display failed', item.id, error);
      });
    }
    mark();
    syncBody();
  }
  function receive(message) {
    if (message.t === 'pet-displays') catalog(message.displays || []);
    else if (message.t === 'pet-display') {
      const slot = slots.get(message.id);
      if (slot) { slot.packet = message.snapshot; slot.instance?.receive(message.snapshot); }
      mark();
    }
  }
  function merge(state) {
    for (const { instance } of slots.values()) if (instance) state = instance.merge(state);
    return state;
  }
  return {
    receive, merge,
    step(value) {
      const nextLanguage = context.language();
      if (nextLanguage !== currentLanguage) {
        const items = [...slots].map(([id, slot]) => ({ id, entry: slot.entry, snapshot: slot.packet }));
        for (const id of slots.keys()) remove(id);
        currentLanguage = nextLanguage;
        catalog(items);
      }
      phase = value;
      for (const { instance } of slots.values()) instance?.step(value);
      mark();
    },
    layout(value) { position = value; for (const { instance } of slots.values()) instance?.layout(value); },
    disconnect() { for (const id of slots.keys()) remove(id); syncBody(); },
    get elements() { return elements(); },
  };
}
