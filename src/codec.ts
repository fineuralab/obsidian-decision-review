import { parseDocument, stringify } from 'yaml';
import { compareEvents, Decision, DecisionError, LessonMeta, recordVersions, Reference, reviewsNewest, scheduleOf, validateDecision, validateLesson, effectiveReview } from './domain';
import { t } from './i18n';
export const APPENDIX = '<!-- decision-review:notes -->';
const MAX_SOURCE_LENGTH = 10 * 1024 * 1024;
function checkSourceSize(source: string): string {
  if (source.length > MAX_SOURCE_LENGTH) throw new DecisionError(t('记录文件超过 10 MB，请拆分或修复后重试。', 'The record exceeds 10 MB. Split or repair it, then try again.'));
  return source;
}
export interface Decoded { decision: Decision; appendix: string }
export interface DecodedLesson { meta: LessonMeta; content: string }
const quoted = (value: string): string => value.split(/\r?\n/).map(line => `> ${line}`).join('\n');
export const outcomeLabel = (outcome: string): string => ({ met: t('达到预期', 'Met expectations'), partial: t('部分达到', 'Partially met'), unmet: t('未达到', 'Not met'), unclear: t('暂时无法判断', 'Too early to tell') })[outcome] ?? outcome;
function markdownLink(path: string, label = path): string { const target = /^https?:\/\//i.test(path) ? new URL(path).href : path.split('/').map(encodeURIComponent).join('/'); return `[${label.replace(/[\r\n]+/g, ' ').replace(/[\\\[\]]/g, '\\$&')}](<${target}>)`; }
function refs(items: Reference[]): string { return items.map(ref => `- ${ref.kind === 'file' ? markdownLink(ref.path, ref.label || ref.path) : markdownLink(ref.url, ref.label || ref.url)}`).join('\n'); }
function textBlock(lines: string[], label: string, value?: string): void { if (value) lines.push(`**${label}**`, '', quoted(value), ''); }
export function encode(d: Decision, appendix = t('\n\n在这里补充自由笔记；插件会保留此区域。\n', '\n\nAdd personal notes here. The plugin preserves this section.\n')): string {
  validateDecision(d); const schedule = scheduleOf(d);
  const lines = ['---', stringify(d, { lineWidth: 0 }).trimEnd(), '---', '', `# ${d.original.record.title.replace(/[\r\n]/g, ' ')}`, '',
    t('状态：{0}；下次回访：{1}', 'Status: {0}; next review: {1}', schedule.status === 'closed' ? t('已结束', 'Closed') : t('观察中', 'Observing'), schedule.nextReviewDate ?? t('未安排', 'Unscheduled')), '', t('## 当时的判断', '## Original reasoning'), ''];
  const recordText = (record: Decision['original']['record']): void => {
    lines.push(t('决定日期：{0}', 'Decision date: {0}', record.decisionDate), '');
    textBlock(lines, t('主要理由', 'Main reason'), record.reason); textBlock(lines, t('期待看到什么', 'Expected outcome'), record.expected);
    textBlock(lines, t('考虑过的其他选项', 'Other options considered'), record.alternatives); textBlock(lines, t('最担心的假设', 'Assumption to watch'), record.assumption);
    if (record.references.length) lines.push(t('**相关资料**', '**References**'), '', refs(record.references), '');
  };
  recordText(d.original.record);
  if (d.revisions.length) {
    lines.push(t('## 记录修订', '## Record revisions'), '');
    for (const revision of recordVersions(d).filter(item => item.id !== d.original.id).reverse()) { lines.push(`### ${revision.createdAt}`, '', quoted(revision.explanation), '', `**${revision.record.title.replace(/[\r\n]/g, ' ')}**`, ''); recordText(revision.record); }
  }
  lines.push(t('## 回访记录', '## Reviews'), '');
  for (const review of reviewsNewest(d)) {
    const version = effectiveReview(d, d.reviews.find(item => item.id === review.id)!);
    lines.push(`### ${review.reviewDate} ${outcomeLabel(review.outcome)} ^review-${review.id}`, '', t('参照版本：{0}', 'Record version: {0}', review.recordRevisionId), '');
    textBlock(lines, t('实际发生了什么', 'What happened'), review.actual); textBlock(lines, t('回头看的调整', 'Reflection'), review.reflection); textBlock(lines, t('下次做法', 'Next time'), review.lesson);
    if (review.references.length) lines.push(refs(review.references), '');
    lines.push(review.followup === 'closed' ? t('结束回访。', 'Follow-up closed.') : review.nextReviewDate ? t('下次回访：{0}', 'Next review: {0}', review.nextReviewDate) : t('继续观察，暂不安排日期。', 'Continue observing without a scheduled date.'), '');
    if (version.correction) lines.push(quoted(t('已更正：{0}；原因：{1}', 'Corrected: {0}; reason: {1}', version.correction.createdAt, version.correction.explanation)), '');
    const corrections = d.reviewCorrections.filter(item => item.reviewId === review.id);
    if (corrections.length) {
      lines.push(t('#### 更正前的版本', '#### Previous versions'), '');
      const prior = [d.reviews.find(item => item.id === review.id)!, ...corrections.sort(compareEvents).slice(0, -1).map(item => item.corrected)];
      for (const old of prior) { lines.push(quoted(`${old.reviewDate} ${outcomeLabel(old.outcome)}`), ''); textBlock(lines, t('实际发生了什么', 'What happened'), old.actual); textBlock(lines, t('判断调整', 'Reflection'), old.reflection); textBlock(lines, t('下次做法', 'Next time'), old.lesson); if (old.references.length) lines.push(refs(old.references), ''); }
    }
  }
  if (!d.reviews.length) lines.push(t('尚未回访。', 'No reviews yet.'), '');
  if (d.supplements.length || d.schedules.length) {
    lines.push(t('## 补充与安排', '## Notes and schedules'), '');
    const events = [...d.supplements.map(item => ({ at: item.createdAt, content: [quoted(item.text), refs(item.references)].filter(Boolean).join('\n\n') })), ...d.schedules.map(item => ({ at: item.createdAt, content: item.status === 'closed' ? t('结束回访。', 'Follow-up closed.') : item.nextReviewDate ? t('下次回访：{0}', 'Next review: {0}', item.nextReviewDate) : t('暂不安排回访。', 'No review scheduled.') }))].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    for (const event of events) lines.push(`### ${event.at}`, '', event.content, '');
  }
  if (d.lessonLinks.length) lines.push(t('## 经验笔记', '## Lesson notes'), '', ...d.lessonLinks.map(link => `- ${markdownLink(link.path)}`), '');
  lines.push(t('## 自由笔记', '## Personal notes'), '', APPENDIX);
  const source = checkSourceSize(lines.join('\n') + appendix);
  // Validate the exact serialized file before any storage write can commit it.
  decode(source); return source;
}
function header(source: string): { value: unknown; body: string } | null {
  checkSourceSize(source);
  const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const owned = /decisionReview(?:Lesson)?\s*:/.test(source) || source.includes(APPENDIX);
  if (!match) { if (owned) throw new DecisionError(t('记录缺少闭合的 YAML 属性。', 'The record is missing closed YAML frontmatter.')); return null; }
  const document = parseDocument(match[1]!, { uniqueKeys: true });
  if (document.errors.length) { if (owned) throw new DecisionError(t('YAML 无法解析：{0}', 'Cannot parse YAML: {0}', document.errors[0]!.message)); return null; }
  return { value: document.toJS({ maxAliasCount: 30 }) as unknown, body: source.slice(match[0].length) };
}
export function decode(source: string): Decoded | null {
  const parsed = header(source); if (!parsed) return null;
  const value = parsed.value && typeof parsed.value === 'object' ? parsed.value : undefined;
  if (!value || !('decisionReview' in value)) {
    if ((!value || !('decisionReviewLesson' in value)) && parsed.body.includes(APPENDIX)) throw new DecisionError(t('决策文件缺少 decisionReview 格式属性，请修复后重新读取。', 'The decision file is missing its decisionReview format property. Repair it, then reload.'));
    return null;
  }
  validateDecision(value); const markers = [...parsed.body.matchAll(/(?:^|\r?\n)<!-- decision-review:notes -->(?=\r?\n|$)/g)];
  if (markers.length !== 1) throw new DecisionError(t('自由笔记分隔标记缺失或重复，请保留一行 <!-- decision-review:notes -->。', 'The personal-notes marker is missing or repeated. Keep one line containing <!-- decision-review:notes -->.'));
  const marker = markers[0]!; return { decision: value, appendix: parsed.body.slice(marker.index! + marker[0].length) };
}
export function encodeLesson(meta: LessonMeta, content: string, decisionPath: string): string {
  validateLesson(meta); if (!content.trim() || content.length > 10000) throw new DecisionError(t('经验内容不能为空，且不能超过 10000 字。', 'Lesson text is required and cannot exceed 10,000 characters.'));
  // The heading is user text. The generated source link uses a stable review block ID.
  return checkSourceSize(['---', stringify(meta, { lineWidth: 0 }).trimEnd(), '---', '', `# ${meta.title.replace(/[\r\n]/g, ' ')}`, '', content.trim(), '', t('来源决定', 'Source decision') + `: [[${decisionPath.replace(/\.md$/, '')}#^review-${meta.reviewId}]]`, ''].join('\n'));
}
export function decodeLesson(source: string): DecodedLesson | null {
  const parsed = header(source); if (!parsed || !parsed.value || typeof parsed.value !== 'object' || !('decisionReviewLesson' in parsed.value)) return null;
  validateLesson(parsed.value); return { meta: parsed.value, content: parsed.body.replace(/^\s*# [^\n]*(?:\n|$)/, '').trim() };
}
