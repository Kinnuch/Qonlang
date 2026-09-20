"""
字体库的预览字形：把目录里每款字体裁成「只有预览那一行用到的字」的子集，打进安装包。

为什么要裁：整套字体动辄几 MB（中日韩的十几 MB），全打进去安装包要涨一百多兆；
而预览只需要那一行字，裁完一款几 KB，31 款加起来也就一百多 KB，用户一打开字体库
就能看见每款字**真正的样子**，不必先下载。

OFL 有「保留字体名称」(Reserved Font Name) 一条：改过的字体不能再用原名，
所以子集里的字族名一律改成 `qnlpv-<文件名>`，界面上按这个名字引用，
原名、版权、许可证记录原样留在字体里，另外写一份 LICENSES.md 说明来源。

用法（需要 fonttools 与 brotli）：
    node scripts/font-catalog.mjs              # 导出目录到 scripts/.font-catalog.json
    python scripts/make-font-previews.py       # 下载、裁剪、写 preview.css

产物（都进版本库）：
    src/renderer/src/assets/fonts/preview/*.woff2
    src/renderer/src/assets/fonts/preview.css
    src/renderer/src/assets/fonts/preview/LICENSES.md
"""

import io
import json
import os
import re
import sys
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, 'scripts', '.font-catalog.json')
OUT_DIR = os.path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'fonts', 'preview')
CSS = os.path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'fonts', 'preview.css')
CACHE = os.path.join(ROOT, 'node_modules', '.cache', 'font-previews')
# 下不动时换成镜像（跟软件里「下载镜像」那一栏一个意思）
MIRROR = os.environ.get('FONT_MIRROR', '')


def preview_family(file_name: str) -> str:
    stem = re.sub(r'\.[^.]+$', '', file_name)
    return 'qnlpv-' + re.sub(r'[^A-Za-z0-9]+', '-', stem).strip('-').lower()


def fetch(url: str, path: str) -> bool:
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return True
    full = MIRROR.rstrip('/') + '/' + url if MIRROR else url
    try:
        req = urllib.request.Request(full, headers={'User-Agent': 'qonlang-font-previews'})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
            f.write(r.read())
        return True
    except Exception as e:  # noqa: BLE001 - 下不动就跳过这一款，报告里写出来
        print('  下载失败：', e)
        return False


def make_subset(src: str, dst: str, text: str, family: str) -> int:
    font = TTFont(src, fontNumber=0, lazy=True)
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.desubroutinize = True
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.drop_tables += ['DSIG']
    sub = subset.Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(font)
    # 改字族名（OFL 的保留字体名称：改过的不能再用原名）
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16):
            value = family if rec.nameID in (1, 16) else family + '-Regular'
            name.setName(value, rec.nameID, rec.platformID, rec.platEncID, rec.langID)
    font.flavor = 'woff2'
    font.save(dst)
    font.close()
    return os.path.getsize(dst)


def main() -> int:
    entries = json.load(io.open(CATALOG, encoding='utf-8'))
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    faces, licenses, total, skipped = [], [], 0, []
    for e in entries:
        # 随软件带的字体本来就在包里，不用裁
        if e.get('builtin') or not e.get('url') or not e.get('sample'):
            continue
        family = preview_family(e['file'])
        src = os.path.join(CACHE, e['file'])
        dst = os.path.join(OUT_DIR, family + '.woff2')
        print(e['family'])
        if not fetch(e['url'], src):
            skipped.append(e['family'])
            continue
        try:
            size = make_subset(src, dst, e['sample'], family)
        except Exception as err:  # noqa: BLE001
            print('  裁剪失败：', err)
            skipped.append(e['family'])
            continue
        total += size
        print('  →', os.path.basename(dst), f'{size / 1024:.1f} KB')
        faces.append((family, os.path.basename(dst)))
        licenses.append(f"- **{e['family']}** — {e['url']}")

    lines = [
        '/* 字体库的预览字形：只含预览那一行用到的字，由 scripts/make-font-previews.py 生成，别手改 */'
    ]
    for family, file_name in faces:
        lines.append(
            f"@font-face {{\n  font-family: '{family}';\n"
            f"  src: url('./preview/{file_name}') format('woff2');\n"
            '  font-display: swap;\n}'
        )
    io.open(CSS, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')

    io.open(os.path.join(OUT_DIR, 'LICENSES.md'), 'w', encoding='utf-8', newline='\n').write(
        '# 预览字形的来源\n\n'
        '这个目录里的 woff2 是字体库各款字体的**子集**（只保留字体库预览那一行用到的字），'
        '由 `scripts/make-font-previews.py` 生成，用于在没下载整套字体时也能看到它真正的样子。\n\n'
        '都是 OFL / Apache 许可的字体。OFL 的「保留字体名称」要求改过的版本不得再用原名，'
        '所以子集里的字族名改成了 `qnlpv-…`；版权与许可证记录原样保留在字体文件里。\n\n'
        + '\n'.join(licenses)
        + '\n'
    )
    print(f'\n共 {len(faces)} 款，合计 {total / 1024:.0f} KB')
    if skipped:
        print('没做成的：', '、'.join(skipped))
    return 0


if __name__ == '__main__':
    sys.exit(main())
