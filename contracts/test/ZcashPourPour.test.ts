import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ZcashPourPoolHarness } from "../typechain-types";
import { createGasReporter } from "./helpers/gasReporter";

describe("ZcashPourPool.pour", function () {
  let zcashPour: ZcashPourPoolHarness;
  const gas = createGasReporter("ZcashPourPool.pour");

  // ---------------------------------------------------------------------------
  // Load the real Groth16 proof + public signals generated for the zcash_pour
  // circuit. We read with fs (rather than `import ... .json`) so the files,
  // which live outside the tsconfig `include` paths, don't break compilation.
  // ---------------------------------------------------------------------------
  const proofDir = path.join(__dirname, "..", "..", "circuits", "build", "ZcashPour");
  const proof = JSON.parse(
    fs.readFileSync(path.join(proofDir, "proof.json"), "utf8")
  );
  const pub: string[] = JSON.parse(
    fs.readFileSync(path.join(proofDir, "public.json"), "utf8")
  );

  // Format the proof for the Solidity verifier. NOTE: snarkjs Solidity calldata
  // SWAPS the inner pairs of pi_b — getting this wrong makes verifyProof fail.
  const pA: [string, string] = [proof.pi_a[0], proof.pi_a[1]];
  const pB: [[string, string], [string, string]] = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const pC: [string, string] = [proof.pi_c[0], proof.pi_c[1]];
  const pubSignals = pub; // length 14, already in the contract's signal order

  // Public-signal layout (confirmed against the circuit + JSON):
  //   [0]     = cm1 (new commitment 1)
  //   [1]     = cm2 (new commitment 2)
  //   [2]     = ok (== 1)
  //   [3..12] = cm_list[0..9] (the 10 input commitments that must already exist)
  //   [13]    = sn_consume (nullifier)
  const cm1 = pubSignals[0];
  const cm2 = pubSignals[1];
  const cmList = pubSignals.slice(3, 13); // 10 entries
  const snConsume = pubSignals[13];

  beforeEach(async function () {
    // Deploy the Poseidon libraries and link them into ZcashPour, mirroring the
    // existing mint test's deploy pattern.
    const PoseidonT2Factory = await ethers.getContractFactory("PoseidonT2");
    const poseidonT2 = await PoseidonT2Factory.deploy();
    await poseidonT2.waitForDeployment();

    const PoseidonT3Factory = await ethers.getContractFactory("PoseidonT3");
    const poseidonT3 = await PoseidonT3Factory.deploy();
    await poseidonT3.waitForDeployment();

    const PoseidonT4Factory = await ethers.getContractFactory("PoseidonT4");
    const poseidonT4 = await PoseidonT4Factory.deploy();
    await poseidonT4.waitForDeployment();

    const ZcashPourFactory = await ethers.getContractFactory("ZcashPourPoolHarness", {
      libraries: {
        "poseidon-solidity/PoseidonT2.sol:PoseidonT2": await poseidonT2.getAddress(),
        "poseidon-solidity/PoseidonT3.sol:PoseidonT3": await poseidonT3.getAddress(),
        "poseidon-solidity/PoseidonT4.sol:PoseidonT4": await poseidonT4.getAddress(),
      },
    });
    zcashPour = (await ZcashPourFactory.deploy()) as ZcashPourPoolHarness;
    await zcashPour.waitForDeployment();
  });

  // Seed the 10 input commitments so pour()'s cm_list existence checks pass.
  // Records the gas of a single mockAddCommitment call.
  async function seedCmList() {
    for (const cm of cmList) {
      await gas.success("mockAddCommitment", () =>
        zcashPour.mockAddCommitment(cm)
      );
    }
  }

  it("should pour successfully with a valid proof", async function () {
    await seedCmList();

    const indexBefore = await zcashPour.commitmentIndex();

    await gas.success("pour", () => zcashPour.pour(pA, pB, pC, pubSignals));

    // Nullifier marked as consumed.
    expect(await zcashPour.snConsumeList(snConsume)).to.equal(true);

    // Both new commitments registered.
    expect(await zcashPour.commitmentToIndex(cm1)).to.be.greaterThan(0n);
    expect(await zcashPour.commitmentToIndex(cm2)).to.be.greaterThan(0n);

    // commitmentIndex advanced by 2 (cm1 + cm2).
    expect(await zcashPour.commitmentIndex()).to.equal(indexBefore + 2n);
  });

  it("should revert with an invalid proof", async function () {
    await seedCmList();

    // Tamper with the proof so verifyProof fails.
    const badA: [string, string] = [pA[0], (BigInt(pA[1]) + 1n).toString()];

    await expect(
      zcashPour.pour(badA, pB, pC, pubSignals)
    ).to.be.revertedWith("invalid proof");

    // Re-send (state is unchanged by the revert) to capture the gas burned.
    await gas.revert("pour (invalid proof)", () =>
      zcashPour.pour(badA, pB, pC, pubSignals)
    );
  });

  after(function () {
    gas.print();
  });
});