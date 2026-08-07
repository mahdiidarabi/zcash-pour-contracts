// Pins the browser note derivation to the circuit.
//
// Reads the circuit's own committed input and the proof generated from it, then
// checks this TypeScript port lands on the same commitment and nullifier. This
// is the same assertion circuits/tools/check.js makes on the Node side -- if the
// port drifts, or a circomlibjs bump changes Poseidon, this fails.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createNote, deriveNote, noteFromJson, noteToJson, P, randomField } from "./note";

const circuits = join(__dirname, "..", "..", "circuits");

const input = JSON.parse(readFileSync(join(circuits, "inputs", "ZcashPour.json"), "utf8"));
const pub: string[] = JSON.parse(
  readFileSync(join(circuits, "build", "ZcashPour", "public.json"), "utf8")
);

describe("note derivation matches the circuit", () => {
  it("reproduces the committed cm and snConsume", async () => {
    const note = await deriveNote({
      sk: BigInt(input.sk_old),
      rho: BigInt(input.rho),
      r: BigInt(input.r_old),
      value: BigInt(input.v),
    });

    // Public signal layout, docs/protocol.md section 6.
    expect(pub.length).toBe(14);

    const j = Number(input.j);
    expect(note.cm.toString()).toBe(input.cm_list[j]);
    expect(note.snConsume.toString()).toBe(input.sn_consume);
    expect(note.snConsume.toString()).toBe(pub[13]);
  });

  it("is deterministic", async () => {
    const secrets = { sk: 12345n, rho: 12345n, r: 13751379n, value: 100n };
    const a = await deriveNote(secrets);
    const b = await deriveNote(secrets);

    expect(a.cm).toBe(b.cm);
    expect(a.snConsume).toBe(b.snConsume);
  });
});

describe("randomField", () => {
  it("stays inside the field", () => {
    for (let i = 0; i < 200; i++) {
      const x = randomField();
      expect(x >= 0n && x < P).toBe(true);
    }
  });

  it("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(randomField().toString());
    }
    expect(seen.size).toBe(200);
  });
});

describe("json round trip", () => {
  it("survives serialisation", async () => {
    const note = await createNote(1000000000000000n);
    const back = await deriveNote(noteFromJson(noteToJson(note)));

    expect(back.cm).toBe(note.cm);
    expect(back.snConsume).toBe(note.snConsume);
  });

  it("rejects a note missing a secret", () => {
    expect(() => noteFromJson({ sk: "1", rho: "2", r: "3" } as any)).toThrow(/value/);
  });
});

// The browser has no Buffer. circomlibjs's entry point re-exports modules that
// reference it at module scope, so the first note derivation threw
// "Buffer is not defined" until src/polyfills.ts was added.
//
// Checked in a child process: deleting globalThis.Buffer in-process breaks
// vitest's own worker RPC, which also needs it.
describe("works without node globals", () => {
  const withoutBuffer = (setup: string) => `
    delete globalThis.Buffer;
    ${setup}
    import("circomlibjs")
      .then((c) => c.buildPoseidonReference())
      .then((p) => console.log("OK", p.F.toString(p([12345n]))))
      .catch((e) => console.log("THREW", e.message));
  `;

  const run = (setup: string) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", withoutBuffer(setup)], {
      encoding: "utf8",
      cwd: join(__dirname, ".."),
    }).trim();

  it("fails without the polyfill — proving the test is real", () => {
    expect(run("")).toMatch(/^THREW Buffer is not defined/);
  });

  it("succeeds once the polyfill installs Buffer", () => {
    const output = run('const { Buffer } = await import("buffer"); globalThis.Buffer = Buffer;');
    expect(output).toMatch(/^OK 4267533774488295900887461483015112262021273608761099826938271132511348470966/);
  });
});
