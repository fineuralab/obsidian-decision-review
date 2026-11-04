import test from 'node:test';
import assert from 'node:assert/strict';
import { DecisionError, newDecision } from '../src/domain';
import { serializeSettingsWrite, settleSettingsWrites, stoppedError } from '../src/lifecycle';
import { DecisionStore } from '../src/store';
import { decision, MemoryPort, record } from './helpers';

async function setup() {
  const port = new MemoryPort(), store = new DecisionStore(port, '记录');
  port.files.set('before.md', '# 保留独立资料');
  await store.create(decision({ references: [{ kind: 'file', path: 'before.md' }] }));
  return { port, store, entry: store.entries[0]! };
}

test('lifecycle: closed stores reject old forms, settings changes, demo operations and renames without writing', async () => {
  const { port, store, entry } = await setup(), before = [...port.files];
  store.close(); store.close();
  const operations = [store.create(decision()), store.update(entry, d => d), store.remove(entry), store.saveLesson(entry, 'missing-review', '经验', '内容'), store.loadDemo([newDecision(record(), null, true, 'demo-lifecycle')]), store.clearDemo(), store.handleRename('before.md', 'after.md'), store.changeFolder('新目录'), store.load()];
  await Promise.all(operations.map(operation => assert.rejects(operation, DecisionError)));
  assert.throws(() => store.markFolderUnavailable('记录', '不可用'), DecisionError);
  assert.deepEqual([...port.files], before); assert.equal(port.trashed.length, 0);
});

for (const operation of ['create', 'update', 'remove', 'rename'] as const) {
  test(`lifecycle: stopping while ${operation} waits for storage prevents the pending write`, async () => {
    const { port, store, entry } = await setup(), before = [...port.files], list = port.list.bind(port);
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    port.list = async folder => { started(); await gate; return list(folder); };
    const pending = operation === 'create' ? store.create(decision()) : operation === 'update' ? store.update(entry, d => d) : operation === 'remove' ? store.remove(entry) : store.handleRename('before.md', 'after.md');
    const rejected = assert.rejects(pending, DecisionError);
    await ready; store.close(); release(); await rejected;
    assert.deepEqual([...port.files], before); assert.equal(port.trashed.length, 0);
  });
}

test('lifecycle: settings writes and startup reads stay ordered across instances sharing one vault', async () => {
  const owner = {}, order: string[] = [];
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const oldWrite = serializeSettingsWrite(owner, async () => { order.push('old-start'); started(); await gate; order.push('old-finish'); });
  await ready;
  const newWrite = serializeSettingsWrite(owner, async () => { order.push('new-write'); });
  let read = false; const startup = settleSettingsWrites(owner).then(() => { read = true; order.push('startup-read'); });
  await Promise.resolve(); assert.equal(read, false); assert.deepEqual(order, ['old-start']);
  release(); await Promise.all([oldWrite, newWrite, startup]);
  assert.deepEqual(order, ['old-start', 'old-finish', 'new-write', 'startup-read']);
});

test('lifecycle: a cancelled old settings request cannot poison the new instance queue', async () => {
  const owner = {}; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = serializeSettingsWrite(owner, async () => { await gate; });
  const cancelled = assert.rejects(serializeSettingsWrite(owner, async () => { throw stoppedError(); }), DecisionError);
  let saved = false; const current = serializeSettingsWrite(owner, async () => { saved = true; });
  release(); await Promise.all([first, cancelled, current]); await settleSettingsWrites(owner);
  assert.equal(saved, true);
});

test('lifecycle: a pending settings write in one vault does not block another vault', async () => {
  const firstOwner = {}, secondOwner = {}; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = serializeSettingsWrite(firstOwner, async () => { await gate; });
  let secondSaved = false;
  try { await serializeSettingsWrite(secondOwner, async () => { secondSaved = true; }); await settleSettingsWrites(secondOwner); assert.equal(secondSaved, true); }
  finally { release(); await pending; }
});
