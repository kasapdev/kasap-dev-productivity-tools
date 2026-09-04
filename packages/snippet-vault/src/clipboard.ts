import { spawn } from "node:child_process";

interface ClipboardCommand {
  cmd: string;
  args: string[];
}

function commandsForPlatform(platform: NodeJS.Platform): ClipboardCommand[] {
  switch (platform) {
    case "win32":
      return [{ cmd: "clip", args: [] }];
    case "darwin":
      return [{ cmd: "pbcopy", args: [] }];
    case "linux":
      return [
        { cmd: "xclip", args: ["-selection", "clipboard"] },
        { cmd: "xsel", args: ["--clipboard", "--input"] },
      ];
    default:
      return [];
  }
}

/**
 * Attempts a single clipboard command, writing `text` to its stdin.
 * Resolves true on success, false on any failure (spawn error, non-zero
 * exit, etc.) — never rejects.
 */
function tryCommand(command: ClipboardCommand, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    let child;
    try {
      child = spawn(command.cmd, command.args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      done(false);
      return;
    }

    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));

    try {
      child.stdin.on("error", () => {
        /* swallow EPIPE etc. — the "error"/"close" handlers above resolve */
      });
      child.stdin.end(text);
    } catch {
      done(false);
    }
  });
}

/**
 * Copies `text` to the system clipboard by shelling out to a
 * platform-appropriate command (clip / pbcopy / xclip / xsel).
 * Resolves `true` on success and `false` if no clipboard mechanism was
 * available or all attempts failed — it never throws.
 */
export async function copyToClipboard(
  text: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  const commands = commandsForPlatform(platform);
  for (const command of commands) {
    const ok = await tryCommand(command, text);
    if (ok) return true;
  }
  return false;
}
