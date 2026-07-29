# Pour Protocol — Spec & Implementation Plan

Single source of truth. The circom circuit, the JS reference implementation, and the
Solidity contracts must all agree with this file. If they disagree, this file is right.

---

## 1. What a pour is

Zcash Sprout's `JoinSplit` consumes up to 2 shielded notes, creates up to 2 shielded
notes, takes `vPubIn` transparent value in, releases `vPubOut` transparent value out:

```
v_in[0] + v_in[1] + vPubIn  ==  v_out[0] + v_out[1] + vPubOut
```

One primitive covers everything:

| Operation | inputs | vPubIn | outputs | vPubOut |
|---|---|---|---|---|
| Deposit | 2 dummy | > 0 | 1 real + 1 dummy | 0 |
| Transfer | 1–2 real | 0 | 1–2 real | 0 |
| Withdraw | 1–2 real | 0 | 1 change + 1 dummy | > 0 |

No separate deposit/withdraw circuit. That generality is what makes this a pour and
not a fixed-denomination mixer.

---

## 2. Field & hash

BN254 scalar field, `p = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.

**Poseidon** (circomlib params) everywhere. Zcash uses SHA256 + BLAKE2b; that's ~30k
constraints per hash vs ~240 for Poseidon, which would put this circuit over a million
constraints. Deliberate documented deviation — this is *pour-shaped*, not Zcash-compatible.

Domain separation via a leading constant, mirroring Zcash's tagged PRFs:
tag `0` = paying key, tag `1` = nullifier. Without it, publishing a nullifier would
leak the paying key.

---

## 3. Note format

Note = `(a_pk, v, rho, r)`.

| Field | Type | Meaning |
|---|---|---|
| `a_sk` | field | Spending key. Secret, never leaves the client. |
| `a_pk` | field | `Poseidon(0, a_sk)` |
| `v` | uint128 | Value in wei |
| `rho` | field | Nullifier seed, random |
| `r` | field | Commitment trapdoor, random |

```
cm = Poseidon(a_pk, v, rho, r)      // Merkle leaf
nf = Poseidon(1, a_sk, rho)         // published on spend, prevents double-spend
```

**Dummy notes:** a pour always supplies 2 inputs, but a deposit has none to spend.
Rule: **`v == 0` means dummy** → skip the Merkle check. The nullifier is still
published, so sample fresh random `a_sk`/`rho` for every dummy, or you link your
transactions. (Zcash uses an explicit `enforce` bool; `v == 0` is equivalent and saves
a signal.)

---

## 4. Merkle tree

Binary, depth **20**, `Poseidon(left, right)`, zero leaf =
`keccak256("zcash-pour-contracts") % p` hashed up per level. Contract keeps the last
**30** roots.

Incremental insert: store only the rightmost path (`filledSubtrees`), so an append is
20 hashes, not a full recompute.

Root history exists because proving takes time — someone else's deposit may advance
the root before your tx lands. Accepting an old root is safe: it only proves membership
of something already in the tree.

---

## 5. Public signals — order is load-bearing

snarkjs emits these as a flat array in declaration order; the generated verifier takes
`uint256[10]`. Reordering silently changes what you're proving.

| # | Signal | Notes |
|---|---|---|
| 0 | `root` | must be in root history |
| 1 | `nullifier[0]` | rejected if spent |
| 2 | `nullifier[1]` | rejected if spent |
| 3 | `commitment[0]` | inserted into tree |
| 4 | `commitment[1]` | inserted into tree |
| 5 | `vPubIn` | must equal `msg.value` |
| 6 | `vPubOut` | paid to `recipient` |
| 7 | `recipient` | address as field element |
| 8 | `relayer` | zero if self-relayed |
| 9 | `fee` | paid to relayer, taken from `vPubOut` |

`recipient`/`relayer`/`fee` feed no real constraint — they exist to *bind* the proof.
Without them a Groth16 proof is a bearer token and anyone can front-run your withdrawal
from the mempool with a different recipient. circom eliminates unconstrained signals, so
each needs a dummy constraint (`x * x === xSquared`). Same trick Tornado uses.

Relayer/fee ship unused in the MVP but must exist from day one — adding a public signal
later means new circuit, new setup, new verifier, migration.

---

## 6. The pour statement

Private witness: per input `a_sk, v, rho, r, pathElements[20], pathIndices[20]`;
per output `a_pk, v, rho, r`.

**Per input i:**
1. `a_pk_i = Poseidon(0, a_sk_i)` — you know the spending key
2. `cm_i = Poseidon(a_pk_i, v_i, rho_i, r_i)`
3. `nullifier[i] = Poseidon(1, a_sk_i, rho_i)`
4. if `v_i != 0`: `MerkleProof(cm_i, path_i) == root`

**Per output j:** `commitment[j] = Poseidon(a_pk_j, v_j, rho_j, r_j)`
(takes `a_pk`, not `a_sk` — you create notes for others without their secrets)

**Balance:** the equation in §1, plus `Num2Bits(128)` on all six value signals.

> The range checks are the single most important constraint. Field arithmetic is
> modular: without them a prover sets an output to `p - 1`, the sum "balances", and
> value is minted from nothing. Bounded by 2^128 each, the sum can't exceed 2^130 << p,
> so it holds over the integers. Give this a dedicated negative test.

---

## 7. Implementation plan

Build in this order. Each phase is testable before the next one starts.

### Phase 1 — JS reference implementation `circuits/src/`
- [ ] `note.ts` — `Note` type, `randomNote()`, `randomFieldElement()`, `commitment()`, `nullifier()`, `derivePk()`
- [ ] `merkle.ts` — off-chain incremental tree: `insert()`, `root()`, `proof(index)`, precomputed zero values
- [ ] `pour.ts` — assemble circuit input JSON from 2 in-notes + 2 out-notes + public params
- [ ] tests for all three

Do this **first**. It's the oracle every later phase is checked against, and it's pure
JS — fast to iterate. Getting the note encoding wrong here poisons everything downstream.

### Phase 2 — circuit primitives `circuits/circuits/lib/`
- [ ] `note.circom` — `NoteCommitment`, `Nullifier`, `DerivePk` templates
- [ ] `merkle.circom` — `MerkleProof(depth)`, using `DualMux` for path ordering
- [ ] Tests asserting circuit output **== JS output** on random inputs

The cross-check against Phase 1 is the point. Don't skip it.

### Phase 3 — top-level circuit `circuits/circuits/pour.circom`
- [ ] `Spend` template: one input note — pk derivation, commitment, nullifier, conditional Merkle check
- [ ] `Pour(depth)`: 2 spends, 2 output commitments, balance, range checks, dummy constraints for recipient/relayer/fee
- [ ] Happy-path tests: deposit, transfer, withdraw
- [ ] Negative tests: wrong `a_sk`, tampered Merkle path, unbalanced values, **overflow attempt (§6)**, spent-note reuse

### Phase 4 — build pipeline
- [ ] `npm run compile` → r1cs/wasm/sym, note the constraint count
- [ ] `npm run setup` → ptau download + groth16 setup + contribution
- [ ] `npm run export-verifier` → `contracts/contracts/verifiers/PourVerifier.sol`

Scripts are already written. Mostly you just run them.

### Phase 5 — contracts `contracts/contracts/`
- [ ] `MerkleTreeWithHistory.sol` — incremental tree + 30-root ring buffer
- [ ] Test: on-chain root **== JS root** after the same inserts (first real integration proof)
- [ ] `ZcashPour.sol` — `pour()`: verify proof, check root known, check nullifiers unspent, mark spent, insert commitments, handle `msg.value`/payout/fee, emit events
- [ ] Attack tests: double-spend, unknown root, `msg.value != vPubIn`, `fee > vPubOut`, replay with swapped recipient

**Watch out:** on-chain Poseidon must match circomlib exactly. `poseidon-solidity` is
wired in — verify it against your JS impl in the very first contract test.

### Phase 6 — end-to-end
- [ ] Test that generates a **real proof** with snarkjs and lands a **real transaction**
- [ ] Full cycle: deposit → transfer → partial withdraw

### Phase 7 — ship
- [ ] Deploy to Sepolia, record addresses in `deployments/sepolia.json`
- [ ] Verify contracts on Etherscan
- [ ] CLI so someone else can actually use it
- [ ] README with the numbers: constraint count, proving time, gas per op

---

## 8. Known limitations (say these out loud in interviews)

**Trusted setup.** Groth16 needs a circuit-specific ceremony. MVP uses one
contributor; whoever holds the toxic waste could mint unlimited value. Production needs
MPC.

**No `rho` derivation.** Zcash derives output `rho` from `h_sig` (unique per tx); we
sample randomly. Reintroduces weak *Faerie Gold*: a malicious sender making two notes
for you with the same `rho` gives them the same nullifier, so you can only spend one.
Burns their money, not yours. Tracked as follow-up.

**Anonymity set.** Privacy scales with pool size. On testnet with a handful of users,
timing and value correlation deanonymise nearly everything regardless of the crypto.

**No note encryption on-chain.** Note data goes to the recipient out of band as JSON.
Zcash puts encrypted ciphertexts in the tx so recipients can scan with a viewing key.
Out of scope.

**Not audited. Testnet only.**
