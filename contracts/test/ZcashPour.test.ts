import { expect } from "chai";
import { ethers } from "hardhat";
import { ZcashPourPool } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { createGasReporter } from "./helpers/gasReporter";

describe("ZcashPourPool", function () {
  let zcashPour: ZcashPourPool;
  let owner: SignerWithAddress;
  const gas = createGasReporter("ZcashPourPool.mint");

  const validData = {
    sk: 1234567890,
    pk: "18587147201541259002125695546381675692640309638765950598836980321625257723989",
    value: ethers.parseEther("0.001"),
    rho: 122333444455555,
    r: "11111111111111111111",
    sn_consume: "11238104884169898363942031412770131447860963024077704902695276903348546802589",
    cm: "3984178828202578543315284134679634058224614370910314519526456923507318320053",
  };

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    // 1. Deploy Poseidon libraries
    const PoseidonT2Factory = await ethers.getContractFactory("PoseidonT2");
    const poseidonT2 = await PoseidonT2Factory.deploy();
    await poseidonT2.waitForDeployment();

    const PoseidonT3Factory = await ethers.getContractFactory("PoseidonT3");
    const poseidonT3 = await PoseidonT3Factory.deploy();
    await poseidonT3.waitForDeployment();

    const PoseidonT4Factory = await ethers.getContractFactory("PoseidonT4");
    const poseidonT4 = await PoseidonT4Factory.deploy();
    await poseidonT4.waitForDeployment();

    // 2. Link libraries to ZcashPourPool
    const ZcashPourFactory = await ethers.getContractFactory("ZcashPourPool", {
      libraries: {
        "poseidon-solidity/PoseidonT2.sol:PoseidonT2": await poseidonT2.getAddress(),
        "poseidon-solidity/PoseidonT3.sol:PoseidonT3": await poseidonT3.getAddress(),
        "poseidon-solidity/PoseidonT4.sol:PoseidonT4": await poseidonT4.getAddress(),
      },
    });
    zcashPour = (await ZcashPourFactory.deploy()) as ZcashPourPool;
    await zcashPour.waitForDeployment();
  });

  describe("mint", function () {
    it("should mint a new note with valid data", async function () {
      const value = validData.value;
      const cm = validData.cm;
      const r = validData.r;
      const snProduce = validData.sn_consume;

      const initialSupply = await zcashPour.totalSupply();
      const initialIndex = await zcashPour.commitmentIndex();

      await gas.success("mint", () =>
        zcashPour.mint(value, cm, r, snProduce, { value })
      );

      const finalSupply = await zcashPour.totalSupply();
      expect(finalSupply).to.equal(initialSupply + value);

      const finalIndex = await zcashPour.commitmentIndex();
      expect(finalIndex).to.equal(initialIndex + 1n);

      const storedCommitment = await zcashPour.indexToCommitment(initialIndex);
      expect(storedCommitment).to.equal(BigInt(cm));
    });

    it("should revert if msg.value != _value", async function () {
      const value = validData.value;
      const cm = validData.cm;
      const r = validData.r;
      const snProduce = validData.sn_consume;

      await expect(
        zcashPour.mint(value, cm, r, snProduce, { value: value - 1n })
      ).to.be.revertedWith("value must be equal to the amount");

      await expect(
        zcashPour.mint(value, cm, r, snProduce, { value: value + 1n })
      ).to.be.revertedWith("value must be equal to the amount");

      await gas.revert("mint (value != msg.value)", () =>
        zcashPour.mint(value, cm, r, snProduce, { value: value - 1n })
      );
    });

    it("should revert if _value is zero", async function () {
      const value = 0n;
      const cm = validData.cm;
      const r = validData.r;
      const snProduce = validData.sn_consume;

      await expect(
        zcashPour.mint(value, cm, r, snProduce, { value: 0 })
      ).to.be.revertedWith("value must be equal to the amount");

      await gas.revert("mint (zero value)", () =>
        zcashPour.mint(value, cm, r, snProduce, { value: 0 })
      );
    });

    it("should revert if commitment does not match", async function () {
      const value = validData.value;
      const r = validData.r;
      const snProduce = validData.sn_consume;
      const wrongCm = "1234567890123456789012345678901234567890123456789012345678901234567890";

      await expect(
        zcashPour.mint(value, wrongCm, r, snProduce, { value })
      ).to.be.revertedWith("wrong commitment");

      await gas.revert("mint (wrong commitment)", () =>
        zcashPour.mint(value, wrongCm, r, snProduce, { value })
      );
    });
  });

  after(function () {
    gas.print();
  });
});