import test from 'node:test';
import assert from 'node:assert/strict';
import { APPENDIX, decode, encode } from '../src/codec';
import { addReview, arrange, correctReview, ConflictError } from '../src/domain';
import { DecisionStore } from '../src/store';
import { decision, MemoryPort } from './helpers';

function reviewed() {
  const d = decision();
  return addReview(d, { recordRevisionId: d.original.id, reviewDate: '2026-01-10', actual: '阶段结果', outcome: 'partial', references: [], followup: 'unscheduled', nextReviewDate: null });
}

test('safety: a multiline correction reason containing the notes marker stays readable after save and restart', async () => {
  const port = new MemoryPort(), store = new DecisionStore(port, '决策复盘');
  await store.create(reviewed()); const entry = store.entries[0]!, review = entry.decision.reviews[0]!;
  const explanation = `更正保留标记的例子\n${APPENDIX}\n以及后续说明`;
  await store.update(entry, d => correctReview(d, review.id, { ...review, actual: '修正结果' }, explanation));
  const restarted = new DecisionStore(port, '决策复盘'); await restarted.load();
  assert.equal(restarted.issues.length, 0);
  assert.equal(restarted.entries[0]?.decision.reviewCorrections[0]?.explanation, explanation);
  assert.equal(restarted.entries[0]?.decision.reviews[0]?.actual, '阶段结果');
});

test('safety: multiline reference labels cannot introduce an extra notes delimiter', () => {
  const d = decision({ references: [{ kind: 'url', url: 'https://example.com', label: `证据\n${APPENDIX}\n说明` }] });
  assert.deepEqual(decode(encode(d))?.decision, d);
});

test('safety: a renamed decision with a removed type property remains a blocked visible record', async () => {
  const port = new MemoryPort(), store = new DecisionStore(port, '决策复盘');
  const path = '决策复盘/我的重要决定.md', source = encode(decision(), '\n保留个人文字\n');
  port.files.set(path, source); await store.load(); const entry = store.entries[0]!;
  const damaged = source.replace('decisionReview: 1\n', ''); port.files.set(path, damaged);
  await store.load();
  assert.equal(store.issues.length, 1, 'owned file must not silently disappear from the index');
  assert.equal(store.entries[0]?.blocked, true);
  await assert.rejects(store.update(entry, d => arrange(d, null)), ConflictError);
  assert.equal(port.files.get(path), damaged, 'the damaged source must not be overwritten');
  const restarted = new DecisionStore(port, '决策复盘'); await restarted.load();
  assert.equal(restarted.issues.length, 1, 'a fresh session must report the file path even without a cached snapshot');
  assert.equal(restarted.issues[0]?.path, path);
  port.files.set(path, source); await store.load();
  assert.equal(store.entries[0]?.blocked, undefined); assert.equal(store.issues.length, 0);
});

test('safety: generated files reject duplicate notes delimiters before they can reach storage', () => {
  assert.throws(() => encode(decision(), `\n保留笔记\n${APPENDIX}\n`));
});

test('safety: Markdown control text round-trips through every multiline user field', async () => {
  const { reviseRecord, supplement } = await import('../src/domain');
  const { getLocale, setLocale } = await import('../src/i18n');
  const prior = getLocale();
  try {
    for (const locale of ['zh-CN', 'en'] as const) {
      setLocale(locale);
      for (const text of [`第一行\n${APPENDIX}\n后续`, '---\r\n标题: 文本\r\n---', '> 引用\n\n# 标题\n[文字](https://example.com)', '<!-- 注释 -->\n^review-example\n```yaml\nx: y\n```']) {
        let d = decision({ title: text, reason: text, expected: text, alternatives: text, assumption: text, references: [{ kind: 'url', url: 'https://example.com', label: text }] });
        d = reviseRecord(d, { ...d.original.record, reason: `${text}\n补充` }, text);
        d = addReview(d, { recordRevisionId: d.original.id, reviewDate: '2026-01-10', actual: text, reflection: text, lesson: text, outcome: 'met', references: d.original.record.references, followup: 'unscheduled', nextReviewDate: null });
        d = correctReview(d, d.reviews[0]!.id, { ...d.reviews[0]!, actual: `${text}\n更正` }, text);
        d = supplement(d, text, d.original.record.references);
        const appendix = '\r\n## 个人文字\r\n保留格式\n';
        assert.deepEqual(decode(encode(d, appendix)), { decision: d, appendix });
      }
    }
  } finally { setLocale(prior); }
});

test('safety: the decision notes marker in a lesson body does not misclassify a lesson', async () => {
  const { decodeLesson, encodeLesson } = await import('../src/codec');
  const { newId } = await import('../src/domain');
  const meta = { decisionReviewLesson: 1 as const, id: newId(), demo: false, decisionId: newId(), reviewId: newId(), reviewVersionId: newId(), title: '保留标记的经验', createdAt: new Date().toISOString() };
  const source = encodeLesson(meta, `经验示例\n${APPENDIX}\n其他文字`, '决策复盘/我的重要决定.md');
  assert.equal(decode(source), null);
  assert.deepEqual(decodeLesson(source)?.meta, meta);
  assert.ok(decodeLesson(source)?.content.includes(APPENDIX));
});
