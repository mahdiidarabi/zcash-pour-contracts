// Burn: destroy a note and take the ETH back out.
//
// The inverse of mint, and completely transparent. Nothing is hidden here.

import type { Note } from "../note";
import { connect, hasWallet, pool, readableError, txUrl, writeContractUrl } from "../chain";
import { $, copy, escapeHtml, formatEth, on, show, status } from "../ui";

let note: Note | null = null;

export function render(root: HTMLElement): void {
  note = null;

  root.innerHTML = `
    <h2>Burn — take the ETH back out</h2>
    <p class="lede">
      The contract re-derives the whole hash chain from the secrets you hand it, checks the
      resulting commitment exists and its nullifier is unused, then pays out. It consumes
      the <em>same</em> nullifier a pour would, so a note can never be both poured and burned.
    </p>
    <p class="warn">
      Burn is transparent. The value, <code>r</code>, <code>rho</code> and <code>sk</code>
      all go into public calldata. Publishing <code>sk</code> links this note to every other
      note ever created for the same key — treat a key as single-use.
    </p>

    <h3>1 · The note to burn</h3>
    <textarea id="note-input" placeholder='Paste a note JSON, or drop the file here'></textarea>
    <div class="row">
      <input type="file" id="note-file" accept="application/json" />
      <button id="load">Load note</button>
    </div>
    <div id="burn-status" class="status idle"></div>

    <div id="target" style="display:none">
      <h3>2 · Where the ETH goes</h3>
      <div class="row">
        <label for="recipient">Recipient</label>
        <input id="recipient" size="46" placeholder="0x…" />
        <button id="use-wallet" class="secondary">Use my wallet</button>
      </div>

      <h3>3 · Send it</h3>
      <div class="row">
        <button id="send">Burn with wallet</button>
      </div>

      <details>
        <summary>No wallet? Use the block explorer</summary>
        <p class="lede">
          Paste into <code>burn</code> on the
          <a href="${writeContractUrl()}" target="_blank" rel="noreferrer">Write Contract</a> tab.
        </p>
        <pre id="etherscan-args" class="note"></pre>
        <button id="copy-args" class="secondary">Copy arguments</button>
      </details>
    </div>
  `;

  on("load", "click", loadNote);
  on("note-file", "change", readFile);
  on("use-wallet", "click", useWallet);
  on("recipient", "input", refreshArgs);
  on("send", "click", send);
  on("copy-args", "click", (e) => copy($("etherscan-args").textContent ?? "", e.target as HTMLElement));
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
    status("burn-status", "working", "Checking the note…");

    const { deriveNote, noteFromJson } = await import("../note");
    const parsed = JSON.parse($<HTMLTextAreaElement>("note-input").value);
    note = await deriveNote(noteFromJson(parsed));

    if (parsed.cm !== undefined && parsed.cm !== note.cm.toString()) {
      status("burn-status", "error", "This note is inconsistent — cm does not match its own secrets.");
      note = null;
      return;
    }

    show("target", true);
    refreshArgs();
    status("burn-status", "ok", `Loaded a note worth ${formatEth(note.value)} ETH.`);
  } catch (e: any) {
    note = null;
    show("target", false);
    status("burn-status", "error", escapeHtml(e?.message ?? "could not read that note"));
  }
}

async function useWallet(): Promise<void> {
  try {
    const { address } = await connect();
    $<HTMLInputElement>("recipient").value = address;
    refreshArgs();
  } catch (e: any) {
    status("burn-status", "error", escapeHtml(readableError(e)));
  }
}

function refreshArgs(): void {
  if (note === null) return;

  const recipient = $<HTMLInputElement>("recipient").value.trim() || "0x…";
  $("etherscan-args").textContent = [
    `_value      ${note.value}`,
    `_r          ${note.r}`,
    `_rho        ${note.rho}`,
    `_sk         ${note.sk}`,
    `_recipient  ${recipient}`,
  ].join("\n");
}

async function send(): Promise<void> {
  if (note === null) return;

  const recipient = $<HTMLInputElement>("recipient").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    status("burn-status", "error", "That is not a valid address.");
    return;
  }

  if (!hasWallet()) {
    status("burn-status", "error", "No injected wallet. Use the block explorer section below.");
    return;
  }

  try {
    status("burn-status", "working", "Confirm in your wallet…");
    const { signer } = await connect();

    const tx = await pool(signer).burn(note.value, note.r, note.rho, note.sk, recipient);
    status("burn-status", "working", `Sent ${tx.hash.slice(0, 12)}… waiting for confirmation.`);

    const receipt = await tx.wait();
    status(
      "burn-status",
      "ok",
      `Burned in block ${receipt.blockNumber}, ${formatEth(note.value)} ETH sent. <a href="${txUrl(tx.hash)}" target="_blank" rel="noreferrer">View transaction</a>.`
    );
  } catch (e: any) {
    status("burn-status", "error", escapeHtml(readableError(e)));
  }
}
