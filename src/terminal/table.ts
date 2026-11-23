export type Column<TableEntry> = Readonly<{
  header: string;
  cell: (tableEntry: TableEntry) => string;
}>;

export function alignTableColumns<TableEntry>(
  columns: readonly Column<TableEntry>[],
  tableEntries: readonly TableEntry[],
): string {
  function mapColumn(column: {
    readonly header: string;
    readonly cell: (tableEntry: TableEntry) => string;
  }) {
    function mapTablePiece2(tableEntry: TableEntry) {
      return column.cell(tableEntry).length;
    }

    return Math.max(column.header.length, ...tableEntries.map(mapTablePiece2));
  }

  const widths = columns.map(mapColumn);

  function mapCell(cell: string, columnIndex: number) {
    const columnWidth = widths[columnIndex];

    const isColumnWidthMissing = columnWidth == null;

    if (isColumnWidthMissing) return cell;

    return cell.padEnd(columnWidth);
  }

  function joinCellsIntoLine(cells: readonly string[]): string {
    return cells.map(mapCell).join('  ').trimEnd();
  }
  function readHeader(column: {
    readonly header: string;
    readonly cell: (tableEntry: TableEntry) => string;
  }) {
    return column.header;
  }

  function mapTablePiece(tableEntry: TableEntry) {
    function mapColumn2(column: {
      readonly header: string;
      readonly cell: (tableEntry: TableEntry) => string;
    }) {
      return column.cell(tableEntry);
    }

    return joinCellsIntoLine(columns.map(mapColumn2));
  }

  return [joinCellsIntoLine(columns.map(readHeader)), ...tableEntries.map(mapTablePiece)].join(
    '\n',
  );
}
