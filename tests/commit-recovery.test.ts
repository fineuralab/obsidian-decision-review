import test from 'node:test';
import assert from 'node:assert/strict';
import { addReview, ConflictError } from '../src/domain';
import { DecisionStore, LessonSavedError } from '../src/store';
import { decision, MemoryPort } from './helpers';

const review = (revision: string) => ({ recordRevisionId: revision, reviewDate: '2026-01-10', actual: '已确认的事实', outcome: 'partial' as const, lesson: '保留成功写入', references: [], followup: 'unscheduled' as const, nextReviewDate: null });
async function setup(reviewed = false) {
  const port = new MemoryPort(), store = new DecisionStore(port, '记录');
  let d = decision(); if (reviewed) d = addReview(d, review(d.original.id));
  port.files.set('普通资料.md', '# 保留普通资料'); await store.create(d);
  return { port, store, entry: store.entries[0]! };
}

test('commit recovery: losing a create acknowledgement never creates a second decision', async () => {
  const port = new MemoryPort(), store = new DecisionStore(port, '记录'), d = decision();
  const write = port.write.bind(port); let once = true;
  port.write = async (...args) => { await write(...args); if (once) { once = false; throw new Error('acknowledgement lost after commit'); } };
  await assert.rejects(store.create(d)); await store.load();
  assert.deepEqual(store.entries[0]?.decision, d);
  await assert.rejects(store.create(d)); assert.equal(port.files.size, 1);
});

test('commit recovery: a stale retry cannot append a review twice after a committed write reports failure', async () => {
  const { port, store, entry } = await setup(), write = port.write.bind(port); let once = true;
  port.write = async (...args) => { await write(...args); if (once) { once = false; throw new Error('acknowledgement lost after commit'); } };
  await assert.rejects(store.update(entry, d => addReview(d, review(d.original.id))));
  await store.load(); await assert.rejects(store.update(entry, d => addReview(d, review(d.original.id))), ConflictError);
  assert.equal(store.entries[0]?.decision.reviews.length, 1); assert.deepEqual(store.entries[0]?.decision.original, entry.decision.original);
  assert.equal(port.files.get('普通资料.md'), '# 保留普通资料');
});

test('commit recovery: a lesson copy whose acknowledgement was lost is rediscovered and linked on retry', async () => {
  const { port, store, entry } = await setup(true), write = port.write.bind(port); let once = true;
  port.write = async (...args) => { await write(...args); if (args[0] !== entry.path && once) { once = false; throw new Error('lesson acknowledgement lost'); } };
  await assert.rejects(store.saveLesson(entry, entry.decision.reviews[0]!.id, '经验', '保留经验原文', true));
  const path = await store.saveLesson(entry, entry.decision.reviews[0]!.id, '经验', '保留经验原文', true);
  assert.equal(store.lessons.length, 1); assert.equal(store.entries[0]?.decision.lessonLinks.length, 1);
  assert.equal(store.lessons[0]?.path, path); assert.ok(port.files.get(path)?.includes('保留经验原文'));
});

test('commit recovery: an acknowledged-as-failed source index keeps exactly one lesson and one link', async () => {
  const { port, store, entry } = await setup(true), write = port.write.bind(port); let once = true;
  port.write = async (...args) => { await write(...args); if (args[0] === entry.path && once) { once = false; throw new Error('index acknowledgement lost'); } };
  await assert.rejects(store.saveLesson(entry, entry.decision.reviews[0]!.id, '经验', '独立原文'), LessonSavedError);
  await store.load(); await assert.rejects(store.saveLesson(entry, entry.decision.reviews[0]!.id, '经验', '独立原文'), ConflictError);
  const path = await store.saveLesson(store.entries[0]!, entry.decision.reviews[0]!.id, '经验', '独立原文');
  assert.equal(store.lessons.length, 1); assert.equal(store.entries[0]?.decision.lessonLinks.length, 1); assert.equal(store.lessons[0]?.path, path);
});

test('commit recovery: a trash acknowledgement failure never repeats deletion or removes independent files', async () => {
  const { port, store, entry } = await setup(true);
  const path = await store.saveLesson(entry, entry.decision.reviews[0]!.id, '保留经验', '独立经验原文');
  const current = store.entries[0]!, trash = port.trash.bind(port); let once = true;
  port.trash = async (...args) => { await trash(...args); if (once) { once = false; throw new Error('trash acknowledgement lost'); } };
  await assert.rejects(store.remove(current)); await store.load(); await assert.rejects(store.remove(current), ConflictError);
  assert.equal(port.trashed.length, 1); assert.equal(store.entries.length, 0);
  assert.ok(port.files.has(path)); assert.equal(port.files.get('普通资料.md'), '# 保留普通资料');
});
