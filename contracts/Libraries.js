// Library addresses for `hardhat verify --libraries Libraries.js`.
//
// hardhat-verify require()s this module directly, so there is no `hre` in scope
// -- the target network has to be recovered from the CLI. Addresses are read
// back out of the `libraries` map hardhat-deploy records on every deployment,
// so a redeploy never leaves stale addresses here.

const fs = require("fs");
const path = require("path");

// `verify` runs in the main hardhat process, where --network is still on argv.
// `run` re-execs the script in a child and passes HARDHAT_NETWORK instead.
function targetNetwork() {
  const i = process.argv.indexOf("--network");
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) {
    return process.argv[i + 1];
  }
  const inline = process.argv.find((a) => a.startsWith("--network="));
  if (inline !== undefined) {
    return inline.slice("--network=".length);
  }
  return process.env.HARDHAT_NETWORK;
}

const network = targetNetwork();
if (!network) {
  throw new Error("Libraries.js: no network given -- pass --network <name>");
}

const deploymentsDir = path.join(__dirname, "deployments");
const networkDir = path.join(deploymentsDir, network);

if (!fs.existsSync(networkDir)) {
  const available = fs.existsSync(deploymentsDir)
    ? fs.readdirSync(deploymentsDir).join(", ") || "(none)"
    : "(none)";
  throw new Error(
    `Libraries.js: nothing deployed to "${network}". Available: ${available}`
  );
}

// Merge the `libraries` map off every deployment on this network -- that map is
// exactly what was linked at deploy time, so it always matches the bytecode
// etherscan is being asked to match.
const libraries = {};
for (const file of fs.readdirSync(networkDir)) {
  if (!file.endsWith(".json")) continue;

  const deployment = JSON.parse(
    fs.readFileSync(path.join(networkDir, file), "utf8")
  );

  for (const [name, address] of Object.entries(deployment.libraries ?? {})) {
    if (libraries[name] !== undefined && libraries[name] !== address) {
      throw new Error(
        `Libraries.js: ${name} has two addresses on ${network} ` +
          `(${libraries[name]} and ${address} via ${file}) -- ` +
          `pass a single-contract libraries file instead`
      );
    }
    libraries[name] = address;
  }
}

module.exports = libraries;
