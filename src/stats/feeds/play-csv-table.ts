export interface PlayCsvTable {
  readonly lines: readonly Readonly<Record<string, string>>[];
}

const utf16LittleEndianBomFirstByte = 0xff;
const utf16LittleEndianBomSecondByte = 0xfe;

/** Play stats CSVs are UTF-16LE with a BOM; the earnings CSVs are plain UTF-8. */
export function decodePlayCsvBytes(csvBytes: Uint8Array): string {
  const isUtf16LittleEndian =
    csvBytes[0] == utf16LittleEndianBomFirstByte && csvBytes[1] == utf16LittleEndianBomSecondByte;
  if (isUtf16LittleEndian) return new TextDecoder('utf-16le').decode(csvBytes);
  return new TextDecoder('utf-8').decode(csvBytes);
}

/** The CSV as lines keyed by lower-cased, trimmed header names, so a column is found by name and not by position. */
export function readPlayCsvTable(csvDocument: string): PlayCsvTable {
  const rows = readCsvRows(csvDocument);
  const headerRow = rows[0];

  if (headerRow == null) {
    return { lines: [] };
  }

  const headers = headerRow.map(headerName);
  const lines: Record<string, string>[] = [];

  for (const row of rows.slice(1)) {
    const line: Record<string, string> = {};

    for (let cellIndex = 0; cellIndex < headers.length; cellIndex += 1) {
      const header = headers[cellIndex];
      const cell = row[cellIndex];

      if (header == null) {
        continue;
      }

      if (cell == null) {
        continue;
      }

      line[header] = cell;
    }

    lines.push(line);
  }

  return { lines };
}

function headerName(headerCell: string): string {
  return headerCell.trim().toLowerCase();
}

function readCsvRows(csvDocument: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let index = 0;

  while (index < csvDocument.length) {
    const character = csvDocument[index];

    if (character == null) {
      break;
    }

    if (inQuotes) {
      index = readQuotedCharacter(csvDocument, index, character);
      continue;
    }

    if (character == '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (character == ',') {
      row.push(cell.trim());
      cell = '';
      index += 1;
      continue;
    }

    if (character == '\n' || character == '\r') {
      if (character == '\r' && csvDocument[index + 1] == '\n') {
        index += 1;
      }

      row.push(cell.trim());
      cell = '';
      pushRow(rows, row);
      row = [];
      index += 1;
      continue;
    }

    cell += character;
    index += 1;
  }

  const hasRemainder = cell != '' || row.length > 0;

  if (hasRemainder) {
    row.push(cell.trim());
    pushRow(rows, row);
  }

  return rows;

  function readQuotedCharacter(document: string, cursor: number, current: string): number {
    if (current != '"') {
      cell += current;

      return cursor + 1;
    }

    const next = document[cursor + 1];

    if (next == '"') {
      cell += '"';

      return cursor + 2;
    }

    inQuotes = false;

    return cursor + 1;
  }
}

function pushRow(rows: string[][], row: string[]): void {
  const isBlank = row.length == 1 && row[0] == '';

  if (isBlank) {
    return;
  }

  rows.push(row);
}
