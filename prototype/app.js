'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const storageKey = 'fineuralab.decision-review.prototype.v1';
  const dateOverride = new URLSearchParams(location.search).get('today');
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride) ? dateOverride : localDate();
  const shiftDate = (value, days) => { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); };
  const ago = (days) => shiftDate(today, -days);
  const shortDate = (value) => value ? `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日` : '';
  const fullDate = (value) => `${value.slice(0, 4)}年${shortDate(value)}`;
  const elapsedDays = (value) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / 86400000);
  const escape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const uid = () => globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const icons = {
    brand: '<path d="M4 5h9a3 3 0 0 1 3 3v12H7a3 3 0 0 1-3-3z"/><path d="M16 8h4v12h-4M8 9h4M8 13h4M8 17h2"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h2M14 14h2"/>',
    file: '<path d="M14 3H6v18h12V7zM14 3v5h4M9 12h6M9 16h6"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    book: '<path d="M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3zM21 4h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h5z"/>',
    link: '<path d="m10 13 4-4M8 15l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0M16 9l1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
  const outcomeNames = { met: '达到预期', partial: '部分达到', unmet: '未达到', unclear: '暂时无法判断' };
  const outcomePill = (value) => `<span class="outcome ${escape(value)}">${value === 'met' ? icon('check') : icon('clock')}${outcomeNames[value]}</span>`;
  const makeSeed = () => ({
    version: 1,
    decisions: [
      { id: 'plugin', title: '新插件先做完整流程，再加高级功能', decisionDate: ago(42), reason: '先让记录、回访和保存经验这条流程真正用起来，再决定高级功能的优先级。', expected: '一个月内完成可用版本，让 3 位试用者走通一次回访，并愿意继续使用。', assumption: '只要流程够轻，用户就愿意在结果出现前留下预期。', alternatives: '同时做方案比较、AI 提问与统计面板。', references: ['新插件 / 首版需求', '试用反馈汇总'], status: 'open', nextReviewDate: ago(2), supplements: [], reviews: [
        { id: 'plugin-review', reviewDate: ago(14), actual: '3 位试用者都走通了首次记录与回访，其中 1 位主动做了第二次回访。基础流程清楚，但新建表单还是偏长。', outcome: 'partial', reflection: '完成一次流程还不能说明愿意持续用。需要观察他们是否会主动记录第二个决定。', lesson: '小工具先观察用户会不会再用一次，再增加功能。', followup: 'scheduled', nextReviewDate: ago(2) }
      ] },
      { id: 'course', title: '先做一个小项目，再购买进阶课程', decisionDate: ago(23), reason: '先确认自己缺的是哪部分能力，避免为了缓解焦虑而继续囤课。', expected: '三周内做完一个最小作品，列出三个具体卡点，再判断课程是否能解决。', assumption: '目前掌握的基础足够完成第一个小作品。', references: ['学习计划 / Python 小项目'], status: 'open', nextReviewDate: today, supplements: [], reviews: [] },
      { id: 'writing', title: '文章固定每周发布一篇，先坚持四周', decisionDate: ago(28), reason: '把发布节奏固定下来，检验选题和写作流程是否能持续。', expected: '四周发布四篇完整文章，每篇的准备和修改控制在两个晚上。', references: ['写作 / 四周选题'], status: 'open', nextReviewDate: today, supplements: [], reviews: [] },
      { id: 'reading', title: '技术书先读项目需要的章节', decisionDate: ago(10), reason: '当前项目需要尽快验证一个具体问题，按问题阅读更容易用到。', expected: '两周内把读到的方法用于项目，并写一篇实践记录。', references: ['读书 / 系统设计'], status: 'open', nextReviewDate: shiftDate(today, 4), supplements: [], reviews: [] },
      { id: 'tool', title: '设计工具继续用现有方案', decisionDate: ago(12), reason: '现有工具能完成这次交付，切换工具需要额外学习。', expected: '保持目前交付速度，同时记录真正影响工作的限制。', references: [], status: 'open', nextReviewDate: null, supplements: [], reviews: [] },
      { id: 'subscription', title: '暂停暂时用不到的软件订阅', decisionDate: ago(50), reason: '最近两个月使用次数少，先暂停一个周期，看看是否真的影响工作。', expected: '一个月内没有关键工作受阻；如果有不可替代需求，再恢复订阅。', references: ['工具使用记录'], status: 'closed', nextReviewDate: null, supplements: [], reviews: [
        { id: 'subscription-review', reviewDate: ago(19), actual: '一个月没有关键工作受阻。唯一一次需要时，使用已有工具完成了。', outcome: 'met', reflection: '购买时把偶尔需要想成了每天需要。', lesson: '续费前看最近的实际使用记录，再决定下个月是否需要。', followup: 'closed', nextReviewDate: null }
      ] }
    ],
    lessons: [
      { id: 'lesson-plugin', decisionId: 'plugin', reviewId: 'plugin-review', title: '先观察用户会不会再用一次', content: '小工具先观察用户会不会再用一次，再增加功能。', createdDate: ago(14) },
      { id: 'lesson-subscription', decisionId: 'subscription', reviewId: 'subscription-review', title: '续费前看实际使用记录', content: '续费前看最近的实际使用记录，再决定下个月是否需要。', createdDate: ago(19) }
    ]
  });
  let data = makeSeed();
  try {
    const cached = localStorage.getItem(storageKey);
    if (cached) {
      const saved = JSON.parse(cached);
      if (saved.version === 1 && Array.isArray(saved.decisions) && Array.isArray(saved.lessons)) data = saved;
    }
  } catch { storageNotice('浏览器本地存储不可用，本次操作只在当前页面保留。'); }
  const state = { view: 'due', selected: 'plugin', query: '', filter: 'all', empty: false, emptyData: { version: 1, decisions: [], lessons: [] }, kept: false };
  const currentData = () => state.empty ? state.emptyData : data;
  const decisions = () => currentData().decisions;
  const lessons = () => currentData().lessons;
  const isDue = (item) => item.status === 'open' && item.nextReviewDate && item.nextReviewDate <= today;
  const dueItems = () => decisions().filter(isDue);
  const chosen = () => decisions().find((item) => item.id === state.selected);
  const latestReview = (item) => [...item.reviews].reverse().sort((a, b) => b.reviewDate.localeCompare(a.reviewDate))[0];
  const statusInfo = (item) => {
    if (item.status === 'closed') return { text: '已结束', tone: 'closed' };
    if (!item.nextReviewDate) return { text: '未安排回访', tone: '' };
    if (item.nextReviewDate < today) return { text: `逾期 ${elapsedDays(item.nextReviewDate)} 天`, tone: 'overdue' };
    if (item.nextReviewDate === today) return { text: '今天回访', tone: 'today' };
    return { text: `${shortDate(item.nextReviewDate)}回访`, tone: '' };
  };
  function storageNotice(message) { const notice = $('#storage-notice'); notice.textContent = message; notice.hidden = false; }
  function persist() {
    if (state.empty) return;
    try { localStorage.setItem(storageKey, JSON.stringify(data)); }
    catch { storageNotice('浏览器未能保存示例。当前页面可继续使用，刷新后可能丢失本次修改。'); }
  }
  let toastTimer;
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3600); }
  function switchView(view) { state.view = view; state.query = ''; state.filter = 'all'; state.kept = false; $('#search').value = ''; $('#status-filter').value = 'all'; $('#workspace').classList.remove('show-list'); render(); }
  function sortedItems() {
    let items = [...decisions()];
    if (state.view === 'due') items = items.filter(isDue);
    if (state.filter === 'open') items = items.filter((item) => item.status === 'open');
    if (state.filter === 'closed') items = items.filter((item) => item.status === 'closed');
    if (state.filter === 'unscheduled') items = items.filter((item) => item.status === 'open' && !item.nextReviewDate);
    const query = state.query.trim().toLocaleLowerCase();
    if (query) items = items.filter((item) => JSON.stringify(item).toLocaleLowerCase().includes(query));
    return items.sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || (a.nextReviewDate || '9999').localeCompare(b.nextReviewDate || '9999') || a.decisionDate.localeCompare(b.decisionDate));
  }
  const itemGroup = (item) => item.status === 'closed' ? '已结束' : !item.nextReviewDate ? '未安排' : item.nextReviewDate < today ? '已逾期' : item.nextReviewDate === today ? '今天' : '接下来';
  function renderList(items) {
    if (state.view === 'lessons') {
      $('#decision-list').innerHTML = '<p class="list-empty">把回访里的下次做法，留给未来的自己。</p>';
      return;
    }
    if (!items.length) {
      $('#decision-list').innerHTML = `<div class="list-empty">${state.query || state.filter !== 'all' ? '没有符合条件的决定。<br><button type="button" class="text-link" data-action="clear-search">清空筛选</button>' : '当前列表没有决定。'}</div>`;
      return;
    }
    let lastGroup = '';
    $('#decision-list').innerHTML = items.map((item) => {
      const group = itemGroup(item);
      let groupHtml = '';
      if (group !== lastGroup) { lastGroup = group; groupHtml = `<div class="group-label ${group === '已逾期' ? 'overdue' : ''}">${group}<span>${items.filter((entry) => itemGroup(entry) === group).length}</span></div>`; }
      const status = statusInfo(item);
      return `${groupHtml}<button type="button" class="decision-item ${state.selected === item.id ? 'selected' : ''}" data-action="select" data-id="${escape(item.id)}" aria-pressed="${state.selected === item.id}"><h3>${escape(item.title)}</h3><p class="item-description">${escape(item.expected)}</p><div class="item-meta"><span class="${status.tone}">${status.text}</span><span>${item.reviews.length ? `${item.reviews.length} 次回访` : '尚未回访'}</span></div></button>`;
    }).join('');
  }
  const field = (label, text, extra = '') => text ? `<div class="record-field ${extra}"><span class="field-label">${label}</span><p>${escape(text)}</p></div>` : '';
  function renderDetails(item) {
    const review = latestReview(item);
    const status = statusInfo(item);
    const lesson = review && lessons().find((entry) => entry.decisionId === item.id && entry.reviewId === review.id);
    const menu = `<details class="menu"><summary class="icon-button" aria-label="更多操作">⋯</summary><div class="menu-items"><button type="button" data-action="supplement">补充想法</button><button type="button" data-action="source">查看原始笔记</button><button type="button" data-action="${item.status === 'closed' ? 'reopen' : 'close-decision'}">${item.status === 'closed' ? '重新开启回访' : '结束回访'}</button></div></details>`;
    $('#detail-pane').innerHTML = `
      <button type="button" class="button subtle mobile-switch" data-action="show-list">${icon('book')} 切换决定</button>
      ${state.kept && !isDue(item) && state.view === 'due' ? `<div class="queue-updated"><span>已保存，这条决定已从待回访队列移出。</span><button type="button" class="text-link" data-action="next-due">${dueItems().length ? '下一条待回访' : '查看队列'}</button></div>` : ''}
      <div class="detail-toolbar"><span class="status ${status.tone}">${icon(item.status === 'closed' ? 'check' : 'clock')}${status.text}</span><div class="detail-actions">${item.status === 'closed' ? '<button type="button" class="button" data-action="reopen">重新开启</button>' : '<button type="button" class="button primary" data-action="review">做一次回访</button><button type="button" class="button subtle" data-action="schedule">调整日期</button>'}${menu}</div></div>
      <h2 class="detail-title">${escape(item.title)}</h2>
      <div class="detail-meta"><span>${icon('calendar')}${fullDate(item.decisionDate)}决定</span><span>${icon('clock')}${item.reviews.length ? `已回访 ${item.reviews.length} 次` : '还没有回访'}</span></div>
      <div class="comparison"><section class="record-column"><div class="column-heading"><h3>当时的判断</h3><span>${shortDate(item.decisionDate)}记录</span></div>${field('主要理由', item.reason)}${field('期待看到什么', item.expected, 'expectation')}${item.assumption ? `<div class="assumption-note"><strong>当时最担心的假设</strong>${escape(item.assumption)}</div>` : ''}${item.alternatives ? `<details class="assumption-note"><summary>考虑过的其他选项</summary><p>${escape(item.alternatives)}</p></details>` : ''}</section>
      <section class="record-column latest"><div class="column-heading"><h3>最近一次回访</h3><span>${review ? shortDate(review.reviewDate) : '等待结果出现'}</span></div>${review ? `${field('实际发生了什么', review.actual)}<div class="outcome-row">${outcomePill(review.outcome)}</div>${field('回头看，哪里需要调整', review.reflection)}${review.lesson ? `<div class="lesson-excerpt">${field('下次遇到类似情况，我会', review.lesson)}<button type="button" class="text-link" data-action="${lesson ? 'open-lesson' : 'save-lesson'}" data-review-id="${escape(review.id)}">${icon('file')}${lesson ? '打开经验笔记' : '保存为经验笔记'}</button></div>` : ''}` : `<div class="no-review">${icon('clock')}<h3>结果出来后，再回来看看</h3><p>对照当时的预期，记下实际发生的事。还没看清结果，也可以先做一次阶段回访。</p><button type="button" class="button" data-action="review">开始第一次回访</button></div>`}</section></div>
      ${item.references.length ? `<section class="references"><div class="section-heading"><h3>相关资料</h3><span>${item.references.length} 项</span></div><div class="reference-row">${item.references.map((ref) => `<button type="button" class="reference-button" data-action="reference" data-ref="${escape(ref)}">${icon(/^https?:/.test(ref) ? 'link' : 'file')}${escape(ref)}</button>`).join('')}</div></section>` : ''}
      <section class="history"><div class="section-heading"><h3>回访与补充</h3><span>${item.reviews.length} 次回访</span></div><div class="timeline">${historyHtml(item)}</div></section>`;
  }
  function historyHtml(item) {
    const reviews = [...item.reviews].reverse().map((review) => ({ date: review.reviewDate, order: 2, html: `<div class="timeline-event"><span class="timeline-dot"></span><details class="timeline-content"><summary>${outcomePill(review.outcome)}<span>${fullDate(review.reviewDate)}</span></summary><div class="history-full"><p><strong>实际发生：</strong>${escape(review.actual)}</p>${review.reflection ? `<p><strong>判断调整：</strong>${escape(review.reflection)}</p>` : ''}${review.lesson ? `<p><strong>下次做法：</strong>${escape(review.lesson)}</p>` : ''}<p>${review.followup === 'closed' ? '已结束回访' : review.nextReviewDate ? `继续观察，下次回访：${fullDate(review.nextReviewDate)}` : '继续观察，暂不安排日期'}</p>${review.lesson ? `<p><button type="button" class="text-link" data-action="${lessons().some((entry) => entry.reviewId === review.id) ? 'open-lesson' : 'save-lesson'}" data-review-id="${escape(review.id)}">${lessons().some((entry) => entry.reviewId === review.id) ? '打开经验笔记' : '保存为经验笔记'}</button></p>` : ''}</div></details></div>` }));
    const supplements = [...item.supplements].reverse().map((entry) => ({ date: entry.date, order: 1, html: `<div class="timeline-event"><span class="timeline-dot"></span><div class="timeline-content"><span class="field-label">${entry.kind === 'schedule' ? '回访安排' : '补充想法'} · ${fullDate(entry.date)}</span><p>${escape(entry.text)}</p></div></div>` }));
    return [...reviews, ...supplements].sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order).map((entry) => entry.html).join('') + `<div class="timeline-event"><span class="timeline-dot"></span><div class="timeline-content"><span class="field-label">${fullDate(item.decisionDate)}</span><p>记录决定，留下理由和预期。</p></div></div>`;
  }
  function emptyHtml() {
    if (!decisions().length) return `<div class="empty-state">${icon('book')}<h2>记下一个值得回头看的决定</h2><p>当时为什么这样选，期待会发生什么。现在留下一点线索，结果出现后再回来。</p><button type="button" class="button primary" data-action="new">记录第一个决定</button><button type="button" class="button" data-action="load-demo">载入演示</button></div>`;
    if (state.query || state.filter !== 'all') return `<div class="empty-state">${icon('search')}<h2>没有找到符合条件的决定</h2><p>换一个关键词，或清空筛选再看看。</p><button type="button" class="button" data-action="clear-search">清空筛选</button></div>`;
    const next = decisions().filter((item) => item.status === 'open' && item.nextReviewDate > today).sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate))[0];
    return `<div class="empty-state">${icon('check')}<h2>今天没有待回访的决定</h2><p>${next ? `下一次回访安排在${shortDate(next.nextReviewDate)}。` : '有了新的结果，随时可以主动做一次回访。'}</p><button type="button" class="button" data-action="all">查看全部决定</button></div>`;
  }
  function renderLessons() {
    const query = state.query.trim().toLocaleLowerCase();
    const entries = lessons().filter((entry) => `${entry.title} ${entry.content} ${decisions().find((item) => item.id === entry.decisionId)?.title || ''}`.toLocaleLowerCase().includes(query));
    $('#detail-pane').innerHTML = `<button type="button" class="button subtle mobile-switch" data-action="show-list">${icon('search')} 搜索经验</button><section class="lesson-page"><h2>留给下次的经验</h2><p>来自真实回访，每一条都能找到当时的决定。</p>${entries.length ? entries.map((entry) => { const item = decisions().find((decision) => decision.id === entry.decisionId); return `<article class="lesson-card"><h3>${escape(entry.title)}</h3><p>${escape(entry.content)}</p><footer><button type="button" class="text-link" data-action="source-decision" data-id="${escape(entry.decisionId)}">${icon('link')}${escape(item?.title || '原决定已移除')}</button><span>${fullDate(entry.createdDate)}</span></footer></article>`; }).join('') : `<div class="empty-state">${icon('file')}<h2>${query ? '没有匹配的经验笔记' : '回访之后，留下一点经验'}</h2><p>${query ? '试试其他关键词。' : '写下次遇到类似情况会怎么做，再主动保存为经验笔记。'}</p><button type="button" class="button" data-action="${query ? 'clear-search' : 'all'}">${query ? '清空筛选' : '查看决定'}</button></div>`}</section>`;
  }
  function render() {
    $('#due-count').textContent = dueItems().length;
    $('#all-count').textContent = decisions().length;
    $('#lesson-count').textContent = lessons().length;
    $('#today-label').textContent = fullDate(today);
    $('#list-heading').textContent = { due: '待回访', all: '全部决定', lessons: '经验笔记' }[state.view];
    $('#search').placeholder = state.view === 'lessons' ? '搜索经验笔记…' : '搜索决定与回访…';
    $('#search').previousElementSibling.textContent = state.view === 'lessons' ? '搜索经验笔记' : '搜索决定与回访';
    $('#status-filter-label').hidden = state.view !== 'all';
    document.querySelectorAll('[data-view]').forEach((button) => { const active = button.dataset.view === state.view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    const items = sortedItems();
    if (!items.some((item) => item.id === state.selected) && !state.kept) state.selected = items[0]?.id;
    renderList(items);
    if (state.view === 'lessons') renderLessons();
    else if (chosen() && (items.some((item) => item.id === state.selected) || state.kept)) renderDetails(chosen());
    else $('#detail-pane').innerHTML = `<button type="button" class="button subtle mobile-switch" data-action="show-list">${icon('book')} 切换决定</button>${emptyHtml()}`;
  }

  const editor = $('#editor-dialog');
  const form = $('#editor-form');
  let editorMode = '';
  let editorContext = {};
  let formBefore = '';
  let returnFocus;
  let confirmCallback;
  const formSignature = () => JSON.stringify([...new FormData(form).entries()]);
  const inputField = (name, label, value = '', options = {}) => `<label class="form-field"><span>${label}${options.optional ? '（选填）' : ''}</span><input name="${name}" type="${options.type || 'text'}" value="${escape(value)}" ${options.max ? `maxlength="${options.max}"` : ''} ${options.type === 'date' ? 'min="0001-01-01" max="9999-12-31"' : ''}>${options.hint ? `<small>${options.hint}</small>` : ''}</label>`;
  const textField = (name, label, value = '', options = {}) => `<label class="form-field"><span>${label}${options.optional ? '（选填）' : ''}</span><textarea name="${name}" maxlength="10000" ${options.placeholder ? `placeholder="${escape(options.placeholder)}"` : ''}>${escape(value)}</textarea>${options.hint ? `<small>${options.hint}</small>` : ''}</label>`;
  function openEditor(mode, context = {}) {
    returnFocus = document.activeElement;
    editorMode = mode; editorContext = context;
    $('#form-error').hidden = true;
    const item = chosen();
    const configs = {
      new: { title: '记录一个决定', description: '趁还记得，留下理由与期待。', save: '保存决定' },
      review: { title: '做一次回访', description: item?.title, save: '保存回访' },
      schedule: { title: context.reopen ? '重新开启回访' : '调整回访日期', description: '只修改回访安排，已有记录都会保留。', save: '保存安排' },
      lesson: { title: '保存为经验笔记', description: '留下具体做法，之后还能找到这次决定。', save: '保存经验笔记' },
      supplement: { title: '补充想法', description: '追加今天的想法，当时的记录继续保留。', save: '保存补充' },
      source: { title: context.title || '原始笔记预览', description: '正式插件中会打开对应的库内 Markdown 笔记。', save: '关闭' }
    };
    const config = configs[mode];
    editor.setAttribute('aria-label', config.title);
    $('#dialog-title').textContent = config.title;
    $('#dialog-description').textContent = config.description;
    $('#dialog-save').textContent = config.save;
    $('#dialog-cancel').hidden = mode === 'source';
    $('.shortcut-hint').hidden = mode === 'source';
    let html = '';
    if (mode === 'new') html = inputField('title', '这次做了什么决定', '', { max: 160, hint: '例如：先做一个小项目，再购买进阶课程。' }) + textField('reason', '主要理由') + textField('expected', '期待看到什么', '', { placeholder: '到时看到什么，你会觉得这次选择值得？' }) + `<div class="form-row">${inputField('decisionDate', '决定日期', today, { type: 'date' })}${inputField('nextReviewDate', '下次回访', shiftDate(today, 30), { type: 'date', optional: true, hint: '先建议 30 天后；清空可暂不安排。' })}</div><details class="optional-fields"><summary>补充依据：其他选项、假设与资料</summary>${textField('alternatives', '考虑过的其他选项', '', { optional: true })}${textField('assumption', '最担心哪个假设不成立', '', { optional: true })}${textField('references', '相关笔记或网址', '', { optional: true, hint: '原型中每行一项。正式插件提供库内文件选择。' })}</details>`;
    if (mode === 'review') html = `<div class="original-preview"><span>当时期待看到</span><p>${escape(item.expected)}</p></div>${inputField('reviewDate', '回访日期', today, { type: 'date' })}${textField('actual', '实际发生了什么', '', { placeholder: '写下已经观察到的事实。阶段性结果也可以。' })}<fieldset class="field-group"><legend>与当时预期相比</legend><div class="radio-row">${Object.entries(outcomeNames).map(([key, label]) => `<label class="radio-choice"><input type="radio" name="outcome" value="${key}">${label}</label>`).join('')}</div></fieldset>${textField('reflection', '回头看，理由或假设哪里需要调整', '', { optional: true })}${textField('lesson', '下次遇到类似情况，我会', '', { optional: true })}<label class="form-field"><span>接下来</span><select name="followup"><option value="scheduled">继续观察，安排下次回访</option><option value="unscheduled">继续观察，暂不安排日期</option><option value="closed">结束回访</option></select></label><div id="next-date-field">${inputField('nextReviewDate', '下次回访', shiftDate(today, 30), { type: 'date' })}</div>`;
    if (mode === 'schedule') html = inputField('nextReviewDate', '下次回访', item.nextReviewDate || shiftDate(today, 30), { type: 'date', optional: true, hint: '清空日期后暂不提醒，仍可在全部决定中找到。' });
    if (mode === 'supplement') html = textField('text', '今天想补充什么');
    if (mode === 'lesson') html = inputField('title', '经验笔记标题', context.review.lesson.slice(0, 48), { max: 160 }) + textField('content', '下次可以怎么做', context.review.lesson) + `<div class="original-preview"><span>来源决定</span><p>${escape(item.title)} · ${fullDate(context.review.reviewDate)}回访</p></div>`;
    if (mode === 'source') html = `<pre class="source-preview">${escape(context.text || sourceText(item))}</pre>`;
    $('#dialog-fields').innerHTML = html;
    formBefore = formSignature();
    editor.showModal();
    const focusName = mode === 'review' ? 'actual' : mode === 'new' || mode === 'lesson' ? 'title' : mode === 'supplement' ? 'text' : 'nextReviewDate';
    form.elements.namedItem(focusName)?.focus();
  }
  function sourceText(item) {
    return `# ${item.title}\n\n决定日期：${item.decisionDate}\n\n## 当时的判断\n\n主要理由：${item.reason}\n\n期待看到：${item.expected}\n\n${item.reviews.map((review) => `## ${review.reviewDate} 回访\n\n${review.actual}\n\n与预期相比：${outcomeNames[review.outcome]}\n\n下次做法：${review.lesson || '未填写'}`).join('\n\n')}\n\n<!-- decision-review:notes -->`;
  }
  function closeEditor() { editor.close(); if (returnFocus?.isConnected) returnFocus.focus(); else $('#new-decision').focus(); }
  function askConfirm(title, description, acceptText, callback, cancelText = '取消') {
    $('#confirm-dialog').setAttribute('aria-label', title);
    $('#confirm-title').textContent = title; $('#confirm-description').textContent = description; $('#confirm-accept').textContent = acceptText; $('#confirm-cancel').textContent = cancelText;
    confirmCallback = callback; $('#confirm-dialog').showModal(); $('#confirm-cancel').focus();
  }
  function requestClose() {
    if (editorMode !== 'source' && formBefore !== formSignature()) askConfirm('放弃未保存的内容？', '关闭后，本次输入不会保留。', '放弃修改', closeEditor, '继续编辑');
    else closeEditor();
  }
  function formError(message, name) {
    $('#form-error').textContent = message; $('#form-error').hidden = false;
    const input = form.elements.namedItem(name);
    if (input && typeof input.focus === 'function') { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    else if (name === 'outcome') form.querySelector('[name="outcome"]')?.focus();
    $('#form-error').scrollIntoView({ block: 'nearest' });
  }
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0 && localDate(new Date(`${value}T12:00:00`)) === value;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (editorMode === 'source') { closeEditor(); return; }
    form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    const values = Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value).trim()]));
    const item = chosen();
    let required = [];
    if (editorMode === 'new') required = [['title', '请写下这次做了什么决定。'], ['reason', '请写下主要理由。'], ['expected', '请写下期待看到什么。']];
    if (editorMode === 'review') required = [['actual', '请写下实际发生了什么。'], ['outcome', '请选择与当时预期相比的结果。']];
    if (editorMode === 'lesson') required = [['title', '请填写经验笔记标题。'], ['content', '请写下下次可以怎么做。']];
    if (editorMode === 'supplement') required = [['text', '请填写补充想法。']];
    for (const [name, message] of required) if (!values[name]) { formError(message, name); return; }
    const eventDate = editorMode === 'new' ? values.decisionDate : values.reviewDate;
    if (['new', 'review'].includes(editorMode) && (!validDate(eventDate) || eventDate > today || (editorMode === 'review' && eventDate < item.decisionDate))) { formError(editorMode === 'new' ? '决定日期应为有效日期，且不能晚于今天。' : '回访日期应在决定日期与今天之间。', editorMode === 'new' ? 'decisionDate' : 'reviewDate'); return; }
    if (values.nextReviewDate && (!validDate(values.nextReviewDate) || values.nextReviewDate < (editorMode === 'new' ? values.decisionDate : item?.decisionDate || today))) { formError('回访日期应为有效日期，且不能早于决定日期。', 'nextReviewDate'); return; }
    if (editorMode === 'review' && values.followup === 'scheduled' && (!values.nextReviewDate || values.nextReviewDate <= today)) { formError('继续观察时，请选择晚于今天的下次回访日期。', 'nextReviewDate'); return; }
    if (editorMode === 'new') {
      const refs = (values.references || '').split('\n').map((value) => value.trim()).filter(Boolean);
      if (refs.some((value) => /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value))) { formError('网址请使用 http:// 或 https://。', 'references'); return; }
      const entry = { id: uid(), title: values.title, decisionDate: values.decisionDate, reason: values.reason, expected: values.expected, alternatives: values.alternatives, assumption: values.assumption, references: refs, status: 'open', nextReviewDate: values.nextReviewDate || null, reviews: [], supplements: [] };
      decisions().push(entry); state.selected = entry.id; state.view = 'all'; state.query = ''; state.filter = 'all'; $('#search').value = ''; $('#status-filter').value = 'all'; toast('已保存决定');
    }
    if (editorMode === 'review') {
      const review = { id: uid(), reviewDate: values.reviewDate, actual: values.actual, outcome: values.outcome, reflection: values.reflection, lesson: values.lesson, followup: values.followup, nextReviewDate: values.followup === 'scheduled' ? values.nextReviewDate : null };
      item.reviews.push(review); item.nextReviewDate = review.nextReviewDate; item.status = values.followup === 'closed' ? 'closed' : 'open'; state.kept = true; toast(item.status === 'closed' ? '已保存回访，并结束后续回访' : '已保存回访');
    }
    if (editorMode === 'schedule') {
      item.status = 'open'; item.nextReviewDate = values.nextReviewDate || null;
      item.supplements.push({ id: uid(), kind: 'schedule', date: today, text: item.nextReviewDate ? `下次回访安排在${fullDate(item.nextReviewDate)}。` : '暂不安排回访日期，继续观察。' }); state.kept = true; toast('已保存回访安排');
    }
    if (editorMode === 'supplement') { item.supplements.push({ id: uid(), date: today, text: values.text }); toast('已保存补充'); }
    if (editorMode === 'lesson') {
      const existing = lessons().find((entry) => entry.reviewId === editorContext.review.id && entry.decisionId === item.id);
      if (!existing) lessons().unshift({ id: uid(), decisionId: item.id, reviewId: editorContext.review.id, title: values.title, content: values.content, createdDate: today });
      toast('已保存经验笔记，可在经验笔记页查看');
    }
    persist(); closeEditor(); render(); $('#detail-pane').focus({ preventScroll: true });
  });
  form.addEventListener('change', (event) => {
    if (event.target.name === 'followup') {
      $('#next-date-field').hidden = event.target.value !== 'scheduled';
      form.elements.nextReviewDate.disabled = event.target.value !== 'scheduled';
      $('#dialog-save').textContent = event.target.value === 'closed' ? '保存并结束回访' : '保存回访';
    }
  });
  editor.addEventListener('cancel', (event) => { event.preventDefault(); requestClose(); });
  $('#dialog-close').addEventListener('click', requestClose); $('#dialog-cancel').addEventListener('click', requestClose);
  $('#confirm-cancel').addEventListener('click', () => { $('#confirm-dialog').close(); confirmCallback = undefined; });
  $('#confirm-accept').addEventListener('click', () => { $('#confirm-dialog').close(); const callback = confirmCallback; confirmCallback = undefined; callback?.(); });
  $('#confirm-dialog').addEventListener('cancel', () => { confirmCallback = undefined; });
  form.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); } });

  $('#search').addEventListener('input', (event) => { state.query = event.target.value; state.kept = false; render(); });
  $('#status-filter').addEventListener('change', (event) => { state.filter = event.target.value; state.kept = false; render(); });
  $('#new-decision').addEventListener('click', () => openEditor('new'));
  $('#close-sidebar').addEventListener('click', () => { $('#workspace').classList.remove('show-list'); $('.mobile-switch')?.focus(); });
  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-view]'); if (nav) { switchView(nav.dataset.view); return; }
    const button = event.target.closest('[data-action]'); if (!button) return;
    const action = button.dataset.action;
    if (action === 'select') { state.selected = button.dataset.id; state.kept = false; $('#workspace').classList.remove('show-list'); render(); $('#detail-pane').focus({ preventScroll: true }); }
    if (action === 'new') openEditor('new');
    if (action === 'review') openEditor('review');
    if (action === 'schedule' || action === 'reopen') openEditor('schedule', { reopen: action === 'reopen' });
    if (action === 'supplement') openEditor('supplement');
    if (action === 'source') openEditor('source');
    if (action === 'all') switchView('all');
    if (action === 'next-due') { state.selected = undefined; state.kept = false; render(); }
    if (action === 'show-list') { $('#workspace').classList.add('show-list'); $('#search').focus(); }
    if (action === 'clear-search') { state.query = ''; state.filter = 'all'; state.kept = false; $('#search').value = ''; $('#status-filter').value = 'all'; render(); }
    if (action === 'load-demo') { if (state.empty) { state.emptyData = makeSeed(); state.selected = 'plugin'; render(); toast('已载入演示'); } else askConfirm('载入演示内容？', '会将示例加入此浏览器。现有内容会保留。', '载入演示', () => { const seed = makeSeed(); seed.decisions.forEach((entry) => { if (!decisions().some((item) => item.id === entry.id)) decisions().push(entry); }); seed.lessons.forEach((entry) => { if (!lessons().some((item) => item.id === entry.id)) lessons().push(entry); }); persist(); render(); }); }
    if (action === 'close-decision') askConfirm('结束这条决定的回访？', '之前的记录会保留，以后也可以重新开启。', '结束回访', () => { const item = chosen(); item.status = 'closed'; item.nextReviewDate = null; item.supplements.push({ id: uid(), kind: 'schedule', date: today, text: '结束后续回访。' }); state.kept = true; persist(); render(); toast('已结束回访'); });
    if (action === 'save-lesson' || action === 'open-lesson') {
      const item = chosen(); const review = item.reviews.find((entry) => entry.id === button.dataset.reviewId);
      const lesson = lessons().find((entry) => entry.reviewId === review.id && entry.decisionId === item.id);
      if (lesson) openEditor('source', { title: lesson.title, text: `# ${lesson.title}\n\n${lesson.content}\n\n来源决定：${item.title}\n来源回访：${review.reviewDate}` });
      else openEditor('lesson', { review });
    }
    if (action === 'source-decision') { state.view = 'all'; state.selected = button.dataset.id; state.query = ''; state.filter = 'all'; $('#search').value = ''; $('#status-filter').value = 'all'; state.kept = false; render(); }
    if (action === 'reference') openEditor('source', { title: '相关资料', text: `${button.dataset.ref}\n\n这是示例资料的入口。正式插件会通过 Obsidian 打开对应文件或网址。` });
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !editor.open && !$('#confirm-dialog').open) { document.querySelectorAll('.menu[open]').forEach((menu) => { menu.open = false; menu.querySelector('summary').focus(); }); if ($('#workspace').classList.contains('show-list')) { $('#workspace').classList.remove('show-list'); $('.mobile-switch')?.focus(); } } });
  $('#theme-toggle').addEventListener('click', (event) => { const dark = document.body.classList.toggle('dark'); event.currentTarget.setAttribute('aria-pressed', String(dark)); event.currentTarget.textContent = dark ? '浅色' : '深色'; });
  $('#width-toggle').addEventListener('click', (event) => { const narrow = $('#plugin-shell').classList.toggle('preview-narrow'); event.currentTarget.setAttribute('aria-pressed', String(narrow)); event.currentTarget.textContent = narrow ? '宽窗口' : '窄窗口'; });
  $('#empty-toggle').addEventListener('click', (event) => { state.empty = !state.empty; state.kept = false; state.selected = undefined; event.currentTarget.setAttribute('aria-pressed', String(state.empty)); event.currentTarget.textContent = state.empty ? '返回示例' : '空状态'; switchView('due'); });
  $('#reset-demo').addEventListener('click', () => askConfirm('重置浏览器中的示例？', '你在原型中新增的示例内容会被替换。Obsidian 笔记库不受影响。', '重置示例', () => { data = makeSeed(); state.emptyData = { version: 1, decisions: [], lessons: [] }; state.empty = false; $('#empty-toggle').setAttribute('aria-pressed', 'false'); $('#empty-toggle').textContent = '空状态'; state.selected = 'plugin'; persist(); switchView('due'); toast('已重置示例'); }));
  $('#brand-icon').innerHTML = icon('brand'); $('#search-icon').innerHTML = icon('search');
  render();
})();
