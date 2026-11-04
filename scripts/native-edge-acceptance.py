"""Additional recovery/settings checks in the same guarded temporary Obsidian vault."""
from pathlib import Path
import json
import plistlib
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
paths=json.loads((ROOT/'output/test-paths.json').read_text())
vault=Path(paths['vault']).resolve()
assert vault.parent.name.startswith('decision-review-test-')
OUT=ROOT/'output/playwright'
PLUGIN="app.plugins.plugins['decision-review']"
checks=[]
def passed(label):
    checks.append(label)
    print('PASS:',label,flush=True)

with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9248')
    page=browser.contexts[0].pages[0]
    page.set_default_timeout(10000)
    page.wait_for_function('typeof app !== "undefined" && app.vault')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve()==vault
    page.reload()
    page.wait_for_function(f'typeof app !== "undefined" && {PLUGIN}?.store?.ready === true')
    entry=page.evaluate(f'{PLUGIN}.store.entries.find(e => !e.decision.demo)')
    assert entry
    original=entry['source']
    view=page.locator('.dr-root:visible')
    def modal(): return page.locator('.modal.dr-modal:visible').last
    page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("zh-CN"); await {PLUGIN}.openView({json.dumps(entry["decision"]["id"])}); }}')
    view.get_by_role('button',name='做一次回访',exact=True).click()
    expect(modal().get_by_label('实际发生了什么 *',exact=True)).to_be_focused()
    modal().get_by_role('button',name='取消',exact=True).click()
    passed('Review opens with focus on actual results after native modal autofocus')

    view.get_by_role('button',name='记录决定',exact=True).click()
    modal().get_by_label('这次做了什么决定 *',exact=True).fill('目录切换前的草稿')
    modal().get_by_label('主要理由 *',exact=True).fill('验证旧表单不能悄悄写入新目录')
    modal().get_by_label('期待看到什么 *',exact=True).fill('拒绝保存并保留输入')
    page.evaluate(f'async () => {{ await {PLUGIN}.setSettings({{folder:"验收其他目录"}}); }}')
    modal().get_by_role('button',name='保存决定',exact=True).click()
    expect(modal().locator('.dr-error')).to_contain_text('数据目录已变更')
    expect(modal().get_by_label('这次做了什么决定 *',exact=True)).to_have_value('目录切换前的草稿')
    modal().get_by_role('button',name='取消',exact=True).click()
    page.locator('.modal.dr-confirm').get_by_role('button',name='放弃修改',exact=True).click()
    page.evaluate(f'async () => {{ await {PLUGIN}.setSettings({{folder:"决策复盘"}}); }}')
    assert not (vault/'验收其他目录').exists()
    passed('Changing the data folder does not move old files or allow a pre-existing form to save into the new folder')

    page.evaluate(f'async () => {{ await {PLUGIN}.openView({json.dumps(entry["decision"]["id"])}); }}')
    path=entry['path']
    page.evaluate(f'''async () => {{ const e={PLUGIN}.store.entries.find(e=>!e.decision.demo); await app.vault.modify(app.vault.getAbstractFileByPath(e.path),e.source.replace('decisionReview: 1','decisionReview: 99')); await {PLUGIN}.store.load(); }}''')
    expect(view.get_by_role('button',name='做一次回访',exact=True)).to_be_disabled()
    expect(view.locator('.dr-detail > .dr-error')).to_contain_text('数据待修复')
    page.evaluate('async ({path,source})=>{ await app.vault.modify(app.vault.getAbstractFileByPath(path),source); }',{'path':path,'source':original})
    page.evaluate(f'async () => {{ await {PLUGIN}.store.load(); }}')
    expect(view.get_by_role('button',name='做一次回访',exact=True)).to_be_enabled()
    passed('Malformed source is blocked with a labeled cached snapshot; repair and reload recover it')

    page.evaluate('async ({source}) => { await app.vault.create("决策复盘/决策-duplicate-check.md",source); }',{'source':original})
    page.evaluate(f'async () => {{ await {PLUGIN}.store.load(); }}')
    assert len(page.evaluate(f'{PLUGIN}.store.entries.filter(e=>!e.decision.demo && e.blocked)'))==2
    page.evaluate('async () => { await app.vault.trash(app.vault.getAbstractFileByPath("决策复盘/决策-duplicate-check.md"),false); }')
    page.evaluate(f'async () => {{ await {PLUGIN}.store.load(); }}')
    assert not page.evaluate(f'{PLUGIN}.store.entries.some(e=>e.blocked)')
    passed('Duplicate decision IDs block both copies, and removing the extra copy restores saving')

    page.evaluate('async () => { if (!app.vault.getAbstractFileByPath("决策复盘/演示数据/保留普通笔记.md")) await app.vault.create("决策复盘/演示数据/保留普通笔记.md","# 手动放入的普通笔记"); }')
    page.evaluate(f'async () => {{ await {PLUGIN}.store.clearDemo(); }}')
    assert (vault/'决策复盘/演示数据/保留普通笔记.md').exists()
    assert len(page.evaluate(f'{PLUGIN}.store.entries'))==1
    page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("en"); await {PLUGIN}.loadDemo(); }}')
    page.evaluate(f'async () => {{ const v=await {PLUGIN}.openView(); v.showDemo(); }}')
    page.set_viewport_size({'width':1440,'height':1050})
    page.screenshot(path=str(OUT/'native-workspace-en.png'))
    page.evaluate(f'async () => {{ await {PLUGIN}.store.clearDemo(); await {PLUGIN}.setLanguage("zh-CN"); await {PLUGIN}.loadDemo(); }}')
    page.evaluate(f'async () => {{ const v=await {PLUGIN}.openView(); v.showDemo(); }}')
    passed('Clearing demo data preserves real decisions and unmarked files; new demo content follows the selected language')
    assert page.evaluate(f'{PLUGIN}.store.entries.find(e=>!e.decision.demo).source')==original
    version=plistlib.loads(Path("/Applications/Obsidian.app/Contents/Info.plist").read_bytes())["CFBundleShortVersionString"]
    (OUT/'native-edge-results.json').write_text(json.dumps({'passed':checks,'obsidianVersion':version},ensure_ascii=False,indent=2))
    browser.close()
