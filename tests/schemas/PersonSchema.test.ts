// tests/schemas/PersonSchema.test.ts
import { describe, it, expect } from "vitest";
import { PersonSchema } from "../../src/schemas/PersonSchema";

describe("PersonSchema Validation", () => {
  it("should validate a correct person object", () => {
    const validPerson = {
      version: "5.0",
      id: "N_123456789", // Starts with N_
      created: "2023-01-01T00:00:00Z",
      last_modified: "2023-01-02T00:00:00Z",
      names: [{ first: "Alan", last: "Turing", primary: true }],
      sex: "M",
      tags: ["mathematician"],
      relationships: {
        parents: [{ id: "N_987654321", type: "biological" }],
      },
      events: [],
      assets: [],
    };

    const result = PersonSchema.safeParse(validPerson);
    expect(result.success).toBe(true);
  });

  it("should fail if ID format is incorrect", () => {
    const invalidPerson = {
      version: "5.0",
      id: "BAD_ID", // Does not start with N_
      created: "2023-01-01T00:00:00Z",
      last_modified: "2023-01-01T00:00:00Z",
      names: [{ first: "Alan", last: "Turing" }],
      sex: "M",
      relationships: { parents: [] },
    };
    const result = PersonSchema.safeParse(invalidPerson);
    expect(result.success).toBe(false);
  });

  it("should support scrapbook_md and _gedcom fields (Spec v5.0)", () => {
    const enhancedPerson = {
      version: "5.0",
      id: "N_SCRAPBOOK",
      created: "2023-01-01T00:00:00Z",
      last_modified: "2023-01-01T00:00:00Z",
      names: [{ first: "Grace", last: "Hopper" }],
      sex: "F",
      relationships: { parents: [] },
      scrapbook_md: "# Notes\n\nSome freeform implementation notes.",
      _gedcom: {
        _UID: "some-unique-id",
        _DATE: "some-date",
      },
    };

    const result = PersonSchema.safeParse(enhancedPerson);
    // This EXPECTS to fail right now, but we write the assertion for SUCCESS
    // The test failure confirms the need for change.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scrapbook_md).toBeDefined();
      expect(result.data._gedcom).toBeDefined();
    }
  });
});
