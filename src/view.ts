import { ItemView, Menu, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { compareDecisions, compareEvents, dayDifference, effectiveReview, isDue, localDate, recordVersions, Reference, reviewsNewest, Review, scheduleOf, searchText } from './domain';
import { outcomeLabel } from './codec';
import { DecisionStore, Entry, LessonEntry } from './store';
import { button, dateLabel, el } from './ui';
import { t } from './i18n';
export const VIEW_TYPE = 'decision-review-view';
export interface ViewHost {
  store: DecisionStore;
  create(demo: boolean): void;
  review(entry: Entry, revisionId: string, reviewId?: string): void;
  correct(entry: Entry): void;
  schedule(entry: Entry, reopen?: boolean): void;
  supplement(entry: Entry): void;
  lesson(entry: Entry, review: Review, copy?: boolean): void;
  closeDecision(entry: Entry): Promise<void>;
  remove(entry: Entry): Promise<void>;
  loadDemo(): Promise<void>;
  openFile(path: string): Promise<void>;
  openRef(ref: Reference): Promise<void>;
  exists(path: string): boolean;
}
type Mode = 'due' | 'all' | 'lessons';
interface Position { scroll: number; expanded: string[]; revision: string }
export class DecisionView extends ItemView {
  private mode: Mode = 'due'; private query = ''; private filter = 'all'; private demo = false;
  private selected = ''; private kept = false; private revision = ''; private rendered = '';
  private root!: HTMLElement; private layout!: HTMLElement; private sidebar!: HTMLElement; private list!: HTMLElement; private detail!: HTMLElement;
  private errors!: HTMLElement; private search!: HTMLInputElement; private statusFilter!: HTMLSelectElement; private demoBanner!: HTMLElement;
  private nav = new Map<Mode, HTMLButtonElement>(); private positions = new Map<string, Position>(); private pendingPosition = false;
  private unsubscribe?: () => void;
  constructor(leaf: WorkspaceLeaf, private host: ViewHost) { super(leaf); this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.restorePosition())); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return t('决策复盘', 'Decision Review'); }
  getIcon(): string { return 'book-check'; }
  getState(): Record<string, unknown> { this.restorePosition(); this.capturePosition(); return { mode: this.mode, query: this.query, filter: this.filter, demo: this.demo, selected: this.selected, kept: this.kept, revision: this.revision, positions: Object.fromEntries([...this.positions].slice(-100)) }; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved = state && typeof state === 'object' ? state as Record<string, unknown> : {};
    this.mode = saved.mode === 'all' || saved.mode === 'lessons' ? saved.mode : 'due'; this.query = typeof saved.query === 'string' ? saved.query.slice(0, 10000) : '';
    this.filter = ['open', 'closed', 'unscheduled'].includes(String(saved.filter)) ? String(saved.filter) : 'all'; this.demo = saved.demo === true;
    this.selected = typeof saved.selected === 'string' ? saved.selected.slice(0, 100) : ''; this.kept = saved.kept === true; this.revision = typeof saved.revision === 'string' ? saved.revision.slice(0, 100) : '';
    if (saved.positions && typeof saved.positions === 'object') for (const [id, raw] of Object.entries(saved.positions).slice(-100)) { if (!raw || typeof raw !== 'object') continue; const p = raw as Partial<Position>; this.positions.set(id, { scroll: typeof p.scroll === 'number' && Number.isFinite(p.scroll) ? Math.max(0, p.scroll) : 0, expanded: Array.isArray(p.expanded) ? p.expanded.filter((value): value is string => typeof value === 'string').slice(0, 1000) : [], revision: typeof p.revision === 'string' ? p.revision : '' }); }
    this.rendered = ''; if (this.search) this.search.value = this.query; if (this.statusFilter) this.statusFilter.value = this.filter; this.render(); await super.setState(state, result);
  }
  private visible(): boolean { return !!this.root?.getClientRects().length && this.detail.clientHeight > 0; }
  private capturePosition(): void { if (!this.rendered || this.pendingPosition || !this.visible()) return; this.positions.set(this.rendered, { scroll: this.detail.scrollTop, expanded: Array.from(this.detail.querySelectorAll<HTMLDetailsElement>('details.dr-history-item[open]'), item => item.dataset.id!), revision: this.revision }); }
  private restorePosition(): void { if (!this.pendingPosition || !this.visible()) return; this.detail.scrollTop = this.positions.get(this.rendered)?.scroll ?? 0; this.pendingPosition = false; }
  onResize(): void { this.restorePosition(); }
  private remember(): void { this.capturePosition(); this.app.workspace.requestSaveLayout(); }
  async onOpen(): Promise<void> {
    this.capturePosition(); this.unsubscribe?.(); this.contentEl.replaceChildren(); this.contentEl.classList.add('dr-view'); this.root = el(this.contentEl, 'div', 'dr-root');
    const header = el(this.root, 'header', 'dr-header'); const heading = el(header, 'div'); el(heading, 'h1', '', t('决策复盘', 'Decision Review')); el(heading, 'p', 'dr-muted', t('记下当时的理由，回来看看结果。', 'Capture your reasons. Come back to the results.'));
    const actions = el(header, 'div', 'dr-actions'); button(actions, t('重新读取', 'Reload'), () => this.host.store.load(), 'dr-quiet', 'refresh-cw'); button(actions, t('记录决定', 'Record decision'), () => this.host.create(this.demo), 'mod-cta', 'plus');
    this.demoBanner = el(this.root, 'div', 'dr-demo-banner'); this.errors = el(this.root, 'div', 'dr-issues');
    const nav = el(this.root, 'nav', 'dr-nav'); nav.setAttribute('aria-label', t('决策复盘导航', 'Decision Review navigation')); this.nav.clear();
    for (const mode of ['due', 'all', 'lessons'] as const) this.nav.set(mode, button(nav, '', () => this.navigate(mode), 'dr-tab'));
    const demo = button(nav, '', () => { this.demo = !this.demo; this.selected = ''; this.kept = false; this.query = ''; this.search.value = ''; this.render(); this.remember(); }, 'dr-quiet dr-demo-toggle'); demo.dataset.role = 'demo-toggle';
    this.layout = el(this.root, 'div', 'dr-layout'); this.sidebar = el(this.layout, 'aside', 'dr-sidebar'); this.sidebar.setAttribute('aria-label', t('决定列表', 'Decision list'));
    const bar = el(this.sidebar, 'div', 'dr-sidebar-heading'); el(bar, 'h2', 'dr-list-title'); button(bar, t('关闭列表', 'Close list'), () => { this.layout.classList.remove('show-list'); this.detail.querySelector<HTMLButtonElement>('.dr-switch')?.focus(); }, 'dr-close-list dr-quiet', 'x');
    this.search = el(this.sidebar, 'input', 'dr-search'); this.search.type = 'search'; this.search.value = this.query; this.search.setAttribute('aria-label', t('搜索决定与回访', 'Search decisions and reviews')); this.search.placeholder = t('搜索决定与回访…', 'Search decisions and reviews…');
    this.search.addEventListener('input', () => { this.query = this.search.value; this.kept = false; this.render(); this.remember(); });
    this.statusFilter = el(this.sidebar, 'select', 'dr-filter'); this.statusFilter.setAttribute('aria-label', t('决定状态', 'Decision status'));
    for (const [value, label] of [['all', t('全部状态', 'All statuses')], ['open', t('观察中', 'Observing')], ['closed', t('已结束', 'Closed')], ['unscheduled', t('未安排回访', 'Unscheduled')]]) { const option = el(this.statusFilter, 'option', '', label); option.value = value!; }
    this.statusFilter.value = this.filter; this.statusFilter.addEventListener('change', () => { this.filter = this.statusFilter.value; this.kept = false; this.render(); this.remember(); });
    this.list = el(this.sidebar, 'div', 'dr-list'); el(this.sidebar, 'p', 'dr-sidebar-footer dr-muted', t('回访记录会一直保留', 'Review history is preserved'));
    this.detail = el(this.layout, 'main', 'dr-detail'); this.detail.tabIndex = -1;
    this.detail.addEventListener('scroll', () => this.remember(), { passive: true });
    this.unsubscribe = this.host.store.subscribe(() => this.render()); this.rendered = ''; this.pendingPosition = false; this.render();
  }
  async onClose(): Promise<void> { this.capturePosition(); this.unsubscribe?.(); this.contentEl.classList.remove('dr-view'); }
  relocalize(): void { void this.onOpen(); }
  select(id: string, demo?: boolean): void { this.capturePosition(); this.selected = id; this.demo = demo ?? this.host.store.entries.find(entry => entry.decision.id === id)?.decision.demo ?? false; this.mode = 'all'; this.kept = false; this.query = ''; this.filter = 'all'; this.revision = ''; if (this.search) this.search.value = ''; if (this.statusFilter) this.statusFilter.value = 'all'; this.layout?.classList.remove('show-list'); this.render(); this.remember(); }
  keep(id: string): void { this.selected = id; this.kept = true; this.render(); this.remember(); }
  show(mode: Mode): void { this.navigate(mode); }
  showDemo(): void { this.demo = true; this.selected = ''; this.navigate('due'); }
  private navigate(mode: Mode): void { this.capturePosition(); this.mode = mode; this.kept = false; this.query = ''; this.filter = 'all'; if (this.search) this.search.value = ''; if (this.statusFilter) this.statusFilter.value = 'all'; this.layout?.classList.remove('show-list'); this.render(); this.remember(); }
  private scoped(): Entry[] { return this.host.store.entries.filter(entry => entry.decision.demo === this.demo); }
  private lessons(): LessonEntry[] { return this.host.store.lessons.filter(lesson => lesson.meta.demo === this.demo); }
  private filtered(): Entry[] {
    const query = this.query.trim().toLocaleLowerCase();
    return this.scoped().filter(entry => {
      const d = entry.decision, s = scheduleOf(d); if (this.mode === 'due' && !isDue(d)) return false;
      if (this.mode === 'all' && (this.filter === 'open' && s.status !== 'open' || this.filter === 'closed' && s.status !== 'closed' || this.filter === 'unscheduled' && (s.status !== 'open' || s.nextReviewDate !== null))) return false;
      return !query || searchText(d).includes(query) || this.lessons().some(lesson => lesson.meta.decisionId === d.id && `${lesson.meta.title}\n${lesson.content}`.toLocaleLowerCase().includes(query));
    }).sort((a, b) => compareDecisions(a.decision, b.decision));
  }
  render(): void {
    if (!this.root) return;
    const focus = this.detail.contains(this.detail.ownerDocument.activeElement) ? (this.detail.ownerDocument.activeElement as HTMLElement).dataset.drFocus : undefined;
    this.capturePosition(); const last = this.rendered; this.rendered = ''; this.pendingPosition = false;
    const items = this.filtered(); let selected = this.scoped().find(entry => entry.decision.id === this.selected);
    if (!selected || (!items.includes(selected) && !this.kept)) { selected = items[0]; this.selected = selected?.decision.id ?? ''; }
    if (this.selected !== last) this.revision = this.positions.get(this.selected)?.revision ?? '';
    const titles: Record<Mode, string> = { due: t('待回访', 'Due reviews'), all: t('全部决定', 'All decisions'), lessons: t('经验笔记', 'Lesson notes') };
    const counts = { due: this.scoped().filter(entry => isDue(entry.decision)).length, all: this.scoped().length, lessons: this.lessons().length };
    for (const [mode, node] of this.nav) { node.replaceChildren(); el(node, 'span', '', titles[mode]); el(node, 'span', 'dr-count', String(counts[mode])); node.classList.toggle('active', this.mode === mode); if (this.mode === mode) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); }
    this.statusFilter.hidden = this.mode !== 'all'; this.sidebar.querySelector('.dr-list-title')!.textContent = titles[this.mode];
    this.search.placeholder = this.mode === 'lessons' ? t('搜索经验笔记…', 'Search lesson notes…') : t('搜索决定与回访…', 'Search decisions and reviews…');
    this.demoBanner.replaceChildren(); this.demoBanner.hidden = !this.demo;
    if (this.demo) { el(this.demoBanner, 'span', '', t('正在查看演示，和真实记录分开保存。', 'Viewing demo data, stored separately from real decisions.')); button(this.demoBanner, t('返回真实记录', 'Back to real decisions'), () => { this.demo = false; this.navigate('due'); }, 'dr-quiet'); }
    const demoToggle = this.root.querySelector<HTMLButtonElement>('[data-role="demo-toggle"]')!; demoToggle.textContent = this.demo ? t('真实记录', 'Real decisions') : t('演示', 'Demo'); demoToggle.hidden = !this.host.store.entries.some(entry => entry.decision.demo);
    this.errors.replaceChildren();
    for (const issue of this.host.store.issues) { const row = el(this.errors, 'div', 'dr-error'); row.setAttribute('role', 'alert'); el(row, 'span', '', `${issue.path}: ${issue.message}`); if (this.host.exists(issue.path)) button(row, t('打开源文件', 'Open source file'), () => this.host.openFile(issue.path), 'dr-quiet'); }
    this.list.replaceChildren(); this.detail.replaceChildren();
    if (!this.host.store.ready) { el(this.detail, 'p', 'dr-muted', t('正在读取记录…', 'Loading records…')); return; }
    if (this.mode === 'lessons') { el(this.list, 'p', 'dr-muted', t('把回访里的下次做法，留给未来的自己。', 'Keep practical lessons for your future self.')); this.renderLessons(); }
    else {
      this.renderList(items); if (selected) this.renderDecision(selected); else this.renderEmpty();
    }
    this.rendered = this.mode === 'lessons' ? 'lessons' : this.selected;
    for (const details of this.detail.querySelectorAll<HTMLDetailsElement>('details.dr-history-item')) { details.open = this.positions.get(this.rendered)?.expanded.includes(details.dataset.id!) ?? false; details.addEventListener('toggle', () => this.remember()); }
    this.pendingPosition = true; this.restorePosition();
    if (focus) Array.from(this.detail.querySelectorAll<HTMLElement>('[data-dr-focus]')).find(node => node.dataset.drFocus === focus)?.focus({ preventScroll: true });
  }
  private switchButton(): void { button(this.detail, this.mode === 'lessons' ? t('搜索经验', 'Search lessons') : t('切换决定', 'Switch decision'), () => { this.layout.classList.add('show-list'); this.search.focus(); }, 'dr-switch dr-quiet', 'panel-left'); }
  private renderList(items: Entry[]): void {
    let last = '';
    for (const entry of items) {
      const d = entry.decision, s = scheduleOf(d); const group = s.status === 'closed' ? t('已结束', 'Closed') : !s.nextReviewDate ? t('未安排', 'Unscheduled') : s.nextReviewDate < localDate() ? t('已逾期', 'Overdue') : s.nextReviewDate === localDate() ? t('今天', 'Today') : t('接下来', 'Upcoming');
      if (group !== last) { el(this.list, 'div', 'dr-group-label', group); last = group; }
      const item = button(this.list, '', () => { this.capturePosition(); this.selected = d.id; this.kept = false; this.revision = ''; this.layout.classList.remove('show-list'); this.render(); this.detail.focus({ preventScroll: true }); this.remember(); }, 'dr-decision-item'); item.replaceChildren();
      item.classList.toggle('selected', d.id === this.selected); item.setAttribute('aria-pressed', String(d.id === this.selected));
      el(item, 'h3', '', d.original.record.title); el(item, 'p', 'dr-item-expectation', d.original.record.expected);
      const meta = el(item, 'div', 'dr-item-meta'); el(meta, 'span', isDue(d) && s.nextReviewDate! < localDate() ? 'dr-overdue' : '', this.statusText(entry)); el(meta, 'span', '', t('{0} 次回访', '{0} reviews', d.reviews.length));
    }
    if (!items.length) el(this.list, 'p', 'dr-muted', t('当前列表没有决定。', 'No decisions in this list.'));
  }
  private statusText(entry: Entry): string { const s = scheduleOf(entry.decision); return s.status === 'closed' ? t('已结束', 'Closed') : !s.nextReviewDate ? t('未安排回访', 'Unscheduled') : s.nextReviewDate < localDate() ? t('逾期 {0} 天', '{0} days overdue', dayDifference(localDate(), s.nextReviewDate)) : s.nextReviewDate === localDate() ? t('今天回访', 'Review today') : t('{0}回访', 'Review {0}', dateLabel(s.nextReviewDate, false)); }
  private text(parent: HTMLElement, label: string, value?: string, className = ''): void { if (!value) return; const block = el(parent, 'div', `dr-record-field ${className}`); el(block, 'span', 'dr-field-caption', label); el(block, 'p', '', value); }
  private renderDecision(entry: Entry): void {
    const d = entry.decision, s = scheduleOf(d), versions = recordVersions(d); const version = versions.find(item => item.id === this.revision) ?? d.original; this.revision = version.id;
    this.switchButton();
    if (entry.blocked) { el(this.detail, 'p', 'dr-error', t('数据待修复，暂显示上次内容。此记录不能保存，请先修复源文件。', 'This record needs repair. Showing the last readable version; saving is disabled until the source is fixed.')); }
    if (this.kept && this.mode === 'due' && !isDue(d)) { const info = el(this.detail, 'div', 'dr-queue-updated'); el(info, 'span', '', t('已保存，这条决定已从待回访队列移出。', 'Saved. This decision has left the due queue.')); button(info, t('下一条待回访', 'Next due review'), () => { this.selected = ''; this.navigate('due'); }, 'dr-quiet'); }
    const toolbar = el(this.detail, 'div', 'dr-detail-toolbar'); el(toolbar, 'span', `dr-status ${isDue(d) ? 'dr-due-status' : ''}`, this.statusText(entry)); const actions = el(toolbar, 'div', 'dr-actions');
    const primary = s.status === 'closed' ? button(actions, t('重新开启', 'Reopen'), () => this.host.schedule(entry, true)) : button(actions, t('做一次回访', 'Review decision'), () => this.host.review(entry, version.id), 'mod-cta'); primary.dataset.drFocus = 'review'; primary.disabled = !!entry.blocked;
    if (s.status !== 'closed') button(actions, t('调整日期', 'Adjust date'), () => this.host.schedule(entry), 'dr-quiet').disabled = !!entry.blocked;
    const more = button(actions, t('更多', 'More'), () => { const menu = new Menu().setUseNativeMenu(false); menu.addItem(item => item.setTitle(t('打开源文件', 'Open source file')).setIcon('file-text').onClick(() => { void this.host.openFile(entry.path); })); if (!entry.blocked) { menu.addItem(item => item.setTitle(t('补充想法', 'Add a note')).onClick(() => this.host.supplement(entry))); menu.addItem(item => item.setTitle(t('更正原记录', 'Correct record')).onClick(() => this.host.correct(entry))); if (s.status !== 'closed') menu.addItem(item => item.setTitle(t('结束回访', 'Close follow-up')).onClick(() => { void this.host.closeDecision(entry); })); menu.addSeparator(); menu.addItem(item => item.setTitle(t('移到回收站', 'Move to trash')).setIcon('trash').onClick(() => { void this.host.remove(entry); })); } const rect = more.getBoundingClientRect(); more.setAttribute('aria-expanded', 'true'); menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument); menu.onHide(() => { more.setAttribute('aria-expanded', 'false'); if (more.isConnected) more.focus({ preventScroll: true }); }); }, 'dr-quiet', 'ellipsis'); more.setAttribute('aria-label', t('更多决定操作', 'More decision actions')); more.dataset.drFocus = 'more'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    el(this.detail, 'h2', 'dr-detail-title', version.record.title); el(this.detail, 'p', 'dr-detail-meta', t('{0}决定；已回访 {1} 次', 'Decided {0}; {1} reviews', dateLabel(version.record.decisionDate), d.reviews.length));
    const compare = el(this.detail, 'div', 'dr-comparison'); const original = el(compare, 'section', 'dr-record-column'); const heading = el(original, 'div', 'dr-column-heading'); el(heading, 'h3', '', t('当时的判断', 'Reasoning at the time'));
    if (versions.length > 1) { const picker = el(original, 'select', 'dr-version-picker'); picker.setAttribute('aria-label', t('记录版本', 'Record version')); for (const item of versions) { const option = el(picker, 'option', '', item.id === d.original.id ? t('首次记录', 'Original record') : t('更正：{0}', 'Correction: {0}', dateLabel(item.createdAt))); option.value = item.id; } picker.value = version.id; picker.addEventListener('change', () => { this.revision = picker.value; this.positions.set(d.id, { ...(this.positions.get(d.id) ?? { scroll: 0, expanded: [] }), revision: picker.value }); this.render(); this.remember(); }); if (version.id !== d.original.id) { this.text(original, t('更正原因', 'Correction reason'), version.explanation); const previous = versions[versions.indexOf(version) - 1] ?? d.original; const fields = { title: t('决定', 'Decision'), reason: t('理由', 'Reason'), expected: t('预期', 'Expectations'), decisionDate: t('日期', 'Date'), alternatives: t('其他选项', 'Other options'), assumption: t('假设', 'Assumption'), references: t('资料', 'References') }; const changed = Object.entries(fields).filter(([key]) => JSON.stringify(previous.record[key as keyof typeof previous.record]) !== JSON.stringify(version.record[key as keyof typeof version.record])).map(([, label]) => label); el(original, 'p', 'dr-muted dr-revision-note', t('变更：{0}', 'Changed: {0}', changed.join(', '))); } }
    this.text(original, t('主要理由', 'Main reason'), version.record.reason); this.text(original, t('期待看到什么', 'Expected outcome'), version.record.expected, 'dr-expectation'); this.text(original, t('当时最担心的假设', 'Assumption to watch'), version.record.assumption);
    if (version.record.alternatives) { const other = el(original, 'details', 'dr-other-options'); el(other, 'summary', '', t('考虑过的其他选项', 'Other options considered')); el(other, 'p', '', version.record.alternatives); }
    this.references(original, version.record.references);
    const latest = el(compare, 'section', 'dr-record-column dr-latest'); const review = reviewsNewest(d)[0]; const latestHeading = el(latest, 'div', 'dr-column-heading'); el(latestHeading, 'h3', '', t('最近一次回访', 'Latest review')); if (review) el(latestHeading, 'span', 'dr-muted', dateLabel(review.reviewDate, false));
    if (review) {
      if (review.recordRevisionId !== version.id) button(latest, t('查看本次回访参照的记录版本', 'Show the record version used for this review'), () => { this.revision = review.recordRevisionId; this.render(); }, 'dr-quiet dr-version-link');
      this.text(latest, t('实际发生了什么', 'What happened'), review.actual); el(latest, 'span', `dr-outcome dr-outcome-${review.outcome}`, outcomeLabel(review.outcome)); this.text(latest, t('回头看，哪里需要调整', 'What needs adjusting'), review.reflection); this.text(latest, t('下次遇到类似情况，我会', 'Next time, I will'), review.lesson);
      this.lessonButton(latest, entry, review); this.references(latest, review.references);
    } else { const empty = el(latest, 'div', 'dr-no-review'); el(empty, 'h3', '', t('结果出来后，再回来看看', 'Come back when you see the results')); el(empty, 'p', 'dr-muted', t('对照当时的预期，记下实际发生的事。阶段性结果也可以。', 'Compare what happened with your expectations. Interim results are welcome.')); if (!entry.blocked) button(empty, t('开始第一次回访', 'Start the first review'), () => this.host.review(entry, version.id)); }
    this.renderHistory(entry);
  }
  private references(parent: HTMLElement, refs: Reference[]): void {
    if (!refs.length) return; const list = el(parent, 'div', 'dr-references');
    for (const ref of refs) { const exists = ref.kind === 'url' || this.host.exists(ref.path); const label = ref.label || (ref.kind === 'file' ? ref.path.split('/').pop()! : ref.url); const node = button(list, exists ? label : t('{0}（链接失效）', '{0} (missing)', label), () => this.host.openRef(ref), `dr-reference ${exists ? '' : 'dr-missing'}`, ref.kind === 'file' ? 'file-text' : 'link'); node.title = ref.kind === 'file' ? ref.path : ref.url; }
  }
  private lessonButton(parent: HTMLElement, entry: Entry, review: Review): void {
    const lesson = this.host.store.findLesson(entry.decision.id, review.id, entry.decision.demo); const declared = entry.decision.lessonLinks.some(link => link.reviewId === review.id);
    if (lesson) { button(parent, t('打开经验笔记', 'Open lesson note'), () => this.host.openFile(lesson.path), 'dr-quiet dr-lesson-link', 'file-text'); const original = entry.decision.reviews.find(item => item.id === review.id)!; if (lesson.meta.reviewVersionId !== effectiveReview(entry.decision, original).versionId) el(parent, 'p', 'dr-muted', t('此回访已更正；经验保留保存时的内容，可打开笔记自行修订。', 'This review was corrected. The lesson keeps its saved content; open it to make changes.')); }
    else if (declared) { el(parent, 'p', 'dr-muted', t('原经验笔记已失效。', 'The original lesson note is missing.')); if (!entry.blocked) button(parent, t('另存一份经验', 'Save a new lesson copy'), () => this.host.lesson(entry, review, true), 'dr-quiet'); }
    else if (review.lesson && !entry.blocked) button(parent, t('保存为经验笔记', 'Save as lesson note'), () => this.host.lesson(entry, review), 'dr-quiet dr-lesson-link', 'file-plus');
  }
  private renderHistory(entry: Entry): void {
    const d = entry.decision; const section = el(this.detail, 'section', 'dr-history'); el(section, 'h3', '', t('回访与补充', 'Reviews and notes'));
    const events = [...reviewsNewest(d).map(review => ({ id: review.id, date: review.reviewDate, at: review.createdAt, review })), ...d.supplements.map(note => ({ id: note.id, date: localDate(new Date(note.createdAt)), at: note.createdAt, note })), ...d.schedules.slice(1).map(schedule => ({ id: schedule.id, date: localDate(new Date(schedule.createdAt)), at: schedule.createdAt, schedule }))].sort((a, b) => b.date.localeCompare(a.date) || Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
    for (const event of events) {
      const details = el(section, 'details', 'dr-history-item'); details.dataset.id = event.id; const summary = el(details, 'summary'); el(summary, 'span', 'dr-history-date', dateLabel(event.date));
      if ('review' in event) { const review = event.review; el(summary, 'span', `dr-outcome dr-outcome-${review.outcome}`, outcomeLabel(review.outcome)); const body = el(details, 'div', 'dr-history-body'); this.text(body, t('实际发生了什么', 'What happened'), review.actual); this.text(body, t('回头看，哪里需要调整', 'What needs adjusting'), review.reflection); this.text(body, t('下次做法', 'Next time'), review.lesson); this.references(body, review.references);
        this.lessonButton(body, entry, review); if (!entry.blocked) button(body, t('更正回访', 'Correct review'), () => this.host.review(entry, review.recordRevisionId, review.id), 'dr-quiet');
        const corrections = d.reviewCorrections.filter(item => item.reviewId === review.id).sort(compareEvents);
        if (corrections.length) { const prior = el(body, 'details', 'dr-corrections'); el(prior, 'summary', '', t('查看更正历史（{0}）', 'Correction history ({0})', corrections.length)); const versions = [d.reviews.find(item => item.id === review.id)!, ...corrections.map(item => item.corrected)]; versions.forEach((version, index) => { const block = el(prior, 'div', 'dr-correction-version'); el(block, 'h4', '', index ? t('更正于 {0}', 'Corrected {0}', corrections[index - 1]!.createdAt) : t('最初回访', 'Original review')); if (index) this.text(block, t('更正原因', 'Reason for correction'), corrections[index - 1]!.explanation); this.text(block, outcomeLabel(version.outcome), version.actual); this.text(block, t('判断调整', 'Reflection'), version.reflection); this.text(block, t('下次做法', 'Next time'), version.lesson); this.references(block, version.references); }); }
      } else if ('note' in event) { el(summary, 'span', '', t('补充想法', 'Added note')); this.text(details, '', event.note.text); this.references(details, event.note.references); }
      else { el(summary, 'span', '', t('回访安排', 'Follow-up schedule')); el(details, 'p', '', event.schedule.status === 'closed' ? t('已结束回访。', 'Follow-up closed.') : event.schedule.nextReviewDate ? t('下次回访：{0}', 'Next review: {0}', dateLabel(event.schedule.nextReviewDate)) : t('继续观察，暂不安排日期。', 'Observing without a scheduled date.')); }
    }
    el(section, 'p', 'dr-created-note dr-muted', t('{0}记录决定，留下理由和预期。', 'Recorded reasons and expectations on {0}.', dateLabel(d.original.record.decisionDate)));
  }
  private renderEmpty(): void {
    this.switchButton(); const empty = el(this.detail, 'div', 'dr-empty');
    if (!this.scoped().length) { el(empty, 'h2', '', t('记下一个值得回头看的决定', 'Record a decision worth revisiting')); el(empty, 'p', 'dr-muted', t('现在留下理由与期待，结果出现后再回来。', 'Leave your reasons and expectations, then return when you see the results.')); button(empty, t('记录第一个决定', 'Record your first decision'), () => this.host.create(this.demo), 'mod-cta'); if (!this.demo) button(empty, t('载入演示', 'Load demo'), async () => { await this.host.loadDemo(); this.demo = true; this.navigate('due'); }, 'dr-quiet'); }
    else if (this.query || this.filter !== 'all') { el(empty, 'h2', '', t('没有符合条件的决定', 'No matching decisions')); button(empty, t('清空筛选', 'Clear filters'), () => { this.query = ''; this.search.value = ''; this.filter = 'all'; this.statusFilter.value = 'all'; this.render(); }, 'dr-quiet'); }
    else { el(empty, 'h2', '', t('今天没有待回访的决定', 'No reviews due today')); const next = this.scoped().map(entry => scheduleOf(entry.decision)).filter(s => s.status === 'open' && s.nextReviewDate && s.nextReviewDate > localDate()).sort((a, b) => a.nextReviewDate!.localeCompare(b.nextReviewDate!))[0]; if (next) el(empty, 'p', 'dr-muted', t('下次回访安排在 {0}。', 'The next review is scheduled for {0}.', dateLabel(next.nextReviewDate!))); button(empty, t('查看全部决定', 'View all decisions'), () => this.navigate('all')); }
  }
  private renderLessons(): void {
    this.switchButton(); el(this.detail, 'h2', 'dr-detail-title', t('留给下次的经验', 'Lessons for next time'));
    const keyword = this.query.trim().toLocaleLowerCase(); const lessons = this.lessons().filter(lesson => {
      const source = this.scoped().find(entry => entry.decision.id === lesson.meta.decisionId)?.decision;
      const titles = source ? [source.original.record.title, ...source.revisions.map(revision => revision.record.title)] : [];
      return [lesson.meta.title, lesson.content, ...titles].join('\n').toLocaleLowerCase().includes(keyword);
    });
    if (!lessons.length) { const empty = el(this.detail, 'div', 'dr-empty'); el(empty, 'h3', '', keyword ? t('没有匹配的经验笔记', 'No matching lesson notes') : t('回访之后，留下一点经验', 'Keep a lesson after your review')); el(empty, 'p', 'dr-muted', t('写下次遇到类似情况会怎么做，再保存为经验笔记。', 'Write what you would do next time, then save it as a lesson note.')); return; }
    for (const lesson of lessons) { const card = el(this.detail, 'article', 'dr-lesson-card'); el(card, 'h3', '', lesson.meta.title); el(card, 'p', '', lesson.content); const actions = el(card, 'div', 'dr-actions'); button(actions, t('打开经验笔记', 'Open lesson note'), () => this.host.openFile(lesson.path), 'dr-quiet', 'file-text'); const source = this.scoped().find(entry => entry.decision.id === lesson.meta.decisionId); if (source) button(actions, t('查看来源决定', 'View source decision'), () => this.select(source.decision.id), 'dr-quiet', 'link'); else el(actions, 'span', 'dr-muted', t('来源决定已移除', 'Source decision removed')); }
  }
}
