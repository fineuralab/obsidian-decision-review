"""Fault-injected folder relocation regressions in a guarded temporary Obsidian vault."""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
paths = json.loads((ROOT / 'output/test-paths.json').read_text())
vault = Path(paths['vault']).resolve()
assert vault.parent.name.startswith('decision-review-test-')
PLUGIN = "app.plugins.plugins['decision-review']"
OUT = ROOT / 'output/playwright'
OUT.mkdir(parents=True, exist_ok=True)
results = {'passed': [], 'failed': [], 'errors': []}

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://127.0.0.1:9248')
    page = browser.contexts[0].pages[0]
    page.set_default_timeout(5000)
    page.wait_for_function('typeof app !== "undefined" && app.vault')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve() == vault
    trust = page.get_by_role('button', name='Trust author and enable plugins', exact=True)
    if trust.is_visible(): trust.click()
    page.wait_for_function(f'{PLUGIN}?.store?.ready === true')
    page.on('pageerror', lambda error: results['errors'].append(str(error)))
    page.keyboard.press('Escape')
    page.set_viewport_size({'width':1280,'height':1050})
    page.evaluate(f'async () => {{await {PLUGIN}.setLanguage("zh-CN");}}')
    results['version'] = page.evaluate(f'{PLUGIN}.manifest.version')

    def record(label, passed):
        results['passed' if passed else 'failed'].append(label)
        print(('PASS: ' if passed else 'FAIL: ') + label, flush=True)

    def snapshot():
        return page.evaluate('async ()=>{const files=app.vault.getMarkdownFiles();return (await Promise.all(files.map(async f=>[f.path,await app.vault.read(f)]))).sort((a,b)=>a[0].localeCompare(b[0]));}')

    def settle():
        page.evaluate(f'async ()=>{{const p={PLUGIN};await p.settingsChain;if(p.renameChain)await p.renameChain;await p.store.load();}}')

    def setup(mode):
        return page.evaluate(f'''async mode=>{{
          const p={PLUGIN},original=p.settings.folder,prefix='迁移验收-'+crypto.randomUUID().slice(0,8);
          const roots=[prefix+'-原目录',prefix+'-中转',prefix+'-最终'];
          for(const root of roots)if(app.vault.getAbstractFileByPath(root))throw new Error('Fixture path exists');
          await p.setSettings({{folder:roots[0]}});await app.vault.createFolder(roots[0]);await app.vault.create(roots[0]+'/内部资料.md','# 测试专用');
          const id='relocation-native-'+crypto.randomUUID(),at='2026-01-01T10:00:00.000Z',reviewAt='2026-01-10T10:00:00.000Z';
          const d={{decisionReview:1,id,demo:false,createdAt:at,updatedAt:reviewAt,
            original:{{id:id+'-original',createdAt:at,explanation:'首次记录',record:{{title:'目录迁移验收',decisionDate:'2026-01-01',reason:'保留原始判断',expected:'改名不丢失访问入口',references:[{{kind:'file',path:roots[0]+'/内部资料.md'}}]}}}},
            revisions:[],reviews:[{{id:id+'-review',createdAt:reviewAt,reviewDate:'2026-01-10',recordRevisionId:id+'-original',actual:'最初回访事实',outcome:'partial',lesson:'逐项确认文件可读',references:[],followup:'unscheduled',nextReviewDate:null}}],reviewCorrections:[],supplements:[],schedules:[{{id:id+'-schedule',createdAt:at,status:'open',nextReviewDate:null}}],lessonLinks:[]}};
          await p.store.create(d);await p.store.saveLesson(p.store.entries[0],id+'-review','保留经验','经验正文原文');
          const lesson=p.store.lessons[0],entry=p.store.entries[0];
          window.__relocationAudit={{p,original,roots,id,saveData:p.saveData,port:p.store.port,write:p.store.port.write,mode,paused:false,source:entry.source}};
          if(mode==='double')p.saveData=async function(data){{const s=window.__relocationAudit;if(data.folder===roots[1]&&!s.paused){{s.paused=true;await new Promise(resolve=>s.release=resolve);}}return s.saveData.call(this,data);}};
          if(mode==='settings-failure'||mode==='settings-always-fail')p.saveData=async function(data){{const s=window.__relocationAudit;if(data.folder===roots[1]&&(mode==='settings-always-fail'||!s.paused)){{s.paused=true;throw new Error('Injected relocation settings failure');}}return s.saveData.call(this,data);}};
          if(mode==='write-gate')p.store.port.write=async function(path,...args){{const s=window.__relocationAudit;if(path===roots[1]+'/决策-'+id+'.md'&&!s.paused){{s.paused=true;await new Promise(resolve=>s.release=resolve);}}return s.write.call(this,path,...args);}};
          return {{id,roots,lessonId:lesson.meta.id}};
        }}''', mode)

    def state(fixture, final_index):
        return page.evaluate(f'''async f=>{{
          const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id),lesson=p.store.findLesson(f.id,f.id+'-review',false),saved=await p.loadData();
          return {{folder:p.settings.folder,storeFolder:p.store.folder,savedFolder:saved.folder,count:p.store.entries.length,decision:e?.decision,blocked:!!e?.blocked,lesson:lesson?{{path:lesson.path,meta:lesson.meta,content:lesson.content}}:null,final:f.roots[{final_index}]}};
        }}''', fixture)

    def clean():
        page.evaluate(f'''async ()=>{{
          const s=window.__relocationAudit;if(!s)return;const p=s.p;
          p.saveData=s.saveData;s.port.write=s.write;s.release?.();await p.settingsChain;if(p.renameChain)await p.renameChain;
          await p.setSettings({{folder:s.original}});
          for(const file of app.vault.getMarkdownFiles().filter(f=>s.roots.some(root=>f.path.startsWith(root+'/'))))await app.vault.trash(file,false);
          delete window.__relocationAudit;
        }}''')

    def cancel_form():
        form=page.locator('.modal.dr-modal:visible')
        if form.count():
            page.keyboard.press('Escape')
            confirm=page.locator('.modal.dr-confirm:visible')
            if confirm.count():confirm.get_by_role('button',name='放弃修改',exact=True).click()
        expect(page.locator('.modal.dr-modal:visible')).to_have_count(0)

    before=snapshot()
    fixture=setup('double')
    try:
        page.evaluate(f'()=>{PLUGIN}.create(false)')
        form=page.locator('.modal.dr-modal:visible').last
        form.get_by_label('这次做了什么决定 *',exact=True).fill('迁移期间保留的草稿')
        form.get_by_label('主要理由 *',exact=True).fill('不应重建已经迁走的旧目录')
        form.get_by_label('期待看到什么 *',exact=True).fill('阻止旧上下文保存，并保留输入')
        page.evaluate('async f=>{await app.vault.rename(app.vault.getAbstractFileByPath(f.roots[0]),f.roots[1]);}',fixture)
        page.wait_for_function('!!window.__relocationAudit.release')
        page.evaluate('async f=>{await app.vault.rename(app.vault.getAbstractFileByPath(f.roots[1]),f.roots[2]);}',fixture)
        form.get_by_role('button',name='保存决定',exact=True).click()
        page.wait_for_function('!document.querySelector(".modal.dr-modal") || !!document.querySelector(".modal.dr-modal .dr-error:not([hidden])")')
        no_old_write=page.evaluate('f=>!app.vault.getMarkdownFiles().some(x=>x.path.startsWith(f.roots[0]+"/"))',fixture)
        record('Saving an old draft during a root move preserves input and never recreates the old folder',bool(form.count()) and no_old_write and '目录' in form.locator('.dr-error').inner_text() and form.get_by_label('这次做了什么决定 *',exact=True).input_value()=='迁移期间保留的草稿')
        cancel_form()
        page.evaluate('window.__relocationAudit.release()');settle()
        value=state(fixture,2)
        record('Two root renames during delayed settings I/O retain the final runtime and persisted folder',value['folder']==value['storeFolder']==value['savedFolder']==value['final'] and value['count']==1 and not value['blocked'])
        d=value.get('decision') or {};lesson=value.get('lesson') or {}
        record('Internal references and independent lesson identities follow the final root',d.get('original',{}).get('record',{}).get('references',[{}])[0].get('path')==value['final']+'/内部资料.md' and d.get('lessonLinks',[{}])[0].get('path','').startswith(value['final']+'/') and lesson.get('meta',{}).get('id')==fixture['lessonId'] and '经验正文原文' in lesson.get('content',''))
        # The window-only fault hooks disappear on reload; restore them before reloading.
        original=page.evaluate('window.__relocationAudit.original')
        page.evaluate('()=>{const s=window.__relocationAudit;s.p.saveData=s.saveData;s.port.write=s.write;}')
        page.reload();page.wait_for_function(f'typeof app !== "undefined" && {PLUGIN}?.store?.ready===true')
        value=state(fixture,2)
        record('An application reload finds the relocated original, complete review and lesson',value['folder']==value['final'] and value['count']==1 and (value.get('decision') or {}).get('reviews',[{}])[0].get('actual')=='最初回访事实' and bool(value.get('lesson')))
        page.evaluate(f'f=>{{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id);if(e)p.supplement(e);}}',fixture)
        form=page.locator('.modal.dr-modal:visible').last
        if form.count():
            form.get_by_label('今天想补充什么 *',exact=True).fill('迁移完成后可以正常追加')
            form.get_by_role('button',name='保存补充',exact=True).click();expect(page.locator('.modal.dr-modal:visible')).to_have_count(0)
        value=state(fixture,2)
        record('New forms can save normally once folder relocation finishes',(value.get('decision') or {}).get('supplements',[{}])[0].get('text')=='迁移完成后可以正常追加')
    finally:
        cancel_form()
        # Rebuild cleanup context if the application reload cleared the fault hooks.
        page.evaluate(f'''f=>{{if(!window.__relocationAudit){{const p={PLUGIN};window.__relocationAudit={{p,original:f.original,roots:f.roots,saveData:p.saveData,port:p.store.port,write:p.store.port.write}};}}}}''',{'roots':fixture['roots'],'original':original if 'original' in locals() else page.evaluate('window.__relocationAudit.original')})
        clean()

    fixture=setup('settings-failure')
    try:
        page.evaluate('async f=>{await app.vault.rename(app.vault.getAbstractFileByPath(f.roots[0]),f.roots[1]);}',fixture);settle()
        value=state(fixture,1)
        record('A transient settings write failure still follows the moved source and retries persistence',value['folder']==value['savedFolder']==value['final'] and value['count']==1 and not value['blocked'])
        record('Settings failure recovery preserves the original review and independent lesson',(value.get('decision') or {}).get('reviews',[{}])[0].get('actual')=='最初回访事实' and (value.get('lesson') or {}).get('meta',{}).get('id')==fixture['lessonId'])
    finally: clean()

    fixture=setup('settings-always-fail')
    try:
        page.evaluate('async f=>{await app.vault.rename(app.vault.getAbstractFileByPath(f.roots[0]),f.roots[1]);}',fixture);settle()
        value=state(fixture,1)
        notice=page.locator('.notice').filter(has_text='重新保存目录')
        record('Persistent settings I/O failure keeps data readable and explicitly requests saving the folder again',value['folder']==value['storeFolder']==value['final'] and value['savedFolder']==fixture['roots'][0] and value['count']==1 and notice.count()>0 and fixture['roots'][1] in notice.last.inner_text())
    finally: clean()

    fixture=setup('write-gate')
    try:
        page.evaluate('async f=>{await app.vault.rename(app.vault.getAbstractFileByPath(f.roots[0]),f.roots[1]);}',fixture)
        page.wait_for_function('!!window.__relocationAudit.release')
        page.evaluate('async f=>{await app.vault.rename(app.vault.getAbstractFileByPath(f.roots[1]),f.roots[2]);}',fixture)
        page.evaluate('window.__relocationAudit.release()');settle()
        value=state(fixture,2);d=value.get('decision') or {}
        record('A second root move during reference writing retains a readable final source',value['folder']==value['savedFolder']==value['final'] and value['count']==1 and not value['blocked'])
        record('A rename interrupted by another move reapplies all original path mappings',d.get('original',{}).get('record',{}).get('references',[{}])[0].get('path')==value['final']+'/内部资料.md' and d.get('lessonLinks',[{}])[0].get('path','').startswith(value['final']+'/'))
    finally: clean()
    fixture=setup('double')
    try:
        page.evaluate('async f=>{await app.vault.rename(app.vault.getAbstractFileByPath(f.roots[0]),f.roots[1]);}',fixture)
        page.wait_for_function('!!window.__relocationAudit.release')
        page.evaluate('async f=>{await app.vault.rename(app.vault.getAbstractFileByPath(f.roots[1]),f.roots[2]);const s=window.__relocationAudit;s.choice=s.p.setSettings({folder:f.roots[0]+"-主动选择"});}',fixture)
        page.evaluate('window.__relocationAudit.release()');settle()
        value=state(fixture,2)
        source_exists=page.evaluate('f=>!!app.vault.getAbstractFileByPath(f.roots[2]+"/决策-"+f.id+".md")',fixture)
        record('An explicit folder choice queued during a move takes precedence over automatic following',value['folder']==value['savedFolder']==fixture['roots'][0]+'-主动选择' and source_exists)
    finally: clean()
    record('Unrelated vault notes stay byte-for-byte unchanged throughout relocation checks',snapshot()==before)
    record('No uncaught native page errors occur during relocation checks',not results['errors'])
    (OUT/('native-relocation-'+str(results['version'])+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2))
    browser.close()
if results['failed'] and '--expect-bugs' not in sys.argv: sys.exit(1)
