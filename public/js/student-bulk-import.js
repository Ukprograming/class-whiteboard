export const STUDENT_IMPORT_SHEET_NAME = "生徒一括登録";
export const STUDENT_IMPORT_HEADERS = Object.freeze([
  "生徒ID（ログイン用）",
  "表示名（画面表示用）",
  "初期パスワード",
]);
export const MAX_STUDENT_IMPORT_ROWS = 200;

const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;

function decodeXmlText(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity.toLowerCase().startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
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
    throw new Error("Excelファイルは5MB以下にしてください。");
  }

  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error("Excelファイル内の項目数が多すぎます。");
  }

  const decoder = new TextDecoder("utf-8");
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
  return new TextDecoder("utf-8").decode(bytes);
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
  if (!relationshipId) throw new Error(`「${sheetName}」シートが見つかりません。ひな型のシート名を変更せずにお使いください。`);

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
  const xml = new TextDecoder("utf-8").decode(bytes);
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi)].map((match) => extractVisibleSpreadsheetText(match[1]));
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

function readRows(entries, worksheetPath) {
  const worksheetXml = decodeEntry(entries, worksheetPath);
  const sharedStrings = readSharedStrings(entries);
  const rows = [];
  for (const rowMatch of worksheetXml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    const rowTag = `<row${rowMatch[1]}>`;
    const rowNumber = Number.parseInt(readXmlAttribute(rowTag, "r"), 10) || rows.length + 1;
    const values = ["", "", ""];
    for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/gi)) {
      const cellTag = `<c${cellMatch[1]}>`;
      const columnIndex = columnIndexFromReference(readXmlAttribute(cellTag, "r"));
      if (columnIndex >= 0 && columnIndex < values.length) {
        values[columnIndex] = cellText(cellTag, cellMatch[2], sharedStrings);
      }
    }
    rows.push({ rowNumber, values });
  }
  return rows;
}

export async function parseStudentWorkbook(file) {
  if (!file || !String(file.name || "").toLowerCase().endsWith(".xlsx")) {
    throw new Error(".xlsx形式のExcelファイルを選択してください。");
  }
  const entries = await unzipWorkbook(await file.arrayBuffer());
  const worksheetPath = findWorksheetPath(entries, STUDENT_IMPORT_SHEET_NAME);
  const rows = readRows(entries, worksheetPath);
  const headerRow = rows.find((row) => row.rowNumber === 1) || { values: [] };
  return { headers: headerRow.values, rows: rows.filter((row) => row.rowNumber >= 2) };
}

export function validateStudentImport({ headers, rows }, existingStudents = []) {
  const normalizedHeaders = STUDENT_IMPORT_HEADERS.map((_, index) => String(headers?.[index] || "").trim());
  const headerMatches = STUDENT_IMPORT_HEADERS.every((header, index) => normalizedHeaders[index] === header);
  if (!headerMatches) {
    return {
      validRows: [],
      errors: [{ rowNumber: 1, message: "1行目の見出しがひな型と異なります。ひな型を再度ダウンロードしてください。" }],
      dataRowCount: 0,
    };
  }

  const nonBlankRows = (rows || []).filter((row) => row.values.some((value) => String(value ?? "").trim() !== ""));
  if (nonBlankRows.length > MAX_STUDENT_IMPORT_ROWS) {
    return {
      validRows: [],
      errors: [{ rowNumber: 0, message: `1回に登録できるのは${MAX_STUDENT_IMPORT_ROWS}人までです。ファイルを分けてください。` }],
      dataRowCount: nonBlankRows.length,
    };
  }

  const existingLoginIds = new Set(existingStudents.map((student) => String(student.student_login_id || "").trim().toLowerCase()));
  const seenLoginIds = new Map();
  const validRows = [];
  const errors = [];

  for (const row of nonBlankRows) {
    const studentLoginId = String(row.values[0] ?? "").trim().toLowerCase();
    const displayName = String(row.values[1] ?? "").trim();
    const password = String(row.values[2] ?? "");
    const rowErrors = [];

    if (!/^[a-z0-9_-]{1,24}$/.test(studentLoginId)) {
      rowErrors.push("生徒IDは半角英数字・_・- の24文字以内で入力してください");
    }
    if (!displayName) rowErrors.push("表示名を入力してください");
    else if (displayName.length > 80) rowErrors.push("表示名は80文字以内で入力してください");
    if (password.length < 8) rowErrors.push("初期パスワードは8文字以上で入力してください");
    if (existingLoginIds.has(studentLoginId)) rowErrors.push("このクラスに同じ生徒IDが登録済みです");
    if (seenLoginIds.has(studentLoginId)) rowErrors.push(`${seenLoginIds.get(studentLoginId)}行目と生徒IDが重複しています`);

    if (studentLoginId && !seenLoginIds.has(studentLoginId)) seenLoginIds.set(studentLoginId, row.rowNumber);
    if (rowErrors.length > 0) {
      errors.push({ rowNumber: row.rowNumber, studentLoginId, message: rowErrors.join(" / ") });
    } else {
      validRows.push({ rowNumber: row.rowNumber, studentLoginId, displayName, password });
    }
  }

  if (nonBlankRows.length === 0) {
    errors.push({ rowNumber: 0, message: "登録する生徒が入力されていません。2行目以降に入力してください。" });
  }
  return { validRows, errors, dataRowCount: nonBlankRows.length };
}
