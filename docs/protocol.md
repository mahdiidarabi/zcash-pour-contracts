# Pour Protocol — as-built spec

Describes the system that exists in this repo today: `circuits/circuits/ZcashPour.circom`
and `contracts/contracts/ZcashPourPool.sol`. Where the circuit and the contract disagree,
the circuit wins — the contract's job is to enforce what the circuit cannot see.

This is a **pour-shaped** shielded pool, not a Zcash-compatible one, and it is smaller
than Sprout in ways that matter. §10 is the honest list.

---

## 1. Shape of the system

A single pool contract holds ETH and a flat set of note commitments. Three operations:

| Op | Value flow | Privacy | Proof |
|---|---|---|---|
| `mint` | ETH **in**, transparent | none — opening is public | no proof, contract recomputes `cm` |
| `pour` | none (internal) | shielded, 1-in / 2-out | Groth16 |
| `burn` | ETH **out**, transparent | none — reveals `sk` | no proof, contract recomputes chain |

Unlike Sprout's `JoinSplit`, one primitive does *not* cover everything here. Deposit and
withdrawal are separate transparent functions; only the internal transfer is shielded.
`pour` moves no ETH at all — it consumes one shielded note and produces two.

```
mint  ──▶  cm                       (transparent deposit, v revealed)
           │
           ▼
pour  ──▶  cm1 + cm2                (shielded split, v1 + v2 == v, all hidden)
           │
           ▼
burn  ──▶  ETH to recipient         (transparent exit, sk revealed)
```

---

## 2. Field and hash

BN254 scalar field,
`p = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.

**Poseidon** (circomlib parameters) everywhere, at three arities:

| Circuit | Solidity | Arity |
|---|---|---|
| `Poseidon(1)` | `posiden1` → `PoseidonT2.hash` | 1 |
| `Poseidon(2)` | `posiden2` → `PoseidonT3.hash` | 2 |
| `Poseidon(3)` | `posiden3` → `PoseidonT4.hash` | 3 |

The on-chain and in-circuit hashes must agree exactly; `ZcashPourBurn.test.ts` pins this
with an oracle test that re-derives the proof's `cm` and `sn_consume` through the
contract's helpers and compares against the circuit's public signals. Keep that test.

**No domain separation.** Every hash is a bare Poseidon call with no tag. Sprout tags its
PRFs (`0` = paying key, `1` = nullifier) specifically so that publishing a nullifier can't
leak the paying key. Here the arities differ between the three derivations, which
separates them in practice, but nothing enforces it structurally. See §10.

---

## 3. Note format

A note is `(sk, rho, r, v)`. Everything is a field element; `v` is in **wei**.

| Field | Secret? | Meaning |
|---|---|---|
| `sk` | secret | Spending key. Sole proof of ownership. |
| `pk` | derived | `Poseidon(sk)` — recipient identifier |
| `rho` | secret* | Entropy for the note serial |
| `r` | secret* | Commitment trapdoor |
| `v` | varies | Value in wei |

\* secret in principle; `mint` publishes both. See §4.1.

The derivation chain — this is the whole protocol:

```
pk          = Poseidon(sk)                        // arity 1
sn_produce  = Poseidon(rho, pk)                   // arity 2  — note serial
cm          = Poseidon(r, sn_produce, v)          // arity 3  — the commitment
sn_consume  = Poseidon(sn_produce, sk)            // arity 2  — the nullifier
```

`sn_produce` is the note's identity; `sn_consume` is what gets published when it's spent.
Deriving `sn_consume` requires `sk`, and `sn_produce` already commits to `Poseidon(sk)`,
so only the holder of `sk` can produce a valid nullifier for a note. That is the entire
ownership argument.

There are no dummy notes and no `v == 0` convention.

---

## 4. Operations

### 4.1 `mint(_value, _cm, _r, _snProduce)` — transparent deposit

```solidity
require(msg.value == _value && _value > 0);
require(posiden3(_r, _snProduce, _value) == _cm);
require(commitmentToIndex[_cm] == 0);          // "already committed"
```

Inserts `_cm` at the next index, bumps `totalSupply` by `_value`, emits
`CommitmentSubmitted`.

The caller hands over `_r` and `_snProduce` **in cleartext calldata**. The contract needs
them only to check that `_cm` is a well-formed commitment to `_value` — but the
consequence is that a minted note's full opening, minus `sk`, is public from birth.
Confidentiality of a fresh note rests entirely on `sk`.

There is deliberately no proof here: you are creating your own note and paying for it.

### 4.2 `pour(pA, pB, pC, pubSignals)` — shielded 1-in / 2-out

Verifies the Groth16 proof, then enforces everything the circuit cannot. **All checks run
before any state change:**

1. `verifyProof(...)` — else `"invalid proof"`
2. `ok == 1` — else `"proof valid but wrong result"`
3. each of `cm_list[0..9]` must already exist — else `"cmList not exist"`
4. `snConsumeList[sn_consume] == false` — else `"this sn consume already used"`
5. `commitmentToIndex[cm1] == 0 && commitmentToIndex[cm2] == 0` — else `"commitment exists"`
6. `cm1 != cm2` — else `"duplicate output commitment"`
7. marks the nullifier spent, emits `SnConsumeSubmitted`
8. inserts `cm1`, `cm2`, emits two `CommitmentSubmitted`

Steps 3 and 8 were once the other way round, which let a proof list its own fresh outputs
inside `cm_list` and still pass.

No ETH moves. `totalSupply` is untouched, which is correct — value neither enters nor
leaves the pool.

Step 5 is what makes the anonymity set real: the circuit proves the spent note is *one of*
`cm_list`, and the contract proves every member of `cm_list` is a genuine pool commitment.
Neither check alone is sufficient.

### 4.3 `burn(_value, _r, _rho, _sk, _recipient)` — transparent exit

Re-derives the whole chain on-chain from the revealed secrets, requires the resulting `cm`
to exist and its `sn_consume` to be unspent, then marks the nullifier, decrements
`totalSupply`, and sends `_value` to `_recipient`.

Because it consumes **the same nullifier `pour` would**, a note can never be both poured
and burned. Two tests cover exactly this crossing (`blocks pour after burn`,
`blocks burn after pour`).

Effects precede the interaction and `totalSupply -= _value` underflow-reverts, so the
external call is not a reentrancy hole.

---

## 5. The circuit

`Main(10)` composes two templates.

**`spending_sn_circuit(n)` — proves the right to spend.** Private: `v, j, r_old, rho,
sk_old`. Public: `cm_list[n]`, `sn_consume`.

1. `pk_old = Poseidon(sk_old)`
2. `sn_produce = Poseidon(rho, pk_old)`
3. `Poseidon(sn_produce, sk_old) === sn_consume` — binds the published nullifier to `sk`
4. `cm_j = Poseidon(r_old, sn_produce, v)`
5. selects `cm_list[j]` by summing `IsEqual(j, i) * cm_list[i]` over `i`, asserts it equals `cm_j`
6. `LessThan(10)` range-checks `j < n`
7. `ok <== 1`

Membership is a **linear scan**, not a Merkle proof: `n` equality gadgets and an
accumulator. That is why `n` is 10 and why it is a public input array rather than a root.

**`pour_circuit()` — proves the split is honest.** Private: `r1, rho1, v1, pk1, r2, rho2,
v2, pk2`.

1. `v === v1 + v2`
2. `Num2Bits(128)` on `v1` and `v2`
3. `cm1 = Poseidon(r1, Poseidon(rho1, pk1), v1)`
4. `cm2 = Poseidon(r2, Poseidon(rho2, pk2), v2)`

Outputs take `pk`, not `sk`, so you can pay someone else without their secret.

**On balance and overflow.** `v` is not range-checked directly, but it doesn't need to be:
it is pinned by `v === v1 + v2` with both addends proven to be 128-bit, so `v < 2^129` over
the integers and the field cannot wrap. `v` is simultaneously pinned to the spent note's
committed value through `cm_j`. Together those give conservation: you cannot pour out more
than you poured in. This is the single most important property in the circuit — it
deserves a dedicated negative test that currently does not exist.

**Size** (from `snarkjs r1cs info`):

| | |
|---|---|
| constraints | 4,612 (2,277 non-linear, 2,335 linear) |
| wires | 4,630 |
| private inputs | 13 |
| public inputs | 11 |
| public outputs | 3 |

Powers-of-tau needs `2^k ≥ 4612`, so `k ≥ 13`; the build uses `POWER=16`.

---

## 6. Public signals — order is load-bearing

circom emits outputs first in declaration order, then public inputs. The generated
verifier takes `uint[14]`, and `ZcashPourPool.pour` indexes it positionally. Reorder
anything in `Main` and the contract silently reads the wrong slots.

| # | Signal | Checked by the contract |
|---|---|---|
| 0 | `cm1` | must not already exist; inserted |
| 1 | `cm2` | must not already exist; inserted |
| 2 | `ok` | `== 1` |
| 3–12 | `cm_list[0..9]` | each must already exist |
| 13 | `sn_consume` | must be unspent; marked spent |

`ok` is hardcoded `ok <== 1` inside the template — it is not the result of any test. Every
real check is a `===` constraint, which makes an invalid witness *unprovable* rather than
producing `ok = 0`. The contract's `require(ok == 1)` is therefore redundant. Harmless, but
don't mistake it for a safety net.

Proof formatting: snarkjs's Solidity calldata **swaps the inner pairs of `pi_b`**. Both
proof-consuming tests do this; getting it wrong fails verification with no useful error.

---

## 7. On-chain state

```solidity
mapping(uint256 => uint256) indexToCommitment;   // index → cm
mapping(uint256 => uint256) commitmentToIndex;   // cm → index  (0 means absent)
mapping(uint256 => bool)    snConsumeList;       // nullifier → spent
uint256 totalSupply;                             // wei held on behalf of notes
uint256 commitmentIndex;                         // next free index, starts at 1
```

`commitmentIndex` starts at **1** so that `commitmentToIndex[x] == 0` unambiguously means
"not present". Every existence check in `pour` depends on that.

There is no Merkle tree and no root history. Membership is proven by naming ten
commitments explicitly and having the contract look each one up.

---

## 8. Artifact coupling

Three artifacts must agree, and nothing at runtime checks that they do:

```
ZcashPour.r1cs ──▶ ZcashPour_final.zkey ──▶ ZcashPourVerifier.sol
                            │
                            └──▶ proof.json / public.json
```

- Recompiling the circuit invalidates the zkey. `prove.sh` catches this via
  `build/<C>/.r1cs.sha256`.
- Re-running `setup` produces a **new zkey even from an identical r1cs** — the phase-2
  contribution draws fresh entropy — which changes `delta` in the verifier and invalidates
  every previously generated proof. Nothing catches this; the symptom is `pour` reverting
  with `"invalid proof"` while the circuit is unchanged.
- The exported verifier carries `r1cs:` and `zkey:` sha256 in its header banner. Compare
  those before debugging anything else.
- **A deployed pool embeds the verifier's `delta`.** Re-running `setup` means redeploy, not
  just re-verify.

Run `setup` only when the r1cs actually changed.

---

## 9. What is actually enforced

- **Ownership** — spending needs `sk`; `sn_consume` is bound to it (§5.3).
- **Conservation** — `v == v1 + v2`, both 128-bit, `v` pinned to the spent commitment (§5).
- **No double-spend** — one nullifier set shared by `pour` and `burn`.
- **No forged membership** — circuit proves `cm_j ∈ cm_list`; contract proves every
  `cm_list` entry is real.
- **No commitment collision** — `mint` and `pour` both reject a commitment that already
  exists, and `pour` rejects `cm1 == cm2`.

---

## 10. Known gaps

**Values are capped at 2^128 wei.** `Num2Bits(128)` on `v1`/`v2` bounds any poured
output. That is ~3.4e38 wei against a 120M-ETH supply of ~1.2e26, so it does not bind in
practice — but `mint` still accepts any `uint256`, so a note above the ceiling can be
minted and burned yet never poured. `circuits/lib/limits.js` mirrors the width and the
note tooling refuses such values up front. Do not widen much further: the range checks
are what keep `v1 + v2` from wrapping the field (§5).

**Anonymity set of 10, prover-chosen, no distinctness check.** Neither circuit nor contract
requires `cm_list` entries to differ. A prover may pass the same commitment ten times; the
contract's ten existence checks all pass, and the spent note is then revealed exactly.
Privacy is opt-in and silently self-defeatable. Enforce distinctness, or replace the list
with a Merkle root — the linear scan is also why `n` can't grow much.

**No proof binding.** Nothing ties a proof to `msg.sender` or a recipient. A Groth16 proof
is a bearer token, so anyone can lift one from the mempool and submit it. For `pour` the
damage is limited to griefing — the front-runner creates the same commitments and the
original tx then reverts with `"commitment exists"` — but the pattern is wrong, and any
future value-bearing public signal (recipient, relayer, fee) must be added *before* launch:
a new public signal means new circuit, new setup, new verifier, redeploy.

**`burn` reveals `sk`.** It publishes `value, r, rho, sk` in calldata. `sk` is the identity
behind `pk`, so burning one note retroactively links every other note ever created for that
`pk` and forward-links any future one. Treat `sk` as single-use, or derive per-note keys.

**No domain separation.** See §2. Distinct arities are doing the work that explicit tags
should do.

**Trusted setup.** Single-contributor Groth16 ceremony. Whoever holds the toxic waste can
forge proofs and mint unlimited value. Fine for testnet, disqualifying for real value.

**No `rho` derivation.** Sprout derives output `rho` from a per-transaction `h_sig`; we
sample it randomly. Reintroduces weak *Faerie Gold*: a sender who makes you two notes with
the same `rho` and `pk` gives them the same nullifier, so only one is spendable. Burns
their money, not yours.

**No note encryption.** Note data reaches the recipient out of band. There is no on-chain
ciphertext and no viewing key, so there is no way to scan for notes paid to you.

**Unexplained: invalid proofs are expensive.** The gas table records `pour (invalid proof)`
at 16,259,887 gas against 447,664 for the success path. The generated verifier returns
`false` cleanly with no `invalid()` opcode, so the cause is not obvious and I have not
traced it. It matters for relayer economics and DoS surface — worth understanding before
anyone else can submit proofs.

**Not audited. Testnet only.**

---

## 11. Divergence from Zcash Sprout

| Sprout | Here |
|---|---|
| SHA256 / BLAKE2b | Poseidon (~240 constraints vs ~30k) |
| Merkle tree, depth 29, root history | flat set + public `cm_list[10]`, linear scan |
| 2-in / 2-out with dummy notes | 1-in / 2-out, no dummies |
| `vPubIn` / `vPubOut` in one circuit | separate transparent `mint` / `burn` |
| tagged PRFs | untagged Poseidon at differing arities |
| `rho` from `h_sig` | random `rho` |
| encrypted note ciphertexts on-chain | out-of-band |

The hash swap is the deliberate one — a faithful Sprout circuit would exceed a million
constraints. The rest are MVP scope cuts.

---

## 12. Next

Ordered by how much they block real use:

1. ~~Widen the value range to `Num2Bits(128)`~~ — done; setup re-run, verifier re-exported.
2. ~~Duplicate-commitment guard on `mint`~~ — done.
3. ~~Reorder `pour`: membership checks before insertion~~ — done, plus a `cm1 != cm2` check.
4. Distinctness on `cm_list`, or move to a Merkle root with history.
5. Negative tests: unbalanced `v1 + v2`, overflow attempt, wrong `sk`, tampered `cm_list`.
6. Bind proofs to a recipient; reserve relayer/fee signals now, not later.
7. ~~Restore a spend-side test helper~~ — done; `mockAddCommitment` now lives only in
   `contracts/test/ZcashPourPoolHarness.sol`. In the pool itself it is a drain: insert a
   commitment with no deposit behind it, then burn it for real ETH.
