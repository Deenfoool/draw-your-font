const byId = id => document.getElementById(id);

function confidenceGroup(value) {
  if (value >= 80) return { key: 'high', label: 'Надёжно' };
  if (value >= 55) return { key: 'medium', label: 'Проверить' };
  return { key: 'low', label: 'Низкая уверенность' };
}

function allScans() {
  try { return window.__drawYourFontProject?.getState?.().scans || []; }
  catch { return []; }
}

function qualitySummary(scans) {
  const glyphs = scans.flatMap(scan => scan.glyphs || []);
  const groups = { high: [], medium: [], low: [] };
  for (const glyph of glyphs) {
    const confidence = Number(glyph.quality?.confidence ?? (glyph.quality?.warnings?.length ? 60 : 85));
    groups[confidenceGroup(confidence).key].push({ glyph, confidence });
  }
  const average = glyphs.length ? Math.round(glyphs.reduce((sum, glyph) => sum + Number(glyph.quality?.confidence ?? 70), 0) / glyphs.length) : 0;
  return { glyphs, groups, average };
}

function decoratePageCards(scans) {
  const cards = [...document.querySelectorAll('#scanPages .scan-page-card:not(.scan-page-error)')];
  scans.forEach((scan, index) => {
    const card = cards[index];
    if (!card) return;
    const confidence = Number(scan.recognition?.confidence ?? 0);
    const group = confidenceGroup(confidence);
    card.dataset.recognitionQuality = group.key;
    let badge = card.querySelector('.recognition-page-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'recognition-page-badge';
      card.prepend(badge);
    }
    const text = `${confidence}% · ${group.label}`;
    if (badge.textContent !== text) badge.textContent = text;
  });
}

function renderRecognitionQuality() {
  const report = byId('scanReport');
  if (!report) return;
  const scans = allScans();
  let panel = byId('recognitionQualityPanel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'recognitionQualityPanel';
    panel.className = 'recognition-quality-panel';
    report.after(panel);
  }
  if (!scans.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const summary = qualitySummary(scans);
  const problemGlyphs = [...summary.groups.low, ...summary.groups.medium]
    .sort((left, right) => left.confidence - right.confidence)
    .slice(0, 40);
  panel.innerHTML = `
    <header>
      <div><strong>Recognition Engine 2.0</strong><span>Без нейросетей · выбран лучший вариант маски</span></div>
      <b>${summary.average}%</b>
    </header>
    <div class="recognition-quality-stats">
      <span data-level="high"><strong>${summary.groups.high.length}</strong> надёжных</span>
      <span data-level="medium"><strong>${summary.groups.medium.length}</strong> проверить</span>
      <span data-level="low"><strong>${summary.groups.low.length}</strong> проблемных</span>
    </div>
    ${problemGlyphs.length ? `<details><summary>Какие символы проверить в редакторе</summary><div class="recognition-problem-list">${problemGlyphs.map(({ glyph, confidence }) => {
      const warnings = (glyph.quality?.warnings || []).slice(0, 2).join(' · ');
      return `<span data-level="${confidenceGroup(confidence).key}" title="${warnings.replaceAll('"', '&quot;')}"><b>${glyph.char || '—'}</b>${confidence}%</span>`;
    }).join('')}</div></details>` : '<p class="recognition-all-good">Все символы распознаны уверенно.</p>'}
  `;
  decoratePageCards(scans);
}

window.addEventListener('drawyourfont:project-updated', () => setTimeout(renderRecognitionQuality, 0));
window.addEventListener('drawyourfont:segmentation-updated', () => setTimeout(renderRecognitionQuality, 0));
const observer = new MutationObserver(() => {
  if (allScans().length) queueMicrotask(renderRecognitionQuality);
});
const start = () => {
  const target = byId('scanPages');
  if (!target) return setTimeout(start, 50);
  observer.observe(target, { childList: true, subtree: true });
  renderRecognitionQuality();
};
start();

window.__drawYourFontRecognition = {
  version: 2,
  refresh: renderRecognitionQuality,
  getSummary: () => qualitySummary(allScans()),
};
