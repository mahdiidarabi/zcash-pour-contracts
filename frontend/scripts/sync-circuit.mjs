// Copy the prover artefacts out of ../circuits/build into public/circuit/, and
// record what they were.
//
//   npm run sync-circuit
//
// This is a DEVELOPMENT step, run by hand after the circuit changes. It is not
// part of `npm run build`: circuits/build/ is gitignored, so it does not exist
// on Vercel. public/circuit/ is committed for the same reason the generated
// verifier .sol is committed -- it is a build artefact the deployment needs.
//
// The zkey encodes delta, and so does the deployed pool. Re-running the trusted
// setup invalidates both at once. manifest.json carries the zkey hash so the app
// can say so out loud instead of failing as "invalid proof" on chain.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, "..", "..", "circuits", "build", "ZcashPour");
const out = join(here, "..", "public", "circuit");

const files = [
  ["ZcashPour_js/ZcashPour.wasm", "ZcashPour.wasm"],
  ["ZcashPour_final.zkey", "ZcashPour.zkey"],
  ["verification_key.json", "verification_key.json"],
];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (!existsSync(build)) {
  console.error(`missing ${build}\n\nrun: cd ../circuits && npm run all ZcashPour 16`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

const manifest = { syncedAt: new Date().toISOString(), files: {} };

for (const [from, to] of files) {
  const src = join(build, from);
  if (!existsSync(src)) {
    console.error(`missing ${src}`);
    process.exit(1);
  }

  copyFileSync(src, join(out, to));
  const bytes = readFileSync(src).length;
  manifest.files[to] = { sha256: sha256(src), bytes };
  console.log(`${to.padEnd(24)} ${(bytes / 1048576).toFixed(2)} MB  ${manifest.files[to].sha256.slice(0, 16)}...`);
}

// The banner the exported verifier carries, so a mismatch is traceable to a
// specific ceremony rather than just "something changed".
const verifier = join(here, "..", "..", "contracts", "contracts", "verifiers", "ZcashPourVerifier.sol");
if (existsSync(verifier)) {
  const match = readFileSync(verifier, "utf8").match(/zkey:\s*sha256:([0-9a-f]{64})/);
  if (match) {
    manifest.verifierZkeySha256 = match[1];
    const zkey = manifest.files["ZcashPour.zkey"].sha256;
    console.log(`\nverifier was exported from zkey ${match[1].slice(0, 16)}...`);
    console.log(zkey === match[1] ? "MATCH -- proofs will verify" : "MISMATCH -- re-export the verifier and redeploy");
  }
}

writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nwrote public/circuit/manifest.json`);
