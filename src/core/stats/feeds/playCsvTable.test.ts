import { describe, expect, test } from 'vitest';
import { decodePlayCsvBytes, readPlayCsvTable } from './playCsvTable.js';

const encodeUtf16LittleEndianWithBom = (csvDocument: string): Uint8Array =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csvDocument, 'utf16le')]);

describe('decodePlayCsvBytes', () => {
  test('decodes UTF-16LE and drops the byte order mark', () => {
    const csvBytes = encodeUtf16LittleEndianWithBom('Date,Package Name\n2026-10-01,com.fit');

    const csvDocument = decodePlayCsvBytes(csvBytes);

    expect(csvDocument).toBe('Date,Package Name\n2026-10-01,com.fit');
  });

  test('decodes UTF-8 when there is no UTF-16 byte order mark', () => {
    const csvBytes = Buffer.from('Description,Amount\nGPA.1,1.5', 'utf8');

    const csvDocument = decodePlayCsvBytes(csvBytes);

    expect(csvDocument).toBe('Description,Amount\nGPA.1,1.5');
  });

  test('decodes an empty file as an empty document', () => {
    expect(decodePlayCsvBytes(new Uint8Array())).toBe('');
  });
});

describe('readPlayCsvTable', () => {
  test('keys every line by its lower-cased, trimmed header names', () => {
    const table = readPlayCsvTable('Date, Daily Device Installs \n2026-10-01,5\n2026-10-02,7\n');

    expect(table.lines).toEqual([
      { date: '2026-10-01', 'daily device installs': '5' },
      { date: '2026-10-02', 'daily device installs': '7' },
    ]);
  });

  test('reads Windows line breaks and skips blank lines', () => {
    const table = readPlayCsvTable('Date,Daily Crashes\r\n2026-10-01,2\r\n\r\n2026-10-02,0\r\n');

    expect(table.lines).toHaveLength(2);
    expect(table.lines[1]).toEqual({ date: '2026-10-02', 'daily crashes': '0' });
  });

  test('reads quoted cells with commas, doubled quotes and new lines', () => {
    const table = readPlayCsvTable('Product Title,Note\n"Coins, big","He said ""hi""\nthere"\n');

    expect(table.lines).toEqual([{ 'product title': 'Coins, big', note: 'He said "hi"\nthere' }]);
  });

  test('keeps a last line that has no final line break', () => {
    const table = readPlayCsvTable('Date,Daily Crashes\n2026-10-01,2');

    expect(table.lines).toEqual([{ date: '2026-10-01', 'daily crashes': '2' }]);
  });

  test('leaves out cells a short line does not have', () => {
    const table = readPlayCsvTable('Date,Daily Crashes\n2026-10-01\n');

    expect(table.lines).toEqual([{ date: '2026-10-01' }]);
  });

  test('gives no lines for an empty document or a header only', () => {
    expect(readPlayCsvTable('').lines).toEqual([]);
    expect(readPlayCsvTable('Date,Daily Crashes\n').lines).toEqual([]);
  });
});
