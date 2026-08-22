import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable";
import { dataTableColumnHelper } from "./dataTableFeatures";

interface Row {
  id: number;
  name: string;
  value: number;
}

const columnHelper = dataTableColumnHelper<Row>();
const columns = columnHelper.columns([
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("value", { header: "Value" }),
]);

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Row ${i}`,
    value: i,
  }));
}

describe("DataTable", () => {
  it("renders the title and every row's cells", () => {
    render(<DataTable data={rows(2)} columns={columns} title="My Table" />);

    expect(
      screen.getByRole("heading", { name: "My Table" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Row 0")).toBeInTheDocument();
    expect(screen.getByText("Row 1")).toBeInTheDocument();
  });

  it("shows the empty message when there's no data", () => {
    render(
      <DataTable data={[]} columns={columns} emptyMessage="Nothing here" />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("filters rows via the search box (case-insensitive substring)", () => {
    render(<DataTable data={rows(3)} columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("Search…"), {
      target: { value: "row 1" },
    });

    expect(screen.getByText("Row 1")).toBeInTheDocument();
    expect(screen.queryByText("Row 0")).not.toBeInTheDocument();
    expect(screen.getByText("1 row")).toBeInTheDocument();
  });

  it("shows the empty message once a search matches nothing", () => {
    render(
      <DataTable data={rows(2)} columns={columns} emptyMessage="No matches" />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search…"), {
      target: { value: "nonexistent" },
    });

    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("sorts ascending then descending on repeated header clicks", () => {
    render(<DataTable data={rows(3)} columns={columns} />);

    const nameHeader = screen.getByRole("button", { name: /Name/ });
    fireEvent.click(nameHeader);
    expect(screen.getByRole("button", { name: "Name ▲" })).toBeInTheDocument();

    fireEvent.click(nameHeader);
    expect(screen.getByRole("button", { name: "Name ▼" })).toBeInTheDocument();
  });

  it("pluralizes the row count", () => {
    render(<DataTable data={rows(1)} columns={columns} />);
    expect(screen.getByText("1 row")).toBeInTheDocument();
  });

  it("shows the plural row count for more than one row", () => {
    render(<DataTable data={rows(5)} columns={columns} />);
    expect(screen.getByText("5 rows")).toBeInTheDocument();
  });

  it("paginates using the given page size", () => {
    render(<DataTable data={rows(15)} columns={columns} pageSize={10} />);

    expect(screen.getByText("Row 0")).toBeInTheDocument();
    expect(screen.queryByText("Row 10")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "›" }));

    expect(screen.getByText("Row 10")).toBeInTheDocument();
    expect(screen.queryByText("Row 0")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("disables the previous-page controls on the first page", () => {
    render(<DataTable data={rows(15)} columns={columns} pageSize={10} />);

    expect(screen.getByRole("button", { name: "«" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "‹" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "›" })).not.toBeDisabled();
  });

  it("disables the next-page controls on the last page", () => {
    render(<DataTable data={rows(15)} columns={columns} pageSize={10} />);
    fireEvent.click(screen.getByRole("button", { name: "»" }));

    expect(screen.getByRole("button", { name: "›" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "»" })).toBeDisabled();
  });

  it("firstPage/lastPage jump to the ends", () => {
    render(<DataTable data={rows(25)} columns={columns} pageSize={10} />);

    fireEvent.click(screen.getByRole("button", { name: "»" }));
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "«" }));
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("calls onRowClick with the row's original data", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable data={rows(2)} columns={columns} onRowClick={onRowClick} />,
    );

    fireEvent.click(screen.getByText("Row 0"));

    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 0, name: "Row 0" }),
    );
  });

  it("rows are not clickable when no onRowClick is given", () => {
    const { container } = render(
      <DataTable data={rows(1)} columns={columns} />,
    );
    expect(container.querySelector("tbody tr")).not.toHaveClass(
      "data-table-row-clickable",
    );
  });
});
