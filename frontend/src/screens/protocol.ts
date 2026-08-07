// Protocol: the whole design, on one page.
//
// Static content. This is the page a reader should be able to open cold and come
// away knowing exactly what the circuit proves and what it does not.

import { POOL_ADDRESS } from "../config";

export function render(root: HTMLElement): void {
  root.innerHTML = `
    <h2>The protocol, end to end</h2>
    <p class="lede">
      A shielded pool in the shape of Zcash Sprout's <em>pour</em> (JoinSplit). ETH goes in
      behind a hash commitment, moves privately behind a zero-knowledge proof, and comes
      back out. What follows is the entire design — including the parts that are weaker
      than the real thing.
    </p>

    <h3>1 · The idea</h3>
    <p class="lede">
      The pool holds ETH and a flat set of <strong>commitments</strong>. A commitment is a
      hash: it binds a value and an owner without revealing either. Spending one publishes
      a <strong>nullifier</strong> — a value derived from the same secrets — which the
      contract records so nothing can be spent twice.
    </p>
    <p class="lede">
      The trick is that the nullifier cannot be linked back to its commitment by anyone
      without the spending key. So the chain sees <em>a</em> note was spent, never
      <em>which</em>.
    </p>
    <pre class="note">mint  ──▶  cm                    deposit, value public
           │
           ▼
pour  ──▶  cm1 + cm2             private split, amounts hidden
           │
           ▼
burn  ──▶  ETH to an address     withdrawal, everything public</pre>

    <h3>2 · A note</h3>
    <p class="lede">
      Four secrets — <code>sk</code>, <code>rho</code>, <code>r</code>, and a value in wei.
      Everything else is derived by Poseidon, a hash designed to be cheap inside an
      arithmetic circuit. SHA-256 costs roughly 30,000 constraints per compression;
      Poseidon costs about 240. That single choice is what keeps this circuit at ~4,600
      constraints instead of over a million.
    </p>
    <pre class="note">pk         = Poseidon(sk)                   who can spend it
sn_produce = Poseidon(rho, pk)              the note's serial
cm         = Poseidon(r, sn_produce, v)     what goes on chain
sn_consume = Poseidon(sn_produce, sk)       the nullifier, published on spend</pre>
    <p class="lede">
      Only the holder of <code>sk</code> can build <code>sn_consume</code>, and
      <code>sn_produce</code> already commits to <code>Poseidon(sk)</code>. That is the
      whole ownership argument — there are no signatures anywhere in this protocol.
    </p>

    <h3>3 · Mint — the deposit</h3>
    <p class="lede">
      You send ETH and the commitment you computed. The contract recomputes
      <code>Poseidon(r, sn_produce, v)</code> and rejects anything that does not match, so
      a commitment always has exactly its value behind it. No proof is involved: you are
      creating your own note and paying for it.
    </p>
    <p class="lede">
      Mint is <strong>transparent</strong>. The value and the opening are public. Privacy
      begins at the first pour.
    </p>

    <h3>4 · Pour — the interesting part</h3>
    <p class="lede">
      One note in, two out. The proof establishes four things at once, without revealing
      which note is being spent:
    </p>
    <ol class="lede">
      <li>You know <code>sk</code>, <code>rho</code> and <code>r</code> for some note.</li>
      <li>That note's commitment is one of ten commitments named publicly in the
          transaction — but not <em>which</em> one.</li>
      <li>The published nullifier really is that note's <code>sn_consume</code>.</li>
      <li>The two new commitments carry values summing exactly to the old one.</li>
    </ol>
    <p class="lede">
      The membership check is a linear scan, not a Merkle proof: the circuit takes ten
      commitments as public input, selects one by a private index <code>j</code> using
      equality gadgets, and asserts it equals the commitment it derived from your secrets.
      The contract then separately checks that all ten really exist in the pool. Neither
      half is sufficient alone — the circuit cannot see the chain, and the contract cannot
      see your secrets.
    </p>
    <p class="lede">
      Conservation comes from <code>v === v1 + v2</code> plus a 128-bit range check on each
      output. The range checks are load-bearing: field arithmetic is modular, so without
      them a prover could pick values that "sum" correctly by wrapping around the field and
      mint money from nothing. Bounded by 2<sup>128</sup> each, the sum cannot wrap.
    </p>

    <h4>What the transaction reveals</h4>
    <table>
      <tr><th>#</th><th>public signal</th><th>what it gives away</th></tr>
      <tr><td>0–1</td><td>cm1, cm2</td><td>two new commitments — values hidden</td></tr>
      <tr><td>2</td><td>ok</td><td>constant 1</td></tr>
      <tr><td>3–12</td><td>cm_list[10]</td><td>the anonymity set you chose</td></tr>
      <tr><td>13</td><td>sn_consume</td><td>a note was spent — not which</td></tr>
    </table>
    <p class="lede">
      Absent from that list: the spent commitment, the amounts, and any link between input
      and outputs. That absence <em>is</em> the protocol.
    </p>

    <h3>5 · Burn — the withdrawal</h3>
    <p class="lede">
      The inverse of mint, and fully transparent. You hand over the secrets, the contract
      re-derives the chain, checks the commitment exists and the nullifier is unused, and
      pays out. Crucially it consumes <strong>the same nullifier a pour would</strong>, so
      a note can never be both poured and burned.
    </p>

    <h3>6 · The circuit</h3>
    <table>
      <tr><th>proving system</th><td>Groth16 over BN254</td></tr>
      <tr><th>constraints</th><td>4,612 (2,277 non-linear)</td></tr>
      <tr><th>public signals</th><td>14</td></tr>
      <tr><th>private inputs</th><td>13</td></tr>
      <tr><th>verifier</th><td>on-chain Solidity, ~450k gas per pour</td></tr>
    </table>
    <p class="lede">
      Groth16 gives constant-size proofs and cheap on-chain verification, at the cost of a
      circuit-specific trusted setup — see below.
    </p>

    <h3>7 · Where this is weaker than Zcash</h3>
    <p class="warn">
      An honest list. This is a portfolio project on a testnet, not a private currency.
    </p>
    <table>
      <tr><th>Trusted setup</th>
          <td>A single contributor ran the ceremony. Whoever holds the toxic waste could
              forge proofs and mint unlimited value. Production needs a multi-party
              ceremony.</td></tr>
      <tr><th>Anonymity set of ten</th>
          <td>Zcash uses a Merkle tree over every note ever created. Ten is small, and the
              prover picks the ten — nothing forces them to be distinct, so a careless
              prover can leak exactly which note they spent.</td></tr>
      <tr><th>One input, not two</th>
          <td>Sprout's JoinSplit consumes two notes and lets value enter and leave in the
              same operation. Here deposit and withdrawal are separate transparent
              functions.</td></tr>
      <tr><th>No note encryption</th>
          <td>Zcash puts encrypted notes on chain so recipients can scan for payments with
              a viewing key. Here the recipient must be handed <code>r</code> and
              <code>rho</code> out of band.</td></tr>
      <tr><th>No domain separation</th>
          <td>Zcash tags its PRFs so a published nullifier cannot leak the paying key. Here
              the differing hash arities do that job in practice, but nothing enforces
              it.</td></tr>
      <tr><th>Random rho</th>
          <td>Zcash derives it per transaction. Sampling it randomly reintroduces a weak
              form of Faerie Gold: a sender who reuses <code>rho</code> for the same
              recipient makes two notes with one nullifier, so only one is spendable.</td></tr>
      <tr><th>Burn reveals sk</th>
          <td>Withdrawing publishes the spending key, which links every note ever created
              for it. Treat a key as single-use.</td></tr>
    </table>

    <h3>8 · Read the code</h3>
    <p class="lede">
      The circuit is <code>circuits/circuits/ZcashPour.circom</code>, the pool is
      <code>contracts/contracts/ZcashPourPool.sol</code>, and the full written spec is
      <code>docs/protocol.md</code>. The deployed pool is
      <a href="https://sepolia.etherscan.io/address/${POOL_ADDRESS}" target="_blank" rel="noreferrer">${POOL_ADDRESS}</a>.
    </p>
  `;
}
