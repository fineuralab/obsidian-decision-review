"""Create verified, reproducible install and source ZIPs from explicit release inputs."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / 'manifest.json').read_text())
PACKAGE = json.loads((ROOT / 'package.json').read_text())
VERSIONS = json.loads((ROOT / 'versions.json').read_text())
assert MANIFEST['id'] == 'decision-review'
assert MANIFEST['version'] == PACKAGE['version']
assert VERSIONS[MANIFEST['version']] == MANIFEST['minAppVersion']
OUT = ROOT / 'dist'
OUT.mkdir(exist_ok=True)
RUNTIME = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-NOTICES.txt']
SOURCE = ['README.md', 'README.en.md', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'package.json', 'package-lock.json', 'manifest.json', 'versions.json', 'tsconfig.json', 'esbuild.config.mjs', 'styles.css', '.gitignore']
for folder in ['src', 'tests', 'scripts', 'docs', 'demo', 'prototype']:
    for path in sorted((ROOT / folder).rglob('*')):
        relative = path.relative_to(ROOT)
        if any(part.startswith('.') for part in relative.parts): continue
        if path.is_symlink(): raise RuntimeError(f'Symlink in source inputs: {relative}')
        if path.is_file() and path.suffix in {'.ts', '.js', '.mjs', '.py', '.md', '.json', '.html', '.css', '.png'}:
            SOURCE.append(relative.as_posix())

def archive(filename, names):
    output = OUT / filename
    expected = {}
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(set(names)):
            path = ROOT / name
            if path.is_symlink() or not path.is_file(): raise RuntimeError(f'Expected regular file: {name}')
            entry = f"{MANIFEST['id']}/{name}"
            info = zipfile.ZipInfo(entry, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            expected[entry] = path.read_bytes()
            z.writestr(info, expected[entry])
    with zipfile.ZipFile(output) as z:
        assert z.testzip() is None
        assert set(z.namelist()) == set(expected)
        for name, content in expected.items(): assert z.read(name) == content
    return output

install = archive(f"decision-review-{MANIFEST['version']}.zip", RUNTIME)
source = archive(f"decision-review-{MANIFEST['version']}-source.zip", SOURCE)
(OUT / 'SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in [install, source]))
(OUT / 'manifest.json').write_bytes((ROOT / 'manifest.json').read_bytes())
for name in ['main.js', 'styles.css']: (OUT / name).write_bytes((ROOT / name).read_bytes())
print(install)
print(source)
print(OUT / 'SHA256SUMS.txt')
