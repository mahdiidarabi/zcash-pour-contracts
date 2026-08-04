// Poseidon, with the same parameters circomlib's circuits and poseidon-solidity
// use. tools/check.js pins that claim against a real proof -- run it after any
// circomlibjs bump.
//
//   hash1 <-> circom Poseidon(1) <-> Solidity posiden1 / PoseidonT2
//   hash2 <-> circom Poseidon(2) <-> Solidity posiden2 / PoseidonT3
//   hash3 <-> circom Poseidon(3) <-> Solidity posiden3 / PoseidonT4

const { buildPoseidon } = require("circomlibjs");

let built;

// buildPoseidon() has to generate the round constants, so it is async and worth
// doing once. Everything downstream is async for this one reason.
async function hashes() {
  if (!built) built = await buildPoseidon();

  // buildPoseidon returns field elements in Montgomery form; F.toString gives
  // the decimal the circuit and the contract both speak.
  const h = (inputs) => BigInt(built.F.toString(built(inputs)));

  return {
    hash1: (a) => h([a]),
    hash2: (a, b) => h([a, b]),
    hash3: (a, b, c) => h([a, b, c]),
  };
}

module.exports = { hashes };
