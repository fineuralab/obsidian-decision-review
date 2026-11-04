"""Guarded native checks for stopped forms and settings writes across plugin instances."""
from pathlib import Path
import json
import shutil
import sys
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
paths=json.loads((ROOT/'output/test-paths.json').read_text());vault=Path(paths['vault']).resolve()
assert vault.parent.name.startswith('decision-review-test-')
PLUGIN="app.plugins.plugins['decision-review']"
OUT=ROOT/'output/playwright';OUT.mkdir(parents=True,exist_ok=True)
results={'passed':[],'failed':[],'errors':[]}
prefix='lifecycle-test-'+uuid4().hex[:8]

with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9248',timeout=5000);page=browser.contexts[0].pages[0]
    page.set_default_timeout(5000);page.wait_for_function('typeof app!=="undefined"&&app.vault')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve()==vault
    trust=page.get_by_role('button',name='Trust author and enable plugins',exact=True)
    if trust.is_visible():trust.click()
    def loaded():page.wait_for_function(f'{PLUGIN}?.store?.ready===true')
    loaded();page.keyboard.press('Escape');page.set_viewport_size({'width':1280,'height':1050})
    page.on('pageerror',lambda error:results['errors'].append(str(error)))
    page.evaluate(f'async()=>{{await {PLUGIN}.setLanguage("zh-CN");}}')
    original=page.evaluate(f'{PLUGIN}.settings');results['version']=page.evaluate(f'{PLUGIN}.manifest.version')
    def record(label,passed):
        results['passed' if passed else 'failed'].append(label);print(('PASS: ' if passed else 'FAIL: ')+label,flush=True)
    def snapshot():return page.evaluate('async()=>{return (await Promise.all(app.vault.getMarkdownFiles().map(async f=>[f.path,await app.vault.read(f)]))).sort((a,b)=>a[0].localeCompare(b[0]));}')
    def form():return page.locator('.modal.dr-modal:visible').last
    def fill(title):
        form().get_by_label('这次做了什么决定 *',exact=True).fill(title)
        form().get_by_label('主要理由 *',exact=True).fill('核对插件生命周期边界')
        form().get_by_label('期待看到什么 *',exact=True).fill('只由当前实例保存')
    def discard():
        if form().count():
            page.keyboard.press('Escape');confirm=page.locator('.modal.dr-confirm:visible')
            if confirm.count():confirm.get_by_role('button',name='放弃修改',exact=True).click()
        expect(page.locator('.modal.dr-modal:visible')).to_have_count(0)
    def save():
        form().get_by_role('button',name='保存决定',exact=True).click()
        page.wait_for_function('!document.querySelector(".modal.dr-modal") || !!document.querySelector(".modal.dr-modal .dr-error:not([hidden])")')
    before=snapshot()
    try:
        page.evaluate(f'''async root=>{{const p={PLUGIN};await p.setSettings({{folder:root+'/a'}});window.__lifecycleAudit={{old:p,root}};p.create(false);}}''',prefix)
        fill('停用前的旧草稿')
        page.evaluate('async()=>{await app.plugins.disablePlugin("decision-review");}')
        if form().count():save()
        no_old_files=page.evaluate('root=>!app.vault.getMarkdownFiles().some(f=>f.path.startsWith(root+"/a/"))',prefix)
        preserved=bool(form().count()) and '停用' in form().locator('.dr-error').inner_text() and form().get_by_label('这次做了什么决定 *',exact=True).input_value()=='停用前的旧草稿'
        record('Disabling the plugin stops old draft writes while preserving the input',preserved and no_old_files)
        page.evaluate('async()=>{await app.plugins.enablePlugin("decision-review");}');loaded()
        page.evaluate(f'async root=>{{await {PLUGIN}.setSettings({{folder:root+"/b"}});}}',prefix)
        if form().count():save()
        no_old_files=page.evaluate('root=>!app.vault.getMarkdownFiles().some(f=>f.path.startsWith(root+"/a/"))',prefix)
        record('Re-enabling with another folder never reactivates an old draft',bool(form().count()) and no_old_files and '停用' in form().locator('.dr-error').inner_text())
        discard()
        page.evaluate(f'()=>{PLUGIN}.create(false)');fill('重新启用后的有效草稿');save();expect(page.locator('.modal.dr-modal:visible')).to_have_count(0)
        state=page.evaluate(f'''root=>{{const p={PLUGIN};return p.settings.folder===root+'/b'&&p.store.entries.some(e=>e.path.startsWith(root+'/b/')&&e.decision.original.record.title==='重新启用后的有效草稿');}}''',prefix)
        record('A fresh form from the current instance saves to the selected folder',state)
        page.evaluate(f'''async root=>{{
          const old={PLUGIN};await old.setSettings({{folder:root+'/settings-a'}});
          const state=window.__lifecycleAudit;state.old=old;state.saveData=old.saveData;
          old.saveData=async function(data){{if(data.folder===root+'/settings-b')await new Promise(resolve=>state.release=resolve);return state.saveData.call(this,data);}};
          state.pending=old.setSettings({{folder:root+'/settings-b'}}).then(()=>({{ok:true}}),error=>({{ok:false,error:error.message}}));
        }}''',prefix)
        page.wait_for_function('!!window.__lifecycleAudit.release')
        page.evaluate('async()=>{await app.plugins.disablePlugin("decision-review");await app.plugins.enablePlugin("decision-review");}');loaded()
        page.evaluate(f'async root=>{{await {PLUGIN}.setSettings({{folder:root+"/settings-c"}});}}',prefix)
        value=page.evaluate(f'''async()=>{{const s=window.__lifecycleAudit,p={PLUGIN};s.release();const result=await s.pending;return {{cancelled:!result.ok,runtime:p.settings.folder,persisted:(await p.loadData()).folder}};}}''')
        record('A delayed settings request from a stopped instance cannot overwrite the new instance',value['cancelled'] and value['runtime']==value['persisted']==prefix+'/settings-c')
        page.evaluate('app.commands.executeCommandById("decision-review:record-decision")')
        expect(form()).to_be_visible();fill('当前命令仍属于新实例');save();expect(page.locator('.modal.dr-modal:visible')).to_have_count(0)
        state=page.evaluate(f'''root=>{{const p={PLUGIN};return p.store.entries.some(e=>e.path.startsWith(root+'/settings-c/')&&e.decision.original.record.title==='当前命令仍属于新实例');}}''',prefix)
        record('Late old work cannot re-register commands pointing at an obsolete instance',state)
        page.evaluate(f'async root=>{{await {PLUGIN}.setSettings({{folder:root+"/settings-c"}});}}',prefix)
        state=page.evaluate(f'''async root=>{{const s=window.__lifecycleAudit,p={PLUGIN};s.old.saveData=s.saveData;let error='';try{{await s.old.setSettings({{folder:root+'/obsolete'}});}}catch(e){{error=e.message;}}return !!error&&p.settings.folder===root+'/settings-c'&&(await p.loadData()).folder===root+'/settings-c';}}''',prefix)
        record('Direct settings requests on a stopped controller are rejected without altering current settings',state)
        page.evaluate(f'async root=>{{await {PLUGIN}.setSettings({{folder:root+"/settings-c"}});}}',prefix)
        page.reload();page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
        state=page.evaluate(f'''root=>{{const p={PLUGIN};return p.settings.folder===root+'/settings-c'&&p.store.entries.some(e=>e.decision.original.record.title==='当前命令仍属于新实例');}}''',prefix)
        record('Application reload keeps the current settings and current-instance record',state)
    finally:
        page.evaluate('async()=>{const s=window.__lifecycleAudit;if(s?.saveData)s.old.saveData=s.saveData;s?.release?.();if(s?.pending)await s.pending;if(!app.plugins.plugins["decision-review"])await app.plugins.enablePlugin("decision-review");}')
        loaded();discard()
        page.evaluate(f'async settings=>{{await {PLUGIN}.setSettings(settings);delete window.__lifecycleAudit;}}',original)
        target=vault/prefix;assert target.parent==vault and target.name.startswith('lifecycle-test-');shutil.rmtree(target,ignore_errors=True)
        page.reload();page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
    record('Existing decisions, independent lessons and ordinary notes remain byte-for-byte unchanged',snapshot()==before)
    record('No uncaught page errors occur during disable and reload checks',not results['errors'])
    (OUT/('native-lifecycle-'+str(results['version'])+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2));browser.close()
if results['failed'] and '--expect-bugs' not in sys.argv:sys.exit(1)
