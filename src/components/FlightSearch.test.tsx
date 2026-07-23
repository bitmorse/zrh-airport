import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlightSearch } from "./FlightSearch";

afterEach(cleanup);

describe("FlightSearch", () => {
  it("opens the input and submits the trimmed query", () => {
    const onSubmit = vi.fn();
    render(<FlightSearch onSubmit={onSubmit} />);

    // Input hidden until the magnifier is tapped.
    expect(screen.queryByLabelText(/Flight number, registration or hex/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Search for a flight/i }));

    const input = screen.getByLabelText(/Flight number, registration or hex/i);
    fireEvent.change(input, { target: { value: "  AI 136 " } });
    fireEvent.click(screen.getByRole("button", { name: /Track/i }));

    expect(onSubmit).toHaveBeenCalledWith("AI 136");
    // Closes after submit.
    expect(screen.queryByLabelText(/Flight number, registration or hex/i)).toBeNull();
  });

  it("ignores an empty submit", () => {
    const onSubmit = vi.fn();
    render(<FlightSearch onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Search for a flight/i }));
    fireEvent.click(screen.getByRole("button", { name: /Track/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
