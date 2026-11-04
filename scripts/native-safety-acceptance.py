"""Guarded native regressions for generated-file readability and damaged ownership metadata."""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
paths = json.loads((ROOT / 'output/test-paths.json').read_text())
vault = Path(paths['vault']).resolve()
assert vault.parent.name.startswith('decision-review-test-')
PLUGIN = "app.plugins.plugins['decision-review']"
MARKER = '<!-- decision-review:notes -->'
OUT = ROOT / 'output/playwright'
OUT.mkdir(parents=True, exist_ok=True)
results = {'passed': [], 'failed': [], 'errors': []}

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://127.0.0.1:9248')
    page = browser.contexts[0].pages[0]
    page.set_default_timeout(4000)
    page.on('pageerror', lambda error: results['errors'].append(str(error)))
    page.wait_for_function('typeof app !== "undefined" && app.vault')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve() == vault
    trust = page.get_by_role('button', name='Trust author and enable plugins', exact=True)
    if trust.is_visible(): trust.click()
    page.wait_for_function(f'{PLUGIN}?.store?.ready === true')
    page.keyboard.press('Escape')
    page.evaluate(f'async () => {{ await {PLUGIN}.setLanguage("zh-CN"); }}')
    page.set_viewport_size({'width':1280,'height':1050})
    results['version'] = page.evaluate(f'{PLUGIN}.manifest.version')

    def record(label, passed):
        results['passed' if passed else 'failed'].append(label)
        print(('PASS: ' if passed else 'FAIL: ') + label, flush=True)

    def snapshot():
        return page.evaluate(f'''async () => {{
          const p={PLUGIN};await p.store.load();
          return {{decisions:p.store.entries.filter(e=>!e.decision.id.startsWith('safety-native-')).map(e=>[e.path,e.source]).sort(),lessons:p.store.lessons.map(e=>[e.path,e.source]).sort()}};
        }}''')

    def show(id):
        page.evaluate(f'async id => {{ await {PLUGIN}.openView(id); }}', id)

    before = snapshot()
    fixture = page.evaluate(f'''async () => {{
      const p={PLUGIN};
      for(const e of [...p.store.entries].filter(e=>e.decision.id.startsWith('safety-native-'))) await p.store.remove(e);
      const id='safety-native-record',at='2026-01-01T10:00:00.000Z',reviewAt='2026-01-10T10:00:00.000Z';
      const d={{decisionReview:1,id,demo:false,createdAt:at,updatedAt:reviewAt,
        original:{{id:id+'-original',createdAt:at,explanation:'首次记录',record:{{title:'安全复查决定',decisionDate:'2026-01-01',reason:'原始判断',expected:'记录保持可读',references:[]}}}},
        revisions:[],reviews:[{{id:id+'-review',createdAt:reviewAt,reviewDate:'2026-01-10',recordRevisionId:id+'-original',actual:'最初回访事实',outcome:'partial',lesson:'下次逐项验证',references:[],followup:'unscheduled',nextReviewDate:null}}],reviewCorrections:[],supplements:[],schedules:[{{id:id+'-schedule',createdAt:at,status:'open',nextReviewDate:null}}],lessonLinks:[]}};
      await p.store.create(d);const e=p.store.entries.find(e=>e.decision.id===id);
      return {{id,path:e.path,source:e.source}};
    }}''')
    try:
        show(fixture['id'])
        page.evaluate(f'''id => {{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===id);p.review(e,e.decision.original.id,e.decision.reviews[0].id);}}''',fixture['id'])
        form=page.locator('.modal.dr-modal:visible').last
        explanation='说明中保留一个标记示例\n'+MARKER+'\n以及后续文字'
        form.get_by_label('实际发生了什么 *',exact=True).fill('更正后的实际事实')
        form.get_by_label('更正原因 *',exact=True).fill(explanation)
        form.get_by_role('button',name='保存更正',exact=True).click()
        page.wait_for_function('!document.querySelector(".modal.dr-modal") || !!document.querySelector(".modal.dr-modal .dr-error:not([hidden])")')
        page.evaluate(f'async () => {{await {PLUGIN}.store.load();}}')
        state=page.evaluate(f'''id => {{const e={PLUGIN}.store.entries.find(e=>e.decision.id===id);return {{blocked:!!e?.blocked,correction:e?.decision.reviewCorrections[0]}};}}''',fixture['id'])
        record('A native multiline correction containing the notes marker saves as a readable record',not form.count() and not state['blocked'] and state.get('correction',{}).get('explanation')==explanation)
        if form.count():
            page.keyboard.press('Escape')
            page.locator('.modal.dr-confirm:visible').get_by_role('button',name='放弃修改',exact=True).click()
        page.reload()
        page.wait_for_function(f'typeof app !== "undefined" && {PLUGIN}?.store?.ready === true')
        state=page.evaluate(f'''id => {{const e={PLUGIN}.store.entries.find(e=>e.decision.id===id);return !!e&&!e.blocked&&e.decision.reviews[0].actual==='最初回访事实'&&e.decision.reviewCorrections[0]?.corrected.actual==='更正后的实际事实';}}''',fixture['id'])
        record('An application reload restores both original and corrected review text',state)
        # Repair the deliberately broken baseline fixture so the next check stays independent.
        page.evaluate('async f=>{await app.vault.modify(app.vault.getAbstractFileByPath(f.path),f.source);}',fixture)
        page.evaluate(f'async () => {{await {PLUGIN}.store.load();}}')
        renamed=page.evaluate(f'''async f=>{{
          const p={PLUGIN},path=p.store.folder+'/用户已改名的重要决定.md';
          if(app.vault.getAbstractFileByPath(path)) throw new Error('Safety fixture path is already occupied');
          await app.vault.rename(app.vault.getAbstractFileByPath(f.path),path);await p.store.load();
          const source=await app.vault.read(app.vault.getAbstractFileByPath(path));return {{...f,path,source}};
        }}''',fixture)
        fixture=renamed
        show(fixture['id'])
        page.evaluate(fr'''async f=>{{await app.vault.modify(app.vault.getAbstractFileByPath(f.path),f.source.replace(/^decisionReview: 1\r?\n/m,''));await {PLUGIN}.store.load();}}''',fixture)
        state=page.evaluate(f'''f=>{{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id);return p.store.issues.some(i=>i.path===f.path)&&!!e?.blocked;}}''',fixture)
        record('A renamed source missing its type property remains visible as blocked with a file error',state)
        if state:
            expect(page.locator('.dr-root:visible .dr-issues')).to_contain_text('decisionReview')
            expect(page.locator('.dr-root:visible').get_by_role('button',name='做一次回访',exact=True)).to_be_disabled()
        page.reload()
        page.wait_for_function(f'typeof app !== "undefined" && {PLUGIN}?.store?.ready === true')
        state=page.evaluate(f'f=>{PLUGIN}.store.issues.some(i=>i.path===f.path)',fixture)
        record('A fresh session reports the damaged renamed file without needing a cached snapshot',state)
        page.evaluate(f'''async f=>{{await app.vault.modify(app.vault.getAbstractFileByPath(f.path),f.source);await {PLUGIN}.store.load();}}''',fixture)
        show(fixture['id'])
        state=page.evaluate(f'''f=>{{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id);return !!e&&!e.blocked&&!p.store.issues.some(i=>i.path===f.path);}}''',fixture)
        record('Repairing the source restores its complete history and normal review actions',state)
        expect(page.locator('.dr-root:visible').get_by_role('button',name='做一次回访',exact=True)).to_be_enabled()
    finally:
        # Restore the source before removing the one test-owned record through the store.
        page.evaluate(f'''async f=>{{const file=app.vault.getAbstractFileByPath(f.path);if(file)await app.vault.modify(file,f.source);const p={PLUGIN};await p.store.load();const e=p.store.entries.find(e=>e.decision.id===f.id);if(e)await p.store.remove(e);}}''',fixture)
    record('Existing decision and lesson files stay byte-for-byte unchanged',snapshot()==before)
    record('No uncaught native page errors occur during the safety regression',not results['errors'])
    (OUT/('native-safety-'+str(results['version'])+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2))
    browser.close()
if results['failed'] and '--expect-bugs' not in sys.argv: sys.exit(1)
