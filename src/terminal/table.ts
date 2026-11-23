// Lines up text columns so a Launch table prints evenly in the terminal.

export type Column<TableEntry> = Readonly<{
  header: string;
  cell: (tableEntry: TableEntry) => string;
}>;

export function alignTableColumns<TableEntry>(
  columns: readonly Column<TableEntry>[],
  tableEntries: readonly TableEntry[],
): string {
  function readColumnWidth(column: {
    readonly header: string;
    readonly cell: (tableEntry: TableEntry) => string;
  }) {
    function readCellLength(tableEntry: TableEntry) {
      return column.cell(tableEntry).length;
    }

    return Math.max(column.header.length, ...tableEntries.map(readCellLength));
  }

  const widths = columns.map(readColumnWidth);

  function padCell(cell: string, columnIndex: number) {
    const columnWidth = widths[columnIndex];

    const isColumnWidthMissing = columnWidth == null;

    if (isColumnWidthMissing) return cell;

    return cell.padEnd(columnWidth);
  }

  function joinCellsIntoLine(cells: readonly string[]): string {
    return cells.map(padCell).join('  ').trimEnd();
  }

  function readHeader(column: {
    readonly header: string;
    readonly cell: (tableEntry: TableEntry) => string;
  }) {
    return column.header;
  }

  function writeTableLine(tableEntry: TableEntry) {
    function readColumnCell(column: {
      readonly header: string;
      readonly cell: (tableEntry: TableEntry) => string;
    }) {
      return column.cell(tableEntry);
    }

    return joinCellsIntoLine(columns.map(readColumnCell));
  }

  return [joinCellsIntoLine(columns.map(readHeader)), ...tableEntries.map(writeTableLine)].join(
    '\n',
  );
}
