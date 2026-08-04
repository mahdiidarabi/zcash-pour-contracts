import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { execFileSync } from "child_process";
import * as path from "path";
import { ZcashPourPool } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// The note tooling lives in ../../circuits. The other suites already reach
// across that boundary for proof.json, so this is not a new direction of
// dependency -- and it is the whole point of the test: prove the JS a user
// runs produces values this contract accepts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createNote, deriveNote } = require("../../circuits/lib/note");

const CIRCUITS_DIR = path.join(__dirname, "..", "..", "circuits");

describe("note tooling <-> ZcashPourPool", function () {
  let pool: ZcashPourPool;
  let owner: SignerWithAddress;
  let recipient: SignerWithAddress;

  beforeEach(async function () {
    [owner, recipient] = await ethers.getSigners();

    // Runs the deploy scripts, so this also covers deploy/ staying correct.
    await deployments.fixture(["ZcashPourPool"]);
    const d = await deployments.get("ZcashPourPool");
    pool = (await ethers.getContractAt("ZcashPourPool", d.address)) as unknown as ZcashPourPool;
  });

  it("derives the same hashes as the contract", async function () {
    const note = await createNote(100n);

    // Every step of the chain, not just the endpoint -- if these ever diverge
    // the failure should say which hash drifted.
    expect(await pool.posiden1(note.sk)).to.equal(note.pk);
    expect(await pool.posiden2(note.rho, note.pk)).to.equal(note.snProduce);
    expect(await pool.posiden3(note.r, note.snProduce, note.value)).to.equal(note.cm);
    expect(await pool.posiden2(note.snProduce, note.sk)).to.equal(note.snConsume);
  });

  it("mints a note built by lib/note.js", async function () {
    const note = await createNote(100n);

    await pool.mint(note.value, note.cm, note.r, note.snProduce, { value: note.value });

    expect(await pool.totalSupply()).to.equal(note.value);
    expect(await pool.indexToCommitment(1)).to.equal(note.cm);
    expect(await pool.commitmentToIndex(note.cm)).to.equal(1n);
  });

  it("rejects minting the same commitment twice", async function () {
    // Without this guard the second deposit is unrecoverable: one commitment
    // has one sn_consume, so only one of the two can ever be spent.
    const note = await createNote(100n);
    await pool.mint(note.value, note.cm, note.r, note.snProduce, { value: note.value });

    await expect(
      pool.mint(note.value, note.cm, note.r, note.snProduce, { value: note.value })
    ).to.be.revertedWith("already committed");

    expect(await pool.totalSupply()).to.equal(note.value);
  });

  it("round-trips mint -> burn and returns the ETH", async function () {
    const note = await createNote(100n);
    await pool.mint(note.value, note.cm, note.r, note.snProduce, { value: note.value });

    const before = await ethers.provider.getBalance(recipient.address);
    await pool.burn(note.value, note.r, note.rho, note.sk, recipient.address);

    expect(await ethers.provider.getBalance(recipient.address)).to.equal(before + note.value);
    expect(await pool.totalSupply()).to.equal(0n);
    expect(await pool.snConsumeList(note.snConsume)).to.equal(true);
  });

  it("cannot burn the same note twice", async function () {
    const note = await createNote(100n);
    await pool.mint(note.value, note.cm, note.r, note.snProduce, { value: note.value });
    await pool.burn(note.value, note.r, note.rho, note.sk, recipient.address);

    await expect(
      pool.burn(note.value, note.r, note.rho, note.sk, recipient.address)
    ).to.be.revertedWith("this sn consume already used");
  });

  it("rejects a burn by someone with the wrong sk", async function () {
    const note = await createNote(100n);
    await pool.mint(note.value, note.cm, note.r, note.snProduce, { value: note.value });

    // A different sk derives a different pk, so a different commitment -- which
    // the pool has never seen.
    await expect(
      pool.burn(note.value, note.r, note.rho, note.sk + 1n, recipient.address)
    ).to.be.revertedWith("commitment not exist");
  });

  it("deriveNote is deterministic for the same secrets", async function () {
    const secrets = { sk: 12345n, rho: 12345n, r: 13751379n, value: 100n };
    const a = await deriveNote(secrets);
    const b = await deriveNote(secrets);

    expect(a.cm).to.equal(b.cm);
    expect(a.snConsume).to.equal(b.snConsume);
  });

  describe("tools/new-note.js", function () {
    it("produces a note the pool accepts", async function () {
      const out = execFileSync("node", ["tools/new-note.js", "--value", "100"], {
        cwd: CIRCUITS_DIR,
        encoding: "utf8",
        // The tool talks to humans on stderr; keep it out of the test report.
        stdio: ["ignore", "pipe", "ignore"],
      });
      const note = JSON.parse(out);

      await pool.mint(note.mint._value, note.mint._cm, note.mint._r, note.mint._snProduce, {
        value: note.mint._value,
      });

      expect(await pool.commitmentToIndex(note.cm)).to.equal(1n);
    });

    it("refuses a value the pour circuit could never spend", function () {
      // The ceiling is the Num2Bits width in pour_circuit(), mirrored by
      // circuits/lib/limits.js. Read it from there rather than hardcoding, so
      // widening the circuit does not silently leave this test asserting the
      // old bound. Better to fail here than twenty seconds into proving.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { MAX_POUR_VALUE } = require("../../circuits/lib/limits");

      expect(() =>
        execFileSync("node", ["tools/new-note.js", "--value", MAX_POUR_VALUE.toString()], {
          cwd: CIRCUITS_DIR,
          encoding: "utf8",
          stdio: "pipe",
        })
      ).to.throw();
    });

    it("allows a real wei amount now the circuit is 128-bit", async function () {
      // 0.001 ETH -- impossible to pour under the old Num2Bits(32) ceiling.
      const out = execFileSync("node", ["tools/new-note.js", "--value", "1000000000000000"], {
        cwd: CIRCUITS_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const note = JSON.parse(out);

      await pool.mint(note.mint._value, note.mint._cm, note.mint._r, note.mint._snProduce, {
        value: note.mint._value,
      });

      expect(await pool.totalSupply()).to.equal(1000000000000000n);
    });
  });
});
