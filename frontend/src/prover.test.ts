// End-to-end proving check, run in node against the real artefacts.
//
// Builds a pour witness using the same note.ts the browser uses, proves it, and
// verifies it. If this passes, the only thing standing between it and a working
// Pour screen is fetch() instead of a file path.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groth16 } from "snarkjs";
import { deriveNote, deriveOutput, randomField } from "./note";
import { toCalldata } from "./prover";

const circuits = join(__dirname, "..", "..", "circuits");
const build = join(circuits, "build", "ZcashPour");

const WASM = join(build, "ZcashPour_js", "ZcashPour.wasm");
const ZKEY = join(build, "ZcashPour_final.zkey");
const VKEY = JSON.parse(readFileSync(join(build, "verification_key.json"), "utf8"));

const input = JSON.parse(readFileSync(join(circuits, "inputs", "ZcashPour.json"), "utf8"));

describe("browser prover pipeline", () => {
  it("builds a witness from note.ts and proves it", async () => {
    // The coin the committed input describes -- it sits at cm_list[j].
    const spent = await deriveNote({
      sk: BigInt(input.sk_old),
      rho: BigInt(input.rho),
      r: BigInt(input.r_old),
      value: BigInt(input.v),
    });

    const j = input.cm_list.indexOf(spent.cm.toString());
    expect(j).toBeGreaterThanOrEqual(0);

    // Split to self, the frontend default: fresh randomness per output.
    const v1 = spent.value / 2n;
    const v2 = spent.value - v1;

    const out1 = await deriveOutput({ pk: spent.pk, rho: randomField(), r: randomField(), value: v1 });
    const out2 = await deriveOutput({ pk: spent.pk, rho: randomField(), r: randomField(), value: v2 });

    const witness = {
      cm_list: input.cm_list,
      v: spent.value.toString(),
      j: String(j),
      r_old: spent.r.toString(),
      sk_old: spent.sk.toString(),
      rho: spent.rho.toString(),
      sn_consume: spent.snConsume.toString(),
      v1: v1.toString(),
      r1: out1.r.toString(),
      rho1: out1.rho.toString(),
      pk1: spent.pk.toString(),
      v2: v2.toString(),
      r2: out2.r.toString(),
      rho2: out2.rho.toString(),
      pk2: spent.pk.toString(),
    };

    const { proof, publicSignals } = await groth16.fullProve(witness, WASM, ZKEY);

    expect(await groth16.verify(VKEY, publicSignals, proof)).toBe(true);

    // Public signal layout, docs/protocol.md section 6.
    expect(publicSignals.length).toBe(14);
    expect(publicSignals[0]).toBe(out1.cm.toString()); // cm1
    expect(publicSignals[1]).toBe(out2.cm.toString()); // cm2
    expect(publicSignals[2]).toBe("1"); // ok
    expect(publicSignals.slice(3, 13)).toEqual(input.cm_list);
    expect(publicSignals[13]).toBe(spent.snConsume.toString());

    // Shape the contract expects, with pi_b's inner pairs swapped.
    const calldata = toCalldata(proof, publicSignals);
    expect(calldata.pB[0][0]).toBe(proof.pi_b[0][1]);
    expect(calldata.pB[0][1]).toBe(proof.pi_b[0][0]);
    expect(calldata.pubSignals.length).toBe(14);
  }, 120000);
});
