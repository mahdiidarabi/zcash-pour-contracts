// Turn a note into the five arguments burn() takes.
//
//   node tools/burn-args.js --note notes/alice.json --recipient 0xabc...
//
// burn is transparent: every one of these values ends up in public calldata.
// Publishing sk links this note to every other note ever made for the same pk,
// so treat a key as single-use. docs/protocol.md section 10.

const fs = require("fs");
const { parseArgs, required } = require("../lib/args");

const USAGE = `usage: node tools/burn-args.js --note <file> --recipient <address>

  --note       a note JSON written by new-note.js
  --recipient  address that receives the ETH`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const noteFile = required(args, "note", USAGE);
  const recipient = required(args, "recipient", USAGE);

  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    console.error(`--recipient ${recipient} is not an address`);
    process.exit(1);
  }

  const note = JSON.parse(fs.readFileSync(noteFile, "utf8"));

  console.log(
    JSON.stringify(
      {
        _value: note.value,
        _r: note.r,
        _rho: note.rho,
        _sk: note.sk,
        _recipient: recipient,
      },
      null,
      2
    )
  );

  console.error("burn publishes sk -- do not reuse this key");
}

main();
