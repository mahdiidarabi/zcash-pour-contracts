// Shell: a tab strip and one screen at a time. No router library -- the hash is
// the whole state.

import "./polyfills";
import "./style.css";

// A rejected promise with no handler used to show up as a screen frozen on its
// last status message. Make it loud instead.
window.addEventListener("unhandledrejection", (e) => {
  console.error("unhandled rejection:", e.reason);
});
import { checkManifest } from "./manifest";
import { CHAIN_NAME, EXPLORER, POOL_ADDRESS, REPO_URL, SUBGRAPH_URL, WRITING_URL } from "./config";
// Screens are dynamically imported so a tab only costs what it uses -- the
// prover and Poseidon do not load unless you actually pour.

type Screen = { render(root: HTMLElement): void };

const screens: Record<string, { label: string; load: () => Promise<Screen> }> = {
  mint: { label: "Mint", load: () => import("./screens/mint") },
  pour: { label: "Pour", load: () => import("./screens/pour") },
  burn: { label: "Burn", load: () => import("./screens/burn") },
  explore: { label: "Explore", load: () => import("./screens/explore") },
  protocol: { label: "Protocol", load: () => import("./screens/protocol") },
};

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <header>
    <h1>zcash-pour</h1>
    <p class="lede">
      A Zcash-style shielded pool on ${CHAIN_NAME}. Deposit ETH behind a Poseidon
      commitment, spend it privately with a Groth16 proof generated <strong>in this
      tab</strong>, withdraw it again.
    </p>
    <p class="meta">
      <a href="${REPO_URL}" target="_blank" rel="noreferrer">GitHub</a>
      ·
      <a href="${WRITING_URL}" target="_blank" rel="noreferrer">Writing on ZK</a>
      ·
      <a href="${EXPLORER}" target="_blank" rel="noreferrer">contract</a>
      ·
      <a href="${SUBGRAPH_URL}" target="_blank" rel="noreferrer">subgraph</a>
    </p>
    <p class="meta addr">${POOL_ADDRESS}</p>
    <div class="banner testnet">
      Testnet demo. The trusted setup had a single contributor, so whoever holds the
      toxic waste could forge proofs. Not audited. Do not put real value in this.
    </div>
    <div id="manifest-banner"></div>
    <nav id="tabs"></nav>
  </header>
  <main id="screen"></main>
  <footer>
    <p>
      No backend. Keys are generated in your browser and never sent anywhere.
      <a href="${REPO_URL}" target="_blank" rel="noreferrer">Source on GitHub</a>
      ·
      <a href="${WRITING_URL}" target="_blank" rel="noreferrer">My writing on zero knowledge</a>
    </p>
  </footer>
`;

const tabs = document.getElementById("tabs")!;
const screen = document.getElementById("screen")!;

for (const [id, { label }] of Object.entries(screens)) {
  const a = document.createElement("a");
  a.href = `#${id}`;
  a.textContent = label;
  a.dataset.screen = id;
  tabs.append(a);
}

async function route(): Promise<void> {
  const id = location.hash.slice(1) || "mint";
  const entry = screens[id] ?? screens.mint;

  for (const a of tabs.querySelectorAll("a")) {
    a.classList.toggle("active", a.dataset.screen === id);
  }

  screen.innerHTML = `<p class="lede">Loading…</p>`;
  (await entry.load()).render(screen);
}

window.addEventListener("hashchange", route);
await route();

// A zkey that no longer matches the deployed verifier fails as "invalid proof"
// from a transaction, which is horrible to diagnose from a browser. Say it up
// front instead.
const manifest = await checkManifest();
if (!manifest.ok) {
  document.getElementById("manifest-banner")!.innerHTML =
    `<div class="banner error">Prover artefacts are stale: ${manifest.detail}</div>`;
}
