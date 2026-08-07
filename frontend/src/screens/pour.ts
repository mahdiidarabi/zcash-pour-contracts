// Pour: spend one note, create two, behind a Groth16 proof built in this tab.
//
// This is the screen worth reading. Everything else is deposit and withdrawal
// plumbing; this is the only place the zero-knowledge part actually happens.

import type { Note } from "../note";
import { connect, hasWallet, pool, readableError, txUrl, writeContractUrl } from "../chain";
import { CM_LIST_SIZE, MAX_POUR_VALUE } from "../config";
import { prove, type ProofResult } from "../prover";
import { commitments } from "../subgraph";
import { $, copy, download, escapeHtml, formatEth, on, parseEth, show, status } from "../ui";

let spent: Note | null = null;
let outputs: { note: Note; label: string }[] = [];
let proof: ProofResult | null = null;

export function render(root: HTMLElement): void {
  spent = null;
  outputs = [];
  proof = null;

  root.innerHTML = `
    <h2>Pour — spend privately</h2>
    <p class="lede">
      Proves, without revealing which note you own, that you hold the secret behind
      <em>one of</em> ten commitments in the pool, and that the two new commitments you are
      creating carry exactly the same total value. The chain learns a nullifier and two new
      commitments. It does not learn which note was spent, or for how much.
    </p>

    <h3>1 · The note to spend</h3>
    <textarea id="note-input" placeholder='Paste a note JSON, or drop the file here'></textarea>
    <div class="row">
      <input type="file" id="note-file" accept="application/json" />
      <button id="load">Load note</button>
    </div>
    <div id="load-status" class="status idle"></div>

    <div id="plan" style="display:none">
      <h3>2 · How to split it</h3>
      <p class="lede">
        Both halves go to your own key, so you end up with two spendable notes and need no
        second party. A pour can pay <em>anyone</em> — you would use their <code>pk</code>
        instead of yours, and they would need the <code>r</code> and <code>rho</code> below
        to spend it.
      </p>
      <div class="row">
        <label for="v1">First (ETH)</label>
        <input id="v1" size="14" />
        <label for="v2">Second (ETH)</label>
        <input id="v2" size="14" />
        <button id="halve" class="secondary">Split evenly</button>
      </div>

      <h3>3 · Prove it</h3>
      <p class="lede">
        Downloads the proving key and runs Groth16 in your browser. Nothing is precomputed
        and no server is involved.
      </p>
      <button id="do-prove">Generate proof</button>
      <div id="prove-status" class="status idle"></div>
      <pre id="proof-out" class="note" style="display:none"></pre>
    </div>

    <div id="submit" style="display:none">
      <h3>4 · Send it</h3>
      <p class="warn">
        Save both new notes before sending. They are the only way to spend the ETH
        afterwards, and the old note becomes unspendable the moment this lands.
      </p>
      <div class="row">
        <button id="save-outputs">Download both notes</button>
        <button id="send" disabled>Pour with wallet</button>
        <span class="hint" id="send-hint">Download the new notes first</span>
      </div>
      <div id="send-status" class="status idle"></div>
      <pre id="outputs-json" class="note"></pre>

      <details>
        <summary>No wallet? Use the block explorer</summary>
        <p class="lede">
          Paste into <code>pour</code> on the
          <a href="${writeContractUrl()}" target="_blank" rel="noreferrer">Write Contract</a> tab.
        </p>
        <pre id="etherscan-args" class="note"></pre>
        <button id="copy-args" class="secondary">Copy arguments</button>
      </details>
    </div>
  `;

  on("load", "click", loadNote);
  on("note-file", "change", readFile);
  on("halve", "click", halve);
  on("do-prove", "click", generateProof);
  on("save-outputs", "click", saveOutputs);
  on("send", "click", send);
  on("copy-args", "click", (e) => proof && copy(JSON.stringify(proof, null, 2), e.target as HTMLElement));
}

function readFile(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    $<HTMLTextAreaElement>("note-input").value = String(reader.result);
    loadNote();
  };
  reader.readAsText(file);
}

async function loadNote(): Promise<void> {
  try {
    status("load-status", "working", "Checking the note…");

    const { deriveNote, noteFromJson } = await import("../note");
    const parsed = JSON.parse($<HTMLTextAreaElement>("note-input").value);
    spent = await deriveNote(noteFromJson(parsed));

    // Re-derived rather than trusted: a hand-edited note would otherwise fail
    // deep inside the prover with nothing useful to say.
    if (parsed.cm !== undefined && parsed.cm !== spent.cm.toString()) {
      status("load-status", "error", "This note is inconsistent — cm does not match its own secrets.");
      spent = null;
      return;
    }

    if (spent.value >= MAX_POUR_VALUE) {
      status("load-status", "error", "This note is above the circuit's 2^128 ceiling and cannot be poured.");
      spent = null;
      return;
    }

    const half = spent.value / 2n;
    $<HTMLInputElement>("v1").value = formatEth(half);
    $<HTMLInputElement>("v2").value = formatEth(spent.value - half);

    show("plan", true);
    status("load-status", "ok", `Loaded a note worth ${formatEth(spent.value)} ETH.`);
  } catch (e: any) {
    spent = null;
    show("plan", false);
    status("load-status", "error", escapeHtml(e?.message ?? "could not read that note"));
  }
}

function halve(): void {
  if (spent === null) return;

  const half = spent.value / 2n;
  $<HTMLInputElement>("v1").value = formatEth(half);
  $<HTMLInputElement>("v2").value = formatEth(spent.value - half);
}

async function generateProof(): Promise<void> {
  if (spent === null) return;

  try {
    const v1 = parseEth($<HTMLInputElement>("v1").value);
    const v2 = parseEth($<HTMLInputElement>("v2").value);

    if (v1 + v2 !== spent.value) {
      status(
        "prove-status",
        "error",
        `The two halves must add up to the note exactly: ${formatEth(v1)} + ${formatEth(v2)} ≠ ${formatEth(spent.value)} ETH.`
      );
      return;
    }
    if (v1 < 0n || v2 < 0n) {
      status("prove-status", "error", "Values cannot be negative.");
      return;
    }

    // The circuit proves membership of cm_list, and the contract separately
    // checks every entry really exists on chain. So the list has to be real
    // commitments, and must contain this note.
    status("prove-status", "working", "Fetching commitments from the subgraph…");
    const rows = await commitments(200);
    const all = rows.map((r) => r.commit);
    const mine = spent.cm.toString();

    if (!all.includes(mine)) {
      status(
        "prove-status",
        "error",
        "This note's commitment is not in the pool yet. If you just minted it, wait for the subgraph to catch up and try again."
      );
      return;
    }

    const others = all.filter((c) => c !== mine).slice(0, CM_LIST_SIZE - 1);
    if (others.length < CM_LIST_SIZE - 1) {
      status(
        "prove-status",
        "error",
        `pour needs ${CM_LIST_SIZE} existing commitments and the pool only has ${all.length}.`
      );
      return;
    }

    const cmList = [mine, ...others];
    const j = 0;

    status("prove-status", "working", "Building the two new notes…");
    const { deriveOutput, deriveNote, randomField } = await import("../note");

    const spec1 = { pk: spent.pk, rho: randomField(), r: randomField(), value: v1 };
    const spec2 = { pk: spent.pk, rho: randomField(), r: randomField(), value: v2 };
    const out1 = await deriveOutput(spec1);
    const out2 = await deriveOutput(spec2);

    const witness = {
      cm_list: cmList,
      v: spent.value.toString(),
      j: String(j),
      r_old: spent.r.toString(),
      sk_old: spent.sk.toString(),
      rho: spent.rho.toString(),
      sn_consume: spent.snConsume.toString(),
      v1: v1.toString(),
      r1: out1.r.toString(),
      rho1: out1.rho.toString(),
      pk1: spent.pk.toString(),
      v2: v2.toString(),
      r2: out2.r.toString(),
      rho2: out2.rho.toString(),
      pk2: spent.pk.toString(),
    };

    const messages: Record<string, string> = {
      loading: "Downloading proving key (~2 MB)…",
      proving: "Proving — 4,612 constraints…",
      verifying: "Verifying locally before spending gas…",
      done: "",
    };

    proof = await prove(witness, (stage) => {
      if (messages[stage]) status("prove-status", "working", messages[stage]);
    });

    if (!proof.locallyValid) {
      status("prove-status", "error", "The proof did not verify locally. Not sending it.");
      proof = null;
      return;
    }

    // Both outputs are spendable by the same sk that owned the input.
    outputs = [
      { note: await deriveNote({ sk: spent.sk, rho: spec1.rho, r: spec1.r, value: v1 }), label: "first" },
      { note: await deriveNote({ sk: spent.sk, rho: spec2.rho, r: spec2.r, value: v2 }), label: "second" },
    ];

    const { noteToJson } = await import("../note");
    $("outputs-json").textContent = JSON.stringify(outputs.map((o) => noteToJson(o.note)), null, 2);
    $("etherscan-args").textContent = etherscanArgs(proof);
    $("proof-out").textContent = JSON.stringify(
      { pubSignals: proof.pubSignals.map((s) => (s.length > 20 ? `${s.slice(0, 20)}…` : s)) },
      null,
      2
    );
    show("proof-out", true);
    show("submit", true);
    $<HTMLButtonElement>("send").disabled = true;

    status(
      "prove-status",
      "ok",
      `Proved in ${Math.round(proof.proveMs)} ms, verified locally in ${Math.round(proof.verifyMs)} ms.`
    );
  } catch (e: any) {
    proof = null;
    status("prove-status", "error", escapeHtml(e?.message ?? "proving failed"));
  }
}

async function saveOutputs(): Promise<void> {
  if (outputs.length === 0) return;

  const { noteToJson } = await import("../note");
  for (const out of outputs) {
    download(`note-${out.note.cm.toString().slice(0, 12)}.json`, JSON.stringify(noteToJson(out.note), null, 2));
  }

  $<HTMLButtonElement>("send").disabled = false;
  $("send-hint").textContent = "Saved — you can pour now";
}

function etherscanArgs(p: ProofResult): string {
  return [
    `_pA         ${JSON.stringify(p.pA)}`,
    `_pB         ${JSON.stringify(p.pB)}`,
    `_pC         ${JSON.stringify(p.pC)}`,
    `_pubSignals ${JSON.stringify(p.pubSignals)}`,
  ].join("\n\n");
}

async function send(): Promise<void> {
  if (proof === null) return;

  if (!hasWallet()) {
    status("send-status", "error", "No injected wallet. Use the block explorer section below.");
    return;
  }

  try {
    status("send-status", "working", "Confirm in your wallet…");
    const { signer } = await connect();

    const tx = await pool(signer).pour(proof.pA, proof.pB, proof.pC, proof.pubSignals);
    status(
      "send-status",
      "working",
      `Sent <a href="${txUrl(tx.hash)}" target="_blank" rel="noreferrer">${tx.hash.slice(0, 18)}…</a> — waiting for confirmation.`
    );

    const receipt = await tx.wait();
    status(
      "send-status",
      "ok",
      `Poured in block ${receipt.blockNumber}. <a href="${txUrl(tx.hash)}" target="_blank" rel="noreferrer">View transaction</a>. The old note is spent; the two new notes are yours.`
    );
  } catch (e: any) {
    status("send-status", "error", escapeHtml(readableError(e)));
  }
}
