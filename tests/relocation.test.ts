import test from 'node:test';
import assert from 'node:assert/strict';
import { arrange } from '../src/domain';
import { DecisionStore } from '../src/store';
import { decision, MemoryPort } from './helpers';

function holdNextList(port: MemoryPort) {
  const original = port.list.bind(port);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let once = true;
  port.list = async folder => { if (once) { once = false; started(); await gate; } return original(folder); };
  return { release, ready };
}
async function blockedLoad(port: MemoryPort, store: DecisionStore) {
  const gate = holdNextList(port), load = store.load(); await gate.ready;
  return { release: gate.release, load };
}

for (const operation of ['create', 'update', 'remove'] as const) {
  test(`relocation: an in-flight ${operation} rechecks its folder after waiting for storage`, async () => {
    const port = new MemoryPort(), store = new DecisionStore(port, '父目录/旧目录'); await store.create(decision());
    const entry = store.entries[0]!, gate = holdNextList(port);
    const operationResult = operation === 'create' ? store.create(decision()) : operation === 'update' ? store.update(entry, d => arrange(d, null)) : store.remove(entry);
    const rejected = assert.rejects(operationResult);
    await gate.ready; const switched = store.changeFolder('父目录'); gate.release();
    await rejected; await switched;
    assert.equal(port.files.get(entry.path), entry.source); assert.equal(port.files.size, 1);
    assert.equal(port.trashed.length, 0);
  });
}

test('relocation: a create queued behind a folder switch cannot write into the new scope', async () => {
  const port = new MemoryPort(), store = new DecisionStore(port, '旧目录');
  const { release, load } = await blockedLoad(port, store);
  const switched = store.changeFolder('新目录');
  const pending = assert.rejects(store.create(decision()));
  release(); await load; await switched; await pending;
  assert.equal(port.files.size, 0);
  await store.create(decision()); assert.equal(store.entries.length, 1, 'a new request after the switch is writable');
});

for (const operation of ['update', 'remove'] as const) {
  test(`relocation: a queued ${operation} from the old scope cannot modify a record exposed by its parent folder`, async () => {
    const port = new MemoryPort(), store = new DecisionStore(port, '父目录/旧目录'); await store.create(decision());
    const entry = store.entries[0]!, { release, load } = await blockedLoad(port, store);
    const switched = store.changeFolder('父目录');
    const pending = assert.rejects(operation === 'update' ? store.update(entry, d => arrange(d, null)) : store.remove(entry));
    release(); await load; await switched; await pending;
    assert.equal(port.files.get(entry.path), entry.source);
    assert.equal(port.trashed.length, 0);
  });
}
