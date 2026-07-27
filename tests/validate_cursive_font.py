import json
from pathlib import Path

from fontTools.ttLib import TTFont
import uharfbuzz as hb

ROOT = Path(__file__).resolve().parents[1]
FONT_PATH = ROOT / 'tests' / '.cursive-fixture.ttf'
LAYOUT_PATH = ROOT / 'tests' / '.cursive-layout.json'

if not FONT_PATH.exists() or not LAYOUT_PATH.exists():
    raise RuntimeError('Сначала запустите node tests/cursive.test.mjs')

layout = json.loads(LAYOUT_PATH.read_text(encoding='utf-8'))
font = TTFont(FONT_PATH)

required = {'head', 'hhea', 'maxp', 'OS/2', 'hmtx', 'cmap', 'loca', 'glyf', 'name', 'post', 'GSUB'}
missing = sorted(required.difference(font.keys()))
if missing:
    raise RuntimeError(f'В связном шрифте отсутствуют таблицы: {missing}')

feature_tags = [record.FeatureTag for record in font['GSUB'].table.FeatureList.FeatureRecord]
if feature_tags != ['calt', 'rlig']:
    raise RuntimeError(f'Неожиданные GSUB-функции: {feature_tags}')

script_tags = [record.ScriptTag for record in font['GSUB'].table.ScriptList.ScriptRecord]
if script_tags != ['DFLT', 'cyrl']:
    raise RuntimeError(f'Неожиданные GSUB-скрипты: {script_tags}')

lookup_types = [lookup.LookupType for lookup in font['GSUB'].table.LookupList.Lookup]
if lookup_types != [1, 6, 1, 6, 1, 6]:
    raise RuntimeError(f'Неверная последовательность GSUB lookup: {lookup_types}')

font_bytes = FONT_PATH.read_bytes()
face = hb.Face(font_bytes)
hb_font = hb.Font(face)
hb.ot_font_set_funcs(hb_font)
hb_font.scale = (face.upem, face.upem)


def shape(text):
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.script = 'Cyrl'
    buffer.language = 'ru'
    buffer.direction = 'ltr'
    hb.shape(hb_font, buffer, {'rlig': True, 'calt': True})
    return [info.codepoint for info in buffer.glyph_infos]

expected_mama = [
    layout['forms']['м']['init'],
    layout['forms']['а']['medi'],
    layout['forms']['м']['medi'],
    layout['forms']['а']['fina'],
]
actual_mama = shape('мама')
if actual_mama != expected_mama:
    raise RuntimeError(f'HarfBuzz сформировал «мама» неверно: {actual_mama}, ожидалось {expected_mama}')

expected_single = [layout['forms']['а']['isol']]
actual_single = shape('а')
if actual_single != expected_single:
    raise RuntimeError(f'Одиночная форма неверна: {actual_single}, ожидалось {expected_single}')

expected_words = [
    layout['forms']['м']['init'],
    layout['forms']['а']['fina'],
    1,
    layout['forms']['м']['init'],
    layout['forms']['а']['fina'],
]
actual_words = shape('ма ма')
if actual_words != expected_words:
    raise RuntimeError(f'Пробел не разорвал соединение: {actual_words}, ожидалось {expected_words}')

print('Cursive FontTools and HarfBuzz validation: PASS')
print('Features:', feature_tags)
print('Shaped мама:', actual_mama)
