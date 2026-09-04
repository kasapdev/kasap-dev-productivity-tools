import { describe, expect, it } from "vitest";
import { diffLabels } from "../src/labels.js";

describe("diffLabels", () => {
  it("removes an existing size label and unrelated labels are left alone", () => {
    const result = diffLabels(["size/M", "bug", "needs-review"], "size/L");
    expect(result.toRemove).toEqual(["size/M"]);
    expect(result.toAdd).toBe("size/L");
  });

  it("returns an empty toRemove when there is no existing size label", () => {
    const result = diffLabels(["bug", "needs-review"], "size/S");
    expect(result.toRemove).toEqual([]);
    expect(result.toAdd).toBe("size/S");
  });

  it("when the same label is already applied, does not include it in toRemove but still reports it as toAdd", () => {
    const result = diffLabels(["size/M", "bug"], "size/M");
    expect(result.toRemove).toEqual([]);
    expect(result.toAdd).toBe("size/M");
  });

  it("removes multiple stale size labels if more than one is somehow present", () => {
    const result = diffLabels(["size/S", "size/XL", "bug"], "size/M");
    expect(result.toRemove).toEqual(["size/S", "size/XL"]);
    expect(result.toAdd).toBe("size/M");
  });

  it("ignores labels that merely contain 'size/' as a substring but are not a real size label", () => {
    const result = diffLabels(["size/weird-custom", "size/M"], "size/L");
    expect(result.toRemove).toEqual(["size/M"]);
    expect(result.toAdd).toBe("size/L");
  });
});
