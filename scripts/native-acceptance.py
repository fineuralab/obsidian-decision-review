"""Exercise the installed plugin in the isolated vault created by setup-test-vault.mjs.
Requires Python Playwright and an isolated Obsidian instance on port 9248.
Never points at a user's regular vault. Results and screenshots go to output/.
"""
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import json
import sys
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PATHS = json.loads((ROOT / 'output/test-paths.json').read_text())
EXPECTED = Path(PATHS['vault']).resolve()
assert EXPECTED.parent.name.startswith('decision-review-test-')
OUT = ROOT / 'output/playwright'
OUT.mkdir(parents=True, exist_ok=True)
PLUGIN = "app.plugins.plugins['decision-review']"
today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
checks = []
def passed(label):
    checks.append(label)
    print('PASS:', label, flush=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://127.0.0.1:9248')
    page = browser.contexts[0].pages[0]
    page.set_default_timeout(10000)
    if '--reload' in sys.argv: page.reload()
    page.wait_for_function('typeof app !== "undefined" && app.vault')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve() == EXPECTED, 'Refusing to use a non-test vault'
    if '--reset' in sys.argv:
        shutil.rmtree(EXPECTED / '决策复盘', ignore_errors=True)
        shutil.rmtree(EXPECTED / '.trash', ignore_errors=True)
        for name in ['验收资料.md', '重命名资料.md']:
            (EXPECTED / name).unlink(missing_ok=True)
        (EXPECTED / '验收资料.md').write_text('# 验收资料\n\n临时验收文件。\n')
        page.reload()
    trust = page.get_by_role('button', name='Trust author and enable plugins', exact=True)
    if trust.is_visible(): trust.click()
    page.keyboard.press('Escape')
    page.wait_for_function(f'{PLUGIN}?.store?.ready === true')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    view = page.locator('.dr-root:visible')
    def modal(): return page.locator('.modal.dr-modal:visible').last
    def reopen_view(): page.evaluate(f'async () => {{ await {PLUGIN}.openView(); }}')
    def current(): return page.evaluate(f'{PLUGIN}.store.entries.find(e => !e.decision.demo)')
    def open_more(label):
        view.get_by_role('button', name='更多决定操作', exact=True).click()
        page.locator('.menu-item').filter(has_text=label).click()
    def fill_review(actual, outcome='部分达到', followup='unscheduled'):
        modal().get_by_label('实际发生了什么 *', exact=True).fill(actual)
        modal().get_by_role('radio', name=outcome, exact=True).check()
        modal().get_by_label('接下来', exact=True).select_option(followup)

    try:
        page.set_viewport_size({'width':1440,'height':1050})
        reopen_view()
        if '--reset' in sys.argv:
            page.evaluate(f'async () => {{ const v=await {PLUGIN}.openView();v.select("",false);v.show("due"); }}')
        if '--capture-only' not in sys.argv:
            assert not page.evaluate(f'{PLUGIN}.store.entries.length'), 'Use a fresh isolated vault for the full acceptance run'
            expect(view.get_by_text('记下一个值得回头看的决定', exact=True)).to_be_visible()
            passed('Native plugin loads with an actionable empty state')
            view.get_by_role('button', name='记录决定', exact=True).click()
            modal().get_by_role('button', name='保存决定', exact=True).click()
            expect(modal().locator('.dr-error')).to_contain_text('请填写')
            modal().get_by_label('这次做了什么决定 *', exact=True).fill('第三款插件首版验收')
            modal().get_by_label('主要理由 *', exact=True).fill('先确认完整使用流程，再交付首版。')
            modal().get_by_label('期待看到什么 *', exact=True).fill('保存真实文件，回访后留下可以复用的经验。')
            modal().get_by_label('决定日期 *', exact=True).fill(str(today - timedelta(days=1)))
            modal().get_by_label('下次回访（选填）', exact=False).fill(str(today))
            modal().locator('.dr-optional summary').click()
            modal().get_by_role('button', name='选择库内文件', exact=True).click()
            page.locator('.prompt-input:visible').fill('验收资料')
            page.locator('.suggestion-item:visible').filter(has_text='验收资料.md').click()
            modal().get_by_role('button', name='添加网址', exact=True).click()
            modal().get_by_label('网址 *', exact=True).fill('javascript:alert(1)')
            modal().get_by_role('button', name='添加', exact=True).click()
            expect(modal().locator('.dr-error')).to_contain_text('http://')
            modal().get_by_label('网址 *', exact=True).fill('https://example.com/decision')
            modal().get_by_label('链接名称（选填）', exact=True).fill('参考资料')
            modal().get_by_role('button', name='添加', exact=True).click()
            modal().get_by_label('主要理由 *', exact=True).press('Meta+Enter')
            expect(page.locator('.modal.dr-modal')).to_have_count(0)
            expect(view.locator('.dr-detail-title')).to_have_text('第三款插件首版验收')
            entry = current()
            assert entry['decision']['original']['record']['references'][0]['path'] == '验收资料.md'
            assert (EXPECTED / entry['path']).is_file()
            passed('Create through the real form; validate required fields, URL scheme, file picker and keyboard save')

            view.get_by_role('button', name='待回访 1', exact=True).click()
            view.get_by_role('button', name='做一次回访', exact=True).click()
            modal().get_by_label('实际发生了什么 *', exact=True).fill('已走通首条记录，等待继续验证回访。')
            modal().get_by_role('button', name='保存回访', exact=True).click()
            expect(modal().locator('.dr-error')).to_contain_text('请选择')
            modal().get_by_role('radio', name='部分达到', exact=True).check()
            modal().get_by_label('下次遇到类似情况，我会（选填）', exact=True).fill('先走通一条完整流程，再扩大功能范围。')
            modal().locator('summary').filter(has_text='关联本次证据').click()
            modal().get_by_role('button', name='选择库内文件', exact=True).click()
            page.locator('.prompt-input:visible').fill('验收资料')
            page.locator('.suggestion-item:visible').filter(has_text='验收资料.md').click()
            modal().get_by_role('button', name='保存回访', exact=True).click()
            expect(view.locator('.dr-queue-updated')).to_be_visible()
            expect(view.locator('.dr-detail-title')).to_have_text('第三款插件首版验收')
            assert len(current()['decision']['reviews']) == 1
            passed('Review requires an explicit outcome and retains the current decision after leaving the due queue')

            view.get_by_role('button', name='保存为经验笔记', exact=True).click()
            modal().get_by_label('经验笔记标题 *', exact=True).fill('先验证完整流程')
            modal().get_by_role('button', name='保存经验笔记', exact=True).click()
            page.wait_for_function(f'{PLUGIN}.store.lessons.length === 1')
            lesson = page.evaluate(f'{PLUGIN}.store.lessons[0]')
            assert '先走通一条完整流程' in lesson['content']
            assert 'review-' in lesson['source']
            page.wait_for_function('app.workspace.activeLeaf?.view?.file?.path?.includes("/经验/") === true')
            expect(page.locator('.modal.dr-modal')).to_have_count(0)
            reopen_view()
            view.locator('.dr-history-item summary').first.click()
            view.get_by_role('button', name='更正回访', exact=True).click()
            modal().get_by_label('实际发生了什么 *', exact=True).fill('更正：已经完成一次真实文件回访。')
            modal().get_by_label('更正原因 *', exact=True).fill('补充实际完成的结果')
            modal().get_by_role('button', name='保存更正', exact=True).click()
            expect(view.locator('.dr-latest')).to_contain_text('更正：已经完成')
            assert len(current()['decision']['reviewCorrections']) == 1
            assert current()['decision']['reviews'][0]['actual'].startswith('已走通首条记录')
            assert page.evaluate(f'{PLUGIN}.store.lessons[0].source') == lesson['source']
            passed('Lesson is an independent Markdown note; review corrections retain original wording and do not rewrite lessons')

            open_more('更正原记录')
            modal().get_by_label('主要理由 *', exact=True).fill('更正后的理由，仅作为一个新版本。')
            modal().get_by_label('更正原因 *', exact=True).fill('把补充依据写完整')
            modal().get_by_role('button', name='保存更正', exact=True).click()
            expect(view.locator('.dr-record-column').first).to_contain_text('先确认完整使用流程')
            revision = current()['decision']['revisions'][0]['id']
            view.get_by_label('记录版本', exact=True).select_option(revision)
            expect(view.locator('.dr-record-column').first).to_contain_text('更正后的理由')
            assert current()['decision']['original']['record']['reason'] == '先确认完整使用流程，再交付首版。'
            passed('Record correction keeps the original and supports switching the comparison version')

            view.get_by_role('button', name='做一次回访', exact=True).click()
            fill_review('资料改名期间写下的回访。', '暂时无法判断')
            page.evaluate('async () => { await app.vault.rename(app.vault.getAbstractFileByPath("验收资料.md"), "重命名资料.md"); }')
            page.wait_for_function(f'{PLUGIN}.store.entries.find(e => !e.decision.demo).decision.original.record.references[0].path === "重命名资料.md"')
            modal().get_by_role('button', name='保存回访', exact=True).click()
            expect(page.locator('.modal.dr-modal')).to_have_count(0)
            assert len(current()['decision']['reviews']) == 2
            assert current()['decision']['reviews'][0]['references'][0]['path'] == '重命名资料.md'
            passed('Renaming a referenced file updates history and an already-open form without losing input')

            view.get_by_role('button', name='做一次回访', exact=True).click()
            fill_review('旧表单输入必须保留')
            page.evaluate(f'async () => {{ const e={PLUGIN}.store.entries.find(e => !e.decision.demo); await app.vault.modify(app.vault.getAbstractFileByPath(e.path), e.source + "\\n外部追加内容"); }}')
            modal().get_by_role('button', name='保存回访', exact=True).click()
            expect(modal().locator('.dr-error')).to_contain_text('源文件')
            expect(modal().get_by_label('实际发生了什么 *', exact=True)).to_have_value('旧表单输入必须保留')
            modal().get_by_role('button', name='取消', exact=True).click()
            page.locator('.modal.dr-confirm').get_by_role('button', name='放弃修改', exact=True).click()
            assert len(current()['decision']['reviews']) == 2
            assert current()['source'].endswith('外部追加内容')
            passed('A stale form cannot overwrite external changes; input remains available and discard is explicit')

            view.get_by_role('button', name='做一次回访', exact=True).click()
            fill_review('失败后重试，只保存一次。')
            page.evaluate('''() => {
              window.__drProcess = app.vault.process;
              app.vault.process = async function() { throw new Error('Injected save failure'); };
            }''')
            modal().get_by_role('button', name='保存回访', exact=True).click()
            expect(modal().locator('.dr-error')).to_contain_text('Injected save failure')
            expect(modal().get_by_label('实际发生了什么 *', exact=True)).to_have_value('失败后重试，只保存一次。')
            page.evaluate('() => { app.vault.process = window.__drProcess; delete window.__drProcess; }')
            modal().get_by_role('button', name='保存回访', exact=True).click()
            expect(page.locator('.modal.dr-modal')).to_have_count(0)
            assert len(current()['decision']['reviews']) == 3
            expect(view.locator('.dr-latest')).to_contain_text('失败后重试，只保存一次。')
            passed('Injected disk failure preserves input and retry creates exactly one review; latest same-day review is shown')

            open_more('补充想法')
            modal().get_by_label('今天想补充什么 *', exact=True).fill('补充观察，不改写最初预期。')
            modal().get_by_role('button', name='保存补充', exact=True).click()
            expect(page.locator('.modal.dr-modal')).to_have_count(0)
            assert len(current()['decision']['supplements']) == 1
            open_more('结束回访')
            page.locator('.modal.dr-confirm').get_by_role('button', name='结束回访', exact=True).click()
            expect(view.get_by_role('button', name='重新开启', exact=True)).to_be_visible()
            view.get_by_role('button', name='重新开启', exact=True).click()
            modal().get_by_label('下次回访（选填）', exact=False).fill(str(today))
            modal().get_by_role('button', name='保存安排', exact=True).click()
            expect(view.get_by_role('button', name='做一次回访', exact=True)).to_be_visible()
            passed('Supplements, closing and reopening follow-up preserve the full history')

            page.evaluate('async () => { await app.vault.trash(app.vault.getAbstractFileByPath("重命名资料.md"), false); }')
            expect(view.get_by_role('button', name='重命名资料.md（链接失效）', exact=True).first).to_be_visible()
            before = current()['source']
            page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("en"); }}')
            expect(view.get_by_role('button', name='Review decision', exact=True)).to_be_visible()
            assert current()['source'] == before
            passed('Deleted files are marked missing; switching to English leaves all decision content unchanged')

            page.reload()
            page.wait_for_function(f'{PLUGIN}?.store?.ready === true')
            reopen_view()
            assert len(current()['decision']['reviews']) == 3
            assert len(current()['decision']['reviewCorrections']) == 1
            assert current()['source'].endswith('外部追加内容')
            assert len(page.evaluate(f'{PLUGIN}.store.lessons')) == 1
            passed('Full application reload restores decisions, revisions, reviews, schedules, personal notes and lessons')

        page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("zh-CN"); await {PLUGIN}.loadDemo(); }}')
        reopen_view()
        page.evaluate(f'async () => {{ const v=await {PLUGIN}.openView();v.showDemo(); }}')
        page.set_viewport_size({'width':1440,'height':1050})
        # Fresh Obsidian profiles may open a 300px file explorer automatically.
        # Give the plugin the full test pane before measuring its narrow layout.
        page.evaluate('() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); }')
        page.wait_for_function('[...document.querySelectorAll(".mod-left-split,.mod-right-split")].every(node=>node.clientWidth===0)')
        page.screenshot(path=str(OUT / 'native-workspace-light.png'))
        page.evaluate('() => { app.vault.setConfig("theme", "obsidian"); app.setTheme(); }')
        page.wait_for_function('document.body.classList.contains("theme-dark")')
        page.screenshot(path=str(OUT / 'native-workspace-dark.png'))
        page.evaluate('() => { app.vault.setConfig("theme", "moonstone"); app.setTheme(); }')
        page.wait_for_function('document.body.classList.contains("theme-light")')
        widths = []
        for width in [1280, 900, 760, 460, 360]:
            page.set_viewport_size({'width':width,'height':1000})
            metrics = view.evaluate('(root) => ({ width: root.clientWidth, content: root.scrollWidth, detail: root.querySelector(".dr-detail").clientWidth, detailContent: root.querySelector(".dr-detail").scrollWidth })')
            assert metrics['content'] <= metrics['width'], metrics
            assert metrics['detailContent'] <= metrics['detail'] + 1, metrics
            widths.append(metrics)
        page.screenshot(path=str(OUT / 'native-workspace-narrow.png'))
        view.get_by_role('button', name='切换决定', exact=True).click()
        view.get_by_role('searchbox').fill('课程')
        view.locator('.dr-decision-item').click()
        expect(view.locator('.dr-detail-title')).to_contain_text('课程')
        view.get_by_role('button', name='做一次回访', exact=True).click()
        expect(modal().get_by_role('button', name='保存回访', exact=True)).to_be_in_viewport()
        page.screenshot(path=str(OUT / 'native-review-narrow.png'))
        modal().get_by_role('button', name='取消', exact=True).click()
        passed('Light, dark and 360–1280px layouts are usable; narrow list switching and review actions work')
        page.set_viewport_size({'width':1440,'height':1050})
        page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("en"); }}')
        page.screenshot(path=str(OUT / 'native-workspace-en.png'))
        page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("zh-CN"); }}')
        assert not errors, errors
        passed('No uncaught JavaScript page errors during native acceptance')
        (OUT / ('native-capture-results.json' if '--capture-only' in sys.argv else 'native-results.json')).write_text(json.dumps({'passed':checks, 'widths':widths, 'errors':errors}, ensure_ascii=False, indent=2))
    except Exception:
        if page.evaluate('typeof window.__drProcess !== "undefined"'):
            page.evaluate('() => { app.vault.process = window.__drProcess; delete window.__drProcess; }')
        page.screenshot(path=str(OUT / 'native-failure.png'))
        (OUT / 'native-failure.txt').write_text(page.locator('body').inner_text())
        raise
    finally:
        browser.close()
