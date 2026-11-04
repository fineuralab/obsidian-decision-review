"""Check release checksums and reproduce a build from the source ZIP in a fresh directory."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import tempfile
import zipfile

parser=argparse.ArgumentParser()
parser.add_argument('--offline-cache', help='Optional npm cache for a network-free clean install')
args=parser.parse_args()
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'manifest.json').read_text())
version=manifest['version']
OUT=ROOT/'output'
OUT.mkdir(exist_ok=True)
install=ROOT/f'dist/decision-review-{version}.zip'
source=ROOT/f'dist/decision-review-{version}-source.zip'
checks=[]
sums={line.split()[1]:line.split()[0] for line in (ROOT/'dist/SHA256SUMS.txt').read_text().splitlines()}
for archive in [install,source]:
    assert hashlib.sha256(archive.read_bytes()).hexdigest()==sums[archive.name]
checks.append('Both release archive SHA-256 checksums match the manifest')
with zipfile.ZipFile(install) as z:
    runtime={name:z.read('decision-review/'+name) for name in ['main.js','manifest.json','styles.css','LICENSE','THIRD-PARTY-NOTICES.txt']}
    assert set(z.namelist())=={'decision-review/'+name for name in runtime}
    assert z.testzip() is None
    for name,content in runtime.items(): assert content==(ROOT/name).read_bytes()
checks.append('Install ZIP contains exactly the five expected regular runtime/license files')
with zipfile.ZipFile(source) as z:
    assert z.testzip() is None
    for item in z.infolist():
        parts=Path(item.filename).parts
        assert parts[0]=='decision-review' and '..' not in parts
        assert not set(parts)&{'node_modules','output','dist','.git','.obsidian','.playwright-cli','__pycache__'}
        assert (item.external_attr>>16)&0o170000!=0o120000
checks.append('Source ZIP has no dependency, temporary-vault, output or local configuration directories')
with tempfile.TemporaryDirectory(prefix='decision-review-source-check-') as base:
    with zipfile.ZipFile(source) as z: z.extractall(base)
    work=Path(base)/'decision-review'
    commands=[('install',['npm','ci','--ignore-scripts','--no-audit','--no-fund'] + (['--offline','--cache',str(Path(args.offline_cache).resolve())] if args.offline_cache else [])),('tests',['npm','test']),('build',['npm','run','build'])]
    for label,command in commands:
        result=subprocess.run(command,cwd=work,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (OUT/f'release-source-{label}.log').write_text(result.stdout)
        if result.returncode: raise RuntimeError(f'{label} failed; see output/release-source-{label}.log')
        print('PASS: clean source archive '+label,flush=True)
    for name in ['main.js','manifest.json','styles.css']: assert (work/name).read_bytes()==runtime[name],name
checks.append('A clean source ZIP install passes all tests and reproduces the three runtime files byte for byte')
for check in checks: print('PASS:',check,flush=True)
(OUT/'release-verification.json').write_text(json.dumps({'version':version,'passed':checks,'sha256':sums},indent=2))
