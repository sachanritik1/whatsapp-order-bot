import { describe, expect, it } from "vitest";

import { containsAny } from "../src/lib/text.js";

describe("text helpers", () => {
  it("matches whole-word greetings", () => {
    expect(containsAny("Hi there", ["hi", "hello"])).toBe(true);
    expect(containsAny("good morning team", ["good morning"])).toBe(true);
  });

  it("does not match substrings inside other words", () => {
    expect(containsAny("shipping details", ["hi"])).toBe(false);
    expect(containsAny("shelloworld", ["hello"])).toBe(false);
  });
});
