// Pins the JS Poseidon against the circuit.
//
// Re-derives the coin described by inputs/ZcashPour.json and checks it lands on
// the same commitment and nullifier the committed proof did. If a circomlibjs
// bump ever changes Poseidon, this fails in a second -- instead of surfacing as
// an unprovable witness twenty seconds into `npm run prove`.
//
//   node tools/check.js

const fs = require("fs");
const path = require("path");
const { deriveNote } = require("../lib/note");

const root = path.join(__dirname, "..");

function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.error(`missing ${file} -- run 'npm run all ZcashPour 16' first`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function expect(what, got, want) {
  if (got !== want) {
    console.error(`FAIL ${what}\n  got  ${got}\n  want ${want}`);
    process.exit(1);
  }
  console.log(`ok   ${what}`);
}

async function main() {
  const input = read("inputs/ZcashPour.json");
  const pub = read("build/ZcashPour/public.json");

  // Public signal layout, docs/protocol.md section 6.
  expect("public.json has 14 signals", pub.length, 14);

  const note = await deriveNote({
    sk: BigInt(input.sk_old),
    rho: BigInt(input.rho),
    r: BigInt(input.r_old),
    value: BigInt(input.v),
  });

  const j = Number(input.j);
  expect("cm == cm_list[j]", note.cm.toString(), input.cm_list[j]);
  expect("snConsume == input", note.snConsume.toString(), input.sn_consume);
  expect("snConsume == public[13]", note.snConsume.toString(), pub[13]);

  console.log("\nJS Poseidon matches the circuit.");
}

main();
