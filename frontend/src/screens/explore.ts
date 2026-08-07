// Explore: read the pool out of the subgraph.
//
// Everything here is public by design. The commitments and nullifiers are the
// entire on-chain footprint of the pool -- what is missing from this page is the
// point: no amounts on pours, and no link from a nullifier back to a commitment.

import { connect, hasWallet } from "../chain";
import { commitments, nullifiers, poolStats, userActivity, type UserActivity } from "../subgraph";
import { $, abbreviate, escapeHtml, formatEth, on, show, status } from "../ui";

export function render(root: HTMLElement): void {
  root.innerHTML = `
    <h2>Explore — what the chain actually shows</h2>
    <p class="lede">
      Indexed by a subgraph over the pool's three events. Note what is <em>not</em> here:
      a pour publishes two commitments and a nullifier, and nothing links them to the note
      that was spent or to any amount.
    </p>
    <div id="explore-status" class="status idle">Loading…</div>

    <div id="stats"></div>

    <h3>My activity</h3>
    <div class="row">
      <input id="address" size="46" placeholder="0x…" />
      <button id="lookup">Look up</button>
      <button id="use-wallet" class="secondary">Use my wallet</button>
    </div>
    <div id="activity"></div>

    <h3>Commitments</h3>
    <div id="commitments"></div>

    <h3>Nullifiers</h3>
    <div id="nullifiers"></div>
  `;

  on("lookup", "click", lookup);
  on("use-wallet", "click", useWallet);

  void load();
}

async function load(): Promise<void> {
  try {
    const [{ pool, block }, cms, nfs] = await Promise.all([poolStats(), commitments(50), nullifiers(50)]);

    if (pool === null) {
      status("explore-status", "idle", "Nothing indexed yet.");
      return;
    }

    $("stats").innerHTML = `
      <table>
        <tr><th>commitments</th><td>${pool.commitmentCount}</td>
            <th>nullifiers</th><td>${pool.nullifierCount}</td></tr>
        <tr><th>mints</th><td>${pool.mintCount}</td>
            <th>pours</th><td>${pool.pourCount}</td></tr>
        <tr><th>burns</th><td>${pool.burnCount}</td>
            <th>held</th><td>${formatEth(BigInt(pool.totalSupply))} ETH</td></tr>
      </table>`;

    $("commitments").innerHTML = table(
      ["#", "commitment", "from"],
      cms.map((c) => [c.index, mono(c.commit), c.source])
    );

    $("nullifiers").innerHTML = table(
      ["nullifier", "from"],
      nfs.map((n) => [mono(n.snConsume), n.source])
    );

    status("explore-status", "ok", `Indexed up to block ${block}.`);
  } catch (e: any) {
    status("explore-status", "error", escapeHtml(e?.message ?? "could not reach the subgraph"));
  }
}

function mono(value: string): string {
  return `<span title="${value}">${abbreviate(value, 12)}</span>`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return `<p class="lede">None yet.</p>`;

  return `<table>
    <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
    ${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}
  </table>`;
}

async function useWallet(): Promise<void> {
  if (!hasWallet()) {
    status("explore-status", "error", "No injected wallet — paste an address instead.");
    return;
  }

  const { address } = await connect();
  $<HTMLInputElement>("address").value = address;
  await lookup();
}

async function lookup(): Promise<void> {
  const address = $<HTMLInputElement>("address").value.trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    $("activity").innerHTML = `<p class="lede">That is not a valid address.</p>`;
    return;
  }

  try {
    const user = await userActivity(address);

    if (user === null) {
      $("activity").innerHTML = `<p class="lede">This address has never touched the pool.</p>`;
      return;
    }

    $("activity").innerHTML = summary(user);
  } catch (e: any) {
    $("activity").innerHTML = `<p class="lede">${escapeHtml(e?.message ?? "lookup failed")}</p>`;
  }
}

function summary(user: UserActivity): string {
  const burns = user.burns.map((b) => [
    b.value === null ? "—" : `${formatEth(BigInt(b.value))} ETH`,
    b.recipient === null ? "—" : mono(b.recipient),
  ]);

  return `
    <table>
      <tr><th>mints</th><td>${user.mintCount}</td>
          <th>total in</th><td>${formatEth(BigInt(user.totalMinted))} ETH</td></tr>
      <tr><th>pours</th><td>${user.pourCount}</td>
          <th>burns</th><td>${user.burnCount}</td></tr>
      <tr><th>total out</th><td>${formatEth(BigInt(user.totalBurned))} ETH</td><th></th><td></td></tr>
    </table>
    <h3>Mints</h3>
    ${table(["value", "commitment"], user.mints.map((m) => [`${formatEth(BigInt(m.value))} ETH`, mono(m.commit)]))}
    <h3>Pours</h3>
    ${table(["nullifier"], user.pours.map((p) => [p.nullifier ? mono(p.nullifier.snConsume) : "—"]))}
    <h3>Burns</h3>
    ${table(["value", "recipient"], burns)}
  `;
}
