export type Column<TableEntry> = Readonly<{
  header: string;
  cell: (tableEntry: TableEntry) => string;
}>;

export const alignTableColumns = <TableEntry>(
  columns: readonly Column<TableEntry>[],
  tableEntries: readonly TableEntry[],
): string => {
  const widths = columns.map((column) =>
    Math.max(
      column.header.length,
      ...tableEntries.map((tableEntry) => column.cell(tableEntry).length),
    ),
  );
  const joinCellsIntoLine = (cells: readonly string[]): string =>
    cells
      .map((cell, columnIndex) => {
        const columnWidth = widths[columnIndex];
        const isColumnWidthMissing = columnWidth === undefined;
        if (isColumnWidthMissing) return cell;
        return cell.padEnd(columnWidth);
      })
      .join('  ')
      .trimEnd();
  return [
    joinCellsIntoLine(columns.map((column) => column.header)),
    ...tableEntries.map((tableEntry) =>
      joinCellsIntoLine(columns.map((column) => column.cell(tableEntry))),
    ),
  ].join('\n');
};
