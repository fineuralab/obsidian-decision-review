"""Verify source anchors, keyboard menu and background workspace restoration."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
paths=json.loads((ROOT/'output/test-paths.json').read_text())
expected=Path(paths['vault']).resolve()
assert expected.parent.name.startswith('decision-review-test-')
PLUGIN="app.plugins.plugins['decision-review']"
checks=[]
with sync_playwright() as p:
    browser=p.chromium.connect_over_cdp('http://127.0.0.1:9248')
    page=browser.contexts[0].pages[0]
    page.set_default_timeout(10000)
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve()==expected
    page.set_viewport_size({'width':1280,'height':750})
    entry=page.evaluate(f'{PLUGIN}.store.entries.find(e=>!e.decision.demo)')
    assert entry and entry['decision']['reviews']
    anchors=page.evaluate('''path => Object.keys(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(path))?.blocks||{})''',entry['path'])
    assert all('review-'+r['id'] in anchors for r in entry['decision']['reviews'])
    checks.append('Every generated source-review link points to a block indexed by Obsidian')
    page.evaluate(f'async () => {{ await {PLUGIN}.openView({json.dumps(entry["decision"]["id"])}); }}')
    view=page.locator('.dr-root:visible')
    more=view.get_by_role('button',name='更多决定操作',exact=True)
    more.focus()
    page.keyboard.press('Enter')
    expect(page.locator('.menu-item').filter(has_text='更正原记录')).to_be_visible()
    page.keyboard.press('Escape')
    expect(more).to_be_focused()
    checks.append('Keyboard opens More; Escape closes it and returns focus')
    view.get_by_role('searchbox').fill('第三款')
    view.locator('.dr-detail').evaluate('(node)=>{node.querySelectorAll(".dr-history-item").forEach(item=>item.open=true);node.scrollTop=node.scrollHeight;}')
    page.wait_for_function('document.querySelector(".dr-detail").scrollTop > 0')
    # Wait for the actual workspace file, not an arbitrary delay.
    page.wait_for_function('''async () => {
      const workspace=JSON.parse(await app.vault.adapter.read('.obsidian/workspace.json'));
      function find(node){ if(node?.state?.type==='decision-review-view') return node.state.state; for(const child of node?.children||[]){const result=find(child); if(result) return result;} }
      const state=find(workspace.main);return state?.query==='第三款' && Object.values(state.positions||{}).some(p=>p.scroll>0&&p.expanded?.length);
    }''')
    before=page.evaluate('app.workspace.getLeavesOfType("decision-review-view")[0].view.getState()')
    lesson_path=page.evaluate(f'{PLUGIN}.store.lessons.find(l=>!l.meta.demo).path')
    page.evaluate(f'async () => {{ await {PLUGIN}.openFile({json.dumps(lesson_path)}); }}')
    page.reload()
    page.wait_for_function(f'typeof app !== "undefined" && {PLUGIN}?.store?.ready === true')
    page.evaluate(f'async () => {{ await {PLUGIN}.openView(); }}')
    expect(view.get_by_role('searchbox')).to_have_value('第三款')
    expect(view.locator('.dr-history-item[open]')).to_have_count(len(before['positions'][entry['decision']['id']]['expanded']))
    assert view.locator('.dr-detail').evaluate('node=>node.scrollTop')>0
    checks.append('Reload while reading a lesson restores the background workspace search, selection, expanded history and reading position')
    page.evaluate(f'async () => {{ const view=await {PLUGIN}.openView();view.showDemo(); }}')
    (ROOT/'output/playwright/native-state-results.json').write_text(json.dumps({'passed':checks},ensure_ascii=False,indent=2))
    for check in checks: print('PASS:',check,flush=True)
    browser.close()
