import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote, serializeNote, parseNote, commitmentOf } from "../src/note.js";
import { DENOMINATIONS } from "../src/constants.js";

test("note round-trips through serialize/parse", () => {
  const note = createNote({
    chainId: 420420421,
    poolAddress: "0x1234567890123456789012345678901234567890",
    denomination: DENOMINATIONS.D1,
  });
  const serialized = serializeNote(note);
  const parsed = parseNote(serialized);

  assert.equal(parsed.chainId, note.chainId);
  assert.equal(parsed.poolAddress, note.poolAddress.toLowerCase());
  assert.equal(parsed.denomination, note.denomination);
  assert.equal(parsed.nullifier, note.nullifier);
  assert.equal(parsed.secret, note.secret);
});

test("two notes never collide", () => {
  const a = createNote({ chainId: 1, poolAddress: "0x0", denomination: DENOMINATIONS.D1 });
  const b = createNote({ chainId: 1, poolAddress: "0x0", denomination: DENOMINATIONS.D1 });
  assert.notEqual(a.nullifier, b.nullifier);
  assert.notEqual(a.secret, b.secret);
});

test("rejects malformed note strings", () => {
  assert.throws(() => parseNote("not-a-note"));
  assert.throws(() => parseNote("kage-v2-1-0x0-1-ab-cd"));
});

test("commitmentOf is deterministic for the same note", async () => {
  const note = createNote({ chainId: 1, poolAddress: "0x0", denomination: DENOMINATIONS.D1 });
  const c1 = await commitmentOf(note);
  const c2 = await commitmentOf(note);
  assert.equal(c1, c2);
});
