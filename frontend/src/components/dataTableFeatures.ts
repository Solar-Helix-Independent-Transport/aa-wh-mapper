import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";
import type { ColumnDef, RowData } from "@tanstack/react-table";

// One shared feature set for every DataTable in the app, rather than each
// call site composing its own - global search needs columnFilteringFeature
// enabled as a prerequisite before globalFilteringFeature works at all (see
// TanStack Table's global-filtering guide), which is easy to forget if this
// were re-declared per table. Kept here (a non-component module) rather
// than in DataTable.tsx itself, since exporting a plain constant from a
// component file breaks fast refresh - see wormholeClass.ts's docstring
// for the same reasoning.
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumn<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData
>;

// Every call site should build its columns via
// `dataTableColumnHelper<TData>().columns([...])`, not a plain
// `DataTableColumn<TData>[]` array literal - TanStack Table v9's own
// TypeScript guidance (node_modules/@tanstack/table-core/skills/typescript)
// flags that as the "erasing accessor value inference" mistake: a bare
// object-literal array widens each column's value type and the shared
// TFeatures generic in a way the internal ColumnDef variants stop
// structurally matching, which surfaces as a baffling "two different types
// with this name exist, but they are unrelated" error instead of a clear
// one. Going through the helper keeps each accessor's inferred value type
// (and this file as the one place the feature/helper pairing is defined).
export function dataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}
