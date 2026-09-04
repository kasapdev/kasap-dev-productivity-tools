import { describe, expect, it } from "vitest";
import {
  computeSizeLabel,
  computeTotalChangedLines,
  DEFAULT_SIZE_THRESHOLDS,
  type ChangedFile,
} from "../src/sizeLabel.js";

describe("computeTotalChangedLines", () => {
  it("sums additions + deletions across all files when nothing is excluded", () => {
    const files: ChangedFile[] = [
      { filename: "src/a.ts", additions: 10, deletions: 2 },
      { filename: "src/b.ts", additions: 3, deletions: 1 },
    ];
    expect(computeTotalChangedLines(files, [])).toBe(16);
  });

  it("excludes files matching a **/*.lock pattern", () => {
    const files: ChangedFile[] = [
      { filename: "src/a.ts", additions: 10, deletions: 2 },
      { filename: "vendor/deps.lock", additions: 500, deletions: 500 },
    ];
    expect(computeTotalChangedLines(files, ["**/*.lock"])).toBe(12);
  });

  it("excludes files matching a dist/** pattern", () => {
    const files: ChangedFile[] = [
      { filename: "dist/index.js", additions: 1000, deletions: 0 },
      { filename: "src/index.ts", additions: 5, deletions: 5 },
    ];
    expect(computeTotalChangedLines(files, ["dist/**"])).toBe(10);
  });

  it("excludes a file matched by an exact filename pattern", () => {
    const files: ChangedFile[] = [
      { filename: "pnpm-lock.yaml", additions: 200, deletions: 100 },
      { filename: "src/index.ts", additions: 4, deletions: 1 },
    ];
    expect(computeTotalChangedLines(files, ["pnpm-lock.yaml"])).toBe(5);
  });

  it("excludes files matching a *.generated.ts style pattern", () => {
    const files: ChangedFile[] = [
      { filename: "src/types.generated.ts", additions: 300, deletions: 0 },
      { filename: "src/handwritten.ts", additions: 7, deletions: 3 },
    ];
    expect(computeTotalChangedLines(files, ["**/*.generated.ts"])).toBe(10);
  });

  it("does not exclude files via naive substring matching (real glob semantics)", () => {
    // "lock" appears as a substring of the filename, but the file is not
    // itself a .lock file and should NOT be excluded by a **/*.lock pattern.
    const files: ChangedFile[] = [{ filename: "src/lockManager.ts", additions: 5, deletions: 5 }];
    expect(computeTotalChangedLines(files, ["**/*.lock"])).toBe(10);
  });

  it("applies multiple exclude patterns together", () => {
    const files: ChangedFile[] = [
      { filename: "pnpm-lock.yaml", additions: 100, deletions: 100 },
      { filename: "dist/bundle.js", additions: 400, deletions: 0 },
      { filename: "src/app.ts", additions: 12, deletions: 3 },
    ];
    expect(computeTotalChangedLines(files, ["**/pnpm-lock.yaml", "dist/**"])).toBe(15);
  });
});

describe("computeSizeLabel", () => {
  const thresholds = DEFAULT_SIZE_THRESHOLDS; // { xsMax: 10, sMax: 50, mMax: 250, lMax: 1000 }

  it("returns size/XS below xs-max", () => {
    expect(computeSizeLabel(0, thresholds)).toBe("size/XS");
    expect(computeSizeLabel(9, thresholds)).toBe("size/XS");
  });

  it("returns size/S at the xs-max boundary and below s-max", () => {
    expect(computeSizeLabel(10, thresholds)).toBe("size/S");
    expect(computeSizeLabel(49, thresholds)).toBe("size/S");
  });

  it("returns size/M at the s-max boundary and below m-max", () => {
    expect(computeSizeLabel(50, thresholds)).toBe("size/M");
    expect(computeSizeLabel(249, thresholds)).toBe("size/M");
  });

  it("returns size/L at the m-max boundary and below l-max", () => {
    expect(computeSizeLabel(250, thresholds)).toBe("size/L");
    expect(computeSizeLabel(999, thresholds)).toBe("size/L");
  });

  it("returns size/XL at and above the l-max boundary", () => {
    expect(computeSizeLabel(1000, thresholds)).toBe("size/XL");
    expect(computeSizeLabel(50000, thresholds)).toBe("size/XL");
  });

  it("respects custom thresholds", () => {
    const custom = { xsMax: 5, sMax: 20, mMax: 100, lMax: 500 };
    expect(computeSizeLabel(4, custom)).toBe("size/XS");
    expect(computeSizeLabel(5, custom)).toBe("size/S");
    expect(computeSizeLabel(20, custom)).toBe("size/M");
    expect(computeSizeLabel(100, custom)).toBe("size/L");
    expect(computeSizeLabel(500, custom)).toBe("size/XL");
  });
});
