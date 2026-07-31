import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ZcashPourPool } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { createGasReporter } from "./helpers/gasReporter";

describe("ZcashPourPool.burn", function () {
  let zcashPour: ZcashPourPool;
  let owner: SignerWithAddress;
  let recipient: SignerWithAddress;
  const gas = createGasReporter("ZcashPourPool.burn");

  // ---------------------------------------------------------------------------
  // We reuse the coin from the real zcash_pour proof as a test oracle. Its
  // witness (vibe_coding/zcash_pour/inputs/input.json) is:
  //   v=100, r_old=13751379, rho=12345, sk_old=12345, j=3
  // so the coin is cm_list[3] and its nullifier is the proof's sn_consume.
  // ---------------------------------------------------------------------------
  const value = 100n; // wei
  const r = 13751379n;
  const rho = 12345n;
  const sk = 12345n;
  const COIN_J = 3; // index of this coin inside cm_list

  // Load proof + public signals (same layout/formatting as the pour test).
  const proofDir = path.join(__dirname, "..", "..", "circuits", "build", "ZcashPour");
  const proof = JSON.parse(fs.readFileSync(path.join(proofDir, "proof.json"), "utf8"));
  const pub: string[] = JSON.parse(fs.readFileSync(path.join(proofDir, "public.json"), "utf8"));

  const pA: [string, string] = [proof.pi_a[0], proof.pi_a[1]];
  const pB: [[string, string], [string, string]] = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const pC: [string, string] = [proof.pi_c[0], proof.pi_c[1]];
  const pubSignals = pub;
  const cmList = pubSignals.slice(3, 13); // cm_list[0..9]
  const expectedCm = cmList[COIN_J]; // the coin we burn
  const expectedSnConsume = pubSignals[13];

  beforeEach(async function () {
    [owner, recipient] = await ethers.getSigners();

    const PoseidonT2 = await (await ethers.getContractFactory("PoseidonT2")).deploy();
    const PoseidonT3 = await (await ethers.getContractFactory("PoseidonT3")).deploy();
    const PoseidonT4 = await (await ethers.getContractFactory("PoseidonT4")).deploy();
    await Promise.all([
      PoseidonT2.waitForDeployment(),
      PoseidonT3.waitForDeployment(),
      PoseidonT4.waitForDeployment(),
    ]);

    const ZcashPourFactory = await ethers.getContractFactory("ZcashPourPool", {
      libraries: {
        "poseidon-solidity/PoseidonT2.sol:PoseidonT2": await PoseidonT2.getAddress(),
        "poseidon-solidity/PoseidonT3.sol:PoseidonT3": await PoseidonT3.getAddress(),
        "poseidon-solidity/PoseidonT4.sol:PoseidonT4": await PoseidonT4.getAddress(),
      },
    });
    zcashPour = (await ZcashPourFactory.deploy()) as ZcashPourPool;
    await zcashPour.waitForDeployment();
  });

  // Derive the coin's commitment + nullifier using the contract's Poseidon
  // helpers (same chain the circuit uses).
  async function deriveCoin() {
    const pk = await zcashPour.posiden1(sk);
    const snProduce = await zcashPour.posiden2(rho, pk);
    const cm = await zcashPour.posiden3(r, snProduce, value);
    const snConsume = await zcashPour.posiden2(snProduce, sk);
    return { snProduce, cm, snConsume };
  }

  // Mint the coin (deposits its `value` so burn has ETH to release).
  async function mintCoin() {
    const { snProduce, cm } = await deriveCoin();
    await zcashPour.mint(value, cm, r, snProduce, { value });
    return cm;
  }

  // Mint the burned coin AND seed the other 9 cm_list entries so the real
  // proof's pour() can also run (used by the double-spend cross-tests).
  async function mintCoinAndSeedRest() {
    for (let i = 0; i < cmList.length; i++) {
      if (i === COIN_J) continue;
      await zcashPour.mockAddCommitment(cmList[i]);
    }
    await mintCoin();
  }

  it("re-derives the same cm and sn_consume as the proof (oracle check)", async function () {
    const { cm, snConsume } = await deriveCoin();
    expect(cm).to.equal(BigInt(expectedCm));
    expect(snConsume).to.equal(BigInt(expectedSnConsume));
  });

  it("burns a minted coin and releases its ETH", async function () {
    await mintCoin();
    const { snConsume } = await deriveCoin();

    const supplyBefore = await zcashPour.totalSupply();
    const balBefore = await ethers.provider.getBalance(recipient.address);

    // burn sent by `owner`, paid out to `recipient`, so the balance delta is exact.
    await gas.success("burn", () =>
      zcashPour.burn(value, r, rho, sk, recipient.address)
    );

    expect(await ethers.provider.getBalance(recipient.address)).to.equal(balBefore + value);
    expect(await zcashPour.totalSupply()).to.equal(supplyBefore - value);
    expect(await zcashPour.snConsumeList(snConsume)).to.equal(true);
  });

  it("reverts when burning the same coin twice", async function () {
    await mintCoin();
    await zcashPour.burn(value, r, rho, sk, recipient.address);

    await expect(
      zcashPour.burn(value, r, rho, sk, recipient.address)
    ).to.be.revertedWith("this sn consume already used");

    await gas.revert("burn (double spend)", () =>
      zcashPour.burn(value, r, rho, sk, recipient.address)
    );
  });

  it("reverts when the coin was never minted", async function () {
    await expect(
      zcashPour.burn(value, r, rho, sk, recipient.address)
    ).to.be.revertedWith("commitment not exist");

    await gas.revert("burn (commitment not exist)", () =>
      zcashPour.burn(value, r, rho, sk, recipient.address)
    );
  });

  it("blocks pour after the coin is burned (no double-spend)", async function () {
    await mintCoinAndSeedRest();
    await zcashPour.burn(value, r, rho, sk, recipient.address);

    await expect(
      zcashPour.pour(pA, pB, pC, pubSignals)
    ).to.be.revertedWith("this sn consume already used");
  });

  it("blocks burn after the coin is poured (no double-spend)", async function () {
    await mintCoinAndSeedRest();
    await zcashPour.pour(pA, pB, pC, pubSignals);

    await expect(
      zcashPour.burn(value, r, rho, sk, recipient.address)
    ).to.be.revertedWith("this sn consume already used");
  });

  after(function () {
    gas.print();
  });
});