"""Guarded native checks for indexed storage, legacy hidden-folder recovery and collisions."""
from pathlib import Path
import json
import shutil
import sys
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
paths = json.loads((ROOT / 'output/test-paths.json').read_text())
vault = Path(paths['vault']).resolve()
assert vault.parent.name.startswith('decision-review-test-')
PLUGIN = "app.plugins.plugins['decision-review']"
OUT = ROOT / 'output/playwright'
OUT.mkdir(parents=True, exist_ok=True)
results = {'passed': [], 'failed': [], 'errors': []}
prefix='visibility-test-'+uuid4().hex[:8]

with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9248',timeout=5000)
    page=browser.contexts[0].pages[0]
    page.set_default_timeout(5000)
    page.wait_for_function('typeof app !== "undefined" && app.vault')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve()==vault
    trust=page.get_by_role('button',name='Trust author and enable plugins',exact=True)
    if trust.is_visible():trust.click()
    page.wait_for_function(f'{PLUGIN}?.store?.ready===true')
    page.keyboard.press('Escape')
    page.set_viewport_size({'width':1280,'height':1050})
    page.on('pageerror',lambda error:results['errors'].append(str(error)))
    page.evaluate(f'async()=>{{await {PLUGIN}.setLanguage("zh-CN");}}')
    results['version']=page.evaluate(f'{PLUGIN}.manifest.version')
    original=page.evaluate(f'{PLUGIN}.settings')
    def record(label,passed):
        results['passed' if passed else 'failed'].append(label)
        print(('PASS: ' if passed else 'FAIL: ')+label,flush=True)
    def snapshot():
        return page.evaluate('async()=>{return (await Promise.all(app.vault.getMarkdownFiles().map(async f=>[f.path,await app.vault.read(f)]))).sort((a,b)=>a[0].localeCompare(b[0]));}')
    before=snapshot()
    fixture=None
    try:
        for folder,label in [('.'+prefix,'A hidden root data folder is rejected without changing saved settings'),(prefix+'/.hidden/records','A nested hidden data folder is rejected without changing saved settings')]:
            state=page.evaluate(f'''async folder=>{{const p={PLUGIN},before=await p.loadData();let error='';try{{await p.setSettings({{folder}});}}catch(e){{error=e.message;}}const result={{error,unchanged:JSON.stringify(await p.loadData())===JSON.stringify(before)&&p.settings.folder===before.folder}};await p.setSettings(before);return result;}}''',folder)
            record(label,bool(state['error']) and state['unchanged'])
        page.evaluate('async root=>{if(app.vault.getAbstractFileByPath(root))throw new Error("Test root exists");await app.vault.createFolder(root);}',prefix)
        hidden_path=prefix+'/.blocked/record.md'
        state=page.evaluate(f'''async path=>{{let error='';try{{await {PLUGIN}.store.port.write(path,'# Hidden write fixture',null);}}catch(e){{error=e.message;}}return {{error,exists:await app.vault.adapter.exists(path)}};}}''',hidden_path)
        record('Storage rejects a hidden target before committing a file',bool(state['error']) and not state['exists'])
        state=page.evaluate(r'''async root=>{
          const p=app.plugins.plugins['decision-review'],upper=root+'/Existing.md',lower=root+'/existing.md',original='# Preserve unrelated content\nCase collision fixture';
          await app.vault.create(upper,original);let error='';try{await p.store.port.write(lower,'# Must not overwrite',null);}catch(e){error=e.message;}
          return {error,unchanged:(await app.vault.adapter.read(upper))===original};
        }''',prefix)
        record('A case-variant create collision preserves the original file',bool(state['error']) and state['unchanged'])
        state=page.evaluate(r'''async root=>{
          const p=app.plugins.plugins['decision-review'],path=root+'/OutsideIndex.md',original='# Adapter-created unrelated content';
          await app.vault.adapter.write(path,original);let error='';try{await p.store.port.write(path,'# Must not overwrite',null);}catch(e){error=e.message;}
          return {error,unchanged:(await app.vault.adapter.read(path))===original};
        }''',prefix)
        record('A physical file created outside the vault cache is never overwritten',bool(state['error']) and state['unchanged'])
        fixture=page.evaluate(f'''async f=>{{
          const p={PLUGIN},folder=f.root+'/source';await p.setSettings({{folder}});
          const id='visibility-native-'+crypto.randomUUID(),at='2026-01-01T10:00:00.000Z';
          const d={{decisionReview:1,id,demo:false,createdAt:at,updatedAt:at,
            original:{{id:id+'-original',createdAt:at,explanation:'首次记录',record:{{title:'隐藏目录恢复验收',decisionDate:'2026-01-01',reason:'保留原始判断',expected:'恢复后仍然完整',references:[]}}}},
            revisions:[],reviews:[],reviewCorrections:[],supplements:[],schedules:[{{id:id+'-schedule',createdAt:at,status:'open',nextReviewDate:null}}],lessonLinks:[]}};
          await p.store.create(d);const entry=p.store.entries.find(e=>e.decision.id===id),source=entry.source,basename=entry.path.split('/').pop();
          const hidden=f.root+'/.legacy',recovered=f.root+'/恢复.v1-Café';await app.vault.adapter.mkdir(hidden);await app.vault.adapter.write(hidden+'/'+basename,source);await p.store.remove(entry);
          await p.setSettings(f.original);
          await app.vault.adapter.write('.obsidian/plugins/decision-review/data.json',JSON.stringify({{...f.original,folder:hidden}}));
          return {{id,source,basename,hidden,recovered}};
        }}''',{'root':prefix,'original':original})
        page.reload();page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
        state=page.evaluate(fr'''()=>({{issues:{PLUGIN}.store.issues,notices:[...document.querySelectorAll('.notice')].map(x=>x.textContent).join('\n')}})''')
        record('A legacy hidden-folder setting produces a persistent warning naming the original path',any(issue['path']==fixture['hidden'] for issue in state['issues']) and fixture['hidden'] in state['notices'] and '不可用' in state['notices'])
        record('Loading a legacy hidden-folder setting leaves its source bytes intact',(vault/fixture['hidden']/fixture['basename']).read_text()==fixture['source'])
        page.evaluate('async f=>{await app.vault.adapter.rename(f.hidden,f.recovered);}',fixture)
        page.reload();page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
        results['startupLayoutReadyBeforeOpen']=page.evaluate('app.workspace.layoutReady')
        page.evaluate(f'async f=>{{await {PLUGIN}.setSettings({{folder:f.recovered}});await {PLUGIN}.openView(f.id);}}',fixture)
        record('Opening the recovered workspace during startup waits for layout initialization',page.evaluate('app.workspace.layoutReady') and page.locator('.dr-root:visible').count()==1)
        state=page.evaluate(f'f=>{{const e={PLUGIN}.store.entries.find(e=>e.decision.id===f.id);return !!e&&!e.blocked&&e.source===f.source;}}',fixture)
        record('Moving the existing file into a visible Unicode folder restores the original decision',state)
        page.reload();page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
        state=page.evaluate(f'f=>{{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id);return p.settings.folder===f.recovered&&!!e&&!e.blocked&&e.source===f.source;}}',fixture)
        record('Visible folder names with dots and Unicode survive application reload',state)
        page.evaluate(f'f=>{{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id);p.supplement(e);}}',fixture)
        form=page.locator('.modal.dr-modal:visible').last
        form.get_by_label('今天想补充什么 *',exact=True).fill('恢复目录后继续追加')
        form.get_by_role('button',name='保存补充',exact=True).click();expect(page.locator('.modal.dr-modal:visible')).to_have_count(0)
        state=page.evaluate(f'f=>{{const d={PLUGIN}.store.entries.find(e=>e.decision.id===f.id).decision;return d.original.record.reason==="保留原始判断"&&d.supplements[0]?.text==="恢复目录后继续追加";}}',fixture)
        record('A recovered record remains editable while preserving the original text',state)
        moved=fixture['recovered'].split('/')[0]+'/.moved'
        source_before_move=page.evaluate(f'f=>{PLUGIN}.store.entries.find(e=>e.decision.id===f.id).source',fixture)
        page.evaluate(f'''async f=>{{await app.vault.rename(app.vault.getAbstractFileByPath(f.recovered),f.moved);const p={PLUGIN};await p.renameChain;await p.store.load();}}''',dict(fixture,moved=moved))
        page.evaluate(f'()=>{PLUGIN}.create(false)')
        form=page.locator('.modal.dr-modal:visible').last
        form.get_by_label('这次做了什么决定 *',exact=True).fill('不应保存到隐藏目录')
        form.get_by_label('主要理由 *',exact=True).fill('目录移动后要保留草稿')
        form.get_by_label('期待看到什么 *',exact=True).fill('停止不可读的写入')
        form.get_by_role('button',name='保存决定',exact=True).click()
        page.wait_for_function('!document.querySelector(".modal.dr-modal") || !!document.querySelector(".modal.dr-modal .dr-error:not([hidden])")')
        draft_preserved=bool(form.count()) and moved in form.locator('.dr-error').inner_text() and form.get_by_label('这次做了什么决定 *',exact=True).input_value()=='不应保存到隐藏目录'
        files=list((vault/moved).glob('*.md'))
        if form.count():
            page.keyboard.press('Escape');page.locator('.modal.dr-confirm:visible').get_by_role('button',name='放弃修改',exact=True).click()
        page.reload();page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
        blocked_after_reload=page.evaluate(f'f=>{PLUGIN}.store.issues.some(i=>i.path===f.moved)',{'moved':moved})
        record('Moving the active folder into a hidden location blocks new writes and preserves its error after reload',draft_preserved and len(files)==1 and blocked_after_reload)
        page.evaluate('async f=>{await app.vault.adapter.rename(f.moved,f.recovered);}',dict(fixture,moved=moved))
        page.reload();page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
        page.evaluate(f'async f=>{{await {PLUGIN}.setSettings({{folder:f.recovered}});}}',fixture)
        state=page.evaluate(f'f=>{{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id);return !p.store.issues.length&&!!e&&!e.blocked&&e.source===f.source;}}',dict(fixture,source=source_before_move))
        record('Restoring and selecting the visible folder clears read-only protection without rewriting the source',state)
    finally:
        form=page.locator('.modal.dr-modal:visible')
        if form.count():
            page.keyboard.press('Escape')
            confirm=page.locator('.modal.dr-confirm:visible')
            if confirm.count():confirm.get_by_role('button',name='放弃修改',exact=True).click()
        page.evaluate(f'async settings=>{{await {PLUGIN}.setSettings(settings);}}',original)
        target=vault/prefix
        assert target.parent==vault and target.name.startswith('visibility-test-')
        shutil.rmtree(target,ignore_errors=True)
        page.reload();page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
    record('Other decision, lesson and ordinary note files remain byte-for-byte unchanged',snapshot()==before)
    record('No uncaught native page errors occur during visibility and collision checks',not results['errors'])
    (OUT/('native-visibility-'+str(results['version'])+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2))
    browser.close()
if results['failed'] and '--expect-bugs' not in sys.argv:sys.exit(1)
