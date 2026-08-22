import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppBrand } from "./AppBrand";

describe("AppBrand", () => {
  it("links home and shows the logo image", () => {
    render(<AppBrand />, { wrapper: MemoryRouter });

    // The link's own accessible name comes from the contained img's alt
    // text ("YAWN"), not its title attribute - that title only surfaces as
    // a tooltip.
    const link = screen.getByRole("link", { name: "YAWN" });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveAttribute("title", "Yet Another Wormhole Navigator");
  });
});
