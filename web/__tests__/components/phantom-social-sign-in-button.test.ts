import * as React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PhantomSocialSignInButton } from "@/components/PhantomSocialSignInButton";

const state = vi.hoisted(() => ({
  open: vi.fn(),
  setOpening: vi.fn(),
  setError: vi.fn(),
  opening: false,
  error: null as string | null,
  isOpened: false,
}));

vi.mock("@phantom/react-sdk", () => ({
  useModal: () => ({ open: state.open, isOpened: state.isOpened }),
}));

// The repository's harness has no DOM renderer. Exercise the real button's
// click handler with controlled hook state rather than matching source text.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: boolean | null) =>
    typeof initial === "boolean"
      ? [state.opening, state.setOpening]
      : [state.error, state.setError],
  useRef: (initial: boolean) => ({ current: initial }),
}));

type ButtonElement = React.ReactElement<{
  onClick: () => Promise<void>;
  disabled: boolean;
  children: string;
  "aria-haspopup": string;
  "aria-expanded": boolean;
}>;

function getButton(
  onBeforeOpen: () => Promise<void> = vi.fn().mockResolvedValue(undefined)
) {
  const element = PhantomSocialSignInButton({ onBeforeOpen });
  const children = element.props.children as [ButtonElement, unknown];
  return children[0];
}

describe("Phantom social sign-in button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.opening = false;
    state.error = null;
    state.isOpened = false;
    vi.stubGlobal("React", React);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("names both providers and exposes its dialog state", () => {
    const button = getButton();
    expect(button.props.children).toBe("Continue with Google/Apple");
    expect(button.props["aria-haspopup"]).toBe("dialog");
    expect(button.props["aria-expanded"]).toBe(false);
    expect(button.props.disabled).toBe(false);

    state.isOpened = true;
    expect(getButton().props["aria-expanded"]).toBe(true);
  });

  it("waits for Base disconnection before opening the existing modal", async () => {
    let finishDisconnect!: () => void;
    const disconnect = vi.fn(
      () => new Promise<void>((resolve) => (finishDisconnect = resolve))
    );
    const button = getButton(disconnect);
    const opening = button.props.onClick();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(state.open).not.toHaveBeenCalled();
    expect(state.setOpening).toHaveBeenCalledWith(true);
    finishDisconnect();
    await opening;
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(state.setOpening).toHaveBeenLastCalledWith(false);
  });

  it("does not open the modal if Base disconnection fails", async () => {
    await getButton(
      vi.fn().mockRejectedValue(new Error("disconnect failed"))
    ).props.onClick();

    expect(state.open).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith(
      "Could not open sign-in. Please try again."
    );
    expect(state.setOpening).toHaveBeenLastCalledWith(false);
  });

  it("ignores duplicate activation while disconnection is pending", async () => {
    let finishDisconnect!: () => void;
    const disconnect = vi.fn(
      () => new Promise<void>((resolve) => (finishDisconnect = resolve))
    );
    const button = getButton(disconnect);
    const first = button.props.onClick();
    await button.props.onClick();
    expect(disconnect).toHaveBeenCalledTimes(1);
    finishDisconnect();
    await first;
    expect(state.open).toHaveBeenCalledTimes(1);
  });

  it("disables the button and gives feedback while opening", () => {
    state.opening = true;
    const button = getButton();
    expect(button.props.disabled).toBe(true);
    expect(button.props.children).toBe("Opening sign-in...");
  });

  it("announces failures without exposing provider error details", () => {
    state.error = "Could not open sign-in. Please try again.";
    const element = PhantomSocialSignInButton({
      onBeforeOpen: vi.fn().mockResolvedValue(undefined),
    });
    const children = element.props.children as [
      ButtonElement,
      React.ReactElement<{ role: string; children: string }>
    ];
    expect(children[1].props.role).toBe("alert");
    expect(children[1].props.children).toBe(state.error);
  });
});
