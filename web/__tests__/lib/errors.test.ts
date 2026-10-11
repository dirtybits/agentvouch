import { describe, expect, it } from "vitest";
import { getErrorMessage } from "@/lib/errors";

describe("getErrorMessage", () => {
  describe("Error instance", () => {
    it("returns the Error message over a custom fallback", () => {
      expect(getErrorMessage(new Error("boom"), "custom")).toBe("boom");
    });

    it("surfaces the cause message before the Error's own message", () => {
      const err = new Error("top", { cause: new Error("cause") });
      expect(getErrorMessage(err)).toBe("cause");
    });

    it("surfaces the cause message when the cause is a plain object", () => {
      const err = new Error("top", { cause: { message: "cause" } });
      expect(getErrorMessage(err)).toBe("cause");
    });

    it("ignores a cause whose message is not a string and falls back to the Error message", () => {
      const err = new Error("top", { cause: { message: 123 } });
      expect(getErrorMessage(err)).toBe("top");
    });

    it("returns the fallback for an Error with an empty message and no cause", () => {
      expect(getErrorMessage(new Error(""))).toBe("Unexpected error");
    });
  });

  describe("plain object", () => {
    it("surfaces a direct string message", () => {
      expect(getErrorMessage({ message: "obj" })).toBe("obj");
    });

    it("surfaces a context message when the object carries one", () => {
      expect(getErrorMessage({ context: { message: "ctx" } })).toBe("ctx");
    });

    it("prefers cause over context when both carry messages", () => {
      expect(
        getErrorMessage({
          cause: { message: "cause" },
          context: { message: "ctx" },
        })
      ).toBe("cause");
    });

    it("returns the fallback for an empty or message-less object", () => {
      expect(getErrorMessage({})).toBe("Unexpected error");
      expect(getErrorMessage({ message: "" })).toBe("Unexpected error");
      expect(getErrorMessage({ message: 123 })).toBe("Unexpected error");
    });
  });

  describe("string", () => {
    it("returns a non-empty string as-is", () => {
      expect(getErrorMessage("some error")).toBe("some error");
    });

    it("returns the fallback for an empty string", () => {
      expect(getErrorMessage("")).toBe("Unexpected error");
    });
  });

  describe("fallback / unknown values", () => {
    it("returns the default fallback for null and undefined", () => {
      expect(getErrorMessage(null)).toBe("Unexpected error");
      expect(getErrorMessage(undefined)).toBe("Unexpected error");
    });

    it("returns the default fallback for numbers, booleans, arrays, and symbols", () => {
      expect(getErrorMessage(123)).toBe("Unexpected error");
      expect(getErrorMessage(false)).toBe("Unexpected error");
      expect(getErrorMessage([1, 2])).toBe("Unexpected error");
      expect(getErrorMessage(Symbol("s"))).toBe("Unexpected error");
    });

    it("uses a custom fallback when no extractable message exists", () => {
      expect(getErrorMessage(undefined, "nothing here")).toBe("nothing here");
      expect(getErrorMessage(0, "zero-fallback")).toBe("zero-fallback");
    });
  });
});
