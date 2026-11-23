import { describe, expect, test } from 'vitest';
import { decodePlayCsvBytes, readPlayCsvTable } from './play-csv-table.ts';

function encodeUtf16LittleEndianWithBom(csvDocument: string): Uint8Array {
  const bufferBytes = Buffer.from([0xff, 0xfe]);
  return Buffer.concat([bufferBytes, Buffer.from(csvDocument, 'utf16le')]);
}
function describeDecodePlayCsvBytes() {
  function decodesUTF16LEAndDropsTheByteOrderMark() {
    const csvBytes = encodeUtf16LittleEndianWithBom('Date,Package Name\n2026-10-01,com.fit');

    const csvDocument = decodePlayCsvBytes(csvBytes);

    expect(csvDocument).toBe('Date,Package Name\n2026-10-01,com.fit');
  }

  test('decodes UTF-16LE and drops the byte order mark', decodesUTF16LEAndDropsTheByteOrderMark);
  function decodesUTF8WhenThereIsNoUTF16ByteOrderMark() {
    const csvBytes = Buffer.from('Description,Amount\nGPA.1,1.5', 'utf8');

    const csvDocument = decodePlayCsvBytes(csvBytes);

    expect(csvDocument).toBe('Description,Amount\nGPA.1,1.5');
  }

  test(
    'decodes UTF-8 when there is no UTF-16 byte order mark',
    decodesUTF8WhenThereIsNoUTF16ByteOrderMark,
  );
  function decodesAnEmptyFileAsAnEmptyDocument() {
    const playCsvBytes = decodePlayCsvBytes(new Uint8Array());
    expect(playCsvBytes).toBe('');
  }

  test('decodes an empty file as an empty document', decodesAnEmptyFileAsAnEmptyDocument);
}

describe('decodePlayCsvBytes', describeDecodePlayCsvBytes);
function describeReadPlayCsvTable() {
  function keysEveryLineByItsLowerCasedTrimmedHeaderNames() {
    const table = readPlayCsvTable('Date, Daily Device Installs \n2026-10-01,5\n2026-10-02,7\n');

    expect(table.lines).toEqual([
      { date: '2026-10-01', 'daily device installs': '5' },
      { date: '2026-10-02', 'daily device installs': '7' },
    ]);
  }

  test(
    'keys every line by its lower-cased, trimmed header names',
    keysEveryLineByItsLowerCasedTrimmedHeaderNames,
  );
  function readsWindowsLineBreaksAndSkipsBlankLines() {
    const table = readPlayCsvTable('Date,Daily Crashes\r\n2026-10-01,2\r\n\r\n2026-10-02,0\r\n');

    expect(table.lines).toHaveLength(2);
    expect(table.lines[1]).toEqual({ date: '2026-10-02', 'daily crashes': '0' });
  }

  test('reads Windows line breaks and skips blank lines', readsWindowsLineBreaksAndSkipsBlankLines);
  function readsQuotedCellsWithCommasDoubledQuotesAndNewLines() {
    const table = readPlayCsvTable('Product Title,Note\n"Coins, big","He said ""hi""\nthere"\n');

    expect(table.lines).toEqual([{ 'product title': 'Coins, big', note: 'He said "hi"\nthere' }]);
  }

  test(
    'reads quoted cells with commas, doubled quotes and new lines',
    readsQuotedCellsWithCommasDoubledQuotesAndNewLines,
  );
  function keepsALastLineThatHasNoPieceLineBreak() {
    const table = readPlayCsvTable('Date,Daily Crashes\n2026-10-01,2');

    expect(table.lines).toEqual([{ date: '2026-10-01', 'daily crashes': '2' }]);
  }

  test('keeps a last line that has no final line break', keepsALastLineThatHasNoPieceLineBreak);
  function leavesOutCellsAShortLineDoesNotHave() {
    const table = readPlayCsvTable('Date,Daily Crashes\n2026-10-01\n');

    expect(table.lines).toEqual([{ date: '2026-10-01' }]);
  }

  test('leaves out cells a short line does not have', leavesOutCellsAShortLineDoesNotHave);
  function givesNoLinesForAnEmptyDocumentOrAHeaderOnly() {
    const playCsvTable = readPlayCsvTable('');
    expect(playCsvTable.lines).toEqual([]);
    expect(readPlayCsvTable('Date,Daily Crashes\n').lines).toEqual([]);
  }

  test(
    'gives no lines for an empty document or a header only',
    givesNoLinesForAnEmptyDocumentOrAHeaderOnly,
  );
}

describe('readPlayCsvTable', describeReadPlayCsvTable);
