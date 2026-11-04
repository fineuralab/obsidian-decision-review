import { APPENDIX, decode, decodeLesson, DecodedLesson, encode, encodeLesson } from './codec';
import { clone, compareEvents, ConflictError, dataFolder, Decision, DecisionError, effectiveReview, LessonMeta, linkLesson, newId, renamePath, renameReferences, under, validateDecision, validPath } from './domain';
import { t } from './i18n';
import { stoppedError } from './lifecycle';
export interface StoragePort {
  list(folder: string): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, source: string, expected: string | null): Promise<void>;
  trash(path: string, expected: string): Promise<void>;
}
export interface Entry { path: string; source: string; appendix: string; decision: Decision; blocked?: boolean }
export interface LessonEntry extends DecodedLesson { path: string; source: string }
export interface Issue { path: string; message: string }
export const errorText = (value: unknown): string => value instanceof Error ? value.message : String(value);
export class LessonSavedError extends DecisionError {
  constructor(public path: string, cause: unknown) { super(t('经验已保存到「{0}」，但来源索引更新失败：{1}。输入保留，重试会复用已有笔记。', 'Lesson saved to “{0}”, but its source index could not be updated: {1}. Your input is preserved; retrying will reuse the existing note.', path, errorText(cause))); }
}
export class DecisionStore {
  entries: Entry[] = [];
  lessons: LessonEntry[] = [];
  issues: Issue[] = [];
  ready = false;
  folder: string;
  private chain: Promise<unknown> = Promise.resolve();
  private folderEpoch = 0;
  private writePauses = 0;
  private unavailableFolder?: Issue;
  private active = true;
  private listeners = new Set<() => void>();
  private renameListeners = new Set<(oldPath: string, newPath: string) => void>();
  constructor(private port: StoragePort, folder: string) { this.folder = dataFolder(folder); }
  subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  onRename(callback: (oldPath: string, newPath: string) => void): () => void { this.renameListeners.add(callback); return () => this.renameListeners.delete(callback); }
  touch(): void { for (const listener of this.listeners) listener(); }
  private queue<T>(work: () => Promise<T>): Promise<T> { const run = (): Promise<T> => { this.assertActive(); return work(); }; const task = this.chain.then(run, run); this.chain = task.catch(() => undefined); return task; }
  assertActive(): void { if (!this.active) throw stoppedError(); }
  close(): void { if (!this.active) return; this.active = false; this.folderEpoch++; this.listeners.clear(); this.renameListeners.clear(); }
  get folderVersion(): number { return this.folderEpoch; }
  pauseWrites(): () => void {
    this.folderEpoch++; this.writePauses++; let active = true;
    return () => { if (active) { active = false; this.writePauses--; } };
  }
  assertFolder(version: number): void {
    this.assertActive();
    if (this.unavailableFolder) throw new DecisionError(this.unavailableFolder.message);
    if (this.writePauses || version !== this.folderEpoch) throw new DecisionError(t('数据目录已变更或正在变更。输入已保留，请在变更完成后重新打开表单。', 'The data folder changed or is being moved. Your input is preserved; reopen the form after the change completes.'));
  }
  markFolderUnavailable(path: string, message: string): void {
    this.assertActive();
    this.folderEpoch++; this.unavailableFolder = { path: validPath(path) ? path : this.folder, message };
    this.entries = this.entries.map(entry => ({ ...entry, blocked: true })); this.issues = [this.unavailableFolder]; this.ready = true; this.touch();
  }
  private mutation<T>(work: (check: () => void) => Promise<T>): Promise<T> {
    const version = this.folderEpoch, paused = this.writePauses > 0;
    const check = (): void => { this.assertFolder(paused ? -1 : version); };
    return this.queue(async () => { check(); return work(check); });
  }
  async changeFolder(folder: string): Promise<void> {
    this.assertActive();
    const next = dataFolder(folder), release = this.pauseWrites();
    return this.queue(async () => {
      this.folder = next; this.unavailableFolder = undefined; this.entries = []; this.lessons = []; this.issues = [];
      try { await this.loadNow(); } catch (error) { this.loadFailed(error); throw error; }
    }).finally(release);
  }
  private loadFailed(error: unknown): void {
    this.issues = [{ path: this.folder, message: t('读取失败：{0}', 'Load failed: {0}', errorText(error)) }];
    this.entries = this.entries.map(entry => ({ ...entry, blocked: true })); this.ready = true; this.touch();
  }
  load(): Promise<void> { return this.queue(async () => { try { await this.loadNow(); } catch (error) { if (this.active) this.loadFailed(error); throw error; } }); }
  private async loadNow(): Promise<void> {
    this.assertActive();
    if (this.unavailableFolder) { this.issues = [this.unavailableFolder]; this.ready = true; this.touch(); return; }
    const paths = await this.port.list(this.folder); this.assertActive(); const previous = new Map(this.entries.map(entry => [entry.path, entry]));
    const entries: Entry[] = [], lessons: LessonEntry[] = [], issues: Issue[] = [], seen = new Set<string>();
    for (const path of paths) {
      this.assertActive();
      seen.add(path);
      try {
        const source = await this.port.read(path); this.assertActive(); const decoded = decode(source);
        if (decoded) { this.checkDemoLocation(decoded.decision, path); entries.push({ path, source, ...decoded }); }
        else {
          const lesson = decodeLesson(source);
          if (lesson) lessons.push({ path, source, ...lesson });
          else if (/^(?:决策|decision)-[^/]+\.md$/i.test(path.split('/').pop()!)) throw new DecisionError(t('决策文件缺少结构化记录。', 'The decision file is missing structured data.'));
        }
      } catch (error) {
        this.assertActive();
        issues.push({ path, message: errorText(error) });
        const cached = previous.get(path); if (cached) entries.push({ ...cached, blocked: true });
      }
    }
    const counts = new Map<string, number>(); for (const entry of entries) counts.set(entry.decision.id, (counts.get(entry.decision.id) ?? 0) + 1);
    for (const entry of entries) {
      this.assertActive();
      if (counts.get(entry.decision.id)! > 1) { entry.blocked = true; issues.push({ path: entry.path, message: t('决策 ID 重复。请移走副本或修复 ID，再重新读取。', 'Duplicate decision ID. Move the copy out or repair the ID, then reload.') }); }
      // Declared lesson files remain reachable after being moved outside the data folder.
      for (const link of entry.decision.lessonLinks) if (!seen.has(link.path)) {
        seen.add(link.path);
        try { const source = await this.port.read(link.path); this.assertActive(); const decoded = decodeLesson(source); if (decoded && decoded.meta.decisionId === entry.decision.id && decoded.meta.reviewId === link.reviewId && decoded.meta.demo === entry.decision.demo) lessons.push({ path: link.path, source, ...decoded }); }
        catch { this.assertActive(); /* Missing links are shown next to the associated review. */ }
      }
    }
    const lessonIDs = new Map<string, number>(); for (const lesson of lessons) lessonIDs.set(lesson.meta.id, (lessonIDs.get(lesson.meta.id) ?? 0) + 1);
    this.lessons = lessons.filter(lesson => { if (lessonIDs.get(lesson.meta.id)! > 1) { issues.push({ path: lesson.path, message: t('经验笔记 ID 重复，请修复副本后重新读取。', 'Duplicate lesson note ID. Repair the copy, then reload.') }); return false; } return true; }).sort((a, b) => compareEvents(b.meta, a.meta));
    this.entries = entries; this.issues = issues; this.ready = true; this.touch();
  }
  private async saved(path: string, source: string): Promise<void> {
    if (!this.active) return;
    const decoded = decode(source)!; this.entries = [{ path, source, ...decoded }, ...this.entries.filter(entry => entry.path !== path)]; this.ready = true; this.touch();
    try { await this.loadNow(); } catch (error) { this.issues = [{ path, message: t('内容已保存，但刷新失败：{0}', 'Saved, but refreshing failed: {0}', errorText(error)) }]; this.touch(); }
  }
  private async current(entry: Entry): Promise<Entry> {
    await this.loadNow(); const found = this.entries.find(item => item.path === entry.path && item.decision.id === entry.decision.id);
    if (!found || found.blocked || found.source !== entry.source) throw new ConflictError(); return found;
  }
  private checkDemoLocation(d: Decision, path: string): void {
    if (d.demo !== under(path, `${this.folder}/演示数据`)) throw new DecisionError(t('演示标记与文件目录不一致，请修复后重试。', 'The demo marker does not match its folder. Repair it, then retry.'));
  }
  create(decision: Decision): Promise<string> { return this.mutation(async check => {
    validateDecision(decision); await this.loadNow();
    if (this.entries.some(entry => entry.decision.id === decision.id)) throw new DecisionError(t('相同 ID 的决定已存在，请重新打开。', 'A decision with this ID already exists. Open it again.'));
    const path = `${this.folder}/${decision.demo ? '演示数据/' : ''}决策-${decision.id}.md`; const source = encode(decision);
    check(); await this.port.write(path, source, null); await this.saved(path, source); return decision.id;
  }); }
  update(entry: Entry, change: (decision: Decision) => Decision): Promise<void> { return this.mutation(async check => {
    const current = await this.current(entry); const next = change(clone(current.decision));
    validateDecision(next); if (next.id !== current.decision.id || next.demo !== current.decision.demo) throw new DecisionError(t('决定 ID 和演示标记不可更改。', 'Decision ID and demo marker cannot be changed.'));
    this.checkDemoLocation(next, current.path); const source = encode(next, current.appendix);
    check(); await this.port.write(current.path, source, current.source); await this.saved(current.path, source);
  }); }
  remove(entry: Entry): Promise<void> { return this.mutation(async check => { const current = await this.current(entry); this.checkDemoLocation(current.decision, current.path); check(); await this.port.trash(current.path, current.source); this.entries = this.entries.filter(item => item.path !== current.path); await this.loadNow(); }); }
  findLesson(decisionId: string, reviewId: string, demo: boolean): LessonEntry | undefined { return this.lessons.find(lesson => lesson.meta.decisionId === decisionId && lesson.meta.reviewId === reviewId && lesson.meta.demo === demo); }
  saveLesson(entry: Entry, reviewId: string, title: string, content: string, copy = false): Promise<string> { return this.mutation(async check => {
    const current = await this.current(entry); this.checkDemoLocation(current.decision, current.path);
    const originalReview = current.decision.reviews.find(review => review.id === reviewId);
    if (!originalReview) throw new DecisionError(t('回访不存在。', 'The review does not exist.'));
    const version = effectiveReview(current.decision, originalReview);
    const candidates = this.lessons.filter(lesson => lesson.meta.decisionId === current.decision.id && lesson.meta.reviewId === reviewId && lesson.meta.demo === current.decision.demo);
    // An unindexed copy is a successful first write from a previous attempt.
    // Reuse it before assigning another path; explicitly saved copies still get new paths.
    let lesson = copy ? candidates.find(lesson => lesson.meta.reviewVersionId === version.versionId && !current.decision.lessonLinks.some(link => link.path === lesson.path)) : candidates[0];
    if (!lesson) {
      const directory = `${this.folder}/${current.decision.demo ? '演示数据/' : ''}经验`;
      const path = `${directory}/经验-${current.decision.id}-${reviewId}${copy ? `-${newId()}` : ''}.md`;
      const meta: LessonMeta = { decisionReviewLesson: 1, id: newId(), demo: current.decision.demo, decisionId: current.decision.id, reviewId, reviewVersionId: version.versionId, title: title.trim(), createdAt: new Date().toISOString() };
      const source = encodeLesson(meta, content, current.path);
      check(); await this.port.write(path, source, null); lesson = { path, source, ...decodeLesson(source)! };
      // Keep the successful first write, even if source linking or a subsequent reload fails.
      this.lessons = [lesson, ...this.lessons]; this.touch();
    }
    if (!current.decision.lessonLinks.some(link => link.path === lesson!.path && link.reviewId === reviewId)) {
      const source = encode(linkLesson(current.decision, { reviewId, path: lesson.path, reviewVersionId: lesson.meta.reviewVersionId }), current.appendix);
      try { check(); await this.port.write(current.path, source, current.source); await this.saved(current.path, source); }
      catch (error) { throw new LessonSavedError(lesson.path, error); }
    }
    return lesson.path;
  }); }
  handleRename(oldPath: string, newPath: string): Promise<void> { return this.queue(async () => {
    if (!validPath(newPath)) { await this.loadNow(); return; }
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.loadNow(); let retry = false;
      for (const entry of this.entries) {
        this.assertActive();
        if (entry.blocked) continue;
        const next = renameReferences(entry.decision, oldPath, newPath);
        if (JSON.stringify(next) === JSON.stringify(entry.decision)) continue;
        try { this.assertActive(); await this.port.write(entry.path, encode(next, entry.appendix), entry.source); }
        catch (error) { if (error instanceof ConflictError && attempt < 2) retry = true; else throw error; }
      }
      if (!retry) break;
    }
    await this.loadNow(); for (const listener of this.renameListeners) listener(oldPath, newPath);
  }); }
  async rebaseAfterRename(entry: Entry, oldPath: string, newPath: string): Promise<Entry> {
    const expected = renameReferences(entry.decision, oldPath, newPath);
    const found = this.entries.find(item => item.path === renamePath(entry.path, oldPath, newPath) && item.decision.id === entry.decision.id);
    return found && !found.blocked && found.appendix === entry.appendix && JSON.stringify(found.decision) === JSON.stringify(expected) ? found : entry;
  }
  loadDemo(items: Decision[]): Promise<void> { return this.mutation(async check => {
    await this.loadNow();
    for (const item of items) {
      if (!item.demo) throw new DecisionError(t('演示记录缺少演示标记。', 'The demo record has no demo marker.'));
      if (this.entries.some(entry => entry.decision.id === item.id)) continue;
      const path = `${this.folder}/演示数据/决策-${item.id}.md`; check(); await this.port.write(path, encode(item), null);
    }
    await this.loadNow();
  }); }
  clearDemo(): Promise<void> { return this.mutation(async check => {
    await this.loadNow(); const directory = `${this.folder}/演示数据`;
    // Never recursively delete a folder; only verified plugin-owned demo notes are eligible.
    const candidates = [...this.entries.filter(entry => entry.decision.demo && !entry.blocked && under(entry.path, directory)).map(entry => ({ path: entry.path, source: entry.source })), ...this.lessons.filter(entry => entry.meta.demo && under(entry.path, directory)).map(entry => ({ path: entry.path, source: entry.source }))];
    try { for (const item of candidates) { check(); await this.port.trash(item.path, item.source); } }
    finally { await this.loadNow(); }
  }); }
}
