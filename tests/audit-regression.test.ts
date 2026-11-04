import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, encode } from '../src/codec';
import { addReview, correctReview, DecisionError, effectiveReview, newDecision, scheduleOf, supplement, validateDecision } from '../src/domain';
import { DecisionStore, LessonSavedError } from '../src/store';
import { decision, MemoryPort, record } from './helpers';

test('audit: retrying a new lesson copy after an index failure reuses the written copy', async () => {
  const port = new MemoryPort(), store = new DecisionStore(port, '决策复盘');
  let d = decision(); d = addReview(d, { recordRevisionId: d.original.id, reviewDate: '2026-01-10', actual: '已确认', outcome: 'met', lesson: '下次先试用', references: [], followup: 'unscheduled', nextReviewDate: null });
  await store.create(d); const entry = store.entries[0]!, reviewId = d.reviews[0]!.id;
  const old = await store.saveLesson(entry, reviewId, '旧经验', '旧正文');
  port.files.delete(old); await store.load(); const current = store.entries[0]!;
  port.failWrite = path => path === current.path;
  await assert.rejects(store.saveLesson(current, reviewId, '经验副本', '副本正文', true), LessonSavedError);
  const written = store.lessons[0]!.path;
  port.failWrite = undefined;
  const retried = await store.saveLesson(current, reviewId, '经验副本', '副本正文', true);
  assert.equal(retried, written, 'retry should link the existing first write');
  assert.equal(store.lessons.length, 1, 'one retry must not create another lesson copy');
  assert.equal(store.entries[0]!.decision.lessonLinks.filter(link => link.path === written).length, 1);
  const explicitCopy = await store.saveLesson(store.entries[0]!, reviewId, '主动再存一份', '另一份正文', true);
  assert.notEqual(explicitCopy, written, 'a separate explicit copy still receives its own path');
  assert.equal(store.lessons.length, 2);
});

test('audit: correcting an old review date can pass its original next-review date without changing the schedule', () => {
  const d = newDecision(record(), '2026-01-10', false, 'audit-history', '2026-01-01T10:00:00.000Z');
  d.reviews.push({ id: 'audit-old-review', createdAt: '2026-01-10T10:00:00.000Z', reviewDate: '2026-01-10', recordRevisionId: d.original.id, actual: '阶段记录', outcome: 'partial', references: [], followup: 'scheduled', nextReviewDate: '2026-01-20' });
  d.updatedAt = '2026-01-10T10:00:00.000Z'; validateDecision(d);
  const corrected = correctReview(d, 'audit-old-review', { ...d.reviews[0]!, reviewDate: '2026-01-25', actual: '更正实际回访日' }, '日期补记错误');
  assert.equal(effectiveReview(corrected, corrected.reviews[0]!).review.reviewDate, '2026-01-25');
  assert.deepEqual(scheduleOf(corrected), scheduleOf(d));
  assert.deepEqual(decode(encode(corrected))!.decision, corrected);
});

test('audit: an oversized update is rejected before writing, preserving the readable source', async () => {
  const port = new MemoryPort(), store = new DecisionStore(port, '决策复盘'); const d = decision();
  const base = encode(d, '\n'); const source = base + 'x'.repeat(10 * 1024 * 1024 - base.length - 16);
  const path = `决策复盘/决策-${d.id}.md`; port.files.set(path, source); await store.load();
  assert.equal(store.entries.length, 1);
  await assert.rejects(store.update(store.entries[0]!, item => supplement(item, '追加记录'.repeat(100), [])), DecisionError);
  assert.equal(port.files.get(path) === source, true, 'source must remain intact when the next file would exceed the read limit');
  const restarted = new DecisionStore(port, '决策复盘'); await restarted.load(); assert.equal(restarted.issues.length, 0);
});

test('audit: cyclic YAML metadata is rejected before it can crash search or later edits', async () => {
  const d = decision(); const source = encode(d).replace('decisionReview: 1', 'decisionReview: 1\nextra: &loop\n  self: *loop');
  assert.throws(() => decode(source), DecisionError);
  const port = new MemoryPort(); port.files.set(`决策复盘/决策-${d.id}.md`, source);
  const store = new DecisionStore(port, '决策复盘'); await store.load();
  assert.equal(store.entries.length, 0); assert.equal(store.issues.length, 1);
});

test('audit: a failed folder load publishes its error instead of leaving the old workspace displayed', async () => {
  const port = new MemoryPort(), store = new DecisionStore(port, '决策复盘'); await store.create(decision());
  const states: Array<{ folder: string; issues: number; entries: number }> = [];
  const unsubscribe = store.subscribe(() => states.push({ folder: store.folder, issues: store.issues.length, entries: store.entries.length }));
  port.failNextList = true; await assert.rejects(store.changeFolder('不可读取目录'));
  assert.equal(store.issues.length, 1); assert.equal(store.issues[0]!.path, '不可读取目录');
  assert.deepEqual(states[states.length - 1], { folder: '不可读取目录', issues: 1, entries: 0 });
  await store.changeFolder('决策复盘'); assert.equal(store.entries.length, 1); unsubscribe();
});
