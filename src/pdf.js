const encoder = new TextEncoder();
const A4_POINTS = Object.freeze({ width: 595.2756, height: 841.8898 });

function ascii(value) { return encoder.encode(value); }
function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function objectBytes(number, bodyParts) { return concatBytes([ascii(`${number} 0 obj\n`), ...bodyParts, ascii('\nendobj\n')]); }

export function buildJpegPdf(jpegPages, options = {}) {
  if (!Array.isArray(jpegPages) || !jpegPages.length) throw new Error('PDF requires at least one page.');
  const title = String(options.title || 'Draw Your Font RU template').replace(/[()\\]/g, '');
  const xmlTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pageCount = jpegPages.length;
  const pageObjectNumbers = jpegPages.map((_, index) => 7 + index * 3);
  const objects = new Map();
  objects.set(1, objectBytes(1, [ascii('<< /Type /Catalog /Pages 2 0 R /Metadata 3 0 R >>')]));
  objects.set(2, objectBytes(2, [ascii(`<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] >>`)]));
  const metadata = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:title="${xmlTitle}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const metadataBytes = ascii(metadata);
  objects.set(3, objectBytes(3, [ascii(`<< /Type /Metadata /Subtype /XML /Length ${metadataBytes.length} >>\nstream\n`), metadataBytes, ascii('\nendstream')]));
  objects.set(4, objectBytes(4, [ascii('<< /Title (Draw Your Font RU template) /Creator (Draw Your Font RU) /Producer (Draw Your Font RU browser PDF writer) >>')]));

  jpegPages.forEach((page, index) => {
    const imageNumber = 5 + index * 3;
    const contentNumber = imageNumber + 1;
    const pageNumber = imageNumber + 2;
    const bytes = page.bytes instanceof Uint8Array ? page.bytes : new Uint8Array(page.bytes);
    if (!page.width || !page.height || !bytes.length) throw new Error(`Invalid JPEG page ${index + 1}.`);
    objects.set(imageNumber, objectBytes(imageNumber, [
      ascii(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`), bytes, ascii('\nendstream'),
    ]));
    const content = ascii(`q\n${A4_POINTS.width.toFixed(4)} 0 0 ${A4_POINTS.height.toFixed(4)} 0 0 cm\n/Im0 Do\nQ\n`);
    objects.set(contentNumber, objectBytes(contentNumber, [ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('endstream')]));
    objects.set(pageNumber, objectBytes(pageNumber, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_POINTS.width.toFixed(4)} ${A4_POINTS.height.toFixed(4)}] /Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`)]));
  });

  const objectCount = 4 + pageCount * 3;
  const header = concatBytes([ascii('%PDF-1.4\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), ascii('\n')]);
  const chunks = [header];
  const offsets = new Array(objectCount + 1).fill(0);
  let currentOffset = header.length;
  for (let number = 1; number <= objectCount; number += 1) {
    const object = objects.get(number);
    if (!object) throw new Error(`Missing PDF object ${number}.`);
    offsets[number] = currentOffset; chunks.push(object); currentOffset += object.length;
  }
  const xrefOffset = currentOffset;
  const xrefLines = [`xref\n0 ${objectCount + 1}\n`, '0000000000 65535 f \n'];
  for (let number = 1; number <= objectCount; number += 1) xrefLines.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  chunks.push(ascii(xrefLines.join('')));
  chunks.push(ascii(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return concatBytes(chunks);
}

export function countPdfPages(pdfBytes) {
  const text = new TextDecoder('latin1').decode(pdfBytes);
  const match = text.match(/\/Type\s*\/Pages\s*\/Count\s+(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function validatePdfStructure(pdfBytes) {
  const errors = [];
  const text = new TextDecoder('latin1').decode(pdfBytes);
  if (!text.startsWith('%PDF-1.4')) errors.push('Нет корректного PDF-заголовка.');
  if (!text.includes('xref\n')) errors.push('Нет таблицы xref.');
  if (!text.trimEnd().endsWith('%%EOF')) errors.push('Нет маркера EOF.');
  const startMatch = text.match(/startxref\n(\d+)\n%%EOF/);
  if (!startMatch) errors.push('Нет startxref.');
  else if (text.slice(Number(startMatch[1]), Number(startMatch[1]) + 4) !== 'xref') errors.push('startxref указывает не на xref.');
  return errors;
}

export async function canvasToJpegPage(canvas, quality = 0.93) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Не удалось получить JPEG страницы.')), 'image/jpeg', quality));
  return { width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

export async function generateTemplatePdf(plan, renderPage, options = {}) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const pages = [];
  for (const page of plan.pages) {
    renderPage(context, page, { dpi: options.dpi || 200, showGuides: options.showGuides !== false });
    pages.push(await canvasToJpegPage(canvas, options.quality || 0.93));
    if (typeof options.onProgress === 'function') options.onProgress(pages.length, plan.pages.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const bytes = buildJpegPdf(pages, { title: plan.title });
  return new Blob([bytes], { type: 'application/pdf' });
}
