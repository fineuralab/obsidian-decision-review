import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, encode } from '../src/codec';
import { DecisionError } from '../src/domain';
import { DecisionStore } from '../src/store';
import { decision, MemoryPort } from './helpers';

for (const folder of ['.decision-review', '记录/.archive/决定']) {
  test(`visibility: an unindexed hidden data folder is rejected before saving (${folder})`, async () => {
    const port = new MemoryPort();
    await assert.rejects(async () => {
      const store = new DecisionStore(port, folder);
      await store.create(decision());
    }, DecisionError);
    assert.equal(port.files.size, 0, 'no decision may be committed to an unindexed data folder');
  });
}

test('visibility: visible folder names containing dots and Unicode still save and reload', async () => {
  const port = new MemoryPort(), folder = '记录.v1/Café e\u0301 中文';
  const store = new DecisionStore(port, folder), d = decision(); await store.create(d);
  const restarted = new DecisionStore(port, folder); await restarted.load();
  assert.equal(restarted.issues.length, 0); assert.deepEqual(restarted.entries[0]?.decision, d);
});

test('visibility: existing hidden reference paths stay readable without rewriting user data', () => {
  const d = decision({ references: [{ kind: 'file', path: '.archive/历史资料.md' }] });
  assert.deepEqual(decode(encode(d))?.decision, d);
});

async function unavailable() {
  const port = new MemoryPort(), store = new DecisionStore(port, '记录'); await store.create(decision());
  const entry = store.entries[0]!, moved = entry.path.replace('记录/', '.archive/');
  port.files.set(moved, entry.source); port.files.delete(entry.path);
  store.markFolderUnavailable('.archive', '目录不可见，请恢复到可见位置。');
  return { port, store, entry, moved };
}

test('visibility: an unavailable moved folder retains its labeled snapshot and refuses every mutation', async () => {
  const { port, store, entry, moved } = await unavailable();
  await store.load(); await store.load();
  assert.equal(store.entries[0]?.blocked, true); assert.equal(store.issues[0]?.path, '.archive');
  await assert.rejects(store.create(decision()), DecisionError);
  await assert.rejects(store.update(entry, d => d), DecisionError);
  await assert.rejects(store.remove(entry), DecisionError);
  assert.equal(port.files.get(moved), entry.source); assert.equal(port.files.size, 1); assert.equal(port.trashed.length, 0);
});

test('visibility: restoring a visible folder clears the unavailable state without losing original content', async () => {
  const { port, store, entry, moved } = await unavailable();
  port.files.set(entry.path, port.files.get(moved)!); port.files.delete(moved);
  await store.changeFolder('记录');
  assert.equal(store.issues.length, 0); assert.equal(store.entries[0]?.blocked, undefined);
  assert.deepEqual(store.entries[0]?.decision, entry.decision);
  await store.update(store.entries[0]!, d => d);
  assert.equal(port.files.size, 1);
});
