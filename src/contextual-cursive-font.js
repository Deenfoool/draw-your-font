import {
  buildTrueTypeFont,
  maskToContours,
  parseSfntTables,
  resampleMask,
} from './font-builder.js';
import { buildCursiveTrueTypeFont as buildLegacyCursiveFont } from './cursive-font-v3.js';
import { generateRussianContextualFormMask } from './contextual-cursive-mask.js';
import {
  buildRussianContextualGsub,
  buildRussianCursiveGpos,
  rebuildSfntWithTables,
} from './opentype-contextual-layout.js';
import { JOINING_TARGET_CLASSES } from './russian-joining.js';

const FORM_SUFFIX = Object.freeze({ upper: 'u', middle: 'm', lower: 'l', special: 's' });

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

function finalizeVector(vector) {
  const points = vector.contours.flat();
  const xMin = points.length ? Math.min(...points.map((point) => point.x)) : 0;
  const xMax = points.length ? Math.max(...points.map((point) => point.x)) : 0;
  const yMin = points.length ? Math.min(...points.map((point) => point.y)) : 0;
  const yMax = points.length ? Math.max(...points.map((point) => point.y)) : 0;
  return { ...vector, xMin, xMax, yMin, yMax };
}

function vectorizeBaselineGlyph(source, character, options = {}, metadata = {}) {
  const detail = clamp(Number(options.detail ?? 96), 32, 196);
  const simplify = clamp(Number(options.simplify ?? 0.55), 0, 3);
  const targetCapHeight = clamp(Number(options.glyphHeight ?? 700), 300, 900);
  const sideBearing = clamp(Number(metadata.sideBearing ?? options.sideBearing ?? 0), 0, 250);
  const rightSideBearing = clamp(Number(metadata.rightSideBearing ?? sideBearing), 0, 250);
  const sampled = resampleMask(
    source.mask,
    source.width,
    source.height,
    { x0: 0, y0: 0, x1: source.width - 1, y1: source.height - 1 },
    detail,
  );
  const loops = maskToContours(sampled.mask, sampled.width, sampled.height, { simplify });
  if (!loops.length) throw new Error(`Символ «${character}» не содержит контура.`);
  const sourceLast = Math.max(1, source.height - 1);
  const sampleYScale = Math.max(1, sampled.height - 1) / sourceLast;
  const sampleXScale = Math.max(1, sampled.width - 1) / Math.max(1, source.width - 1);
  const baseline = Number(source.baselineY ?? sourceLast * 0.82) * sampleYScale;
  const cap = Number(source.capY ?? sourceLast * 0.12) * sampleYScale;
  const outlineScale = targetCapHeight / Math.max(1, baseline - cap);
  const contours = loops.map((loop) => loop.map((point) => ({
    x: Math.round(sideBearing + point.x * outlineScale),
    y: Math.round((baseline - point.y) * outlineScale),
    onCurve: true,
  })));
  const contentWidth = Math.max(...contours.flat().map((point) => point.x)) - sideBearing;
  const vector = finalizeVector({
    name: metadata.name,
    unicode: metadata.unicode || [],
    contours,
    advanceWidth: Math.max(120, Math.ceil(contentWidth + sideBearing + rightSideBearing)),
    leftSideBearing: sideBearing,
  });
  vector.pixelToFont = (point) => ({
    x: sideBearing + point.x * sampleXScale * outlineScale,
    y: (baseline - point.y * sampleYScale) * outlineScale,
  });
  return vector;
}

function transformVector(vector, adjustment = {}) {
  const scale = clamp(adjustment.scale ?? 1, 0.55, 1.8);
  const dx = Number(adjustment.offsetX || 0) * 8;
  const dy = Number(adjustment.offsetY || 0) * 8;
  const contours = vector.contours.map((contour) => contour.map((point) => ({
    ...point,
    x: Math.round(point.x * scale + dx),
    y: Math.round(point.y * scale + dy),
  })));
  const transformed = finalizeVector({
    ...vector,
    contours,
    advanceWidth: Math.max(120, Math.round(vector.advanceWidth * scale + dx)),
  });
  if (vector.pixelToFont) transformed.pixelToFont = (point) => {
    const mapped = vector.pixelToFont(point);
    return { x: mapped.x * scale + dx, y: mapped.y * scale + dy };
  };
  return transformed;
}

function cloneLegacyProject(project) {
  return {
    ...project,
    glyphs: [...(project.glyphs || [])],
    kerning: { ...(project.kerning || {}) },
    font: { ...(project.font || {}) },
    cursive: project.cursive ? {
      ...project.cursive,
      pairOverrides: { ...(project.cursive.pairOverrides || {}) },
      glyphs: Object.fromEntries(Object.entries(project.cursive.glyphs || {}).map(([character, config]) => [character, {
        ...config,
        entry: { ...config.entry },
        exit: { ...config.exit },
        exitVariants: Object.fromEntries(Object.entries(config.exitVariants || {}).map(([name, point]) => [name, { ...point }])),
        forms: Object.fromEntries(Object.entries(config.forms || {}).map(([name, value]) => [name, { ...value }])),
      }])),
    } : undefined,
  };
}

function contextualAdjustment(config, baseForm, targetClass) {
  if (baseForm === 'fina') return config.contextualForms?.fina || config.forms?.fina || {};
  return config.contextualForms?.[baseForm]?.[targetClass] || config.forms?.[baseForm] || {};
}

function createContextualVector({ glyphs, sourceGlyph, character, config, cursive, form, joiningClass, options, name }) {
  const generated = generateRussianContextualFormMask(sourceGlyph, form, cursive, config);
  let vector = vectorizeBaselineGlyph(generated, character, options, {
    name,
    unicode: [],
    sideBearing: 0,
    rightSideBearing: 0,
  });
  const baseForm = generated.baseForm;
  vector = transformVector(vector, contextualAdjustment(config, baseForm, joiningClass));
  if (baseForm === 'medi' || baseForm === 'fina') {
    const entryPoint = vector.pixelToFont?.({ x: 0, y: generated.leftExternalY }) || { x: vector.xMin, y: 0 };
    vector.cursiveEntry = { x: Math.round(entryPoint.x), y: Math.round(entryPoint.y) };
  }
  if (baseForm === 'init' || baseForm === 'medi') {
    const exitPoint = vector.pixelToFont?.({ x: generated.width - 1, y: generated.rightExternalY }) || { x: vector.xMax, y: 0 };
    vector.cursiveExit = { x: Math.round(exitPoint.x), y: Math.round(exitPoint.y) };
  }
  delete vector.pixelToFont;
  const id = glyphs.length;
  glyphs.push(vector);
  return id;
}

export function buildRussianContextualCursiveFont(project, options = {}) {
  const legacy = buildLegacyCursiveFont(cloneLegacyProject(project), options);
  const glyphs = [...legacy.glyphs];
  const baseIds = new Map(Object.entries(legacy.layout.baseIds || {}).map(([character, id]) => [character, Number(id)]));
  const sourceByChar = new Map((project.glyphs || []).map((glyph) => [glyph.char, glyph]));
  const layout = {
    ...legacy.layout,
    contextualForms: {},
    contextualConfig: {},
    featureLookups: [],
    engine: 'russian-school-contextual-v1',
  };

  for (const [character, id] of baseIds) {
    const sourceGlyph = sourceByChar.get(character);
    const config = project.cursive?.glyphs?.[character];
    if (!sourceGlyph || !config || !/^[а-яё]$/u.test(character) || (!config.joinLeft && !config.joinRight)) continue;
    const baseName = glyphs[id]?.name || `uni${character.codePointAt(0).toString(16).toUpperCase()}`;
    const forms = { isol: id, init: {}, medi: {}, fina: null };
    layout.contextualConfig[character] = {
      joinLeft: Boolean(config.joinLeft),
      joinRight: Boolean(config.joinRight),
      entryClass: config.entryClass || 'middle',
      entryMode: config.entryMode || 'standard',
    };

    if (config.joinRight) {
      for (const joiningClass of JOINING_TARGET_CLASSES) {
        const suffix = FORM_SUFFIX[joiningClass];
        forms.init[joiningClass] = createContextualVector({
          glyphs,
          sourceGlyph,
          character,
          config,
          cursive: project.cursive,
          form: `init.${suffix}`,
          joiningClass,
          options,
          name: `${baseName}.init.${suffix}`,
        });
        if (config.joinLeft) {
          forms.medi[joiningClass] = createContextualVector({
            glyphs,
            sourceGlyph,
            character,
            config,
            cursive: project.cursive,
            form: `medi.${suffix}`,
            joiningClass,
            options,
            name: `${baseName}.medi.${suffix}`,
          });
        }
      }
    }

    if (config.joinLeft) {
      forms.fina = createContextualVector({
        glyphs,
        sourceGlyph,
        character,
        config,
        cursive: project.cursive,
        form: 'fina',
        joiningClass: 'none',
        options,
        name: `${baseName}.fina.ru`,
      });
    }
    layout.contextualForms[character] = forms;
  }

  for (const glyph of glyphs) delete glyph.pixelToFont;
  const inkGlyphs = glyphs.filter((glyph) => glyph.contours?.length);
  const inkTop = Math.max(0, ...inkGlyphs.map((glyph) => glyph.yMax));
  const inkBottom = Math.min(0, ...inkGlyphs.map((glyph) => glyph.yMin));
  const ascent = clamp(Math.max(Number(project.font?.ascent ?? 800), inkTop + 40), 200, 1600);
  const descent = clamp(Math.min(Number(project.font?.descent ?? -200), inkBottom - 40), -800, -1);
  layout.metrics = { ascent, descent, inkTop, inkBottom };

  const plain = buildTrueTypeFont(glyphs, {
    familyName: project.font?.familyName || project.title,
    styleName: project.font?.styleName || 'Regular',
    ascent,
    descent,
    version: '1.400',
  });
  const gsub = buildRussianContextualGsub(layout);
  layout.featureLookups = gsub.featureLookups;
  const gpos = buildRussianCursiveGpos(glyphs);
  const legacyTables = parseSfntTables(legacy.ttf).tables;
  const kern = legacyTables.find((table) => table.tag === 'kern')?.bytes;
  const additions = new Map([['GSUB', gsub.bytes], ['GPOS', gpos]]);
  if (kern) additions.set('kern', kern);
  const ttf = rebuildSfntWithTables(plain, additions);
  return {
    ttf,
    glyphs,
    layout,
    tables: parseSfntTables(ttf).tables.map((table) => table.tag),
  };
}
