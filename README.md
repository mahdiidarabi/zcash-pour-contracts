 # zcash-pour-contracts

  A proof of concept of the Zcash pour (JoinSplit) transaction, in circom and Solidity.

  A pour is the single primitive behind Zcash's shielded pool: it consumes up to two
  private notes, creates up to two new ones, and lets value enter or leave the pool —
  all behind a zero-knowledge proof. One circuit covers deposit, private transfer, and
  withdrawal. That generality is what separates a pour from a fixed-denomination mixer.

  This is an MVP for **testnet only**. It is not audited, and it uses a single-contributor
  trusted setup.

  ## Layout
  
  | | |
  |---|---|
  | [`circuits/`](circuits/README.md) | circom circuits + Groth16 build pipeline |
  | [`contracts/`](contracts/README.md) | Hardhat project — the pool and the generated verifier |
  | [`docs/protocol.md`](docs/protocol.md) | note format, public signal layout, implementation plan |

  The two projects are independent npm packages. `circuits/` generates the Solidity
  verifier that `contracts/` compiles against; that generated file is the only thing
  crossing the boundary.

  ## Quick start
  
  ```bash
  cd circuits  && npm install && npm run all ZcashPour 16
  cd ../contracts && npm install && npx hardhat test
  ```

  Start with [`docs/protocol.md`](docs/protocol.md) — it is the source of truth for the
  note format and the public signal ordering, and both sides must agree with it.

  ## Design notes

  Poseidon replaces Zcash's SHA256/BLAKE2b throughout. A SHA256 compression costs ~30k
  R1CS constraints against ~240 for Poseidon, which would put a faithful Sprout circuit
  over a million constraints. This makes the system *pour-shaped*, not Zcash-compatible.
  Rationale and the full list of deviations are in the protocol doc.

  One thing: the contracts/README.md you saved ends with the four review notes from my previous message (the "Four small things I noticed..." section). Those were meant as chat
  commentary, not README content — worth deleting lines 54-59 unless you want them tracked as a TODO list, in which case they'd read better as a ## TODO heading.