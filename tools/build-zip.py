#!/usr/bin/env python3
"""Package the extension into dist/shootme-<version>.zip, ready to hand to someone.

    python3 tools/build-zip.py
"""
import json, os, zipfile, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
INCLUDE = ['manifest.json', 'icons', 'src', 'INSTALL.md']
SKIP_SUFFIX = {'.map'}

def files():
    for entry in INCLUDE:
        path = ROOT / entry
        if path.is_file():
            yield path
        elif path.is_dir():
            for sub in sorted(path.rglob('*')):
                if sub.is_file() and sub.suffix not in SKIP_SUFFIX:
                    yield sub

def main():
    version = json.loads((ROOT / 'manifest.json').read_text())['version']
    out_dir = ROOT / 'dist'
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f'shootme-{version}.zip'
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files():
            archive.write(path, path.relative_to(ROOT).as_posix())
    size = out.stat().st_size / 1024
    print(f'{out.relative_to(ROOT)}  ({size:.0f} KB)')
    print('Send that file. The person unzips it, then follows INSTALL.md.')

if __name__ == '__main__':
    main()
