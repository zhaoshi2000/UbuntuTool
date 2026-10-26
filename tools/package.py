#!/usr/bin/env python3
"""Build dependency-free source and GNOME extension archives, also from Windows."""
import argparse
from pathlib import Path
import zipfile
import json

ROOT = Path(__file__).resolve().parents[1]
UUID = 'ubuntutool@zhaoshi2000'

def package(output: Path):
    output.mkdir(parents=True, exist_ok=True)
    extension = output / f'{UUID}.shell-extension.zip'
    with zipfile.ZipFile(extension, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted((ROOT / 'extension').rglob('*')):
            if file.is_file() and file.name != 'gschemas.compiled':
                archive.write(file, file.relative_to(ROOT / 'extension'))
        archive.write(ROOT / 'LICENSE', 'LICENSE')
    version = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
    source = output / f'UbuntuTool-{version}.zip'
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in ('extension', 'scripts', 'tools', 'tests', 'docs', '.github'):
            for file in sorted((ROOT / name).rglob('*')):
                if file.is_file() and not any(p in ('__pycache__', 'work', 'node_modules') for p in file.parts) and file.name != 'gschemas.compiled':
                    archive.write(file, 'UbuntuTool/' + file.relative_to(ROOT).as_posix())
        for name in ('README.md', 'LICENSE', 'package.json', '.gitignore', '.gitattributes'):
            archive.write(ROOT / name, f'UbuntuTool/{name}')
    print(extension)
    print(source)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    package(parser.parse_args().output)
