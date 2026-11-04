import { App, EditableFileView, getLanguage, Notice, Plugin, PluginSettingTab, Setting, setTooltip, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { arrange, ConflictError, dataFolder, DecisionError, isDue, localDate, Reference, renamePath, scheduleOf, under, validDataPath, validURL } from './domain';
import { ConfirmModal, DecisionPicker, LessonModal, RecordModal, ReviewModal, ScheduleModal, SupplementModal } from './forms';
import { demoDecisions } from './demo';
import { getLocale, LanguagePreference, normalizePreference, resolveLocale, setLocale, t } from './i18n';
import { DecisionStore, Entry, errorText, StoragePort } from './store';
import { DecisionView, VIEW_TYPE, ViewHost } from './view';
import { serializeSettingsWrite, settleSettingsWrites, stoppedError } from './lifecycle';
export interface Settings { language: LanguagePreference; folder: string; days: number; statusBar: boolean }
class VaultStorage implements StoragePort {
  constructor(private app: App) {}
  async list(folder: string): Promise<string[]> {
    if (!validDataPath(folder)) throw new DecisionError(t('目录「{0}」不可见，请选择 Obsidian 可索引的目录。', 'Folder “{0}” is hidden. Choose a folder Obsidian can index.', folder));
    const entry = this.app.vault.getAbstractFileByPath(folder);
    if (entry instanceof TFile) throw new DecisionError(t('「{0}」被同名文件占用。', 'A file occupies the folder path “{0}”.', folder));
    if (!(entry instanceof TFolder) && await this.app.vault.adapter.exists(folder) && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw new DecisionError(t('目录「{0}」尚未被 Obsidian 读取。请选择可见目录或等待读取后重试。', 'Folder “{0}” has not been indexed by Obsidian. Choose a visible folder or wait for indexing, then retry.', folder));
    return this.app.vault.getMarkdownFiles().filter(file => under(file.path, folder)).map(file => file.path);
  }
  async read(path: string): Promise<string> { const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) throw new DecisionError(t('文件不存在：{0}', 'File not found: {0}', path)); return this.app.vault.read(file); }
  private async folders(path: string): Promise<void> { const parts = path.split('/'); parts.pop(); let current = ''; for (const part of parts) { current = current ? `${current}/${part}` : part; const file = this.app.vault.getAbstractFileByPath(current); if (file instanceof TFolder) continue; if (file) throw new DecisionError(t('「{0}」被同名文件占用。', 'A file occupies the folder path “{0}”.', current)); try { await this.app.vault.createFolder(current); } catch (error) { if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; } if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw new DecisionError(t('目录「{0}」尚未被 Obsidian 读取，记录未写入。', 'Folder “{0}” has not been indexed by Obsidian. The record was not written.', current)); } }
  async write(path: string, source: string, expected: string | null): Promise<void> {
    if (!validDataPath(path)) throw new DecisionError(t('文件路径无效或位于隐藏路径中，请选择 Obsidian 可见目录。', 'The file path is invalid or hidden. Choose a folder visible to Obsidian.'));
    try {
      if (expected === null) {
        await this.folders(path); await this.app.vault.create(path, source);
        if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) throw new DecisionError(t('内容已写入「{0}」，但 Obsidian 尚未索引它。输入已保留，请将文件移入可见目录后重新读取。', 'Content was written to “{0}”, but Obsidian has not indexed it. Your input is preserved; move the file to a visible folder, then reload.', path));
        return;
      }
      const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) throw new ConflictError();
      await this.app.vault.process(file, current => { if (current !== expected) throw new ConflictError(); return source; });
    } catch (error) { if (error instanceof ConflictError) throw error; throw new DecisionError(t('保存「{0}」失败：{1}', 'Could not save “{0}”: {1}', path, errorText(error))); }
  }
  async trash(path: string, expected: string): Promise<void> { const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile) || await this.app.vault.read(file) !== expected) throw new ConflictError(); await this.app.vault.trash(file, false); }
}
export default class DecisionReviewPlugin extends Plugin implements ViewHost {
  store!: DecisionStore;
  settings!: Settings;
  private ribbon?: HTMLElement; private status?: HTMLElement; private timer?: ReturnType<typeof setTimeout>; private unloaded = false; private commandsReady = false; private settingsChain: Promise<unknown> = Promise.resolve();
  private fileTasks = new Map<string, Promise<void>>();
  private renameChain: Promise<unknown> = Promise.resolve();
  private folderChoice = 0;
  async onload(): Promise<void> {
    this.register(() => { this.unloaded = true; this.store?.close(); if (this.timer) clearTimeout(this.timer); });
    await settleSettingsWrites(this.app); this.assertLoaded();
    const raw = await this.loadData() as Partial<Settings> | null; this.assertLoaded(); const language = normalizePreference(raw?.language); setLocale(resolveLocale(language, getLanguage()));
    let folder = typeof raw?.folder === 'string' ? raw.folder : getLocale() === 'zh-CN' ? '决策复盘' : 'Decision Review';
    let storageFolder = folder, unavailable: { path: string; message: string } | undefined;
    try { folder = dataFolder(folder); storageFolder = folder; }
    catch (error) {
      storageFolder = '决策复盘';
      unavailable = { path: folder, message: t('原数据目录「{0}」不可用：{1}。请在设置中选择可见目录；已有记录可先移入可见目录再重新读取。', 'The saved data folder “{0}” is unavailable: {1}. Choose a visible folder in settings; existing records can be moved there and reloaded.', folder, errorText(error)) };
      new Notice(unavailable.message, 15000);
    }
    this.settings = { language, folder, days: [7, 14, 30, 90].includes(Number(raw?.days)) ? Number(raw!.days) : 30, statusBar: raw?.statusBar !== false };
    if (!raw?.folder) await this.saveData(this.settings);
    this.assertLoaded();
    this.store = new DecisionStore(new VaultStorage(this.app), storageFolder);
    if (unavailable) this.store.markFolderUnavailable(unavailable.path, unavailable.message);
    this.registerView(VIEW_TYPE, leaf => new DecisionView(leaf, this));
    this.ribbon = this.addRibbonIcon('book-check', t('打开决策复盘', 'Open Decision Review'), () => this.run(() => this.openView()));
    this.status = this.addStatusBarItem(); this.status.addEventListener('click', () => this.run(async () => { const view = await this.openView(); view?.show('due'); })); this.status.setAttribute('role', 'button'); this.status.tabIndex = 0;
    this.status.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.status!.click(); } });
    this.register(this.store.subscribe(() => this.updateStatus())); this.commands(); this.addSettingTab(new DecisionSettings(this.app, this));
    this.app.workspace.onLayoutReady(() => { if (!this.unloaded) this.run(() => this.store.load()); });
    const schedule = (): void => { if (this.unloaded) return; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.run(() => this.store.load()), 250); };
    this.registerEvent(this.app.vault.on('modify', file => { if (under(file.path, this.store.folder) || this.store.lessons.some(lesson => lesson.path === file.path)) schedule(); }));
    this.registerEvent(this.app.vault.on('create', schedule)); this.registerEvent(this.app.vault.on('delete', schedule));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const release = this.settings.folder === oldPath || under(this.settings.folder, oldPath) ? this.store.pauseWrites() : () => undefined;
      const work = (): Promise<void> => this.followRename(file, oldPath);
      const task = this.renameChain.then(work, work).finally(release);
      this.renameChain = task.catch(() => undefined); this.run(() => task);
    }));
    let today = localDate(); const tick = (): void => { const next = localDate(); if (next !== today) { today = next; this.store.touch(); } };
    this.registerInterval(window.setInterval(tick, 60000)); this.registerDomEvent(window, 'focus', tick); this.registerDomEvent(document, 'visibilitychange', tick);
    this.updateStatus();
  }
  private assertLoaded(): void { if (this.unloaded) throw stoppedError(); }
  async saveData(data: unknown): Promise<void> { this.assertLoaded(); await serializeSettingsWrite(this.app, async () => { this.assertLoaded(); await super.saveData(data); }); }
  run(work: () => Promise<unknown>): void { if (this.unloaded) return; void Promise.resolve().then(() => { if (!this.unloaded) return work(); }).catch(error => { if (!this.unloaded) new Notice(errorText(error), 10000); }); }
  private commands(): void {
    const ids = ['open-decision-review', 'record-decision', 'view-due-reviews', 'review-decision', 'open-lessons']; if (this.commandsReady) ids.forEach(id => this.removeCommand(id));
    this.addCommand({ id: ids[0]!, name: t('打开决策复盘', 'Open Decision Review'), callback: () => this.run(() => this.openView()) });
    this.addCommand({ id: ids[1]!, name: t('记录一个决定', 'Record a decision'), callback: () => this.create(false) });
    this.addCommand({ id: ids[2]!, name: t('查看待回访', 'View due reviews'), callback: () => this.run(async () => { const view = await this.openView(); view?.show('due'); }) });
    this.addCommand({ id: ids[3]!, name: t('为当前决定做回访', 'Review a decision'), callback: () => this.run(() => this.pickReview()) });
    this.addCommand({ id: ids[4]!, name: t('打开经验笔记', 'Open lesson notes'), callback: () => this.run(async () => { const view = await this.openView(); view?.show('lessons'); }) }); this.commandsReady = true;
  }
  private updateStatus(): void { if (!this.status) return; const due = this.store.entries.filter(entry => !entry.decision.demo && isDue(entry.decision)).length; this.status.hidden = !this.settings.statusBar; this.status.textContent = t('决策待回访 {0}', 'Decision reviews due: {0}', due); this.status.setAttribute('aria-label', t('查看 {0} 个待回访决定', 'View {0} decisions due for review', due)); }
  setSettings(patch: Partial<Settings>, followMove = false): Promise<void> {
    const work = async (): Promise<void> => {
      this.assertLoaded();
      const next = { ...this.settings, ...patch }; next.language = normalizePreference(next.language); next.folder = dataFolder(next.folder); if (![7, 14, 30, 90].includes(next.days)) throw new DecisionError(t('回访间隔无效。', 'Invalid review interval.'));
      const folderChanged = next.folder !== this.settings.folder, release = folderChanged ? this.store.pauseWrites() : () => undefined;
      try {
        await this.saveData(next); this.assertLoaded(); this.settings = next; if (patch.folder !== undefined && !followMove) this.folderChoice++;
        setLocale(resolveLocale(next.language, getLanguage())); this.commands(); if (this.ribbon) setTooltip(this.ribbon, t('打开决策复盘', 'Open Decision Review'), { placement: 'right' });
        if (folderChanged) await this.store.changeFolder(next.folder); else await this.store.load();
        this.assertLoaded();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof DecisionView) leaf.view.relocalize(); this.updateStatus();
      } finally { release(); }
    };
    const task = this.settingsChain.then(work, work); this.settingsChain = task.catch(() => undefined); return task;
  }
  private async waitForSettings(): Promise<void> {
    let pending: Promise<unknown>;
    do { pending = this.settingsChain; await pending; } while (pending !== this.settingsChain);
  }
  private async followRename(file: TAbstractFile, oldPath: string): Promise<void> {
    const originalFolder = this.settings.folder, choice = this.folderChoice; let trackedFolder = originalFolder;
    let following = originalFolder === oldPath || under(originalFolder, oldPath), retrySettings = false;
    for (;;) {
      if (this.unloaded) return;
      await this.waitForSettings(); this.assertLoaded(); let nextPath = file.path;
      // An explicit folder choice made while awaiting I/O takes precedence.
      if (this.settings.folder !== trackedFolder || this.folderChoice !== choice) following = false;
      if (following) {
        const physicalFolder = renamePath(originalFolder, oldPath, nextPath); let nextFolder: string;
        try { nextFolder = dataFolder(physicalFolder); }
        catch (error) {
          let message = t('数据目录已移动到不可用路径「{0}」：{1}。保存已暂停，输入会保留。请移回可见目录，并在设置中重新选择目录。', 'The data folder moved to the unavailable path “{0}”: {1}. Saving is paused and your input is preserved. Move it to a visible folder and select that folder in settings.', physicalFolder, errorText(error));
          this.settings = { ...this.settings, folder: physicalFolder }; this.store.markFolderUnavailable(physicalFolder, message);
          const persist = (): Promise<void> => this.saveData(this.settings);
          const saved = this.settingsChain.then(persist, persist); this.settingsChain = saved.catch(() => undefined);
          try { await saved; } catch (settingsError) {
            message += t(' 保存目录设置也失败：{0}。请在重载前处理此错误。', ' Saving the folder setting also failed: {0}. Resolve this before reloading.', errorText(settingsError));
            this.store.markFolderUnavailable(physicalFolder, message);
          }
          throw new DecisionError(message);
        }
        if (nextFolder !== trackedFolder) {
          try { await this.setSettings({ folder: nextFolder }, true); }
          catch (error) {
            this.assertLoaded();
            await this.waitForSettings();
            if (this.folderChoice !== choice) following = false;
            else if (this.settings.folder !== nextFolder) {
              // The physical move already happened; keep it readable if settings I/O fails.
              this.settings = { ...this.settings, folder: nextFolder }; retrySettings = true;
              await this.store.changeFolder(nextFolder);
            } else if (file.path === nextPath) throw error;
          }
          await this.waitForSettings();
          if (this.folderChoice !== choice || this.settings.folder !== nextFolder) following = false;
          trackedFolder = this.settings.folder;
        }
        if (following && file.path !== nextPath) continue;
      }
      if (!following) nextPath = file.path;
      try { await this.store.handleRename(oldPath, nextPath); }
      catch (error) { if (following && file.path !== nextPath) continue; throw error; }
      if (!following || file.path === nextPath) break;
    }
    if (retrySettings && !this.unloaded) {
      try { await this.setSettings({}); }
      catch (error) { if (!this.unloaded) new Notice(t('目录已跟随到「{0}」，但保存设置或刷新失败：{1}。请在设置中重新保存目录。', 'Following the moved folder “{0}”, but saving settings or refreshing failed: {1}. Save the folder again in settings.', this.settings.folder, errorText(error)), 10000); }
    }
  }
  setLanguage(language: LanguagePreference): Promise<void> { return this.setSettings({ language }); }
  private async waitForWorkspace(): Promise<void> {
    this.assertLoaded();
    await new Promise<void>(resolve => this.app.workspace.onLayoutReady(resolve));
    this.assertLoaded();
  }
  async openView(id?: string): Promise<DecisionView | undefined> {
    await this.waitForWorkspace();
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.assertLoaded(); await this.app.workspace.revealLeaf(leaf); this.assertLoaded(); this.app.workspace.setActiveLeaf(leaf, { focus: true }); const view = leaf.view instanceof DecisionView ? leaf.view : undefined; if (id) view?.select(id); return view;
  }
  private after(id: string): void { if (this.unloaded) return; for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof DecisionView) leaf.view.keep(id); }
  create(demo: boolean): void { this.assertLoaded(); new RecordModal(this.app, this.store, this.settings.days, id => { this.run(() => this.openView(id)); }, undefined, demo).open(); }
  correct(entry: Entry): void { this.assertLoaded(); new RecordModal(this.app, this.store, this.settings.days, id => this.after(id), entry).open(); }
  review(entry: Entry, revisionId: string, reviewId?: string): void { this.assertLoaded(); new ReviewModal(this.app, this.store, entry, this.settings.days, id => this.after(id), revisionId, reviewId).open(); }
  schedule(entry: Entry, reopen = false): void { this.assertLoaded(); new ScheduleModal(this.app, this.store, entry, this.settings.days, id => this.after(id), reopen).open(); }
  supplement(entry: Entry): void { this.assertLoaded(); new SupplementModal(this.app, this.store, entry, id => this.after(id)).open(); }
  lesson(entry: Entry, review: Parameters<ViewHost['lesson']>[1], copy = false): void { this.assertLoaded(); new LessonModal(this.app, this.store, entry, review, (path, id) => { this.after(id); this.run(() => this.openFile(path)); }, copy).open(); }
  async closeDecision(entry: Entry): Promise<void> { new ConfirmModal(this.app, t('结束这条决定的回访？', 'Close follow-up for this decision?'), t('记录会保留，以后可以重新开启。', 'Records are preserved. You can reopen follow-up later.'), t('结束回访', 'Close follow-up'), accepted => { if (accepted) this.run(async () => { await this.store.update(entry, d => arrange(d, null, 'closed')); this.after(entry.decision.id); }); }).open(); }
  async remove(entry: Entry): Promise<void> { new ConfirmModal(this.app, t('将这个决定移到回收站？', 'Move this decision to trash?'), t('决定文件及其历史会移到库内回收站，资料和独立经验笔记保留。', 'The decision file and its history move to vault trash. References and independent lesson notes remain.'), t('移到回收站', 'Move to trash'), accepted => { if (accepted) this.run(() => this.store.remove(entry)); }).open(); }
  loadDemo(): Promise<void> { return this.store.loadDemo(demoDecisions()); }
  async clearDemo(): Promise<void> { return new Promise(resolve => new ConfirmModal(this.app, t('清除演示数据？', 'Clear demo data?'), t('只将带演示标记的示例决定和经验笔记移到回收站。', 'Only marked demo decisions and lesson notes are moved to trash.'), t('清除演示', 'Clear demo'), accepted => { if (accepted) this.run(async () => { try { await this.store.clearDemo(); } finally { resolve(); } }); else resolve(); }).open()); }
  exists(path: string): boolean { return this.app.vault.getAbstractFileByPath(path) instanceof TFile; }
  async openRef(ref: Reference): Promise<void> { if (ref.kind === 'file') return this.openFile(ref.path); if (!validURL(ref.url)) throw new DecisionError(t('网址无效。', 'Invalid URL.')); window.open(ref.url, '_blank', 'noopener,noreferrer'); }
  openFile(path: string): Promise<void> { const pending = this.fileTasks.get(path); if (pending) return pending; const task = this.openFileOnce(path).finally(() => this.fileTasks.delete(path)); this.fileTasks.set(path, task); return task; }
  private async openFileOnce(path: string): Promise<void> {
    await this.waitForWorkspace();
    const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) throw new DecisionError(t('链接失效：{0}。请重新关联资料。', 'Missing file: {0}. Link the reference again.', path));
    const candidates: WorkspaceLeaf[] = []; this.app.workspace.iterateAllLeaves(leaf => { if (leaf.getViewState().state?.file === path) candidates.push(leaf); });
    for (const leaf of candidates) { await leaf.loadIfDeferred(); if (leaf.view instanceof EditableFileView && leaf.view.file?.path === path) { await this.app.workspace.revealLeaf(leaf); this.app.workspace.setActiveLeaf(leaf, { focus: true }); return; } }
    await this.app.workspace.getLeaf('tab').openFile(file);
  }
  private async pickReview(): Promise<void> {
    await this.waitForWorkspace();
    const current = this.app.workspace.getActiveViewOfType(EditableFileView)?.file?.path; await this.store.load();
    const entries = this.store.entries.filter(entry => !entry.blocked && !entry.decision.demo && scheduleOf(entry.decision).status === 'open');
    const related = current ? entries.filter(({ decision }) => [
      ...decision.original.record.references,
      ...decision.revisions.flatMap(revision => revision.record.references),
      ...decision.reviews.flatMap(review => review.references),
      ...decision.reviewCorrections.flatMap(correction => correction.corrected.references),
      ...decision.supplements.flatMap(note => note.references)
    ].some(ref => ref.kind === 'file' && ref.path === current)) : [];
    const choices = related.length ? related : entries;
    if (!choices.length) { new Notice(t('没有可回访的决定，请先记录一个决定。', 'No decisions to review. Record a decision first.')); await this.openView(); return; }
    if (choices.length === 1) this.review(choices[0]!, choices[0]!.decision.original.id); else new DecisionPicker(this.app, choices, entry => this.review(entry, entry.decision.original.id)).open();
  }
}
class DecisionSettings extends PluginSettingTab {
  constructor(app: App, private plugin: DecisionReviewPlugin) { super(app, plugin); }
  display(): void {
    this.containerEl.replaceChildren(); const p = this.plugin;
    new Setting(this.containerEl).setName(t('决策复盘', 'Decision Review')).setHeading();
    new Setting(this.containerEl).setName(t('界面语言', 'Interface language')).setDesc(t('切换语言不会改写用户内容或移动文件。', 'Changing language does not rewrite user content or move files.')).addDropdown(dropdown => { dropdown.addOptions({ auto: t('跟随 Obsidian', 'Follow Obsidian'), 'zh-CN': '简体中文', en: 'English' }).setValue(p.settings.language); dropdown.selectEl.setAttribute('aria-label', t('界面语言', 'Interface language')); dropdown.onChange(async value => { dropdown.setDisabled(true); try { await p.setLanguage(normalizePreference(value)); this.display(); } catch (error) { dropdown.setValue(p.settings.language); new Notice(errorText(error), 10000); } finally { dropdown.setDisabled(false); } }); });
    new Setting(this.containerEl).setName(t('默认回访间隔', 'Default review interval')).setDesc(t('用于新记录，不改动已有安排。', 'Used for new records; existing schedules stay unchanged.')).addDropdown(dropdown => { dropdown.addOptions(Object.fromEntries([7, 14, 30, 90].map(days => [String(days), t('{0} 天', '{0} days', days)]))).setValue(String(p.settings.days)); dropdown.onChange(value => p.run(() => p.setSettings({ days: Number(value) }))); });
    let folder = p.settings.folder; const setting = new Setting(this.containerEl).setName(t('数据文件夹', 'Data folder')).setDesc(t('请选择可见文件夹，路径段不能以点号开头。切换路径不会搬迁旧文件；迁移时先在 Obsidian 内移动整个目录。', 'Choose a visible folder; path segments cannot start with a dot. Changing this path does not move old files. To migrate, move the entire folder in Obsidian first.'));
    setting.addText(text => { text.setValue(folder).onChange(value => { folder = value; }); text.inputEl.setAttribute('aria-label', t('数据文件夹', 'Data folder')); }); setting.addButton(button => button.setButtonText(t('保存目录', 'Save folder')).onClick(async () => { button.setDisabled(true); try { await p.setSettings({ folder }); this.display(); } catch (error) { new Notice(errorText(error), 10000); } finally { button.setDisabled(false); } }));
    new Setting(this.containerEl).setName(t('状态栏到期数量', 'Due count in status bar')).addToggle(toggle => { toggle.setValue(p.settings.statusBar).onChange(value => p.run(() => p.setSettings({ statusBar: value }))); });
    new Setting(this.containerEl).setName(t('演示数据', 'Demo data')).setDesc(t('与真实记录分开保存。', 'Stored separately from real decisions.')).addButton(button => button.setButtonText(t('载入演示', 'Load demo')).onClick(() => p.run(async () => { await p.loadDemo(); const view = await p.openView(); view?.showDemo(); }))).addButton(button => button.setButtonText(t('清除演示', 'Clear demo')).onClick(() => p.run(() => p.clearDemo())));
    new Setting(this.containerEl).setName(t('重新读取', 'Reload')).setDesc(t('修复源文件后重新读取记录。', 'Reload records after repairing source files.')).addButton(button => button.setButtonText(t('重新读取', 'Reload')).onClick(() => p.run(() => p.store.load())));
  }
}
