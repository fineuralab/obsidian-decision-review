"""Install the actual ZIP into the guarded test vault, then exercise and remove one test decision."""
from pathlib import Path
import hashlib
import json
import zipfile
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
paths=json.loads((ROOT/'output/test-paths.json').read_text())
vault=Path(paths['vault']).resolve()
plugin=Path(paths['plugin']).resolve()
assert vault.parent.name.startswith('decision-review-test-') and plugin.is_relative_to(vault)
manifest=json.loads((ROOT/'manifest.json').read_text())
archive=ROOT/f'dist/decision-review-{manifest["version"]}.zip'
names=['main.js','styles.css','manifest.json','LICENSE','THIRD-PARTY-NOTICES.txt']
with zipfile.ZipFile(archive) as z:
    assert set(z.namelist())=={'decision-review/'+name for name in names}
    for name in names: (plugin/name).write_bytes(z.read('decision-review/'+name))
checks=['Runtime and license files are installed from the actual ZIP, preserving plugin settings']
PLUGIN="app.plugins.plugins['decision-review']"
with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9248')
    page=browser.contexts[0].pages[0]
    page.set_default_timeout(10000)
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve()==vault
    page.reload()
    page.wait_for_function(f'typeof app !== "undefined" && {PLUGIN}?.store?.ready === true')
    page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("zh-CN"); await {PLUGIN}.openView(); }}')
    before=page.evaluate(f'{PLUGIN}.store.entries.filter(e=>!e.decision.demo).length')
    view=page.locator('.dr-root:visible')
    view.get_by_role('button',name='返回真实记录',exact=True).click() if view.get_by_role('button',name='返回真实记录',exact=True).is_visible() else None
    view.get_by_role('button',name='记录决定',exact=True).click()
    def modal(): return page.locator('.modal.dr-modal:visible').last
    modal().get_by_label('这次做了什么决定 *',exact=True).fill('安装包首次加载验收')
    modal().get_by_label('主要理由 *',exact=True).fill('直接从 ZIP 安装后验证文件写入。')
    modal().get_by_label('期待看到什么 *',exact=True).fill('可以保存、回访、重载，并移到回收站。')
    modal().get_by_role('button',name='保存决定',exact=True).click()
    expect(view.locator('.dr-detail-title')).to_have_text('安装包首次加载验收')
    view.get_by_role('button',name='做一次回访',exact=True).click()
    modal().get_by_label('实际发生了什么 *',exact=True).fill('从安装 ZIP 加载并成功写入真实 Markdown。')
    modal().get_by_role('radio',name='达到预期',exact=True).check()
    modal().get_by_label('接下来',exact=True).select_option('closed')
    modal().get_by_role('button',name='保存并结束回访',exact=True).click()
    expect(view.get_by_role('button',name='重新开启',exact=True)).to_be_visible()
    entry=page.evaluate(f'{PLUGIN}.store.entries.find(e=>e.decision.original.record.title==="安装包首次加载验收")')
    assert len(entry['decision']['reviews'])==1
    assert page.evaluate(f'{PLUGIN}.manifest.version')==manifest['version']
    checks.append('Installed ZIP creates a decision, persists a review and closes follow-up through native forms')
    page.reload()
    page.wait_for_function(f'typeof app !== "undefined" && {PLUGIN}?.store?.ready === true')
    page.evaluate(f'async () => {{ await {PLUGIN}.openView({json.dumps(entry["decision"]["id"])}); }}')
    expect(view.locator('.dr-latest')).to_contain_text('从安装 ZIP 加载')
    view.get_by_role('button',name='更多决定操作',exact=True).click()
    page.locator('.menu-item').filter(has_text='移到回收站').click()
    page.locator('.modal.dr-confirm').get_by_role('button',name='移到回收站',exact=True).click()
    page.wait_for_function(f'{PLUGIN}.store.entries.filter(e=>!e.decision.demo).length === {before}')
    assert not (vault/entry['path']).exists()
    assert any((vault/'.trash').rglob(Path(entry['path']).name))
    checks.append('Reload reads the saved review and the confirmed trash action removes only that test decision')
    # Verify the view itself uses the local calendar day for UTC timestamps.
    page.evaluate(f'''async () => {{
      const plugin={PLUGIN}; const base=JSON.parse(JSON.stringify(plugin.store.entries.find(e=>!e.decision.demo).decision));
      base.id='timezone-package-check';base.createdAt='2026-01-01T00:00:00.000Z';base.updatedAt='2026-11-02T20:00:00.000Z';
      base.original.id='timezone-original';base.original.createdAt=base.createdAt;base.original.record.title='时区日期检查';base.original.record.decisionDate='2026-01-01';
      base.revisions=[];base.reviews=[];base.reviewCorrections=[];base.lessonLinks=[];
      base.schedules=[{{id:'timezone-schedule',createdAt:base.createdAt,status:'open',nextReviewDate:null}}];
      base.supplements=[{{id:'timezone-note',createdAt:base.updatedAt,text:'本地日期检查',references:[]}}];
      await plugin.store.create(base);await plugin.openView(base.id);
    }}''')
    expected_date=page.evaluate('new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"short",day:"numeric"}).format(new Date("2026-11-02T20:00:00.000Z"))')
    expect(view.locator('.dr-history-date')).to_have_text(expected_date)
    page.evaluate(f'''async () => {{ const plugin={PLUGIN};await plugin.store.remove(plugin.store.entries.find(e=>e.decision.id==='timezone-package-check')); }}''')
    checks.append('The installed view groups a UTC timestamp by the actual local calendar day')
    page.evaluate(f'async () => {{ const view=await {PLUGIN}.openView(); view.showDemo(); }}')
    for check in checks: print('PASS:',check,flush=True)
    (ROOT/'output/native-package-verification.json').write_text(json.dumps({'version':manifest['version'],'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'passed':checks},indent=2))
    browser.close()
