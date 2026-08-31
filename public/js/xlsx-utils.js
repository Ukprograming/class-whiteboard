const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 48 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 600;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlText(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity.toLowerCase().startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity.toLowerCase()] || match;
  });
}

function readXmlAttribute(tag, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`(?:^|\\s)${escapedName}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeXmlText(match?.[1] ?? match?.[2] ?? "");
}

export function extractVisibleSpreadsheetText(xml) {
  const visibleXml = String(xml || "")
    .replace(/<(?:\w+:)?rPh\b[^>]*>[\s\S]*?<\/(?:\w+:)?rPh>/gi, "")
    .replace(/<(?:\w+:)?phoneticPr\b[^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?phoneticPr>)/gi, "");
  const text = [];
  for (const match of visibleXml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)) {
    text.push(decodeXmlText(match[1]));
  }
  return text.join("");
}

function normalizeZipPath(basePath, targetPath) {
  const target = String(targetPath || "").replace(/\\/g, "/");
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const parts = `${basePath}/${target}`.split("/");
  const normalized = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("ExcelファイルのZIP構造を確認できませんでした。");
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("このブラウザはExcel読込に対応していません。ChromeまたはEdgeの最新版をお使いください。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipWorkbook(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
    throw new Error("Excelファイルが空です。");
  }
  if (arrayBuffer.byteLength > MAX_WORKBOOK_BYTES) {
    throw new Error("Excelファイルは8MB以下にしてください。");
  }

  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error("Excelファイル内の項目数が多すぎます。");

  const entries = new Map();
  let offset = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Excelファイルの項目一覧が壊れています。");
    }
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength));

    if ((flags & 0x1) !== 0) throw new Error("パスワードで保護されたExcelファイルは読み込めません。");
    if (uncompressedSize > MAX_UNCOMPRESSED_ENTRY_BYTES) throw new Error("Excelファイル内のデータが大きすぎます。");
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("Excelファイルの展開サイズが大きすぎます。");
    if (localHeaderOffset + 30 > view.byteLength || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error("Excelファイルのデータ位置を確認できませんでした。");
    }

    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (compressionMethod === 0) content = new Uint8Array(compressed);
    else if (compressionMethod === 8) content = await inflateRaw(compressed);
    else throw new Error("この圧縮方式のExcelファイルには対応していません。");
    entries.set(fileName.replace(/^\/+/, ""), content);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeEntry(entries, path) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Excelファイル内に必要なデータがありません: ${path}`);
  return decoder.decode(bytes);
}

function findWorksheetPath(entries, sheetName) {
  const workbookXml = decodeEntry(entries, "xl/workbook.xml");
  let relationshipId = "";
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?\s*>/gi)) {
    if (readXmlAttribute(match[0], "name") === sheetName) {
      relationshipId = readXmlAttribute(match[0], "r:id");
      break;
    }
  }
  if (!relationshipId) throw new Error(`「${sheetName}」シートが見つかりません。シート名を変更せずにお使いください。`);

  const relationshipsXml = decodeEntry(entries, "xl/_rels/workbook.xml.rels");
  for (const match of relationshipsXml.matchAll(/<(?:\w+:)?Relationship\b[^>]*\/?\s*>/gi)) {
    if (readXmlAttribute(match[0], "Id") === relationshipId) {
      return normalizeZipPath("xl", readXmlAttribute(match[0], "Target"));
    }
  }
  throw new Error("入力シートの参照先を確認できませんでした。");
}

function readSharedStrings(entries) {
  const bytes = entries.get("xl/sharedStrings.xml");
  if (!bytes) return [];
  const xml = decoder.decode(bytes);
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi)]
    .map((match) => extractVisibleSpreadsheetText(match[1]));
}

function columnIndexFromReference(reference) {
  const letters = String(reference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let index = 0;
  for (const letter of letters) index = (index * 26) + letter.charCodeAt(0) - 64;
  return index - 1;
}

function cellText(cellTag, cellBody, sharedStrings) {
  const type = readXmlAttribute(cellTag, "t");
  if (type === "inlineStr") return extractVisibleSpreadsheetText(cellBody);
  const value = cellBody.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i)?.[1] ?? "";
  if (type === "s") return sharedStrings[Number.parseInt(value, 10)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  if (type === "str") return decodeXmlText(value);
  return decodeXmlText(value);
}

function readRows(entries, worksheetPath, { maxColumns = 64, maxRows = 500 } = {}) {
  const worksheetXml = decodeEntry(entries, worksheetPath);
  const sharedStrings = readSharedStrings(entries);
  const rows = [];
  for (const rowMatch of worksheetXml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    if (rows.length >= maxRows) throw new Error(`Excelファイルは${maxRows}行以内にしてください。`);
    const rowTag = `<row${rowMatch[1]}>`;
    const rowNumber = Number.parseInt(readXmlAttribute(rowTag, "r"), 10) || rows.length + 1;
    const values = [];
    for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/gi)) {
      const cellTag = `<c${cellMatch[1]}>`;
      const columnIndex = columnIndexFromReference(readXmlAttribute(cellTag, "r"));
      if (columnIndex >= maxColumns) throw new Error(`Excelファイルは${maxColumns}列以内にしてください。`);
      if (columnIndex >= 0) values[columnIndex] = cellText(cellTag, cellMatch[2], sharedStrings);
    }
    rows.push({ rowNumber, values: Array.from({ length: values.length }, (_, index) => values[index] ?? "") });
  }
  return rows;
}

export async function parseXlsxSheet(file, sheetName, options = {}) {
  if (!file || !String(file.name || "").toLowerCase().endsWith(".xlsx")) {
    throw new Error(".xlsx形式のExcelファイルを選択してください。");
  }
  const entries = await unzipWorkbook(await file.arrayBuffer());
  const worksheetPath = findWorksheetPath(entries, sheetName);
  return readRows(entries, worksheetPath, options);
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

const STYLE_IDS = Object.freeze({ body: 0, header: 1, title: 2, note: 3, metaLabel: 4 });

function makeCellXml(value, rowIndex, columnIndex, styleId = 0) {
  if (value === null || value === undefined || value === "") return "";
  const ref = `${columnName(columnIndex)}${rowIndex}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" s="${styleId}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = escapeXml(value);
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function buildWorksheetXml(sheet) {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const maxColumns = Math.max(1, ...rows.map((row) => Array.isArray(row) ? row.length : 0));
  const maxRows = Math.max(1, rows.length);
  const rowStyleMap = sheet.rowStyles || {};
  const cellStyleMap = sheet.cellStyles || {};
  const rowHeights = sheet.rowHeights || {};
  const rowXml = rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 1;
    const rowStyle = STYLE_IDS[rowStyleMap[excelRow]] ?? 0;
    const cells = (row || []).map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${excelRow}`;
      const styleId = STYLE_IDS[cellStyleMap[ref]] ?? rowStyle;
      return makeCellXml(value, excelRow, columnIndex, styleId);
    }).join("");
    const height = Number(rowHeights[excelRow]);
    const heightAttrs = Number.isFinite(height) ? ` ht="${height}" customHeight="1"` : "";
    return `<row r="${excelRow}"${heightAttrs}>${cells}</row>`;
  }).join("");

  const widths = Array.from({ length: maxColumns }, (_, index) => {
    const requested = Number(sheet.columnWidths?.[index]);
    const width = Number.isFinite(requested) ? Math.max(6, Math.min(requested, 80)) : 18;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const freezeRows = Math.max(0, Number(sheet.freezeRows) || 0);
  const pane = freezeRows
    ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  const selection = freezeRows ? '<selection pane="bottomLeft" activeCell="A1" sqref="A1"/>' : '<selection activeCell="A1" sqref="A1"/>';
  const filter = sheet.autoFilterRow
    ? `<autoFilter ref="A${sheet.autoFilterRow}:${columnName(maxColumns - 1)}${maxRows}"/>`
    : "";
  const mergeCells = (sheet.merges || []).length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${escapeXml(ref)}"/>`).join("")}</mergeCells>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${columnName(maxColumns - 1)}${maxRows}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}${selection}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${widths}</cols>
  <sheetData>${rowXml}</sheetData>
  ${filter}${mergeCells}
</worksheet>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Yu Gothic"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Yu Gothic"/><family val="2"/></font>
    <font><b/><color rgb="FF183A4A"/><sz val="16"/><name val="Yu Gothic"/><family val="2"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2478B8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDFF3F4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F7F9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD3E0E6"/></left><right style="thin"><color rgb="FFD3E0E6"/></right><top style="thin"><color rgb="FFD3E0E6"/></top><bottom style="thin"><color rgb="FFD3E0E6"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  entries.forEach(({ name, content }) => {
    const nameBytes = encoder.encode(name);
    const dataBytes = typeof content === "string" ? encoder.encode(content) : content;
    const checksum = crc32(dataBytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    localParts.push(local, dataBytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    localOffset += local.length + dataBytes.length;
  });

  const centralBytes = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, localOffset, true);
  return concatBytes([...localParts, centralBytes, end]);
}

function safeSheetName(name, index) {
  const cleaned = String(name || `Sheet${index + 1}`).replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

export function createXlsxBlob({ sheets = [], creator = "Class Whiteboard" } = {}) {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error("Excelには1つ以上のシートが必要です。");
  const normalizedSheets = sheets.map((sheet, index) => ({ ...sheet, name: safeSheetName(sheet.name, index) }));
  const sheetEntries = normalizedSheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    content: buildWorksheetXml(sheet),
  }));
  const workbookSheets = normalizedSheets.map((sheet, index) =>
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  const workbookRels = normalizedSheets.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  const sheetOverrides = normalizedSheets.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  const now = new Date().toISOString();
  const entries = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheetOverrides}</Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "docProps/core.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${escapeXml(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${normalizedSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: buildStylesXml() },
    ...sheetEntries,
  ];
  return new Blob([createZip(entries)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = String(filename || "download.xlsx");
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeExcelFilename(value, fallback = "form") {
  const cleaned = String(value || "").trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").slice(0, 80);
  return cleaned || fallback;
}
