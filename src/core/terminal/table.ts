/** A table column and its domain-specific cell renderer. */
export type Column<TableEntry> = Readonly<{
  header: string;
  cell: (tableEntry: TableEntry) => string;
}>;

/** Render a non-empty collection as a padded text table. */
export const formatTable = <TableEntry>(
  columns: readonly Column<TableEntry>[],
  tableEntries: readonly TableEntry[],
): string => {
  const widths = columns.map((column) =>
    Math.max(
      column.header.length,
      ...tableEntries.map((tableEntry) => column.cell(tableEntry).length),
    ),
  );
  const renderCells = (cells: readonly string[]): string =>
    cells
      .map((cell, columnIndex) => {
        const width = widths[columnIndex];
        if (width === undefined) return cell;
        return cell.padEnd(width);
      })
      .join('  ')
      .trimEnd();
  return [
    renderCells(columns.map((column) => column.header)),
    ...tableEntries.map((tableEntry) =>
      renderCells(columns.map((column) => column.cell(tableEntry))),
    ),
  ].join('\n');
};
