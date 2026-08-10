import { expect, test } from "bun:test";
import {
  isAbsoluteCrossPlatform,
  isWindowsStylePath,
  pathIdentityCrossPlatform,
  pathsMatchCrossPlatform,
} from "../src/adapters/chatgpt-web/cross-platform-paths";

test("windows-style detection covers drive letters and UNC shares only", () => {
  expect(isWindowsStylePath("E:\\Projects\\demo")).toBe(true);
  expect(isWindowsStylePath("E:/Projects/demo")).toBe(true);
  expect(isWindowsStylePath("\\\\server\\share\\dir")).toBe(true);
  expect(isWindowsStylePath("/home/user/demo")).toBe(false);
  expect(isWindowsStylePath("relative/path")).toBe(false);
});

test("absoluteness follows the path's own flavor", () => {
  expect(isAbsoluteCrossPlatform("E:\\Projects\\demo")).toBe(true);
  expect(isAbsoluteCrossPlatform("/home/user/demo")).toBe(true);
  expect(isAbsoluteCrossPlatform("relative/path")).toBe(false);
  // Drive-relative and current-drive-rooted Windows forms are not location-independent.
  expect(isAbsoluteCrossPlatform("C:relative")).toBe(false);
  expect(isAbsoluteCrossPlatform("\\rooted-on-current-drive")).toBe(false);
});

test("windows path identity is case-insensitive and separator-normalized", () => {
  expect(pathIdentityCrossPlatform("E:/Projects/Demo")).toBe(pathIdentityCrossPlatform("e:\\projects\\demo"));
  expect(pathIdentityCrossPlatform("E:\\Projects\\a\\..\\demo")).toBe(pathIdentityCrossPlatform("E:\\Projects\\demo"));
});

test("containment respects path-segment boundaries and never mixes flavors", () => {
  expect(pathsMatchCrossPlatform("E:\\Projects", "E:\\Projects\\demo\\file.ts")).toBe(true);
  expect(pathsMatchCrossPlatform("E:\\Projects", "e:/projects")).toBe(true);
  expect(pathsMatchCrossPlatform("E:\\Projects", "E:\\Other")).toBe(false);
  expect(pathsMatchCrossPlatform("E:\\Proj", "E:\\Projects")).toBe(false);
  expect(pathsMatchCrossPlatform("/srv/app", "/srv/app/sub")).toBe(true);
  expect(pathsMatchCrossPlatform("/srv/app", "/srv/application")).toBe(false);
  expect(pathsMatchCrossPlatform("/srv/app", "E:\\Projects")).toBe(false);
});
