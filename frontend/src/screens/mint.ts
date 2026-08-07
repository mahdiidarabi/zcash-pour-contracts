// Mint: create a note locally, then shield ETH into its commitment.
//
// The note is generated in the browser and never leaves it. Downloading is
// forced before the transaction can be sent, because sk is the only thing that
// can ever get the ETH back out.

// note.ts pulls in circomlibjs -> ffjavascript, which is most of the bundle.
// Imported on demand so first paint does not wait for it.
import type { Note } from "../note";
import { connect, hasWallet, pool, readableError, txUrl, writeContractUrl } from "../chain";
import { MAX_POUR_VALUE, POOL_ADDRESS } from "../config";
import { $, copy, download, escapeHtml, formatEth, on, parseEth, show, status } from "../ui";

let note: Note | null = null;
let saved = false;

export function render(root: HTMLElement): void {
  note = null;
  saved = false;

  root.innerHTML = `
    <h2>Mint — shield ETH into a commitment</h2>
    <p class="lede">
      A note is four secrets: <code>sk</code>, <code>rho</code>, <code>r</code> and a value.
      Everything else is derived from them by Poseidon. The chain only ever sees the
      commitment <code>cm</code>; <code>sk</code> stays in this tab.
    </p>

    <div class="row">
      <label for="amount">Amount (ETH)</label>
      <input id="amount" value="0.001" size="12" />
      <button id="generate">Generate note</button>
    </div>
    <div id="mint-status" class="status idle"></div>

    <div id="result" style="display:none">
      <h3>Your note</h3>
      <p class="warn">
        This is the coin. Anyone holding it can spend it, and if you lose it the ETH is
        stranded forever — <code>burn</code> re-derives the commitment from these secrets
        and there is no recovery path.
      </p>
      <pre id="note-json" class="note"></pre>
      <div class="row">
        <button id="save">Download note JSON</button>
        <button id="copy-note" class="secondary">Copy</button>
      </div>

      <h3>Send it</h3>
      <div class="row">
        <button id="send" disabled>Mint with wallet</button>
        <span class="hint" id="send-hint">Download the note first</span>
      </div>

      <details>
        <summary>No wallet? Use the block explorer</summary>
        <p class="lede">
          Paste these into <code>mint</code> on the
          <a href="${writeContractUrl()}" target="_blank" rel="noreferrer">Write Contract</a>
          tab. Set <code>payableAmount</code> to the same value as <code>_value</code>,
          in ETH.
        </p>
        <pre id="etherscan-args" class="note"></pre>
        <button id="copy-args" class="secondary">Copy arguments</button>
      </details>
    </div>
  `;

  on("generate", "click", generate);
  on("save", "click", saveNote);
  on("copy-note", "click", async (e) => {
    if (note === null) return;
    const { noteToJson } = await import("../note");
    await copy(JSON.stringify(noteToJson(note), null, 2), e.target as HTMLElement);
  });
  on("copy-args", "click", (e) => note && copy(etherscanArgs(note), e.target as HTMLElement));
  on("send", "click", send);
}

async function generate(): Promise<void> {
  let value: bigint;

  try {
    value = parseEth($<HTMLInputElement>("amount").value);
  } catch (e: any) {
    status("mint-status", "error", `Amount: ${e.message}`);
    return;
  }

  if (value <= 0n) {
    status("mint-status", "error", "Amount must be greater than zero — mint requires _value > 0.");
    return;
  }

  let noteToJson: (n: Note) => Record<string, string>;

  // Anything in here that throws used to leave the status stuck on "Loading",
  // because the rejection had nowhere to go.
  try {
    status("mint-status", "working", "Loading Poseidon…");
    const lib = await import("../note");
    noteToJson = lib.noteToJson;

    status("mint-status", "working", "Deriving Poseidon hashes…");
    note = await lib.createNote(value);
  } catch (e: any) {
    status("mint-status", "error", `Could not build the note: ${escapeHtml(e?.message ?? String(e))}`);
    return;
  }

  saved = false;
  $("note-json").textContent = JSON.stringify(noteToJson(note), null, 2);
  $("etherscan-args").textContent = etherscanArgs(note);
  $<HTMLButtonElement>("send").disabled = true;
  $("send-hint").textContent = "Download the note first";
  show("result", true);

  // Not fatal: the note can still be minted and burned, only poured.
  const pourable =
    value < MAX_POUR_VALUE
      ? ""
      : ` <strong>Note:</strong> above 2^128 wei this can be minted and burned but never poured.`;

  status("mint-status", "ok", `Note ready for ${formatEth(value)} ETH.${pourable}`);
}

async function saveNote(): Promise<void> {
  if (note === null) return;

  const { noteToJson } = await import("../note");
  download(`note-${note.cm.toString().slice(0, 12)}.json`, JSON.stringify(noteToJson(note), null, 2));
  saved = true;

  $<HTMLButtonElement>("send").disabled = false;
  $("send-hint").textContent = "Saved — you can mint now";
}

function etherscanArgs(n: Note): string {
  return [
    `_value      ${n.value}`,
    `_cm         ${n.cm}`,
    `_r          ${n.r}`,
    `_snProduce  ${n.snProduce}`,
    ``,
    `payableAmount (ETH)  ${formatEth(n.value)}`,
  ].join("\n");
}

async function send(): Promise<void> {
  if (note === null || !saved) return;

  if (!hasWallet()) {
    status("mint-status", "error", "No injected wallet. Use the block explorer section below.");
    return;
  }

  try {
    status("mint-status", "working", "Confirm in your wallet…");
    const { signer } = await connect();

    const tx = await pool(signer).mint(note.value, note.cm, note.r, note.snProduce, {
      value: note.value,
    });

    status("mint-status", "working", `Sent ${tx.hash.slice(0, 12)}… waiting for confirmation.`);
    const receipt = await tx.wait();

    status(
      "mint-status",
      "ok",
      `Minted in block ${receipt.blockNumber}. <a href="${txUrl(tx.hash)}" target="_blank" rel="noreferrer">View transaction</a>. Keep the note file safe.`
    );
  } catch (e: any) {
    status("mint-status", "error", escapeHtml(readableError(e)));
  }
}

export const meta = { id: "mint", label: "Mint", address: POOL_ADDRESS };
