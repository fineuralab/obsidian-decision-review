import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base = await mkdtemp(path.join(tmpdir(), 'decision-review-test-'));
const vault = path.join(base, 'vault'), profile = path.join(base, 'profile');
const plugin = path.join(vault, '.obsidian/plugins/decision-review');
await mkdir(plugin, { recursive: true }); await mkdir(profile, { recursive: true });
for (const file of ['manifest.json', 'main.js', 'styles.css']) await copyFile(path.join(root, file), path.join(plugin, file));
await writeFile(path.join(plugin, 'data.json'), JSON.stringify({ language: 'zh-CN', folder: '决策复盘', days: 30, statusBar: true }));
await writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['decision-review']));
await writeFile(path.join(vault, '.obsidian/app.json'), JSON.stringify({ alwaysUpdateLinks: true, defaultViewMode: 'preview' }));
await writeFile(path.join(vault, '.obsidian/appearance.json'), JSON.stringify({ theme: 'moonstone' }));
await writeFile(path.join(vault, '.obsidian/workspace.json'), JSON.stringify({
  main: { id: 'main', type: 'split', direction: 'vertical', children: [{ id: 'decision-leaf', type: 'leaf', state: { type: 'decision-review-view', state: {} } }] },
  left: { id: 'left', type: 'split', direction: 'horizontal', children: [], collapsed: true, width: 240 },
  right: { id: 'right', type: 'split', direction: 'horizontal', children: [], collapsed: true, width: 240 }
}));
await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { '3333333333333333': { path: vault, ts: Date.now(), open: true } } }));
await writeFile(path.join(vault, '验收资料.md'), '# 验收资料\n\n只用于临时库的界面检查。\n');
await mkdir(path.join(root, 'output/playwright'), { recursive: true });
await writeFile(path.join(root, 'output/test-paths.json'), JSON.stringify({ base, vault, profile, plugin }));
console.log(JSON.stringify({ base, vault, profile, plugin }));
