// Groth16 proving, in the browser.
//
// This is the part worth looking at: snarkjs runs the same prover the CLI does,
// against the same wasm and zkey, and the contract on Sepolia verifies the
// result. Nothing is precomputed and there is no server involved.

import { CIRCUIT } from "./config";

export interface PourCalldata {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
  pubSignals: string[];
}

export interface ProofResult extends PourCalldata {
  proveMs: number;
  verifyMs: number;
  locallyValid: boolean;
}

export type Stage = "loading" | "proving" | "verifying" | "done";

// snarkjs hands back pi_b with the inner pairs in the opposite order to the
// Solidity verifier. Getting this wrong makes verifyProof return false with no
// diagnostic whatsoever -- it is the single easiest mistake in the repo.
export function toCalldata(proof: any, pub: string[]): PourCalldata {
  return {
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pC: [proof.pi_c[0], proof.pi_c[1]],
    pubSignals: pub,
  };
}

export async function prove(
  input: Record<string, unknown>,
  onStage: (stage: Stage) => void = () => {}
): Promise<ProofResult> {
  onStage("loading");

  // Dynamic so the ~3 MB prover is fetched only when someone actually pours,
  // instead of on first paint.
  const { groth16 } = await import("snarkjs");
  const vkey = await (await fetch(CIRCUIT.vkey)).json();

  onStage("proving");
  const startProve = performance.now();
  const { proof, publicSignals } = await groth16.fullProve(input, CIRCUIT.wasm, CIRCUIT.zkey);
  const proveMs = performance.now() - startProve;

  // Verify locally before asking anyone to pay gas for it. A proof that fails
  // here would fail on chain too, and this costs milliseconds.
  onStage("verifying");
  const startVerify = performance.now();
  const locallyValid = await groth16.verify(vkey, publicSignals, proof);
  const verifyMs = performance.now() - startVerify;

  onStage("done");

  return { ...toCalldata(proof, publicSignals), proveMs, verifyMs, locallyValid };
}
