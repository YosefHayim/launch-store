import { parse } from 'csv-parse/sync';

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

/** The CSV as lines keyed by lower-cased, trimmed header names, so a column is found by name and not by position. */
export const readPlayCsvTable = (csvDocument: string): PlayCsvTable => {
  const lines: Record<string, string>[] = parse(csvDocument, {
    columns: (headerCells: string[]) =>
      headerCells.map((headerCell) => headerCell.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  return { lines };
};
