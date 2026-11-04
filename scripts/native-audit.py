"""Regression audit in the guarded temporary vault; can run against 0.1.0 to record failures."""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
paths = json.loads((ROOT / 'output/test-paths.json').read_text())
vault = Path(paths['vault']).resolve()
assert vault.parent.name.startswith('decision-review-test-')
OUT = ROOT / 'output/playwright'
OUT.mkdir(parents=True, exist_ok=True)
PLUGIN = "app.plugins.plugins['decision-review']"
results = {'passed': [], 'failed': []}

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://127.0.0.1:9248')
    page = browser.contexts[0].pages[0]
    page.set_default_timeout(2500)
    page.wait_for_function('typeof app !== "undefined" && app.vault')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve() == vault
    trust = page.get_by_role('button', name='Trust author and enable plugins', exact=True)
    if trust.is_visible(): trust.click()
    page.keyboard.press('Escape')
    page.wait_for_function(f'{PLUGIN}?.store?.ready === true')
    if '--reload' in sys.argv:
        previous_version = page.evaluate(f'{PLUGIN}.manifest.version')
        previous_sources = page.evaluate(f'{PLUGIN}.store.entries.map(e=>[e.path,e.source]).sort()')
        previous_lessons = page.evaluate(f'{PLUGIN}.store.lessons.map(e=>[e.path,e.source]).sort()')
        page.reload()
        page.wait_for_function(f'typeof app !== "undefined" && {PLUGIN}?.store?.ready === true')
        assert page.evaluate(f'{PLUGIN}.store.entries.map(e=>[e.path,e.source]).sort()') == previous_sources
        assert page.evaluate(f'{PLUGIN}.store.lessons.map(e=>[e.path,e.source]).sort()') == previous_lessons
        results['fromVersion'] = previous_version
        results['passed'].append('Reload after upgrade preserves all existing decision and lesson source files')
    page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("zh-CN"); }}')
    results['version'] = page.evaluate(f'{PLUGIN}.manifest.version')
    page.set_viewport_size({'width':1280,'height':1050})
    view = page.locator('.dr-root:visible')
    def modal(): return page.locator('.modal.dr-modal:visible').last
    def record_result(label, success):
        results['passed' if success else 'failed'].append(label)
        print(('PASS: ' if success else 'FAIL: ') + label, flush=True)
    def discard_dialogs():
        for _ in range(4):
            prompt = page.locator('.prompt:visible')
            if prompt.count():
                page.keyboard.press('Escape')
                expect(prompt).to_have_count(0)
                continue
            if not page.locator('.modal:visible').count(): break
            confirm = page.locator('.modal.dr-confirm:visible')
            if confirm.count(): confirm.get_by_role('button', name='放弃修改', exact=True).click()
            else:
                page.keyboard.press('Escape')
                page.wait_for_function('!document.querySelector(".modal.dr-modal") || !!document.querySelector(".modal.dr-confirm")')
    def show(id): page.evaluate(f'async id => {{ await {PLUGIN}.openView(id); }}', id)

    page.evaluate(f'''async () => {{
      const plugin={PLUGIN};
      for(const entry of [...plugin.store.entries].filter(e=>e.decision.id.startsWith('audit-native-'))) await plugin.store.remove(entry);
      for(const lesson of [...plugin.store.lessons].filter(e=>e.meta.decisionId.startsWith('audit-native-'))) {{
        const file=app.vault.getAbstractFileByPath(lesson.path);if(file) await app.vault.trash(file,false);
      }}
      await plugin.store.load();
      for(const path of ['audit-corrected.md','audit-supplement.md','audit-busy.md']) if(!app.vault.getAbstractFileByPath(path)) await app.vault.create(path,'# Audit fixture');
      function make(id,title,refs=[]) {{
        const at='2026-01-01T10:00:00.000Z';
        return {{decisionReview:1,id,demo:false,createdAt:at,updatedAt:at,
          original:{{id:id+'-original',createdAt:at,explanation:'Original',record:{{title,decisionDate:'2026-01-01',reason:'Review the actual workflow',expected:'The right decision is selected',references:refs}}}},
          revisions:[],reviews:[],reviewCorrections:[],supplements:[],schedules:[{{id:id+'-schedule',createdAt:at,status:'open',nextReviewDate:null}}],lessonLinks:[]}};
      }}
      const command=make('audit-native-command','Audit source decision');
      const review={{id:'audit-native-review',createdAt:'2026-01-10T10:00:00.000Z',reviewDate:'2026-01-10',recordRevisionId:command.original.id,actual:'Observed once',outcome:'partial',lesson:'Keep one habit',references:[],followup:'unscheduled',nextReviewDate:null}};
      command.reviews=[review];command.reviewCorrections=[{{id:'audit-native-correction',createdAt:'2026-01-11T10:00:00.000Z',reviewId:review.id,explanation:'Link the evidence',corrected:{{...review,references:[{{kind:'file',path:'audit-corrected.md'}}]}}}}];
      command.supplements=[{{id:'audit-native-supplement',createdAt:'2026-01-12T10:00:00.000Z',text:'Additional context',references:[{{kind:'file',path:'audit-supplement.md'}}]}}];
      command.updatedAt='2026-01-12T10:00:00.000Z';
      await plugin.store.create(command);
      await plugin.store.create(make('audit-native-busy','Audit busy form',[{{kind:'file',path:'audit-busy.md'}}]));
      await plugin.store.create(make('audit-native-other','Unrelated audit decision'));
      const entry=plugin.store.entries.find(e=>e.decision.id===command.id);
      await plugin.store.saveLesson(entry,review.id,'MetaOnlyNeedle','Keep one habit');
    }}''')

    for path, label in [('audit-corrected.md','Current-note review command recognizes corrected evidence'),('audit-supplement.md','Current-note review command recognizes supplementary references')]:
        page.evaluate(f'async path => {{ await {PLUGIN}.openFile(path); }}', path)
        page.evaluate('app.commands.executeCommandById("decision-review:review-decision")')
        try:
            expect(modal().locator('.modal-title')).to_have_text('做一次回访')
            expect(modal().locator('.dr-form-description')).to_have_text('Audit source decision')
            record_result(label, True)
        except Exception:
            record_result(label, False)
        finally: discard_dialogs()

    show('audit-native-command')
    view.get_by_role('searchbox').fill('MetaOnlyNeedle')
    record_result('All-decisions search finds the associated lesson title', view.locator('.dr-decision-item').count() == 1)
    view.locator('.dr-tab').nth(2).click()
    view.get_by_role('searchbox').fill('Audit source decision')
    record_result('Lesson search finds the source decision title', view.locator('.dr-lesson-card').count() == 1)

    show('audit-native-busy')
    page.evaluate(f'() => {{ const p={PLUGIN};p.correct(p.store.entries.find(e=>e.decision.id==="audit-native-busy")); }}')
    modal().get_by_label('主要理由 *',exact=True).fill('Unsaved busy input')
    modal().get_by_label('更正原因 *',exact=True).fill('Test saving with a reference rename')
    modal().locator('.dr-optional > summary').click()
    page.evaluate(f'''() => {{
      const store={PLUGIN}.store,port=store.port;window.__auditRestore={{port,write:port.write}};
      const path=store.entries.find(e=>e.decision.id==='audit-native-busy').path;
      let paused=false;
      port.write=async function(target,...args) {{
        if(target===path&&!paused){{paused=true;await new Promise(resolve=>window.__auditRelease=resolve);throw new Error('Injected delayed audit failure');}}
        return window.__auditRestore.write.call(this,target,...args);
      }};
    }}''')
    try:
        modal().get_by_role('button',name='保存更正',exact=True).click()
        page.wait_for_function('typeof window.__auditRelease === "function"')
        page.evaluate('async () => { if(app.vault.getAbstractFileByPath("audit-busy-renamed.md")) await app.vault.trash(app.vault.getAbstractFileByPath("audit-busy-renamed.md"),false); await app.vault.rename(app.vault.getAbstractFileByPath("audit-busy.md"),"audit-busy-renamed.md"); }')
        remove=modal().get_by_role('button',name='移除 audit-busy-renamed.md',exact=True)
        record_result('Reference controls recreated during saving remain disabled',remove.is_disabled())
        page.evaluate('() => { window.__auditRestore.port.write=window.__auditRestore.write;window.__auditRelease(); }')
        expect(modal().locator('.dr-error')).to_contain_text('Injected delayed audit failure')
        expect(remove).to_be_enabled()
        expect(modal().get_by_label('主要理由 *',exact=True)).to_have_value('Unsaved busy input')
        record_result('Failed save restores the recreated controls and retains the draft',True)
    finally:
        page.evaluate('() => { if(window.__auditRestore)window.__auditRestore.port.write=window.__auditRestore.write;window.__auditRelease?.();delete window.__auditRestore;delete window.__auditRelease; }')
        discard_dialogs()

    show('audit-native-command')
    page.evaluate(f'''async () => {{
      const p={PLUGIN},lesson=p.store.findLesson('audit-native-command','audit-native-review',false);
      await app.vault.trash(app.vault.getAbstractFileByPath(lesson.path),false);await p.store.load();
    }}''')
    view.get_by_role('button',name='另存一份经验',exact=True).first.click()
    modal().get_by_label('经验笔记标题 *',exact=True).fill('Audit recovered copy')
    modal().get_by_label('下次可以怎么做 *',exact=True).fill('Keep the first successfully written copy')
    page.evaluate(f'''() => {{
      const port={PLUGIN}.store.port,path={PLUGIN}.store.entries.find(e=>e.decision.id==='audit-native-command').path;
      const original=port.write;window.__auditCopyRestore={{port,write:original}};let failed=false;
      port.write=async function(target,...args){{if(target===path&&!failed){{failed=true;throw new Error('Injected index failure');}}return original.call(this,target,...args);}};
    }}''')
    try:
        modal().get_by_role('button',name='保存经验笔记',exact=True).click()
        expect(modal().locator('.dr-error')).to_contain_text('经验已保存到')
        written=page.evaluate(f'{PLUGIN}.store.findLesson("audit-native-command","audit-native-review",false).path')
        modal().get_by_role('button',name='保存经验笔记',exact=True).click()
        page.wait_for_function('path=>app.workspace.activeLeaf?.view?.file?.path===path',arg=written)
        matches=page.evaluate(f'{PLUGIN}.store.lessons.filter(e=>e.meta.decisionId==="audit-native-command"&&e.meta.reviewId==="audit-native-review").map(e=>e.path)')
        record_result('Retrying a lesson copy in the actual form keeps exactly one written copy',matches==[written])
    finally:
        page.evaluate('() => { if(window.__auditCopyRestore)window.__auditCopyRestore.port.write=window.__auditCopyRestore.write;delete window.__auditCopyRestore; }')
        discard_dialogs()

    page.evaluate(f'''async () => {{
      const p={PLUGIN},base=JSON.parse(JSON.stringify(p.store.entries.find(e=>e.decision.id==='audit-native-command').decision));
      base.id='audit-native-dates';base.createdAt='2026-01-01T10:00:00.000Z';base.updatedAt='2026-01-10T10:00:00.000Z';
      base.original.id='audit-native-dates-original';base.original.createdAt=base.createdAt;base.original.record.title='Historical review date audit';
      base.revisions=[];base.reviewCorrections=[];base.supplements=[];base.lessonLinks=[];
      base.schedules=[{{id:'audit-native-dates-schedule',createdAt:base.createdAt,status:'open',nextReviewDate:'2026-01-20'}}];
      base.reviews=[{{id:'audit-native-dates-review',createdAt:base.updatedAt,reviewDate:'2026-01-10',recordRevisionId:base.original.id,actual:'Interim results',outcome:'partial',references:[],followup:'scheduled',nextReviewDate:'2026-01-20'}}];
      await p.store.create(base);await p.openView(base.id);
    }}''')
    history=view.locator('.dr-history-item').first
    if not history.evaluate('(node)=>node.open'):
        history.locator(':scope > summary').click()
    view.get_by_role('button',name='更正回访',exact=True).click()
    modal().get_by_label('回访日期 *',exact=True).fill('2026-01-25')
    modal().get_by_label('更正原因 *',exact=True).fill('The recorded occurrence date was wrong')
    modal().get_by_role('button',name='保存更正',exact=True).click()
    expect(page.locator('.modal.dr-modal:visible')).to_have_count(0)
    corrected=page.evaluate(f'{PLUGIN}.store.entries.find(e=>e.decision.id==="audit-native-dates").decision')
    record_result('Historical review date correction saves while the original schedule remains unchanged',corrected['reviewCorrections'][0]['corrected']['reviewDate']=='2026-01-25' and corrected['reviews'][0]['nextReviewDate']=='2026-01-20' and corrected['schedules'][0]['nextReviewDate']=='2026-01-20')

    original_folder=page.evaluate(f'{PLUGIN}.settings.folder')
    page.evaluate('async () => { if(!app.vault.getAbstractFileByPath("audit-folder-blocker.md")) await app.vault.create("audit-folder-blocker.md","# Not a folder"); }')
    try:
        error=page.evaluate(f'async () => {{ try {{ await {PLUGIN}.setSettings({{folder:"audit-folder-blocker.md"}});return ""; }}catch(e){{return e.message;}} }}')
        expect(view.locator('.dr-issues')).to_contain_text('被同名文件占用')
        record_result('A failed folder change displays its error and clears obsolete decision rows',bool(error) and view.locator('.dr-decision-item').count()==0)
    finally:
        page.evaluate(f'async folder => {{ await {PLUGIN}.setSettings({{folder}});await app.vault.trash(app.vault.getAbstractFileByPath("audit-folder-blocker.md"),false); }}',original_folder)
    filename='audit-native-'+str(results['version'])+'.json'
    (OUT/filename).write_text(json.dumps(results,ensure_ascii=False,indent=2))
    browser.close()
if results['failed']: sys.exit(1)
