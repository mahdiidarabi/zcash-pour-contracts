// Note derivation, browser side.
//
// This mirrors circuits/lib/{field,poseidon,note}.js. It is a port rather than a
// reuse because the Node version is CommonJS and takes its randomness from
// node:crypto -- bundling it would mean polyfilling more than this file is long.
//
// note.test.ts pins the two implementations together against the circuit's own
// committed vector. If they ever drift, that test fails.

import { buildPoseidonReference } from "circomlibjs";

// BN254 scalar field.
export const P =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface Note {
  sk: bigint;
  rho: bigint;
  r: bigint;
  value: bigint;
  pk: bigint;
  snProduce: bigint;
  cm: bigint;
  snConsume: bigint;
}

// An output you are paying to someone else: you pick the randomness, they hold
// the sk. No snConsume, because you cannot build their nullifier.
export interface Output {
  pk: bigint;
  rho: bigint;
  r: bigint;
  value: bigint;
  snProduce: bigint;
  cm: bigint;
}

// Random field element, by rejection.
//
// `random256Bits % P` is biased: 2^256 is only ~5.3 P, so the bottom ~29% of the
// field would come up noticeably more often. These are secret keys.
export function randomField(): bigint {
  const bytes = new Uint8Array(32);

  for (;;) {
    crypto.getRandomValues(bytes);

    let x = 0n;
    for (const b of bytes) {
      x = (x << 8n) | BigInt(b);
    }

    if (x < P) return x;
  }
}

let poseidon: any = null;

// buildPoseidonReference, not buildPoseidon: the latter goes through
// ffjavascript's wasm/worker builder, which hangs in the browser. The reference
// implementation is pure JS and produces byte-identical output -- note.test.ts
// checks that against the circuit's own vector.
//
// Constants are generated on first use, so do it once.
async function hashes() {
  if (poseidon === null) {
    poseidon = await buildPoseidonReference();
  }

  const h = (inputs: bigint[]): bigint => BigInt(poseidon.F.toString(poseidon(inputs)));

  return {
    hash1: (a: bigint) => h([a]),
    hash2: (a: bigint, b: bigint) => h([a, b]),
    hash3: (a: bigint, b: bigint, c: bigint) => h([a, b, c]),
  };
}

// pk        = Poseidon(sk)
// snProduce = Poseidon(rho, pk)
// cm        = Poseidon(r, snProduce, v)
// snConsume = Poseidon(snProduce, sk)
export async function deriveNote(secrets: {
  sk: bigint;
  rho: bigint;
  r: bigint;
  value: bigint;
}): Promise<Note> {
  const { hash1, hash2, hash3 } = await hashes();

  const pk = hash1(secrets.sk);
  const snProduce = hash2(secrets.rho, pk);
  const cm = hash3(secrets.r, snProduce, secrets.value);
  const snConsume = hash2(snProduce, secrets.sk);

  return { ...secrets, pk, snProduce, cm, snConsume };
}

export async function createNote(value: bigint): Promise<Note> {
  return deriveNote({
    sk: randomField(),
    rho: randomField(),
    r: randomField(),
    value,
  });
}

export async function deriveOutput(spec: {
  pk: bigint;
  rho: bigint;
  r: bigint;
  value: bigint;
}): Promise<Output> {
  const { hash2, hash3 } = await hashes();

  const snProduce = hash2(spec.rho, spec.pk);
  const cm = hash3(spec.r, snProduce, spec.value);

  return { ...spec, snProduce, cm };
}

// BigInt does not survive JSON.stringify, so notes cross the file boundary as
// decimal strings -- the form circom, the contract and ethers all accept.
export function noteToJson(note: Note): Record<string, string> {
  return {
    sk: note.sk.toString(),
    rho: note.rho.toString(),
    r: note.r.toString(),
    value: note.value.toString(),
    pk: note.pk.toString(),
    snProduce: note.snProduce.toString(),
    cm: note.cm.toString(),
    snConsume: note.snConsume.toString(),
  };
}

export function noteFromJson(json: Record<string, string>): {
  sk: bigint;
  rho: bigint;
  r: bigint;
  value: bigint;
} {
  for (const key of ["sk", "rho", "r", "value"]) {
    if (json[key] === undefined) {
      throw new Error(`note is missing "${key}"`);
    }
  }

  return {
    sk: BigInt(json.sk),
    rho: BigInt(json.rho),
    r: BigInt(json.r),
    value: BigInt(json.value),
  };
}
