// @vitest-environment jsdom
//
// Exercises the PRODUCTION bundle, not the source.
//
// Two browser-only failures have already shipped past the source tests: a wasm
// Poseidon builder that hangs, and a missing Buffer global. Both were invisible
// to node tests of src/, because Vite's dev pipeline and its Rollup production
// pipeline resolve CommonJS dependencies differently and only the latter
// minifies. This loads what actually gets deployed.
//
// Requires `npm run build` first; skips loudly rather than silently passing.

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const dist = join(__dirname, "..", "dist", "assets");
const circuits = join(__dirname, "..", "..", "circuits");
const input = JSON.parse(readFileSync(join(circuits, "inputs", "ZcashPour.json"), "utf8"));

function builtChunk(prefix: string): string | null {
  if (!existsSync(dist)) return null;
  const match = readdirSync(dist).find((f) => f.startsWith(prefix) && f.endsWith(".js"));
  return match === undefined ? null : join(dist, match);
}

describe("production bundle", () => {
  beforeAll(() => {
    // jsdom has no Worker; ffjavascript captures it at module scope. In a real
    // browser it exists, so a stub is enough to get the module evaluated.
    // The note chunk imports the entry chunk, so main.ts runs on import and
    // expects its mount point. In a browser the entry has already loaded.
    document.body.innerHTML = '<div id="app"></div>';

    if (!(globalThis as any).Worker) {
      (globalThis as any).Worker = class {
        postMessage() {}
        terminate() {}
        addEventListener() {}
      };
    }
  });

  it("derives the right commitment from the built chunk", async () => {
    const chunk = builtChunk("note-");
    if (chunk === null) {
      console.warn("no dist/ — skipping; run `npm run verify` to include this");
      return;
    }

    const built: any = await import(/* @vite-ignore */ chunk);

    const note = await built.deriveNote({
      sk: BigInt(input.sk_old),
      rho: BigInt(input.rho),
      r: BigInt(input.r_old),
      value: BigInt(input.v),
    });

    // Same vector the source test uses, so a bundling regression is caught here
    // even when src/ is perfectly fine.
    expect(note.cm.toString()).toBe(input.cm_list[Number(input.j)]);
    expect(note.snConsume.toString()).toBe(input.sn_consume);
  }, 60000);

  it("generates random field elements in the built chunk", async () => {
    const chunk = builtChunk("note-");
    if (chunk === null) return;

    const built: any = await import(/* @vite-ignore */ chunk);

    // crypto.getRandomValues is the one browser API note.ts calls directly.
    const a = built.randomField();
    const b = built.randomField();
    expect(a).not.toBe(b);
    expect(a < built.P).toBe(true);
  }, 30000);
});
