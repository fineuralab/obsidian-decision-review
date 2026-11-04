"""Native checks for imported enums, complete correction projections and lesson chronology."""
from pathlib import Path
import json
import shutil
import sys
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
paths=json.loads((ROOT/'output/test-paths.json').read_text())
vault=Path(paths['vault']).resolve()
assert vault.parent.name.startswith('decision-review-test-')
PLUGIN="app.plugins.plugins['decision-review']"
OUT=ROOT/'output/playwright';OUT.mkdir(parents=True,exist_ok=True)
results={'passed':[],'failed':[],'errors':[]}
prefix='import-test-'+uuid4().hex[:8]

with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9248',timeout=5000)
    page=browser.contexts[0].pages[0];page.set_default_timeout(5000)
    page.wait_for_function('typeof app!=="undefined"&&app.vault')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve()==vault
    trust=page.get_by_role('button',name='Trust author and enable plugins',exact=True)
    if trust.is_visible():trust.click()
    page.wait_for_function(f'{PLUGIN}?.store?.ready===true');page.keyboard.press('Escape')
    page.on('pageerror',lambda error:results['errors'].append(str(error)))
    page.set_viewport_size({'width':1280,'height':1050})
    page.evaluate(f'async()=>{{await {PLUGIN}.setLanguage("zh-CN");}}')
    original=page.evaluate(f'{PLUGIN}.settings');results['version']=page.evaluate(f'{PLUGIN}.manifest.version')
    def record(label,passed):
        results['passed' if passed else 'failed'].append(label)
        print(('PASS: ' if passed else 'FAIL: ')+label,flush=True)
    def snapshot():
        return page.evaluate('async()=>{return (await Promise.all(app.vault.getMarkdownFiles().map(async f=>[f.path,await app.vault.read(f)]))).sort((a,b)=>a[0].localeCompare(b[0]));}')
    def loaded():page.wait_for_function(f'typeof app!=="undefined"&&{PLUGIN}?.store?.ready===true')
    def show(id):page.evaluate(f'async id=>{{await {PLUGIN}.openView(id);}}',id)
    def seed(mode):
        return page.evaluate(f'''async mode=>{{
          const p={PLUGIN},id='import-native-'+crypto.randomUUID(),at='2026-01-01T00:00:00.000Z';
          const review={{id:id+'-review',createdAt:'2026-01-02T00:00:00.000Z',reviewDate:'2026-01-02',recordRevisionId:id+'-original',actual:'Original review wording',outcome:'partial',references:[],followup:'closed',nextReviewDate:null}};
          const d={{decisionReview:1,id,demo:false,createdAt:at,updatedAt:'2026-01-03T05:00:00.000Z',original:{{id:id+'-original',createdAt:at,explanation:'Original',record:{{title:'Import fixture '+mode,decisionDate:'2026-01-01',reason:'Preserve original input',expected:'Complete readable history',references:[]}}}},revisions:[],reviews:[review],reviewCorrections:[],supplements:[],schedules:[{{id:id+'-schedule',createdAt:at,status:'open',nextReviewDate:null}}],lessonLinks:[]}};
          if(mode!=='plain'){{const earlier={{id:id+'-correction-a',createdAt:mode==='offset'?'2026-01-03T10:00:00+08:00':'2026-01-03T05:00:00.000Z',reviewId:review.id,explanation:'Earlier explanation',corrected:{{...review,actual:'Earlier correction wording'}}}};const later={{id:id+'-correction-z',createdAt:'2026-01-03T05:00:00.000Z',reviewId:review.id,explanation:'Latest explanation',corrected:{{...review,actual:'Latest correction wording'}}}};d.reviewCorrections=[later,earlier];}}
          await p.store.create(d);const e=p.store.entries.find(e=>e.decision.id===id);return {{id,path:e.path,source:e.source,decision:e.decision}};
        }}''',mode)
    before=snapshot()
    try:
        page.evaluate(f'async folder=>{{await {PLUGIN}.setSettings({{folder}});}}',prefix)
        plain=seed('plain')
        for field,old,new in [('outcome','outcome: partial','outcome: [met]'),('followup','followup: closed','followup: [closed]')]:
            assert old in plain['source']
            damaged=plain['source'].replace(old,new,1)
            page.evaluate(f'''async f=>{{await app.vault.modify(app.vault.getAbstractFileByPath(f.path),f.source);await {PLUGIN}.store.load();await {PLUGIN}.openView(f.id);}}''',dict(plain,source=damaged))
            state=page.evaluate(f'''async f=>{{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id);return p.store.issues.some(i=>i.path===f.path)&&!!e?.blocked&&(await app.vault.read(app.vault.getAbstractFileByPath(f.path)))===f.source;}}''',dict(plain,source=damaged))
            record('A YAML list '+field+' is reported and retained as a read-only cached file',state)
            page.reload();loaded()
            state=page.evaluate(f'''async f=>{{const p={PLUGIN};return p.store.issues.some(i=>i.path===f.path)&&!p.store.entries.some(e=>e.decision.id===f.id)&&(await app.vault.read(app.vault.getAbstractFileByPath(f.path)))===f.source;}}''',dict(plain,source=damaged))
            record('A cold reload rejects malformed '+field+' without changing the source',state)
            page.evaluate(f'''async f=>{{await app.vault.modify(app.vault.getAbstractFileByPath(f.path),f.source);await {PLUGIN}.store.load();}}''',plain)
            state=page.evaluate(f'''f=>{{const p={PLUGIN},e=p.store.entries.find(e=>e.decision.id===f.id);return !!e&&!e.blocked&&!p.store.issues.some(i=>i.path===f.path)&&e.source===f.source&&e.decision.reviews[0].followup==='closed';}}''',plain)
            record('Repairing '+field+' restores the original closed decision',state)
        histories=[]
        for mode in ['offset','same-instant']:
            fixture=seed(mode);histories.append(fixture)
            body=fixture['source'].partition('\n---\n')[2]
            complete=all(body.count(wording)==1 for wording in ['Original review wording','Earlier correction wording','Latest correction wording'])
            record('Readable Markdown contains all correction versions exactly once ('+mode+')',complete)
            show(fixture['id'])
            expect(page.locator('.dr-root:visible .dr-latest')).to_contain_text('Latest correction wording')
            record('The latest review and original source metadata remain correct ('+mode+')',fixture['decision']['reviewCorrections'][0]['corrected']['actual']=='Latest correction wording' and len(fixture['decision']['reviewCorrections'])==2 and fixture['decision']['reviews'][0]['actual']=='Original review wording')
        page.evaluate(f'''async f=>{{
          const p={PLUGIN},folder=p.store.folder+'/经验';await app.vault.createFolder(folder);
          for(const [id,title,createdAt] of [['earlier','Earlier import lesson','2026-01-03T10:00:00+08:00'],['later','Later import lesson','2026-01-03T05:00:00.000Z']]){{
            const meta={{decisionReviewLesson:1,id:'import-lesson-'+id,demo:false,decisionId:f.id,reviewId:f.decision.reviews[0].id,reviewVersionId:f.decision.reviews[0].id,title,createdAt}};
            await app.vault.create(folder+'/'+id+'.md',['---',JSON.stringify(meta,null,2),'---','','# '+title,'','Preserve independent lesson text',''].join(String.fromCharCode(10)));
          }}
          await p.store.load();const v=await p.openView(f.id);v.show('lessons');
        }}''',histories[0])
        titles=page.locator('.dr-root:visible .dr-lesson-card h3').all_text_contents()
        record('Independent lessons with timezone offsets display in true chronological order',titles==['Later import lesson','Earlier import lesson'])
    finally:
        page.evaluate(f'async settings=>{{await {PLUGIN}.setSettings(settings);}}',original)
        target=vault/prefix;assert target.parent==vault and target.name.startswith('import-test-')
        shutil.rmtree(target,ignore_errors=True)
        page.reload();loaded()
    record('Unrelated decisions, lessons and ordinary notes remain byte-for-byte unchanged',snapshot()==before)
    record('No uncaught native page errors occur during import checks',not results['errors'])
    (OUT/('native-import-'+str(results['version'])+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2))
    browser.close()
if results['failed'] and '--expect-bugs' not in sys.argv:sys.exit(1)
