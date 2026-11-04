import { App, EditableFileView, EventRef, FuzzySuggestModal, Modal, Notice, TFile } from 'obsidian';
import { addDays, addReview, arrange, clone, correctReview, DecisionError, effectiveReview, localDate, newDecision, newId, Outcome, RecordSnapshot, recordVersions, Reference, renamePath, reviseRecord, Review, scheduleOf, supplement, under, validDate, validURL } from './domain';
import { Entry, errorText, DecisionStore } from './store';
import { button, el, field, select } from './ui';
import { getLocale, t, translator } from './i18n';
import { outcomeLabel } from './codec';
export class ConfirmModal extends Modal {
  private resolved = false;
  private previous?: HTMLElement;
  constructor(app: App, private title: string, private description: string, private accept: string, private done: (accepted: boolean) => void) { super(app); }
  onOpen(): void {
    this.previous = this.modalEl.ownerDocument.activeElement as HTMLElement; this.modalEl.classList.add('dr-confirm'); this.setTitle(this.title);
    this.modalEl.setAttribute('aria-label', this.title); el(this.contentEl, 'p', 'dr-muted', this.description);
    const actions = el(this.contentEl, 'div', 'dr-actions'); const cancel = button(actions, t('取消', 'Cancel'), () => this.close());
    button(actions, this.accept, () => { this.resolved = true; super.close(); this.done(true); }, 'mod-cta'); cancel.focus();
  }
  onClose(): void { if (!this.resolved) this.done(false); if (this.previous?.isConnected) this.previous.focus({ preventScroll: true }); }
}
class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private choose: (file: TFile) => void) { super(app); this.setPlaceholder(t('搜索库内笔记或文件', 'Search vault notes or files')); }
  getItems(): TFile[] { return this.app.vault.getFiles(); }
  getItemText(item: TFile): string { return item.path; }
  onChooseItem(item: TFile): void { this.choose(item); }
}
export class DecisionPicker extends FuzzySuggestModal<Entry> {
  constructor(app: App, private items: Entry[], private choose: (item: Entry) => void) { super(app); this.setPlaceholder(t('搜索并选择决定', 'Search and choose a decision')); }
  getItems(): Entry[] { return this.items; }
  getItemText(item: Entry): string { return item.decision.original.record.title; }
  onChooseItem(item: Entry): void { this.choose(item); }
}
abstract class SaveModal extends Modal {
  protected tr = translator(getLocale());
  protected form!: HTMLFormElement;
  protected body!: HTMLElement;
  protected error!: HTMLElement;
  protected entry?: Entry;
  private cleanup: Array<() => void> = [];
  private busy = false;
  private allowed = false;
  private asking = false;
  private baseline = '';
  private signatureExtras: () => unknown = () => [];
  private sourceFolder?: string;
  private sourceVersion?: number;
  protected actionButton!: HTMLButtonElement;
  constructor(app: App, protected store?: DecisionStore, entry?: Entry) { super(app); this.entry = entry; this.sourceFolder = store?.folder; this.sourceVersion = store?.folderVersion; }
  protected setup(title: string, description: string): void {
    this.modalEl.classList.add('dr-modal'); this.setTitle(title); this.modalEl.setAttribute('aria-label', title);
    el(this.contentEl, 'p', 'dr-form-description dr-muted', description);
    this.form = el(this.contentEl, 'form', 'dr-form'); this.form.noValidate = true;
    this.body = el(this.form, 'div', 'dr-form-body'); this.error = el(this.body, 'div', 'dr-error'); this.error.setAttribute('role', 'alert'); this.error.hidden = true;
    if (this.store) this.dispose(this.store.onRename((oldPath, newPath) => { if (this.entry) void this.store!.rebaseAfterRename(this.entry, oldPath, newPath).then(next => { this.entry = next; }); }));
  }
  protected dispose(cleanup: () => void): void { this.cleanup.push(cleanup); }
  protected focusInput(input: HTMLElement): void {
    input.focus(); const window = this.modalEl.ownerDocument.defaultView;
    if (window) { const frame = window.requestAnimationFrame(() => { if (this.form.isConnected) input.focus(); }); this.dispose(() => window.cancelAnimationFrame(frame)); }
  }
  protected submit(label: string, work: () => Promise<void>, extras: () => unknown = () => []): void {
    this.signatureExtras = extras;
    const footer = el(this.form, 'footer', 'dr-form-footer'); el(footer, 'span', 'dr-shortcut', this.tr('Ctrl / ⌘ + Enter 保存', 'Ctrl / ⌘ + Enter to save'));
    button(footer, this.tr('取消', 'Cancel'), () => this.close()); this.actionButton = el(footer, 'button', 'dr-button mod-cta', label); this.actionButton.type = 'submit';
    this.baseline = this.signature();
    this.scope.register(['Ctrl'], 'Enter', event => { if (!event.isComposing && !event.repeat && !this.busy) this.form.requestSubmit(); return false; });
    this.scope.register(['Meta'], 'Enter', event => { if (!event.isComposing && !event.repeat && !this.busy) this.form.requestSubmit(); return false; });
    this.form.addEventListener('submit', event => {
      event.preventDefault(); if (this.busy) return; this.error.hidden = true;
      const missing = Array.from(this.form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[required],textarea[required]')).find(input => !input.disabled && !input.value.trim());
      if (missing) { this.showError(this.tr('请填写：{0}', 'Please fill in: {0}', missing.labels?.[0]?.textContent?.replace('*', '').trim() || '')); missing.focus(); return; }
      if (!this.form.reportValidity()) return;
      const checkFolder = (): void => {
        if (this.store) this.store.assertFolder(this.sourceVersion!);
        if (this.store && this.store.folder !== this.sourceFolder) throw new DecisionError(this.tr('数据目录已变更。请复制输入，重新打开表单。', 'The data folder changed. Copy your input and reopen this form.'));
      };
      try { checkFolder(); } catch (error) { this.showError(errorText(error)); return; }
      this.busy = true; const controls = new Map(Array.from(this.form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input,textarea,select,button'), control => [control, control.disabled] as const));
      for (const control of controls.keys()) control.disabled = true;
      const oldLabel = this.actionButton.textContent; this.actionButton.textContent = this.tr('正在保存…', 'Saving…'); this.form.setAttribute('aria-busy', 'true');
      void Promise.resolve().then(() => { checkFolder(); return work(); }).then(() => { this.allowed = true; this.busy = false; super.close(); }).catch(error => this.showError(errorText(error))).finally(() => {
        this.busy = false; this.form.removeAttribute('aria-busy');
        for (const control of this.form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input,textarea,select,button')) control.disabled = controls.get(control) ?? false;
        this.actionButton.textContent = oldLabel;
      });
    });
  }
  private signature(): string { return JSON.stringify([Array.from(this.form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select'), input => [input.name, input.type === 'radio' ? (input as HTMLInputElement).checked : input.value]), this.signatureExtras()]); }
  protected showError(message: string): void { this.error.textContent = message; this.error.hidden = false; this.error.scrollIntoView({ block: 'nearest' }); }
  close(): void {
    if (this.busy || this.asking) return;
    if (!this.allowed && this.form && this.baseline !== this.signature()) {
      this.asking = true; new ConfirmModal(this.app, this.tr('放弃未保存的内容？', 'Discard unsaved changes?'), this.tr('关闭后，本次输入不会保留。', 'Your unsaved input will be lost.'), this.tr('放弃修改', 'Discard changes'), accepted => { this.asking = false; if (accepted) { this.allowed = true; this.close(); } }).open(); return;
    }
    super.close();
  }
  onClose(): void { for (const callback of this.cleanup.splice(0)) callback(); }
}
class URLModal extends SaveModal {
  constructor(app: App, private choose: (ref: Reference) => void) { super(app); }
  onOpen(): void {
    this.setup(this.tr('添加网址', 'Add URL'), this.tr('仅在点击时打开网址。', 'URLs open only when clicked.'));
    const url = field(this.body, this.tr('网址', 'URL'), '', { required: true, max: 4000 }); const label = field(this.body, this.tr('链接名称（选填）', 'Link label (optional)'), '', { max: 300 });
    this.submit(this.tr('添加', 'Add'), async () => { if (!validURL(url.value.trim())) throw new DecisionError(this.tr('请输入有效的 http:// 或 https:// 网址。', 'Enter a valid http:// or https:// URL.')); this.choose({ kind: 'url', url: url.value.trim(), ...(label.value.trim() ? { label: label.value.trim() } : {}) }); }); url.focus();
  }
}
class ReferenceSelection {
  items: Reference[];
  private disposed = false;
  private renameRef: EventRef;
  private tr = translator(getLocale());
  constructor(parent: HTMLElement, private app: App, refs: Reference[]) {
    this.items = clone(refs); const section = el(parent, 'section', 'dr-reference-selection'); el(section, 'h3', '', this.tr('相关资料', 'References')); const list = el(section, 'div', 'dr-reference-list');
    const render = (): void => { list.replaceChildren(); for (const [index, ref] of this.items.entries()) { const row = el(list, 'div', 'dr-reference-row'); const path = ref.kind === 'file' ? ref.path : ref.url; el(row, 'span', 'dr-reference-name', ref.label || path); const remove = button(row, this.tr('移除', 'Remove'), () => { this.items.splice(index, 1); render(); }, 'dr-quiet'); remove.setAttribute('aria-label', this.tr('移除 {0}', 'Remove {0}', path)); remove.disabled = section.closest('form')?.getAttribute('aria-busy') === 'true'; } };
    const add = (ref: Reference): void => { if (this.disposed) return; if (this.items.length >= 100) { new Notice(this.tr('最多关联 100 项资料。', 'Up to 100 references are allowed.')); return; } if (!this.items.some(item => JSON.stringify(item) === JSON.stringify(ref))) this.items.push(ref); render(); };
    const actions = el(section, 'div', 'dr-actions'); button(actions, this.tr('选择库内文件', 'Choose vault file'), () => new FilePicker(app, file => add({ kind: 'file', path: file.path })).open(), '', 'file-plus');
    button(actions, this.tr('添加网址', 'Add URL'), () => new URLModal(app, add).open(), 'dr-quiet', 'link');
    this.renameRef = app.vault.on('rename', (file, oldPath) => { for (const ref of this.items) if (ref.kind === 'file') ref.path = renamePath(ref.path, oldPath, file.path); render(); }); render();
  }
  dispose(): void { this.disposed = true; this.app.vault.offref(this.renameRef); }
}
export class RecordModal extends SaveModal {
  private id = newId();
  constructor(app: App, store: DecisionStore, private days: number, private after: (id: string) => void, entry?: Entry, private demo = false) { super(app, store, entry); }
  onOpen(): void {
    const versions = this.entry ? recordVersions(this.entry.decision) : []; const original = versions[versions.length - 1]?.record;
    this.setup(this.entry ? this.tr('更正原记录', 'Correct record') : this.tr('记录一个决定', 'Record a decision'), this.entry ? this.tr('首次版本保留，更正会另存为新版本。', 'The original is preserved. Corrections are saved as a new version.') : this.tr('趁还记得，留下理由与期待。', 'Capture your reasons and expectations while they are fresh.'));
    const title = field(this.body, this.tr('这次做了什么决定', 'What did you decide'), original?.title, { required: true });
    const reason = field(this.body, this.tr('主要理由', 'Main reason'), original?.reason, { multiline: true, required: true });
    const expected = field(this.body, this.tr('期待看到什么', 'Expected outcome'), original?.expected, { multiline: true, required: true, hint: this.tr('到时看到什么，你会觉得这次选择值得？', 'What would make this choice worthwhile when you look back?') });
    const dates = el(this.body, 'div', 'dr-form-row'); const decisionDate = field(dates, this.tr('决定日期', 'Decision date'), original?.decisionDate ?? localDate(), { type: 'date', required: true });
    const nextDate = !this.entry ? field(dates, this.tr('下次回访（选填）', 'Next review (optional)'), addDays(localDate(), this.days), { type: 'date', hint: this.tr('清空可暂不安排。', 'Clear the date to leave it unscheduled.') }) : undefined;
    const extra = el(this.body, 'details', 'dr-optional'); el(extra, 'summary', '', this.tr('补充依据：其他选项、假设与资料', 'Add context: other options, assumptions and references'));
    const alternatives = field(extra, this.tr('考虑过的其他选项（选填）', 'Other options considered (optional)'), original?.alternatives, { multiline: true });
    const assumption = field(extra, this.tr('最担心的假设（选填）', 'Assumption to watch (optional)'), original?.assumption, { multiline: true });
    const active = this.app.workspace.getActiveViewOfType(EditableFileView)?.file;
    const initialRefs = original?.references ?? (active && !under(active.path, this.store!.folder) ? [{ kind: 'file' as const, path: active.path }] : []);
    const refs = new ReferenceSelection(extra, this.app, initialRefs); this.dispose(() => refs.dispose());
    const explanation = this.entry ? field(this.body, this.tr('更正原因', 'Reason for correction'), '', { required: true, multiline: true }) : undefined;
    this.submit(this.entry ? this.tr('保存更正', 'Save correction') : this.tr('保存决定', 'Save decision'), async () => {
      const record: RecordSnapshot = { title: title.value.trim(), reason: reason.value.trim(), expected: expected.value.trim(), decisionDate: decisionDate.value, alternatives: alternatives.value.trim(), assumption: assumption.value.trim(), references: clone(refs.items) };
      if (this.entry) { await this.store!.update(this.entry, d => reviseRecord(d, record, explanation!.value)); this.after(this.entry.decision.id); }
      else { const decision = newDecision(record, nextDate?.value || null, this.demo, this.id); await this.store!.create(decision); this.after(decision.id); }
    }, () => refs.items); title.focus();
  }
}
export class ReviewModal extends SaveModal {
  constructor(app: App, store: DecisionStore, entry: Entry, private days: number, private after: (id: string) => void, private revisionId = entry.decision.original.id, private reviewId?: string) { super(app, store, entry); }
  onOpen(): void {
    const d = this.entry!.decision; const prior = this.reviewId ? effectiveReview(d, d.reviews.find(review => review.id === this.reviewId)!).review : undefined;
    this.revisionId = prior?.recordRevisionId ?? this.revisionId;
    const version = recordVersions(d).find(item => item.id === this.revisionId) ?? d.original;
    this.setup(prior ? this.tr('更正回访', 'Correct review') : this.tr('做一次回访', 'Review decision'), d.original.record.title);
    const preview = el(this.body, 'div', 'dr-original-preview'); el(preview, 'span', 'dr-muted', this.tr('当时期待看到', 'Expected at the time')); el(preview, 'p', '', version.record.expected);
    const reviewDate = field(this.body, this.tr('回访日期', 'Review date'), prior?.reviewDate ?? localDate(), { type: 'date', required: true });
    const actual = field(this.body, this.tr('实际发生了什么', 'What happened'), prior?.actual, { multiline: true, required: true });
    const outcomes = el(this.body, 'fieldset', 'dr-outcomes'); el(outcomes, 'legend', '', this.tr('与当时预期相比', 'Compared with expectations'));
    const radios: HTMLInputElement[] = [];
    for (const value of ['met', 'partial', 'unmet', 'unclear'] as const) { const label = el(outcomes, 'label'); const radio = el(label, 'input'); radio.type = 'radio'; radio.name = 'outcome'; radio.value = value; radio.checked = prior?.outcome === value; label.append(this.modalEl.ownerDocument.createTextNode(outcomeLabel(value))); radios.push(radio); }
    const reflection = field(this.body, this.tr('回头看，哪里需要调整（选填）', 'What needs adjusting in hindsight (optional)'), prior?.reflection, { multiline: true });
    const lesson = field(this.body, this.tr('下次遇到类似情况，我会（选填）', 'Next time, I will (optional)'), prior?.lesson, { multiline: true });
    const optional = el(this.body, 'details', 'dr-optional'); el(optional, 'summary', '', this.tr('关联本次证据', 'Link evidence for this review')); const refs = new ReferenceSelection(optional, this.app, prior?.references ?? []); this.dispose(() => refs.dispose());
    const explanation = prior ? field(this.body, this.tr('更正原因', 'Reason for correction'), '', { required: true, multiline: true }) : undefined;
    let followup: HTMLSelectElement | undefined, nextDate: HTMLInputElement | HTMLTextAreaElement | undefined;
    if (!prior) {
      followup = select(this.body, this.tr('接下来', 'Follow-up'), { scheduled: this.tr('继续观察，安排下次回访', 'Continue observing and schedule a review'), unscheduled: this.tr('继续观察，暂不安排日期', 'Continue observing without a date'), closed: this.tr('结束回访', 'Close follow-up') }, 'scheduled');
      nextDate = field(this.body, this.tr('下次回访', 'Next review'), addDays(localDate(), this.days), { type: 'date', required: true });
      followup.addEventListener('change', () => { nextDate!.parentElement!.hidden = followup!.value !== 'scheduled'; nextDate!.disabled = followup!.value !== 'scheduled'; this.actionButton.textContent = followup!.value === 'closed' ? this.tr('保存并结束回访', 'Save and close follow-up') : this.tr('保存回访', 'Save review'); });
    } else el(this.body, 'p', 'dr-muted', this.tr('更正保留原版本，不改变当前回访安排；已有经验笔记不会自动改写。', 'The original is preserved and the current schedule stays unchanged. Existing lesson notes are not rewritten.'));
    this.submit(prior ? this.tr('保存更正', 'Save correction') : this.tr('保存回访', 'Save review'), async () => {
      const outcome = radios.find(radio => radio.checked)?.value as Outcome | undefined;
      if (!outcome) throw new DecisionError(this.tr('请选择与当时预期相比的结果。', 'Choose how the result compares with expectations.'));
      const patch = { reviewDate: reviewDate.value, actual: actual.value.trim(), outcome, reflection: reflection.value.trim(), lesson: lesson.value.trim(), references: clone(refs.items) };
      await this.store!.update(this.entry!, decision => prior ? correctReview(decision, prior.id, patch, explanation!.value) : addReview(decision, { ...patch, recordRevisionId: version.id, followup: followup!.value as Review['followup'], nextReviewDate: followup!.value === 'scheduled' ? nextDate!.value || null : null })); this.after(d.id);
    }, () => refs.items); this.focusInput(actual);
  }
}
export class ScheduleModal extends SaveModal {
  constructor(app: App, store: DecisionStore, entry: Entry, private days: number, private after: (id: string) => void, private reopen = false) { super(app, store, entry); }
  onOpen(): void {
    this.setup(this.reopen ? this.tr('重新开启回访', 'Reopen follow-up') : this.tr('调整回访日期', 'Adjust review date'), this.tr('只修改安排，已有记录都会保留。', 'Only the schedule changes. Existing records are preserved.'));
    const nextDate = field(this.body, this.tr('下次回访（选填）', 'Next review (optional)'), scheduleOf(this.entry!.decision).nextReviewDate ?? addDays(localDate(), this.days), { type: 'date', hint: this.tr('清空日期后暂不提醒。', 'Clear the date to leave it unscheduled.') });
    this.submit(this.tr('保存安排', 'Save schedule'), async () => { if (nextDate.value && !validDate(nextDate.value)) throw new DecisionError(this.tr('日期无效。', 'Invalid date.')); await this.store!.update(this.entry!, d => arrange(d, nextDate.value || null)); this.after(this.entry!.decision.id); }); nextDate.focus();
  }
}
export class SupplementModal extends SaveModal {
  constructor(app: App, store: DecisionStore, entry: Entry, private after: (id: string) => void) { super(app, store, entry); }
  onOpen(): void {
    this.setup(this.tr('补充想法', 'Add a note'), this.tr('追加今天的想法，当时的记录继续保留。', 'Add your thoughts today while preserving the original record.'));
    const text = field(this.body, this.tr('今天想补充什么', 'What would you like to add'), '', { multiline: true, required: true });
    const refs = new ReferenceSelection(this.body, this.app, []); this.dispose(() => refs.dispose());
    this.submit(this.tr('保存补充', 'Save note'), async () => { await this.store!.update(this.entry!, d => supplement(d, text.value, refs.items)); this.after(this.entry!.decision.id); }, () => refs.items); text.focus();
  }
}
export class LessonModal extends SaveModal {
  constructor(app: App, store: DecisionStore, entry: Entry, private review: Review, private after: (path: string, id: string) => void, private copy = false) { super(app, store, entry); }
  onOpen(): void {
    this.setup(this.tr('保存为经验笔记', 'Save as lesson note'), this.tr('留下具体做法，并保留来源决定。', 'Keep a practical next step with its source decision.'));
    const title = field(this.body, this.tr('经验笔记标题', 'Lesson note title'), this.review.lesson?.slice(0, 80) ?? '', { required: true });
    const content = field(this.body, this.tr('下次可以怎么做', 'What to do next time'), this.review.lesson ?? '', { multiline: true, required: true });
    this.submit(this.tr('保存经验笔记', 'Save lesson note'), async () => { const path = await this.store!.saveLesson(this.entry!, this.review.id, title.value, content.value, this.copy); this.after(path, this.entry!.decision.id); }); title.focus();
  }
}
