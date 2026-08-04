// Turn a generated proof into the four arguments pour() takes.
//
//   node tools/calldata.js > calldata.json
//
// snarkjs writes the inner pairs of pi_b in the opposite order to what the
// Solidity verifier reads. Swapping them is the easiest thing in this whole
// repo to get wrong -- verification just returns false, with no hint why.

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("../lib/args");

const USAGE = `usage: node tools/calldata.js [--circuit <name>]

  --circuit  defaults to ZcashPour`;

function read(file) {
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}\n\nrun 'npm run prove <circuit>' first\n\n${USAGE}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const circuit = args.circuit === undefined || args.circuit === true ? "ZcashPour" : args.circuit;

  const dir = path.join(__dirname, "..", "build", circuit);
  const proof = read(path.join(dir, "proof.json"));
  const pub = read(path.join(dir, "public.json"));

  console.log(
    JSON.stringify(
      {
        pA: [proof.pi_a[0], proof.pi_a[1]],
        pB: [
          [proof.pi_b[0][1], proof.pi_b[0][0]],
          [proof.pi_b[1][1], proof.pi_b[1][0]],
        ],
        pC: [proof.pi_c[0], proof.pi_c[1]],
        pubSignals: pub,
      },
      null,
      2
    )
  );

  console.error(`${pub.length} public signals`);
}

main();
