export interface PlayCsvTable {
  readonly lines: readonly Readonly<Record<string, string>>[];
}

const UTF16_LITTLE_ENDIAN_BOM_FIRST_BYTE = 0xff;
const UTF16_LITTLE_ENDIAN_BOM_SECOND_BYTE = 0xfe;

/** Play stats CSVs are UTF-16LE with a BOM; the earnings CSVs are plain UTF-8. */
export const decodePlayCsvBytes = (csvBytes: Uint8Array): string => {
  const isUtf16LittleEndian =
    csvBytes[0] === UTF16_LITTLE_ENDIAN_BOM_FIRST_BYTE &&
    csvBytes[1] === UTF16_LITTLE_ENDIAN_BOM_SECOND_BYTE;
  if (isUtf16LittleEndian) return new TextDecoder('utf-16le').decode(csvBytes);
  return new TextDecoder('utf-8').decode(csvBytes);
};

/** Cells split per the Play escaping scheme: a quoted cell may hold commas, new lines and doubled quotes. */
const splitCsvCells = (csvDocument: string): string[][] => {
  const cellLines: string[][] = [];
  let currentLine: string[] = [];
  let currentCell = '';
  let isInsideQuotes = false;
  for (let position = 0; position < csvDocument.length; position += 1) {
    const character = csvDocument.charAt(position);
    const isDoubledQuote =
      isInsideQuotes && character === '"' && csvDocument.charAt(position + 1) === '"';
    if (isDoubledQuote) {
      currentCell += '"';
      position += 1;
      continue;
    }
    if (character === '"') {
      isInsideQuotes = !isInsideQuotes;
      continue;
    }
    const isCellEnd = !isInsideQuotes && character === ',';
    if (isCellEnd) {
      currentLine.push(currentCell);
      currentCell = '';
      continue;
    }
    const isLineEnd = !isInsideQuotes && (character === '\n' || character === '\r');
    if (isLineEnd) {
      const isWindowsLineBreak = character === '\r' && csvDocument.charAt(position + 1) === '\n';
      if (isWindowsLineBreak) position += 1;
      currentLine.push(currentCell);
      cellLines.push(currentLine);
      currentLine = [];
      currentCell = '';
      continue;
    }
    currentCell += character;
  }
  const isLastLineUnfinished = currentCell !== '' || currentLine.length > 0;
  if (isLastLineUnfinished) {
    currentLine.push(currentCell);
    cellLines.push(currentLine);
  }
  return cellLines;
};

/** The CSV as lines keyed by lower-cased, trimmed header names, so a column is found by name and not by position. */
export const readPlayCsvTable = (csvDocument: string): PlayCsvTable => {
  const [headerCells, ...bodyLines] = splitCsvCells(csvDocument);
  if (headerCells === undefined) return { lines: [] };
  const headerNames = headerCells.map((headerCell) => headerCell.trim().toLowerCase());
  const lines = bodyLines
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => {
      const keyedCells: Record<string, string> = {};
      for (const [position, headerName] of headerNames.entries()) {
        const cell = cells[position];
        if (cell !== undefined) keyedCells[headerName] = cell.trim();
      }
      return keyedCells;
    });
  return { lines };
};
