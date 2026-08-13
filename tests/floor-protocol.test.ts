import { expect, test } from "bun:test";
import floorText from "../src/adapters/chatgpt-web/procedure/floor-v1.md" with { type: "text" };
import {
  FLOOR_PROTOCOL_SHA256,
  FloorProtocolError,
  buildFloorProcedureBlock,
  floorProtocolDigest,
  normalizeFloorProtocolText,
  parseFloorProtocolSections,
  verifyFloorProtocolText,
} from "../src/adapters/chatgpt-web/procedure/floor-protocol";

test("the shipped Floor prose matches the pinned digest", () => {
  expect(floorProtocolDigest(normalizeFloorProtocolText(floorText))).toBe(FLOOR_PROTOCOL_SHA256);
});

test("all five sections parse and are non-empty", () => {
  const sections = parseFloorProtocolSections(normalizeFloorProtocolText(floorText));
  for (const name of ["the floor", "claims", "attack", "deliver", "deliver with tools"]) {
    expect(sections.get(name), `section '${name}'`).toBeTruthy();
  }
});

test("a one-character tamper fails closed and names both digests", () => {
  const tampered = floorText.replace("pattern-matched", "pattern-matchee");
  expect(tampered).not.toBe(floorText);
  expect(() => verifyFloorProtocolText(tampered)).toThrow(FloorProtocolError);
  expect(() => verifyFloorProtocolText(tampered)).toThrow(FLOOR_PROTOCOL_SHA256);
});

test("CRLF line endings verify clean after normalization", () => {
  const crlf = normalizeFloorProtocolText(floorText).replace(/\n/g, "\r\n");
  expect(verifyFloorProtocolText(crlf)).toBe(normalizeFloorProtocolText(floorText));
});

test("read-only block ends with the adapted plain Deliver", () => {
  const block = buildFloorProcedureBlock({ localTools: false });
  expect(block[0]).toContain("[Fable procedure floor-v1]");
  expect(block[0]).toContain("adds no new task and no new facts");
  expect(block.at(-1)).toContain("transport obligations, not narration");
  expect(block.at(-1)).not.toContain("Call the tools.");
});

test("local-tools block ends with Deliver-with-tools and keeps the transport-tail deferral", () => {
  const block = buildFloorProcedureBlock({ localTools: true });
  expect(block.at(-1)).toContain("Call the tools.");
  expect(block.at(-1)).toContain("transport obligations, not narration");
  expect(block.at(-1)).not.toContain("The reader asked a question");
});

test("section bodies carry no leftover heading markers", () => {
  for (const part of buildFloorProcedureBlock({ localTools: true })) {
    expect(part).not.toMatch(/^#\s/m);
  }
});
