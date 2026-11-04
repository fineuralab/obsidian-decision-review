import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addReview, arrange, clone, correctReview, effectiveReview, isDue, localDate, newDecision, renameReferences, reviewsNewest, reviseRecord, scheduleOf, supplement, validateDecision, validDate, validPath, validURL } from '../src/domain';
import { decision, record } from './helpers';
const reviewInput = (d = decision()) => ({ recordRevisionId: d.original.id, reviewDate: '2026-01-10', actual: '完成了一次', outcome: 'partial' as const, references: [], followup: 'unscheduled' as const, nextReviewDate: null });
test('calendar arithmetic handles leap days, month ends and year boundaries', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); assert.equal(addDays('2025-01-31', 30), '2025-03-02'); assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(validDate('2025-02-29'), false); assert.equal(validDate('2026-04-31'), false); assert.equal(validDate('0000-01-01'), false);
});
test('calendar day addition survives daylight-saving transitions', () => {
  const prior = process.env.TZ; process.env.TZ = 'America/New_York';
  try { assert.equal(addDays('2026-03-07', 2), '2026-03-09'); assert.equal(addDays('2026-10-31', 2), '2026-11-02'); } finally { if (prior) process.env.TZ = prior; else delete process.env.TZ; }
});
test('vault paths and URLs reject traversal, internal folders and executable schemes', () => {
  for (const value of ['/tmp/x', '../x', 'a/../b', '.obsidian/data', 'a//b', 'C:\\temp', '.trash/file']) assert.equal(validPath(value), false, value);
  assert.equal(validPath('资料/章节 #1.md'), true); assert.equal(validURL('https://example.com/a?q=1'), true); assert.equal(validURL('javascript:alert(1)'), false); assert.equal(validURL('http://'), false);
});
test('new record owns a snapshot rather than mutable form references', () => {
  const input = record({ references: [{ kind: 'file', path: 'A.md' }] }); const d = newDecision(input, null); input.references.length = 0; input.reason = 'changed'; assert.equal(d.original.record.references.length, 1); assert.notEqual(d.original.record.reason, input.reason); assert.equal(isDue(d), false);
});
test('due status is derived from schedule and local dates', () => {
  const d = decision(); assert.equal(isDue(d, '2026-01-30'), false); assert.equal(isDue(d, '2026-01-31'), true); assert.equal(isDue(arrange(d, null), '2026-02-01'), false); assert.equal(isDue(arrange(d, null, 'closed'), '2026-02-01'), false);
});
test('backdated review appends a new schedule without replacing original expectations', () => {
  const d = decision(); const later = arrange(d, '2026-12-30'); const next = addReview(later, reviewInput(d));
  assert.deepEqual(next.original, d.original); assert.equal(next.reviews.length, 1); assert.deepEqual(scheduleOf(next), { status: 'open', nextReviewDate: null }); assert.equal(later.reviews.length, 0);
});
test('multiple reviews on the same day sort by creation time', () => {
  const d = decision(); const first = addReview(d, reviewInput(d)); const second = addReview(first, { ...reviewInput(d), actual: '第二次' }); assert.equal(reviewsNewest(second)[0]!.actual, '第二次'); assert.equal(second.reviews.length, 2);
});
test('record corrections retain the original and reviews keep their reference version', () => {
  const base = decision(); const d = addReview(base, reviewInput(base)); const revised = reviseRecord(d, record({ reason: '更正理由' }), '补充遗漏'); assert.notEqual(revised.revisions[0]!.record.reason, revised.original.record.reason); assert.equal(revised.reviews[0]!.recordRevisionId, revised.original.id); assert.equal(d.revisions.length, 0);
});
test('review corrections preserve original wording and do not alter the schedule', () => {
  const base = decision(); const first = addReview(base, reviewInput(base)); const original = first.reviews[0]!;
  const corrected = correctReview(first, original.id, { ...original, actual: '更正事实', outcome: 'met' }, '修正数量');
  assert.equal(corrected.reviews[0]!.actual, '完成了一次'); assert.equal(effectiveReview(corrected, original).review.actual, '更正事实'); assert.deepEqual(scheduleOf(corrected), scheduleOf(first));
  const broken = clone(corrected); broken.reviewCorrections[0]!.corrected.followup = 'closed'; assert.throws(() => validateDecision(broken));
});
test('rename updates every structured file reference while preserving prose', () => {
  let d = decision({ references: [{ kind: 'file', path: 'A/1.md' }], reason: 'A/1.md 是当时看到的文件' });
  d = supplement(d, '记录', [{ kind: 'file', path: 'A/2.png' }]); d = addReview(d, { ...reviewInput(d), references: [{ kind: 'file', path: 'A/1.md' }] });
  const next = renameReferences(d, 'A', 'B'); assert.deepEqual(next.original.record.references, [{ kind: 'file', path: 'B/1.md' }]); assert.equal(next.original.record.reason, d.original.record.reason); assert.deepEqual(next.supplements[0]!.references, [{ kind: 'file', path: 'B/2.png' }]); assert.deepEqual(next.reviews[0]!.references, [{ kind: 'file', path: 'B/1.md' }]);
});
test('invalid source versions, duplicate IDs and dangling review revisions are rejected', () => {
  const d = decision(); const broken = clone(d) as unknown as Record<string, unknown>; broken.decisionReview = 2; assert.throws(() => validateDecision(broken));
  const duplicate = clone(d); duplicate.schedules[0]!.id = d.original.id; assert.throws(() => validateDecision(duplicate));
  const dangling = addReview(d, reviewInput(d)); dangling.reviews[0]!.recordRevisionId = 'missing'; assert.throws(() => validateDecision(dangling));
});
test('new decisions and scheduled reviews validate input date boundaries', () => {
  assert.throws(() => newDecision(record(), '2025-12-31')); assert.throws(() => newDecision(record({ decisionDate: '9999-01-01' }), null));
  const d = decision(); assert.throws(() => addReview(d, { ...reviewInput(d), followup: 'scheduled', nextReviewDate: '2026-01-11' }));
});

test('timestamps near UTC midnight are grouped under the local calendar day', () => {
  const prior = process.env.TZ; process.env.TZ = 'Asia/Shanghai';
  try { assert.equal(localDate(new Date('2026-11-03T20:00:00.000Z')), '2026-11-04'); }
  finally { if (prior) process.env.TZ = prior; else delete process.env.TZ; }
});
