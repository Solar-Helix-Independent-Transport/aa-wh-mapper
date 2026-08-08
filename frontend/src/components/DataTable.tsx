import { useState } from "react";
import { useTable } from "@tanstack/react-table";
import type {
  PaginationState,
  RowData,
  SortingState,
} from "@tanstack/react-table";
import { dataTableFeatures, type DataTableColumn } from "./dataTableFeatures";

export type { DataTableColumn } from "./dataTableFeatures";

interface Props<TData extends RowData> {
  data: TData[];
  columns: DataTableColumn<TData>[];
  getRowId?: (row: TData) => string;
  onRowClick?: (row: TData) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  pageSize?: number;
}

/** A reusable table shell (search + sort + pagination) wrapping TanStack
 * Table - column definitions and row data are the only thing each call
 * site provides; this owns the filter/sort/pagination state and renders
 * the search box, header row (click-to-sort), body, and pager. Global
 * filter matches TanStack's default (case-insensitive substring) across
 * every column's rendered value - no per-column filter UI, just the one
 * search box, since none of this app's admin tables need more than that.
 */
export function DataTable<TData extends RowData>({
  data,
  columns,
  getRowId,
  onRowClick,
  searchPlaceholder = "Search…",
  emptyMessage = "No results.",
  pageSize = 10,
}: Props<TData>) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    state: { globalFilter, sorting, pagination },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  });

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="data-table-wrapper">
      <input
        type="text"
        className="data-table-search"
        placeholder={searchPlaceholder}
        value={globalFilter}
        onChange={(event) => setGlobalFilter(event.target.value)}
      />

      {filteredCount === 0 ? (
        <p className="dim data-table-empty">{emptyMessage}</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id}>
                      {!header.isPlaceholder && (
                        <button
                          type="button"
                          className="data-table-header-button"
                          onClick={header.column.getToggleSortingHandler()}
                          disabled={!header.column.getCanSort()}
                        >
                          <table.FlexRender header={header} />
                          {{ asc: " ▲", desc: " ▼" }[
                            header.column.getIsSorted() as string
                          ] ?? ""}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={
                    onRowClick ? "data-table-row-clickable" : undefined
                  }
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                >
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="data-table-pagination">
            <button
              type="button"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage()}
            >
              «
            </button>
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              ‹
            </button>
            <span className="dim">
              Page {table.state.pagination.pageIndex + 1} of{" "}
              {Math.max(1, table.getPageCount())}
            </span>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => table.lastPage()}
              disabled={!table.getCanNextPage()}
            >
              »
            </button>
            <span className="dim data-table-count">
              {filteredCount} row{filteredCount === 1 ? "" : "s"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
