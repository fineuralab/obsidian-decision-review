import { t } from './i18n';
export const PLUGIN_ID = 'decision-review';
export type Reference = { kind: 'file'; path: string; label?: string } | { kind: 'url'; url: string; label?: string };
export interface RecordSnapshot { title: string; decisionDate: string; reason: string; expected: string; alternatives?: string; assumption?: string; references: Reference[] }
export interface Revision { id: string; createdAt: string; explanation: string; record: RecordSnapshot }
export type Outcome = 'met' | 'partial' | 'unmet' | 'unclear';
export interface Review { id: string; createdAt: string; reviewDate: string; recordRevisionId: string; actual: string; outcome: Outcome; reflection?: string; lesson?: string; references: Reference[]; followup: 'scheduled' | 'unscheduled' | 'closed'; nextReviewDate: string | null }
export interface ReviewCorrection { id: string; createdAt: string; reviewId: string; explanation: string; corrected: Review }
export interface Supplement { id: string; createdAt: string; text: string; references: Reference[] }
export interface ScheduleEvent { id: string; createdAt: string; nextReviewDate: string | null; status: 'open' | 'closed'; reason?: string }
export interface LessonLink { reviewId: string; path: string; reviewVersionId: string }
export interface Decision {
  decisionReview: 1; id: string; demo: boolean; createdAt: string; updatedAt: string;
  original: Revision; revisions: Revision[]; reviews: Review[]; reviewCorrections: ReviewCorrection[];
  supplements: Supplement[]; schedules: ScheduleEvent[]; lessonLinks: LessonLink[];
}
export interface LessonMeta { decisionReviewLesson: 1; id: string; demo: boolean; decisionId: string; reviewId: string; reviewVersionId: string; title: string; createdAt: string }
export class DecisionError extends Error { constructor(message: string) { super(message); this.name = 'DecisionError'; } }
export class ConflictError extends DecisionError { constructor() { super(t('源文件已修改、移动或存在冲突。输入已保留；请复制输入，关闭并重新打开表单。', 'The source file changed, moved, or has a conflict. Your input is preserved. Copy it, close and reopen this form.')); this.name = 'ConflictError'; } }
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const newId = (): string => crypto.randomUUID();
export function localDate(date = new Date()): string { return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T12:00:00`); return Number.isFinite(parsed.getTime()) && localDate(parsed) === value;
}
export function addDays(value: string, days: number): string {
  if (!validDate(value) || !Number.isSafeInteger(days)) throw new DecisionError(t('日期无效。', 'Invalid date.'));
  const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); const result = localDate(date);
  if (!validDate(result)) throw new DecisionError(t('日期超出支持范围。', 'Date is out of range.')); return result;
}
export function dayDifference(a: string, b: string): number { return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000); }
export function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\\<>:"|?*]/.test(value) && !value.startsWith('/') && value.split('/').every(part => !!part && part !== '.' && part !== '..' && part !== '.obsidian' && part !== '.trash');
}
export function validDataPath(value: unknown): value is string { return validPath(value) && value.split('/').every(part => !part.startsWith('.')); }
export function dataFolder(value: string): string {
  const normalized = value.trim().replace(/\/+$/g, '');
  if (!validPath(normalized)) throw new DecisionError(t('请输入有效的库内文件夹路径。', 'Enter a valid folder path inside this vault.'));
  if (!validDataPath(normalized)) throw new DecisionError(t('数据目录不能位于点号开头的隐藏路径中，Obsidian 不会索引其中的记录。请选择可见文件夹。', 'The data folder cannot be inside a dot-prefixed hidden path: Obsidian will not index its records. Choose a visible folder.'));
  return normalized;
}
export const under = (path: string, folder: string): boolean => path.startsWith(`${folder}/`);
export const renamePath = (path: string, oldPath: string, nextPath: string): string => path === oldPath ? nextPath : under(path, oldPath) ? nextPath + path.slice(oldPath.length) : path;
export function validURL(value: string): boolean { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !/[\u0000-\u0020]/.test(value); } catch { return false; } }
function fail(zh: string, en: string): never { throw new DecisionError(t(zh, en)); }
function serializable(value: unknown): void {
  try { JSON.stringify(value); }
  catch { fail('记录含有循环引用或无法保存的值，请修复 YAML 属性。', 'The record contains cyclic references or values that cannot be saved. Repair its YAML properties.'); }
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('记录格式无效。', 'Invalid record format.'); return value as Record<string, unknown>; }
function text(value: unknown, required = true, max = 10000): asserts value is string { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('文本缺失或超过长度限制。', 'Text is missing or exceeds its length limit.'); }
function id(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('记录 ID 无效。', 'Invalid record ID.'); }
function instant(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) fail('记录时间无效。', 'Invalid record timestamp.'); }
function date(value: unknown): asserts value is string { if (!validDate(value)) fail('日期无效。', 'Invalid date.'); }
function array(value: unknown): asserts value is unknown[] { if (!Array.isArray(value) || value.length > 10000) fail('记录列表缺失或过长。', 'The record list is missing or too long.'); }
export function validateReferences(value: unknown): asserts value is Reference[] {
  array(value); if (value.length > 100) fail('最多关联 100 项资料。', 'Up to 100 references are allowed.');
  for (const raw of value) { const ref = object(raw); if (ref.label !== undefined) text(ref.label, false, 300);
    if (ref.kind === 'file') { if (!validPath(ref.path)) fail('关联文件路径无效。', 'Invalid referenced file path.'); }
    else if (ref.kind === 'url') { if (typeof ref.url !== 'string' || ref.url.length > 4000 || !validURL(ref.url)) fail('网址应以 http:// 或 https:// 开头。', 'Use an http:// or https:// URL.'); }
    else fail('资料类型无效。', 'Invalid reference type.');
  }
}
export function validateRecord(value: unknown): asserts value is RecordSnapshot {
  const record = object(value); text(record.title, true, 160); text(record.reason); text(record.expected); date(record.decisionDate);
  if (record.alternatives !== undefined) text(record.alternatives, false); if (record.assumption !== undefined) text(record.assumption, false); validateReferences(record.references);
}
function validateReview(value: unknown, revisions: Revision[], preserveSchedule = false): asserts value is Review {
  const review = object(value); id(review.id); instant(review.createdAt); date(review.reviewDate); text(review.actual);
  if (review.reflection !== undefined) text(review.reflection, false); if (review.lesson !== undefined) text(review.lesson, false);
  validateReferences(review.references);
  const revision = revisions.find(item => item.id === review.recordRevisionId);
  if (!revision || review.reviewDate < revision.record.decisionDate || Date.parse(review.createdAt) < Date.parse(revision.createdAt)) fail('回访引用的记录版本或日期无效。', 'Invalid record version or date in a review.');
  if (typeof review.outcome !== 'string' || !['met', 'partial', 'unmet', 'unclear'].includes(review.outcome)) fail('回访评价无效。', 'Invalid review outcome.');
  if (typeof review.followup !== 'string' || !['scheduled', 'unscheduled', 'closed'].includes(review.followup)) fail('后续回访安排无效。', 'Invalid follow-up schedule.');
  if (review.followup === 'scheduled') { date(review.nextReviewDate); if (!preserveSchedule && review.nextReviewDate <= review.reviewDate) fail('下次回访应晚于本次回访。', 'The next review must be after this review.'); }
  else if (review.nextReviewDate !== null) fail('未安排或已结束的回访不能包含日期。', 'Unscheduled or closed reviews cannot have a next date.');
}
export function validateDecision(value: unknown): asserts value is Decision {
  serializable(value);
  const decision = object(value); if (decision.decisionReview !== 1) fail('不支持的决策格式版本。', 'Unsupported decision format version.');
  id(decision.id); if (typeof decision.demo !== 'boolean') fail('演示标记无效。', 'Invalid demo marker.'); instant(decision.createdAt); instant(decision.updatedAt);
  for (const key of ['revisions', 'reviews', 'reviewCorrections', 'supplements', 'schedules', 'lessonLinks']) array(decision[key]);
  const d = decision as unknown as Decision; const revisions = [d.original, ...d.revisions]; const ids = new Set<string>();
  const event = (raw: unknown): Record<string, unknown> => { const item = object(raw); id(item.id); instant(item.createdAt); if (ids.has(item.id)) fail('历史记录 ID 重复。', 'Duplicate history entry ID.'); ids.add(item.id);
    if (Date.parse(item.createdAt) < Date.parse(d.createdAt) || Date.parse(item.createdAt) > Date.parse(d.updatedAt)) fail('历史记录时间范围无效。', 'History timestamp is out of range.'); return item; };
  if (Date.parse(d.updatedAt) < Date.parse(d.createdAt)) fail('更新时间早于创建时间。', 'Updated time precedes creation time.');
  for (const revision of revisions) { event(revision); text(revision.explanation); validateRecord(revision.record); }
  if (d.original.createdAt !== d.createdAt || !d.schedules.length) fail('首次记录或初始回访安排缺失。', 'The original record or initial schedule is missing.');
  for (const review of d.reviews) { event(review); validateReview(review, revisions); }
  for (const correction of d.reviewCorrections) {
    event(correction); text(correction.explanation); const original = d.reviews.find(review => review.id === correction.reviewId);
    if (!original) fail('更正引用的回访不存在。', 'The corrected review does not exist.'); validateReview(correction.corrected, revisions, true);
    for (const key of ['id', 'createdAt', 'recordRevisionId', 'followup', 'nextReviewDate'] as const) if (correction.corrected[key] !== original[key]) fail('更正不能改写原回访身份、参照版本或后续安排。', 'A correction cannot change the review identity, record version, or follow-up schedule.');
    if (Date.parse(correction.createdAt) <= Date.parse(original.createdAt)) fail('更正时间必须晚于原回访。', 'A correction must follow the original review.');
  }
  for (const supplement of d.supplements) { event(supplement); text(supplement.text); validateReferences(supplement.references); }
  for (const schedule of d.schedules) { event(schedule); if (!['open', 'closed'].includes(schedule.status)) fail('回访状态无效。', 'Invalid review status.'); if (schedule.reason !== undefined) text(schedule.reason, false);
    if (schedule.nextReviewDate !== null) { date(schedule.nextReviewDate); if (schedule.status === 'closed' || schedule.nextReviewDate < d.original.record.decisionDate) fail('回访安排日期无效。', 'Invalid scheduled review date.'); }
  }
  for (const link of d.lessonLinks) { object(link); if (!validPath(link.path) || !d.reviews.some(review => review.id === link.reviewId) || ![...d.reviews.filter(review => review.id === link.reviewId).map(review => review.id), ...d.reviewCorrections.filter(c => c.reviewId === link.reviewId).map(c => c.id)].includes(link.reviewVersionId)) fail('经验来源或文件路径无效。', 'Invalid lesson source or file path.'); }
}
export function recordVersions(d: Decision): Revision[] { return [d.original, ...d.revisions].sort(compareEvents); }
export const compareEvents = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
export function effectiveReview(d: Decision, review: Review): { review: Review; versionId: string; correction?: ReviewCorrection } {
  const corrections = d.reviewCorrections.filter(c => c.reviewId === review.id).sort(compareEvents);
  const correction = corrections[corrections.length - 1];
  return correction ? { review: correction.corrected, versionId: correction.id, correction } : { review, versionId: review.id };
}
export function reviewsNewest(d: Decision): Review[] { return d.reviews.map(review => effectiveReview(d, review).review).sort((a, b) => b.reviewDate.localeCompare(a.reviewDate) || compareEvents(b, a)); }
export function scheduleOf(d: Decision): { status: 'open' | 'closed'; nextReviewDate: string | null } {
  const events = [...d.schedules, ...d.reviews.map(review => ({ id: review.id, createdAt: review.createdAt, status: review.followup === 'closed' ? 'closed' as const : 'open' as const, nextReviewDate: review.nextReviewDate }))].sort(compareEvents);
  const last = events[events.length - 1]!; return { status: last.status, nextReviewDate: last.nextReviewDate };
}
export function isDue(d: Decision, today = localDate()): boolean { const schedule = scheduleOf(d); return schedule.status === 'open' && !!schedule.nextReviewDate && schedule.nextReviewDate <= today; }
export function compareDecisions(a: Decision, b: Decision): number {
  const x = scheduleOf(a), y = scheduleOf(b); if (x.status !== y.status) return x.status === 'open' ? -1 : 1;
  if (x.status === 'closed') return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id);
  return (x.nextReviewDate || '9999-99-99').localeCompare(y.nextReviewDate || '9999-99-99') || compareEvents(a, b);
}
export function searchText(d: Decision): string { return JSON.stringify(d).toLocaleLowerCase(); }
function nextTime(d: Decision, now = new Date().toISOString()): string { return new Date(Math.max(Date.parse(now), Date.parse(d.updatedAt) + 1)).toISOString(); }
function checked(d: Decision): Decision { validateDecision(d); return d; }
function requireInputDate(value: string, earliest?: string): void { if (!validDate(value) || value > localDate() || (earliest && value < earliest)) fail('日期应在决定日期与今天之间。', 'The date must be between the decision date and today.'); }
export function newDecision(record: RecordSnapshot, nextReviewDate: string | null, demo = false, decisionId = newId(), now = new Date().toISOString()): Decision {
  validateRecord(record); requireInputDate(record.decisionDate); const original: Revision = { id: newId(), createdAt: now, explanation: t('首次记录', 'Original record'), record: clone(record) };
  return checked({ decisionReview: 1, id: decisionId, demo, createdAt: now, updatedAt: now, original, revisions: [], reviews: [], reviewCorrections: [], supplements: [], schedules: [{ id: newId(), createdAt: now, status: 'open', nextReviewDate }], lessonLinks: [] });
}
export function reviseRecord(d: Decision, record: RecordSnapshot, explanation: string): Decision { validateRecord(record); requireInputDate(record.decisionDate); text(explanation); const next = clone(d); next.updatedAt = nextTime(d); next.revisions.push({ id: newId(), createdAt: next.updatedAt, explanation: explanation.trim(), record: clone(record) }); return checked(next); }
export type ReviewInput = Omit<Review, 'id' | 'createdAt'>;
export function addReview(d: Decision, input: ReviewInput): Decision {
  const version = recordVersions(d).find(item => item.id === input.recordRevisionId); if (!version) fail('记录版本不存在。', 'The record version does not exist.');
  requireInputDate(input.reviewDate, version.record.decisionDate);
  if (input.followup === 'scheduled' && (!validDate(input.nextReviewDate) || input.nextReviewDate <= localDate())) fail('继续观察时，下次回访应晚于今天。', 'When scheduling another review, choose a date after today.');
  const next = clone(d); next.updatedAt = nextTime(d); next.reviews.push({ ...clone(input), id: newId(), createdAt: next.updatedAt }); return checked(next);
}
export function correctReview(d: Decision, reviewId: string, patch: Pick<Review, 'reviewDate' | 'actual' | 'outcome' | 'reflection' | 'lesson' | 'references'>, explanation: string): Decision {
  const original = d.reviews.find(review => review.id === reviewId); if (!original) fail('回访不存在。', 'The review does not exist.'); text(explanation);
  const prior = effectiveReview(d, original).review; const version = recordVersions(d).find(item => item.id === original.recordRevisionId)!; requireInputDate(patch.reviewDate, version.record.decisionDate);
  const next = clone(d); next.updatedAt = nextTime(d); next.reviewCorrections.push({ id: newId(), createdAt: next.updatedAt, reviewId, explanation: explanation.trim(), corrected: { ...clone(prior), ...clone(patch) } }); return checked(next);
}
export function arrange(d: Decision, nextReviewDate: string | null, status: 'open' | 'closed' = 'open', reason?: string): Decision { const next = clone(d); next.updatedAt = nextTime(d); next.schedules.push({ id: newId(), createdAt: next.updatedAt, nextReviewDate, status, ...(reason ? { reason } : {}) }); return checked(next); }
export function supplement(d: Decision, content: string, references: Reference[]): Decision { const next = clone(d); next.updatedAt = nextTime(d); next.supplements.push({ id: newId(), createdAt: next.updatedAt, text: content.trim(), references: clone(references) }); return checked(next); }
export function linkLesson(d: Decision, link: LessonLink): Decision { const next = clone(d); next.updatedAt = nextTime(d); next.lessonLinks.push(clone(link)); return checked(next); }
export function renameReferences(d: Decision, oldPath: string, newPath: string): Decision {
  const next = clone(d); const refs = (items: Reference[]): void => { for (const ref of items) if (ref.kind === 'file') ref.path = renamePath(ref.path, oldPath, newPath); };
  for (const version of [next.original, ...next.revisions]) refs(version.record.references);
  for (const review of [...next.reviews, ...next.reviewCorrections.map(c => c.corrected)]) refs(review.references);
  for (const entry of next.supplements) refs(entry.references);
  for (const link of next.lessonLinks) link.path = renamePath(link.path, oldPath, newPath); return next;
}
export function validateLesson(value: unknown): asserts value is LessonMeta {
  serializable(value);
  const meta = object(value); if (meta.decisionReviewLesson !== 1 || typeof meta.demo !== 'boolean') fail('经验笔记格式无效。', 'Invalid lesson note format.');
  for (const key of ['id', 'decisionId', 'reviewId', 'reviewVersionId']) id(meta[key]); text(meta.title, true, 160); instant(meta.createdAt);
}
