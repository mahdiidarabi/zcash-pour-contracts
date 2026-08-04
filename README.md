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

## Read this first

[`docs/protocol.md`](docs/protocol.md) is the source of truth for the note format and
the public signal ordering, and both sides must agree with it. Section 10 lists the
known gaps. Values are bounded by the circuit's `Num2Bits(128)` range checks, which is
far above anything real, but the tooling will still tell you if you cross it.

## Design notes

Poseidon replaces Zcash's SHA256/BLAKE2b throughout. A SHA256 compression costs ~30k
R1CS constraints against ~240 for Poseidon, which would put a faithful Sprout circuit
over a million constraints. That makes this system *pour-shaped*, not Zcash-compatible;
the full list of deviations is in the protocol doc.
