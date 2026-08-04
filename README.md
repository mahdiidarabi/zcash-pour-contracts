# zcash-pour-contracts

A proof of concept of the Zcash pour (JoinSplit) transaction, in circom and Solidity.

A pour is the primitive behind Zcash's shielded pool: it spends a private note and
creates new ones behind a zero-knowledge proof, so value moves without anyone learning
which coin moved. This repo implements a pour-shaped pool — `mint` shields ETH into a
commitment, `pour` spends one note into two behind a Groth16 proof, `burn` unshields
back to an address.

This is an MVP for **testnet only**. It is not audited, and it uses a single-contributor
trusted setup.

## Layout

| | |
|---|---|
| [`circuits/`](circuits/README.md) | circom circuits, Groth16 pipeline, and the note tooling |
| [`contracts/`](contracts/README.md) | Hardhat project — the pool and the generated verifier |
| [`docs/protocol.md`](docs/protocol.md) | as-built spec: note format, public signals, known gaps |

The two projects are independent npm packages. `circuits/` generates the Solidity
verifier that `contracts/` compiles against; that generated file is the only build
artifact crossing the boundary.

## Quick start

```bash
cd circuits && npm install && npm run all ZcashPour 16
npm run check                       # does the JS Poseidon match the circuit?

cd ../contracts && npm install && npm test
```

## Using the pool

Notes are built off-chain by `circuits/tools/`, then handed to the contract. A full
deposit and withdrawal, with no proving involved:

```bash
cd circuits
node tools/new-note.js --value 100 --name alice     # -> notes/alice.json
```

```js
const note = require("./circuits/notes/alice.json");

// shield 100 wei
await pool.mint(note.mint._value, note.mint._cm, note.mint._r, note.mint._snProduce,
                { value: note.mint._value });

// unshield it again
await pool.burn(note.value, note.r, note.rho, note.sk, recipient);
```

`notes/alice.json` holds `sk` in the clear and is gitignored. Lose it and the ETH is
stranded — `burn` cannot re-derive the commitment without it.

`pour` needs a proof and ten existing commitments; see
[`circuits/README.md`](circuits/README.md).

## Read this first

[`docs/protocol.md`](docs/protocol.md) is the source of truth for the note format and
the public signal ordering, and both sides must agree with it. Section 10 lists the
known gaps — the one that will surprise you is that **poured values are capped at 2³²
wei (~4.29 gwei)**, so notes are dust-sized until the circuit is widened.

## Design notes

Poseidon replaces Zcash's SHA256/BLAKE2b throughout. A SHA256 compression costs ~30k
R1CS constraints against ~240 for Poseidon, which would put a faithful Sprout circuit
over a million constraints. That makes this system *pour-shaped*, not Zcash-compatible;
the full list of deviations is in the protocol doc.
