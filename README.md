# zcash-pour-contracts

A working implementation of the Zcash **pour** (JoinSplit) transaction — circom circuit,
Solidity verifier, subgraph, and a browser client that generates real Groth16 proofs.

### ▸ [Live demo](https://zcash-pour-contracts.vercel.app/) · [Writing on zero knowledge](https://mahdidarabi.medium.com/list/reading-list)

The demo runs on Sepolia. Deposit ETH behind a Poseidon commitment, spend it privately
with a proof generated **in your browser**, withdraw it again. No backend — keys are
created in the tab and never leave it.

---

A pour is the primitive behind Zcash's shielded pool: it spends a private note and creates
new ones behind a zero-knowledge proof, so value moves without anyone learning which coin
moved. `mint` shields ETH into a commitment, `pour` spends one note into two behind a
Groth16 proof, `burn` unshields back to an address.

**Testnet only.** Not audited, and the trusted setup had a single contributor — whoever
holds the toxic waste could forge proofs. The honest list of everything weaker than real
Zcash is [§10 of the protocol doc](docs/protocol.md).

## What this is

| | |
|---|---|
| **Circuit** | Groth16 over BN254, 4,612 constraints, 14 public signals |
| **Proving** | ~0.8 s in node, a few seconds in-browser via snarkjs |
| **On chain** | Solidity verifier, ~453k gas per pour |
| **Hash** | Poseidon throughout — ~240 constraints vs ~30,000 for SHA-256 |
| **Live** | [`0x9097…6C5f`](https://sepolia.etherscan.io/address/0x9097c70e0aCE543FE9cE07393b3865864cEF6C5f) on Sepolia, indexed by a subgraph |

Built end to end: the circuit and its trusted-setup pipeline, the pool contract and its
generated verifier, note-derivation tooling shared between Node and the browser, a
subgraph over the pool's events, and a client that proves in the tab. Every layer has
tests, and the JS derivation is pinned to the circuit's own committed vector so the two
cannot silently drift.

## Layout

| | |
|---|---|
| [`circuits/`](circuits/README.md) | circom circuits, Groth16 pipeline, note tooling |
| [`contracts/`](contracts/README.md) | Hardhat project — the pool and the generated verifier |
| [`contracts/zcash-pour-subgraph/`](contracts/zcash-pour-subgraph) | The Graph subgraph over the pool's events |
| [`frontend/`](frontend/README.md) | the browser client — proving, wallet, subgraph reader |
| [`docs/protocol.md`](docs/protocol.md) | as-built spec: note format, public signals, known gaps |

`circuits/` and `contracts/` are independent npm packages. `circuits/` generates the
Solidity verifier that `contracts/` compiles against; that generated file is the only
build artifact crossing the boundary.

## Quick start

```bash
cd circuits && npm install && npm run all ZcashPour 16
npm run check                       # does the JS Poseidon match the circuit?

cd ../contracts && npm install && npm test

cd ../frontend && npm install && npm run dev
```

## The full path

Every step, from an empty repo to a shielded transfer. Notes are built off-chain by
`circuits/tools/`; the contract only ever sees commitments and nullifiers.

### 0. Build the circuit and deploy

```bash
cd circuits && npm install
npm run all ZcashPour 16      # compile + trusted setup + export the verifier
npm run prove ZcashPour       # regenerate the reference proof
npm run check                 # JS Poseidon == circuit?

cd ../contracts && npm install && npm test
npm run deploy:sepolia
npm run verify:sepolia -- <pool address>
```

`npm run all` re-runs the trusted setup, which changes the verifier's `delta`. That
invalidates every existing proof **and** any already-deployed pool, so `prove` and a
redeploy are not optional. Only run it when the circuit actually changed.

### 1. Make a note

```bash
cd circuits
node tools/new-note.js --value 1000000000000000 --name alice   # 0.001 ETH
```

Writes `notes/alice.json` — the secrets, the four derived values, and the `mint()`
arguments ready to pass:

```
pk        = Poseidon(sk)                  who can spend it
snProduce = Poseidon(rho, pk)             the note's serial
cm        = Poseidon(r, snProduce, v)     what goes on chain
snConsume = Poseidon(snProduce, sk)       the nullifier, published on spend
```

**`sk` is the coin.** `notes/*.json` is gitignored; lose the file and the ETH is stranded
with no recovery path.

### 2. Shield it

```js
const note = require("./circuits/notes/alice.json");

await pool.mint(note.mint._value, note.mint._cm, note.mint._r, note.mint._snProduce,
                { value: note.mint._value });
```

`msg.value` must equal `_value` exactly. The same commitment cannot be minted twice.

### 3. Get ten commitments

`pour` proves your note is one of ten, and the contract requires all ten to already exist
on chain. So the pool needs ten commitments before any pour is possible:

```bash
for name in alice bob carol dave erin frank grace heidi ivan judy; do
  node tools/new-note.js --value 1000000000000000 --name "$name"
done
```

Mint each one, then collect the ten `cm` values into a JSON array:

```bash
jq -s '[.[].cm]' notes/*.json > cmlist.json
```

Nothing checks that the entries are distinct, so padding with one commitment repeated ten
times also passes — and identifies your spent note exactly. Fine for a smoke test, no
privacy.

### 4. Pour

Spend alice's note into two new ones. `--pk1`/`--pk2` are the recipients' `pk`, which they
give you; it is the only value they have to share.

```bash
node tools/pour-input.js \
  --note notes/alice.json \
  --cm-list cmlist.json \
  --v1 400000000000000 --pk1 <bob's pk> \
  --v2 600000000000000 --pk2 <carol's pk> \
  --out inputs/pour1.json > outputs.json

npm run prove ZcashPour inputs/pour1.json
node tools/calldata.js > calldata.json
```

```js
const { pA, pB, pC, pubSignals } = require("./circuits/calldata.json");
await pool.pour(pA, pB, pC, pubSignals);
```

`v1 + v2` must equal the spent note's value. **`outputs.json` matters** — it holds the `r`
and `rho` chosen for each new note, and the recipient cannot spend theirs without them.
The chain only ever sees the commitment, so hand those over out of band; combined with
their own `sk` they form a spendable note.

Alice's note is now spent: its nullifier is on chain and it can never be poured or burned
again.

### 5. Unshield

```bash
node tools/burn-args.js --note notes/alice.json --recipient 0xabc...
```

```js
await pool.burn(note.value, note.r, note.rho, note.sk, recipient);
```

`burn` is fully transparent — value, `r`, `rho` and `sk` all land in public calldata.
Publishing `sk` links this note to every other note ever made for the same key, so treat
a key as single-use.

Per-tool detail is in [`circuits/README.md`](circuits/README.md); the contract side is in
[`contracts/README.md`](contracts/README.md).

## Further reading

[`docs/protocol.md`](docs/protocol.md) is the source of truth — note format, the exact
public signal ordering, what the circuit proves, and §10's list of everything weaker here
than in real Zcash. The circuit and the contract must both agree with it.

The [Protocol tab](https://zcash-pour-contracts.vercel.app/#protocol) on the live demo
covers the same ground in prose, if you would rather read it than the spec.

## Why Poseidon

A SHA-256 compression costs ~30,000 R1CS constraints; Poseidon costs ~240. A faithful
Sprout circuit using Zcash's SHA-256/BLAKE2b would run past a million constraints, which
is the difference between proving in a browser tab and not proving at all. That choice
makes this system *pour-shaped* rather than Zcash-compatible; the full list of deviations
is in the protocol doc.
