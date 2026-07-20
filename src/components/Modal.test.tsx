import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

afterEach(cleanup);

describe("Modal", () => {
  it("renders title + children and closes on ✕, Escape and backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Test dialog" onClose={onClose}>
        <p>body content</p>
      </Modal>,
    );
    expect(screen.getByText("Test dialog")).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("dialog")); // backdrop
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
