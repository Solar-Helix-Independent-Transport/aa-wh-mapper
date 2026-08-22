import { describe, expect, it } from "vitest";
import { dataTableColumnHelper, dataTableFeatures } from "./dataTableFeatures";

describe("dataTableFeatures", () => {
  it("builds without throwing", () => {
    // The real coverage of this feature set (column filtering enabled as a
    // prerequisite for global filtering, sorting, pagination) comes from
    // DataTable.test.tsx actually exercising search/sort/pagination through
    // a rendered table - this just pins that construction itself succeeds.
    expect(dataTableFeatures).toBeTruthy();
  });
});

describe("dataTableColumnHelper", () => {
  it("builds column defs usable by TanStack Table", () => {
    interface Row {
      name: string;
    }
    const helper = dataTableColumnHelper<Row>();
    const columns = helper.columns([
      helper.accessor("name", { header: "Name" }),
    ]);

    expect(columns).toHaveLength(1);
    expect(columns[0].header).toBe("Name");
  });
});
