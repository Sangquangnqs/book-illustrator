import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.jsx";

describe("App", () => {
  it("renders the product shell", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Book Illustration Studio" })
    ).toBeInTheDocument();
  });
});
