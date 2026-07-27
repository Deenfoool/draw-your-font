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

required = {'head', 'hhea', 'maxp', 'OS/2', 'hmtx', 'cmap', 'loca', 'glyf', 'name', 'post', 'GSUB', 'GPOS'}
missing = sorted(required.difference(font.keys()))
if missing:
    raise RuntimeError(f'В связном шрифте отсутствуют таблицы: {missing}')

gsub_features = [record.FeatureTag for record in font['GSUB'].table.FeatureList.FeatureRecord]
if gsub_features != ['calt', 'rlig']:
    raise RuntimeError(f'Неожиданные GSUB-функции: {gsub_features}')

gsub_scripts = [record.ScriptTag for record in font['GSUB'].table.ScriptList.ScriptRecord]
if gsub_scripts != ['DFLT', 'cyrl']:
    raise RuntimeError(f'Неожиданные GSUB-скрипты: {gsub_scripts}')

gsub_lookups = [lookup.LookupType for lookup in font['GSUB'].table.LookupList.Lookup]
if gsub_lookups != [1, 6, 1, 6, 1, 6]:
    raise RuntimeError(f'Неверная последовательность GSUB lookup: {gsub_lookups}')

feature_lookup_indices = {
    record.FeatureTag: list(record.Feature.LookupListIndex)
    for record in font['GSUB'].table.FeatureList.FeatureRecord
}
if feature_lookup_indices != {'calt': [1, 3, 5], 'rlig': [1, 3, 5]}:
    raise RuntimeError(f'GSUB-функции ссылаются не только на контекстные lookup: {feature_lookup_indices}')

gpos_features = [record.FeatureTag for record in font['GPOS'].table.FeatureList.FeatureRecord]
if gpos_features != ['curs']:
    raise RuntimeError(f'Неожиданные GPOS-функции: {gpos_features}')

gpos_scripts = [record.ScriptTag for record in font['GPOS'].table.ScriptList.ScriptRecord]
if gpos_scripts != ['DFLT', 'cyrl']:
    raise RuntimeError(f'Неожиданные GPOS-скрипты: {gpos_scripts}')

gpos_lookups = font['GPOS'].table.LookupList.Lookup
if [lookup.LookupType for lookup in gpos_lookups] != [3]:
    raise RuntimeError('GPOS должен содержать один Cursive Attachment lookup типа 3')

cursive_subtable = gpos_lookups[0].SubTable[0]
if cursive_subtable.PosFormat != 1 or cursive_subtable.EntryExitCount < 2:
    raise RuntimeError('GPOS cursive attachment имеет неверный формат или слишком мало записей')
entry_count = sum(record.EntryAnchor is not None for record in cursive_subtable.EntryExitRecord)
exit_count = sum(record.ExitAnchor is not None for record in cursive_subtable.EntryExitRecord)
if not entry_count or not exit_count:
    raise RuntimeError('В GPOS отсутствуют входные или выходные курсивные якоря')

glyph_order = font.getGlyphOrder()
glyf = font['glyf']
r_name = glyph_order[layout['forms']['р']['isol']]
a_name = glyph_order[layout['forms']['а']['isol']]
r_y_min = glyf[r_name].yMin
a_y_min = glyf[a_name].yMin
if r_y_min >= -80:
    raise RuntimeError(f'Нижний элемент «р» не опущен ниже строки: yMin={r_y_min}')
if r_y_min >= a_y_min - 40:
    raise RuntimeError(f'«р» должна быть заметно ниже «а»: р={r_y_min}, а={a_y_min}')

metrics = layout['metrics']
if font['hhea'].descent > metrics['inkBottom']:
    raise RuntimeError(f'hhea.descent не покрывает нижние элементы: {font["hhea"].descent} > {metrics["inkBottom"]}')
if font['OS/2'].sTypoDescender > metrics['inkBottom']:
    raise RuntimeError(f'OS/2 descender не покрывает нижние элементы: {font["OS/2"].sTypoDescender} > {metrics["inkBottom"]}')
if metrics['descent'] > metrics['inkBottom'] - 20:
    raise RuntimeError(f'В метриках нет безопасного нижнего поля: {metrics}')

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
    hb.shape(hb_font, buffer, {'rlig': True, 'calt': True, 'curs': True})
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

expected_drozh = [
    layout['forms']['д']['init'],
    layout['forms']['р']['medi'],
    layout['forms']['о']['medi'],
    layout['forms']['ж']['medi'],
    layout['forms']['ь']['fina'],
]
actual_drozh = shape('дрожь')
if actual_drozh != expected_drozh:
    raise RuntimeError(f'HarfBuzz сформировал «дрожь» неверно: {actual_drozh}, ожидалось {expected_drozh}')

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

print('Cursive FontTools, HarfBuzz and descender validation: PASS')
print('GSUB features:', gsub_features, feature_lookup_indices)
print('GPOS feature:', gpos_features[0], f'anchors entry={entry_count} exit={exit_count}')
print('Descenders:', {'р': r_y_min, 'а': a_y_min, 'hhea': font['hhea'].descent, 'OS/2': font['OS/2'].sTypoDescender})
print('Shaped дрожь:', actual_drozh)
