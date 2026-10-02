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

if layout.get('engine') != 'russian-school-contextual-v1':
    raise RuntimeError(f'Неожиданный движок соединений: {layout.get("engine")}')

gsub_features = [record.FeatureTag for record in font['GSUB'].table.FeatureList.FeatureRecord]
if gsub_features != ['calt', 'rlig']:
    raise RuntimeError(f'Неожиданные GSUB-функции: {gsub_features}')

gsub_scripts = [record.ScriptTag for record in font['GSUB'].table.ScriptList.ScriptRecord]
if gsub_scripts != ['DFLT', 'cyrl']:
    raise RuntimeError(f'Неожиданные GSUB-скрипты: {gsub_scripts}')

gsub_lookups = [lookup.LookupType for lookup in font['GSUB'].table.LookupList.Lookup]
expected_context_count = len(layout['featureLookups'])
expected_lookup_types = [value for _ in range(expected_context_count) for value in (1, 6)]
if gsub_lookups != expected_lookup_types:
    raise RuntimeError(f'Неверная последовательность GSUB lookup: {gsub_lookups}')

feature_lookup_indices = {
    record.FeatureTag: list(record.Feature.LookupListIndex)
    for record in font['GSUB'].table.FeatureList.FeatureRecord
}
expected_feature_indices = list(layout['featureLookups'])
if feature_lookup_indices != {'calt': expected_feature_indices, 'rlig': expected_feature_indices}:
    raise RuntimeError(f'GSUB-функции ссылаются не на контекстные lookup: {feature_lookup_indices}')
if expected_context_count != 11:
    raise RuntimeError(f'Фикстура должна содержать 9 базовых и 2 парных правила, получено {expected_context_count}')

gpos_features = [record.FeatureTag for record in font['GPOS'].table.FeatureList.FeatureRecord]
if gpos_features != ['curs', 'kern']:
    raise RuntimeError(f'Неожиданные GPOS-функции: {gpos_features}')

gpos_scripts = [record.ScriptTag for record in font['GPOS'].table.ScriptList.ScriptRecord]
if gpos_scripts != ['DFLT', 'cyrl']:
    raise RuntimeError(f'Неожиданные GPOS-скрипты: {gpos_scripts}')

gpos_lookups = font['GPOS'].table.LookupList.Lookup
if [lookup.LookupType for lookup in gpos_lookups] != [3, 2]:
    raise RuntimeError('GPOS должен содержать Cursive Attachment типа 3 и Pair Positioning типа 2')

cursive_subtable = gpos_lookups[0].SubTable[0]
if cursive_subtable.PosFormat != 1 or cursive_subtable.EntryExitCount < 2:
    raise RuntimeError('GPOS cursive attachment имеет неверный формат или слишком мало записей')
entry_count = sum(record.EntryAnchor is not None for record in cursive_subtable.EntryExitRecord)
exit_count = sum(record.ExitAnchor is not None for record in cursive_subtable.EntryExitRecord)
if not entry_count or not exit_count:
    raise RuntimeError('В GPOS отсутствуют входные или выходные курсивные якоря')

pair_subtable = gpos_lookups[1].SubTable[0]
if pair_subtable.PosFormat != 1 or pair_subtable.ValueFormat1 != 0x0004 or pair_subtable.ValueFormat2 != 0:
    raise RuntimeError('GPOS kern должен использовать PairPos Format 1 и XAdvance первого глифа')

pair_adjustments = layout.get('pairAdjustments', [])
if len(pair_adjustments) != 10:
    raise RuntimeError(f'Ожидалось 10 контекстных записей интервала м|о, получено {len(pair_adjustments)}')
if {item.get('pairKey') for item in pair_adjustments} != {'м|о'}:
    raise RuntimeError(f'В таблицу интервалов попали лишние пары: {pair_adjustments}')

glyph_order = font.getGlyphOrder()
pair_values = {}
for first_name, pair_set in zip(pair_subtable.Coverage.glyphs, pair_subtable.PairSet):
    for record in pair_set.PairValueRecord:
        pair_values[(first_name, record.SecondGlyph)] = record.Value1.XAdvance
for item in pair_adjustments:
    key = (glyph_order[item['first']], glyph_order[item['second']])
    if pair_values.get(key) != item['xAdvance']:
        raise RuntimeError(f'GPOS kern не содержит ожидаемую поправку {key}: {pair_values.get(key)} != {item["xAdvance"]}')

blocked_id = layout['contextualForms']['т']['blocked']
if not isinstance(blocked_id, int):
    raise RuntimeError('Для отключённой пары т|а не создан изолированный blocked-глиф')
blocked_name = glyph_order[blocked_id]
if blocked_name in set(cursive_subtable.Coverage.glyphs):
    raise RuntimeError('Blocked-глиф не должен содержать курсивные entry/exit anchors')

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


def shape(text, kern=True):
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.script = 'Cyrl'
    buffer.language = 'ru'
    buffer.direction = 'ltr'
    hb.shape(hb_font, buffer, {'rlig': True, 'calt': True, 'curs': True, 'kern': kern})
    return {
        'glyphs': [info.codepoint for info in buffer.glyph_infos],
        'advances': [position.x_advance for position in buffer.glyph_positions],
        'offsets': [(position.x_offset, position.y_offset) for position in buffer.glyph_positions],
    }


forms = layout['contextualForms']
expected_mama = [
    forms['м']['init']['lower'],
    forms['а']['medi']['lower'],
    forms['м']['medi']['lower'],
    forms['а']['fina'],
]
actual_mama = shape('мама')
if actual_mama['glyphs'] != expected_mama:
    raise RuntimeError(f'HarfBuzz сформировал «мама» неверно: {actual_mama["glyphs"]}, ожидалось {expected_mama}')

expected_drozh = [
    forms['д']['init']['upper'],
    forms['р']['medi']['lower'],
    forms['о']['medi']['middle'],
    forms['ж']['medi']['upper'],
    forms['ь']['fina'],
]
actual_drozh = shape('дрожь')
if actual_drozh['glyphs'] != expected_drozh:
    raise RuntimeError(f'HarfBuzz сформировал «дрожь» неверно: {actual_drozh["glyphs"]}, ожидалось {expected_drozh}')

expected_single = [forms['а']['isol']]
actual_single = shape('а')
if actual_single['glyphs'] != expected_single:
    raise RuntimeError(f'Одиночная форма неверна: {actual_single["glyphs"]}, ожидалось {expected_single}')

space_name = font.getBestCmap().get(ord(' '))
if not space_name:
    raise RuntimeError('В cmap отсутствует пробел')
space_id = font.getGlyphID(space_name)
expected_words = [forms['м']['init']['lower'], forms['а']['fina'], space_id, forms['м']['init']['lower'], forms['а']['fina']]
actual_words = shape('ма ма')
if actual_words['glyphs'] != expected_words:
    raise RuntimeError(f'Пробел не разорвал соединение: {actual_words["glyphs"]}, ожидалось {expected_words}')

expected_mo = [forms['м']['init']['upper'], forms['о']['fina']]
mo_with_kern = shape('мо', kern=True)
mo_without_kern = shape('мо', kern=False)
if mo_with_kern['glyphs'] != expected_mo or mo_without_kern['glyphs'] != expected_mo:
    raise RuntimeError(f'Парное правило м|о выбрало неверные глифы: {mo_with_kern["glyphs"]}, ожидалось {expected_mo}')
expected_adjustment = next(
    item['xAdvance']
    for item in pair_adjustments
    if item['first'] == expected_mo[0] and item['second'] == expected_mo[1]
)
actual_adjustment = sum(mo_with_kern['advances']) - sum(mo_without_kern['advances'])
if actual_adjustment != expected_adjustment:
    raise RuntimeError(f'HarfBuzz применил неверный интервал м|о: {actual_adjustment}, ожидалось {expected_adjustment}')

expected_ta = [forms['т']['blocked'], forms['а']['isol']]
actual_ta = shape('та')
if actual_ta['glyphs'] != expected_ta:
    raise RuntimeError(f'Отключение соединения т|а не сработало: {actual_ta["glyphs"]}, ожидалось {expected_ta}')

control_words = ['мама', 'молоко', 'машина', 'берёза', 'ёжик', 'лилия', 'шишка', 'щука', 'подъезд', 'цифра', 'дружба', 'уфимец', 'филин', 'скорость']
for word in control_words:
    shaped = shape(word)
    if len(shaped['glyphs']) != len(word) or 0 in shaped['glyphs']:
        raise RuntimeError(f'Контрольное слово «{word}» сформировано некорректно: {shaped["glyphs"]}')

print('Russian School Joining FontTools and HarfBuzz validation: PASS')
print('GSUB:', gsub_features, feature_lookup_indices)
print('GPOS:', gpos_features, {'entry': entry_count, 'exit': exit_count, 'pairs': len(pair_values)})
print('Pair м|о:', {'glyphs': mo_with_kern['glyphs'], 'xAdvance': actual_adjustment})
print('Pair т|а:', actual_ta['glyphs'])
print('Descenders:', {'р': r_y_min, 'а': a_y_min, 'hhea': font['hhea'].descent, 'OS/2': font['OS/2'].sTypoDescender})
print('Shaped дрожь:', actual_drozh['glyphs'])
