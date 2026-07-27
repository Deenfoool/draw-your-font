from pathlib import Path
from zipfile import ZipFile
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent / 'output'
TTF = OUT / 'stage3-test.ttf'
WOFF = OUT / 'stage3-test.woff'
ZIP = OUT / 'stage3-test.zip'
WOFF2 = OUT / 'stage3-test.woff2'

required = {'head','hhea','maxp','OS/2','hmtx','cmap','loca','glyf','name','post'}

for path in (TTF, WOFF):
    font = TTFont(path, recalcBBoxes=False, recalcTimestamp=False)
    assert required.issubset(font.keys()), (path, font.keys())
    cmap = font.getBestCmap()
    assert cmap[0x0401] == 'uni0401'
    assert cmap[0x0410] == 'uni0410'
    assert font['name'].getDebugName(1) == 'Тестовый почерк'
    assert font['name'].getDebugName(2) == 'Regular'
    assert len(font.getGlyphOrder()) == 4
    for cp in (0x0401, 0x0410):
        glyph = font['glyf'][cmap[cp]]
        assert glyph.numberOfContours > 0
        assert glyph.xMax > glyph.xMin
        assert glyph.yMax > glyph.yMin
    font.close()

font = TTFont(TTF, recalcBBoxes=False, recalcTimestamp=False)
font.flavor = 'woff2'
font.save(WOFF2)
font.close()
assert WOFF2.read_bytes()[:4] == b'wOF2'
font = TTFont(WOFF2, recalcBBoxes=False, recalcTimestamp=False)
assert font.getBestCmap()[0x0401] == 'uni0401'
font.close()

with ZipFile(ZIP) as archive:
    names = set(archive.namelist())
    assert {'test-handwriting.ttf', 'test-handwriting.woff', 'font.css'} <= names
    assert archive.testzip() is None

print('FontTools validation: PASS')
print(f'TTF: {TTF.stat().st_size} bytes')
print(f'WOFF: {WOFF.stat().st_size} bytes')
print(f'WOFF2 compatibility fixture: {WOFF2.stat().st_size} bytes')
