import { posix, resolve, win32 } from "node:path";

/**
 * The bridge can run on a different operating system than the Codex host that
 * authored the task environment: this fork's Docker runtime is Linux while
 * Codex on the user's machine may be Windows. Every path arriving in turn
 * metadata or the environment_context block therefore carries the CODEX host's
 * path style, and validating it with the bridge host's `node:path` flavor
 * wrongly rejects it. These helpers pick the flavor from the path itself.
 */

/** Windows-style: a drive-letter root (C:\ or C:/) or a UNC share (\\server\...). */
export function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * Absolute under the path's own flavor, regardless of the bridge host.
 * Drive-relative (`C:foo`) and current-drive-rooted (`\foo`) Windows forms are
 * rejected: they are not location-independent and Codex never emits them.
 */
export function isAbsoluteCrossPlatform(value: string): boolean {
  return isWindowsStylePath(value) || posix.isAbsolute(value);
}

/** Normalize without touching the filesystem; Windows-style paths compare case-insensitively. */
export function pathIdentityCrossPlatform(value: string): string {
  if (isWindowsStylePath(value)) return win32.resolve(value).toLowerCase();
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Resolve with the flavor the path itself uses. */
export function resolveCrossPlatform(value: string): string {
  return isWindowsStylePath(value) ? win32.resolve(value) : resolve(value);
}

/** True when `path` equals `root` or lives inside it; mixed styles never match. */
export function pathsMatchCrossPlatform(root: string, path: string): boolean {
  const rootId = pathIdentityCrossPlatform(root);
  const pathId = pathIdentityCrossPlatform(path);
  const rootIsWindows = isWindowsStylePath(rootId);
  if (rootIsWindows !== isWindowsStylePath(pathId)) return false;
  const flavor = rootIsWindows ? win32 : process.platform === "win32" ? win32 : posix;
  const rel = flavor.relative(rootId, pathId);
  return rel === "" || (!rel.startsWith("..") && !flavor.isAbsolute(rel));
}
