import assert from 'node:assert/strict';
import {
  buildRussianEntryPath,
  getRussianEntryProfile,
  normalizeRussianEntryMode,
  RUSSIAN_ENTRY_MODES,
  RUSSIAN_OVAL_ENTRY_PRESETS,
  RUSSIAN_SHORT_UPPER_PRESETS,
} from '../src/russian-entry-paths.js';
import { generateRussianContextualFormMask } from '../src/contextual-cursive-mask.js';
import {
  getRussianEntryClass,
  getRussianEntryMode,
  resolveJoiningSequence,
} from '../src/russian-joining.js';

assert.deepEqual(RUSSIAN_ENTRY_MODES, ['standard', 'short-upper', 'oval-retrace', 'none']);
assert.equal(normalizeRussianEntryMode('oval-retrace'), 'oval-retrace');
assert.equal(normalizeRussianEntryMode('unknown'), 'standard');
assert.deepEqual(Object.keys(RUSSIAN_OVAL_ENTRY_PRESETS), ['а', 'б', 'д', 'о', 'ф']);
assert.deepEqual(Object.keys(RUSSIAN_SHORT_UPPER_PRESETS), ['с']);

const geometry = { glyphWidth: 60, xHeightY: 22, baselineY: 54, smoothness: 0.62 };
const start = { x: 0, y: 42 };
const entry = { x: 18, y: 38 };
const standard = buildRussianEntryPath('standard', start, entry, geometry);
const shortUpper = buildRussianEntryPath('short-upper', start, entry, { ...geometry, character: 'с' });
const oval = buildRussianEntryPath('oval-retrace', start, entry, { ...geometry, character: 'о' });

assert.equal(standard.segments.length, 1);
assert.equal(shortUpper.segments.length, 2);
assert.equal(oval.segments.length, 2);
assert.ok(oval.retracePoint);
assert.ok(oval.retracePoint.x > entry.x);
assert.equal(oval.segments[1].end.x, entry.x);
assert.equal(oval.segments[1].end.y, entry.y);
assert.equal(shortUpper.segments[0].role, 'short-upper-entry');
assert.equal(oval.segments[1].role, 'oval-retrace');
assert.equal(shortUpper.profileKey, 'ru-school-es');
assert.equal(oval.profileKey, 'ru-school-o');

const ovalPaths = new Map();
for (const character of ['а', 'б', 'д', 'о', 'ф']) {
  const profile = getRussianEntryProfile(character, 'oval-retrace');
  const path = buildRussianEntryPath('oval-retrace', start, entry, { ...geometry, character });
  assert.equal(path.profileKey, profile.id);
  assert.equal(path.character, character);
  assert.ok(path.retracePoint.x > entry.x, `${character}: возвратная точка должна находиться внутри корпуса буквы`);
  assert.ok(path.retracePoint.y >= geometry.xHeightY, `${character}: траектория не должна выходить выше рабочей зоны`);
  assert.ok(path.retracePoint.y <= geometry.baselineY, `${character}: траектория не должна проваливаться ниже базовой линии`);
  assert.deepEqual(path.segments.at(-1).end, entry, `${character}: траектория должна завершаться в настоящем входном якоре`);
  ovalPaths.set(character, `${path.retracePoint.x.toFixed(3)}:${path.retracePoint.y.toFixed(3)}:${path.segments[1].control.x.toFixed(3)}:${path.segments[1].control.y.toFixed(3)}`);
}
assert.equal(new Set(ovalPaths.values()).size, 5, 'Все пять овальных букв должны иметь отличающуюся геометрию входа.');

function createGlyph(char) {
  const width = 60;
  const height = 72;
  const mask = new Uint8Array(width * height);
  for (let y = 20; y <= 55; y += 1) {
    for (let x = 18; x <= 44; x += 1) {
      const dx = (x - 31) / 13;
      const dy = (y - 38) / 18;
      if (dx * dx + dy * dy <= 1 && dx * dx + dy * dy >= 0.48) mask[y * width + x] = 1;
    }
  }
  return {
    char,
    width,
    height,
    mask,
    guides: { capY: 7, xHeightY: 20, baselineY: 56, descenderY: 68 },
  };
}

const baseConfig = {
  joinLeft: true,
  joinRight: true,
  entryClass: 'lower',
  entry: { x: 0.3, y: 0.54 },
  exit: { x: 0.9, y: 0.7 },
  exitVariants: {
    upper: { x: 0.9, y: 0.42 },
    middle: { x: 0.9, y: 0.58 },
    lower: { x: 0.9, y: 0.72 },
    special: { x: 0.9, y: 0.5 },
  },
};
const cursive = { tailLength: 0.34, thickness: 2.2, smoothness: 0.62, connectionY: 0.76 };
const standardMask = generateRussianContextualFormMask(createGlyph('н'), 'fina', cursive, { ...baseConfig, entryMode: 'standard' });
const ovalMask = generateRussianContextualFormMask(createGlyph('о'), 'fina', cursive, { ...baseConfig, entryMode: 'oval-retrace' });
const specialMask = generateRussianContextualFormMask(createGlyph('с'), 'fina', cursive, { ...baseConfig, entryMode: 'short-upper' });

assert.equal(standardMask.entryMode, 'standard');
assert.equal(ovalMask.entryMode, 'oval-retrace');
assert.equal(ovalMask.entryProfile, 'ru-school-o');
assert.equal(specialMask.entryMode, 'short-upper');
assert.equal(specialMask.entryProfile, 'ru-school-es');
assert.ok(ovalMask.retracePoint);
assert.equal(standardMask.retracePoint, null);
assert.notDeepEqual([...ovalMask.mask], [...standardMask.mask]);
assert.notDeepEqual([...specialMask.mask], [...standardMask.mask]);

const controlPairs = ['ла', 'мо', 'но', 'оф', 'да', 'ро', 'со'];
const characters = [...new Set(controlPairs.flatMap((pair) => [...pair]))];
const glyphConfigs = Object.fromEntries(characters.map((character) => [character, {
  ...baseConfig,
  entryClass: getRussianEntryClass(character),
  entryMode: getRussianEntryMode(character),
}]));

for (const pair of controlPairs) {
  const [leftCharacter, rightCharacter] = [...pair];
  const sequence = resolveJoiningSequence(pair, glyphConfigs);
  assert.equal(sequence.length, 2);
  assert.equal(sequence[0].connectedRight, true, `${pair}: первая буква должна соединяться вправо`);
  assert.equal(sequence[1].connectedLeft, true, `${pair}: вторая буква должна принимать соединение слева`);
  assert.equal(sequence[0].exitClass, getRussianEntryClass(rightCharacter), `${pair}: выход первой буквы должен определяться следующей буквой`);
  assert.equal(sequence[1].entryMode, getRussianEntryMode(rightCharacter), `${pair}: должна применяться русская геометрия входа второй буквы`);

  const rightMask = generateRussianContextualFormMask(createGlyph(rightCharacter), 'fina', cursive, glyphConfigs[rightCharacter]);
  assert.equal(rightMask.entryMode, getRussianEntryMode(rightCharacter));
  if (['а', 'б', 'д', 'о', 'ф'].includes(rightCharacter)) {
    assert.equal(rightMask.entryProfile, RUSSIAN_OVAL_ENTRY_PRESETS[rightCharacter].id);
    assert.ok(rightMask.retracePoint, `${pair}: овальная буква должна иметь возвратное движение`);
  }
}

console.log('Russian letter-specific oval/retrace and pair tests: PASS');
