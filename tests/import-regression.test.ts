import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, encodeLesson } from '../src/codec';
import { Decision, DecisionError, effectiveReview, newDecision, validateDecision } from '../src/domain';
import { DecisionStore } from '../src/store';
import { MemoryPort, record } from './helpers';

function imported(): Decision {
  const d = newDecision(record(), null, false, 'imported-decision', '2026-01-01T00:00:00.000Z');
  d.reviews.push({ id: 'imported-review', createdAt: '2026-01-02T00:00:00.000Z', reviewDate: '2026-01-02', recordRevisionId: d.original.id, actual: 'Original review wording', outcome: 'partial', references: [], followup: 'closed', nextReviewDate: null });
  d.updatedAt = '2026-01-03T05:00:00.000Z';
  return d;
}

for (const [field, value] of [['outcome', ['met']], ['followup', ['closed']]] as const) {
  test(`import: ${field} must be a string enum rather than a YAML list`, () => {
    const d = imported(), invalid = { ...d, reviews: [{ ...d.reviews[0], [field]: value }] };
    assert.throws(() => validateDecision(invalid), DecisionError);
  });
}

for (const mode of ['offset', 'same-instant'] as const) {
  test(`import: generated history includes each original and corrected wording once (${mode})`, () => {
    const d = imported(), review = d.reviews[0]!;
    const earlier = { id: 'correction-a', createdAt: mode === 'offset' ? '2026-01-03T10:00:00+08:00' : '2026-01-03T05:00:00.000Z', reviewId: review.id, explanation: 'Earlier explanation', corrected: { ...review, actual: 'Earlier correction wording' } };
    const later = { id: 'correction-z', createdAt: '2026-01-03T05:00:00.000Z', reviewId: review.id, explanation: 'Latest explanation', corrected: { ...review, actual: 'Latest correction wording' } };
    d.reviewCorrections = [later, earlier]; validateDecision(d);
    assert.equal(effectiveReview(d, review).versionId, later.id);
    const source = encode(d), body = source.slice(source.indexOf('\n---\n') + 5);
    for (const wording of ['Original review wording', 'Earlier correction wording', 'Latest correction wording']) {
      assert.equal(body.split(wording).length - 1, 1, `readable history must include ${wording} exactly once`);
    }
  });
}

test('import: independent lessons sort by the actual instant across timezone offsets', async () => {
  const port = new MemoryPort(), store = new DecisionStore(port, '记录'), d = imported(); await store.create(d);
  const meta = { decisionReviewLesson: 1 as const, decisionId: d.id, reviewId: d.reviews[0]!.id, reviewVersionId: d.reviews[0]!.id, demo: false };
  port.files.set('记录/经验/earlier.md', encodeLesson({ ...meta, id: 'lesson-earlier', title: 'Earlier lesson', createdAt: '2026-01-03T10:00:00+08:00' }, 'Earlier text', store.entries[0]!.path));
  port.files.set('记录/经验/later.md', encodeLesson({ ...meta, id: 'lesson-later', title: 'Later lesson', createdAt: '2026-01-03T05:00:00.000Z' }, 'Later text', store.entries[0]!.path));
  await store.load(); assert.deepEqual(store.lessons.map(lesson => lesson.meta.id), ['lesson-later', 'lesson-earlier']);
});
