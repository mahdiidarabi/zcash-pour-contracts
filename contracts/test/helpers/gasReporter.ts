import { ethers } from "hardhat";

// Shared gas-usage collector for tests. Each test file creates one reporter,
// records gas for the calls it cares about (success / deploy / revert), and
// prints a table in an `after` hook. Reverted txs are still mined by Hardhat,
// so their gas is fetched from the receipt via the error's transactionHash.
type GasRow = { Call: string; Outcome: string; "Gas Used": string };

export function createGasReporter(title: string) {
  const rows: GasRow[] = [];

  function push(call: string, outcome: string, gasUsed: bigint) {
    // Keep only the first measurement for each (call, outcome) pair so repeated
    // identical calls (e.g. seeding loops) collapse into a single row.
    if (rows.some((r) => r.Call === call && r.Outcome === outcome)) return;
    rows.push({
      Call: call,
      Outcome: outcome,
      "Gas Used": gasUsed.toLocaleString("en-US"),
    });
  }

  // Measure a normal transaction expected to succeed.
  async function success(call: string, send: () => Promise<any>) {
    const tx = await send();
    const receipt = await tx.wait();
    push(call, "success", receipt.gasUsed);
    return receipt;
  }

  // Measure a contract deployment expected to succeed.
  async function deploy(call: string, deployFn: () => Promise<any>) {
    const contract = await deployFn();
    await contract.waitForDeployment();
    const receipt = await contract.deploymentTransaction()!.wait();
    push(call, "deploy", receipt.gasUsed);
    return contract;
  }

  // Measure a transaction (or deployment) expected to revert.
  async function revert(call: string, send: () => Promise<any>) {
    try {
      const tx = await send();
      await tx.wait();
      throw new Error(`${call}: expected revert but tx succeeded`);
    } catch (e: any) {
      const hash =
        e?.transactionHash ?? e?.receipt?.hash ?? e?.transaction?.hash;
      const receipt = hash
        ? await ethers.provider.getTransactionReceipt(hash)
        : null;
      if (receipt) push(call, "revert", receipt.gasUsed);
      else console.warn(`  [gas] could not resolve receipt for ${call}`);
    }
  }

  function print() {
    console.log(`\n  Gas usage — ${title}:`);
    console.table(rows);
  }

  return { success, deploy, revert, print, rows };
}