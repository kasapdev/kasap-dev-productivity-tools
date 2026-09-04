import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { copyToClipboard } from "../src/clipboard.js";

interface FakeChild extends EventEmitter {
  stdin: EventEmitter & { end: (text: string) => void };
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stdin = new EventEmitter() as EventEmitter & { end: (text: string) => void };
  stdin.end = vi.fn();
  child.stdin = stdin;
  return child;
}

const spawnMock = vi.mocked(spawn);

describe("copyToClipboard", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("uses `clip` on win32 and resolves true on success", async () => {
    spawnMock.mockImplementation((..._args: unknown[]) => {
      const child = makeFakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child as unknown as ReturnType<typeof spawn>;
    });

    const ok = await copyToClipboard("hello", "win32");

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("clip", [], expect.anything());
  });

  it("uses `pbcopy` on darwin", async () => {
    spawnMock.mockImplementation((..._args: unknown[]) => {
      const child = makeFakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child as unknown as ReturnType<typeof spawn>;
    });

    const ok = await copyToClipboard("hello", "darwin");

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("pbcopy", [], expect.anything());
  });

  it("uses `xclip` on linux and succeeds when available", async () => {
    spawnMock.mockImplementation((..._args: unknown[]) => {
      const child = makeFakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child as unknown as ReturnType<typeof spawn>;
    });

    const ok = await copyToClipboard("hello", "linux");

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], expect.anything());
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to `xsel` on linux when xclip is unavailable", async () => {
    spawnMock.mockImplementation((cmd: unknown, ..._rest: unknown[]) => {
      const child = makeFakeChild();
      if (cmd === "xclip") {
        queueMicrotask(() => child.emit("error", new Error("ENOENT: no xclip")));
      } else {
        queueMicrotask(() => child.emit("close", 0));
      }
      return child as unknown as ReturnType<typeof spawn>;
    });

    const ok = await copyToClipboard("hello", "linux");

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenNthCalledWith(1, "xclip", ["-selection", "clipboard"], expect.anything());
    expect(spawnMock).toHaveBeenNthCalledWith(2, "xsel", ["--clipboard", "--input"], expect.anything());
  });

  it("resolves false (without throwing) when every clipboard command fails", async () => {
    spawnMock.mockImplementation((..._args: unknown[]) => {
      const child = makeFakeChild();
      queueMicrotask(() => child.emit("error", new Error("spawn failed")));
      return child as unknown as ReturnType<typeof spawn>;
    });

    const ok = await copyToClipboard("hello", "linux");

    expect(ok).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(2); // tried both xclip and xsel
  });

  it("resolves false immediately on an unsupported platform (no command attempted)", async () => {
    const ok = await copyToClipboard("hello", "aix");

    expect(ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("defaults to process.platform when no platform argument is given", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    spawnMock.mockImplementation((..._args: unknown[]) => {
      const child = makeFakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child as unknown as ReturnType<typeof spawn>;
    });

    const ok = await copyToClipboard("hello");

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("pbcopy", [], expect.anything());
  });
});
