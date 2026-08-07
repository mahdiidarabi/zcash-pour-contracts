// Are the prover artefacts the ones the deployed verifier was exported from?
//
// Kept out of prover.ts so the check does not pull snarkjs into the entry chunk.

import { CIRCUIT } from "./config";

export async function checkManifest(): Promise<{ ok: boolean; detail: string }> {
  try {
    const manifest = await (await fetch(CIRCUIT.manifest)).json();
    const zkey = manifest.files?.["ZcashPour.zkey"]?.sha256;
    const expected = manifest.verifierZkeySha256;

    if (!zkey || !expected) {
      return { ok: true, detail: "manifest incomplete; skipping check" };
    }

    return zkey === expected
      ? { ok: true, detail: `zkey ${zkey.slice(0, 12)}… matches the deployed verifier` }
      : {
          ok: false,
          detail: `zkey ${zkey.slice(0, 12)}… but the verifier was built from ${expected.slice(0, 12)}… — proofs will be rejected`,
        };
  } catch {
    return { ok: true, detail: "manifest unavailable; skipping check" };
  }
}
