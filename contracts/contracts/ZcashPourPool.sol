
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "poseidon-solidity/PoseidonT2.sol";
import "poseidon-solidity/PoseidonT3.sol";
import "poseidon-solidity/PoseidonT4.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

import "./verifiers/ZcashPourVerifier.sol";

contract ZcashPourPool is ZcashPourVerifier {

    mapping(uint256 => uint256) public indexToCommitment;
    mapping(uint256 => uint256) public commitmentToIndex;
    mapping(uint256 => bool) public snConsumeList;
    uint256 public totalSupply;
    uint256 public commitmentIndex;

    event CommitmentSubmitted(uint256 commitIndex, uint256 commit);
    event SnConsumeSubmitted(uint256 snConsume);
 


    constructor() {
        commitmentIndex = 1;
    }

    function mint(uint256 _value, uint256 _cm, uint256 _r, uint256 _snProduce) public payable {
        require(msg.value == _value && _value > 0, "value must be equal to the amount");

        uint256 calculatedCommitment = posiden3(_r, _snProduce, _value);

        require(calculatedCommitment == _cm, "wrong commitment");
        require(commitmentToIndex[_cm] == 0, "already committed");

        indexToCommitment[commitmentIndex] = _cm;
        commitmentToIndex[_cm] = commitmentIndex;

        emit CommitmentSubmitted(commitmentIndex, _cm);

        commitmentIndex++;

        totalSupply += _value;
    }

    // NOTE: the test-only mockAddCommitment lives in
    // contracts/test/ZcashPourPoolHarness.sol, not here. In the pool it would be
    // a drain: insert a commitment with no deposit behind it, then burn it for
    // real ETH.

    function pour(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[14] calldata _pubSignals) public {
        require(this.verifyProof(_pA, _pB, _pC, _pubSignals), "invalid proof");

        // Public signal layout, docs/protocol.md section 6:
        //   [0] cm1   [1] cm2   [2] ok   [3..12] cm_list   [13] sn_consume
        uint256 cm1 = _pubSignals[0];
        uint256 cm2 = _pubSignals[1];
        uint256 snConsume = _pubSignals[13];

        // Redundant -- ok is hardcoded to 1 in the circuit and every real check
        // is a constraint, so a bad witness is unprovable rather than ok == 0.
        // Kept as defence in depth against a future circuit change.
        require(_pubSignals[2] == 1, "proof valid but wrong result");

        // ---- checks ----
        //
        // All of them before any state change. Inserting cm1/cm2 first, as this
        // used to, let a proof name its own fresh outputs inside cm_list and
        // still pass the existence checks below.
        for (uint256 i = 3; i <= 12; i++) {
            require(commitmentToIndex[_pubSignals[i]] > 0, "cmList not exist");
        }

        require(snConsumeList[snConsume] == false, "this sn consume already used");
        require(commitmentToIndex[cm1] == 0 && commitmentToIndex[cm2] == 0, "commitment exists");

        // Identical outputs would pass the check above and then insert the same
        // commitment at two indices, leaving commitmentToIndex pointing at the
        // second one. Only one of them could ever be spent anyway: same note
        // means same sn_produce, so same nullifier.
        require(cm1 != cm2, "duplicate output commitment");

        // ---- effects ----
        snConsumeList[snConsume] = true;
        emit SnConsumeSubmitted(snConsume);

        indexToCommitment[commitmentIndex] = cm1;
        commitmentToIndex[cm1] = commitmentIndex;
        emit CommitmentSubmitted(commitmentIndex, cm1);
        commitmentIndex++;

        indexToCommitment[commitmentIndex] = cm2;
        commitmentToIndex[cm2] = commitmentIndex;
        emit CommitmentSubmitted(commitmentIndex, cm2);
        commitmentIndex++;
    }

    // burn is the inverse of mint: it destroys an existing shielded coin and
    // releases its value as plain ETH. The caller reveals (value, r, rho, sk);
    // we re-derive the full hash chain so that only the coin's true owner can
    // burn it, and we consume the SAME sn_consume nullifier that pour would,
    // so a coin can never be both poured and burned (double-spend).
    function burn(uint256 _value, uint256 _r, uint256 _rho, uint256 _sk, address _recipient) public {
        require(_value > 0, "value must be > 0");
        require(_recipient != address(0), "bad recipient");

        // Re-derive the coin exactly as it was created (see zcash_pour.circom).
        uint256 pk = posiden1(_sk);
        uint256 snProduce = posiden2(_rho, pk);
        uint256 cm = posiden3(_r, snProduce, _value);
        require(commitmentToIndex[cm] > 0, "commitment not exist");

        // Same nullifier pour consumes: blocks pour<->burn double-spend.
        uint256 snConsume = posiden2(snProduce, _sk);
        require(snConsumeList[snConsume] == false, "this sn consume already used");

        // Effects before interaction (reentrancy-safe). totalSupply underflows
        // and reverts if it would drop below the burned value.
        snConsumeList[snConsume] = true;
        emit SnConsumeSubmitted(snConsume);

        totalSupply -= _value;

        (bool ok, ) = payable(_recipient).call{value: _value}("");
        require(ok, "transfer failed");
    }


    function posiden1(uint256 input1) public pure returns (uint256) {
        uint256[1] memory inputs;
        inputs[0] = input1;
        return PoseidonT2.hash(inputs);
    }

    function posiden2(uint256 input1, uint256 input2) public pure returns (uint256) {
        uint256[2] memory inputs;
        inputs[0] = input1;
        inputs[1] = input2;
        return PoseidonT3.hash(inputs);
    }

    function posiden3(uint256 input1, uint256 input2, uint256 input3) public pure returns (uint256) {
        uint256[3] memory inputs;
        inputs[0] = input1;
        inputs[1] = input2;
        inputs[2] = input3;
        return PoseidonT4.hash(inputs);
    }
}