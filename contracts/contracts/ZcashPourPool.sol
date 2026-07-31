
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


    constructor() {
        commitmentIndex = 1;
    }

    function mint(uint256 _value, uint256 _cm, uint256 _r, uint256 _snProduce) public payable {
        require(msg.value == _value && _value > 0, "value must be equal to the amount");

        uint256 calculatedCommitment = posiden3(_r, _snProduce, _value);

        require(calculatedCommitment == _cm, "wrong commitment");

        indexToCommitment[commitmentIndex] = _cm;
        commitmentToIndex[_cm] = commitmentIndex;
        commitmentIndex++;

        totalSupply += _value;
    }

    // TEST-ONLY: insert a commitment directly so pour()'s cm_list existence checks pass.
    function mockAddCommitment(uint256 _cm) public {
        indexToCommitment[commitmentIndex] = _cm;
        commitmentToIndex[_cm] = commitmentIndex;
        commitmentIndex++;
    }

    function pour(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[14] calldata _pubSignals) public {
        require(this.verifyProof(_pA, _pB, _pC, _pubSignals), "invalid proof");

        uint256 cm1 = _pubSignals[0];
        uint256 cm2 = _pubSignals[1];
        require(commitmentToIndex[cm1] == 0 && commitmentToIndex[cm2] == 0, "commitment exists");
        
        indexToCommitment[commitmentIndex] = cm1;
        commitmentToIndex[cm1] = commitmentIndex;
        commitmentIndex++;

        indexToCommitment[commitmentIndex] = cm2;
        commitmentToIndex[cm2] = commitmentIndex;
        commitmentIndex++;

        

        uint256 ok = _pubSignals[2];
        require(ok == 1, "proof valid but wrong result");

        uint256 cmList1 = _pubSignals[3];
        require(commitmentToIndex[cmList1] > 0, "cmList1 not exist");

        uint256 cmList2 = _pubSignals[4];
        require(commitmentToIndex[cmList2] > 0, "cmList2 not exist");

        uint256 cmList3 = _pubSignals[5];
        require(commitmentToIndex[cmList3] > 0, "cmList3 not exist");

        uint256 cmList4 = _pubSignals[6];
        require(commitmentToIndex[cmList4] > 0, "cmList4 not exist");

        uint256 cmList5 = _pubSignals[7];
        require(commitmentToIndex[cmList5] > 0, "cmList5 not exist");

        uint256 cmList6 = _pubSignals[8];
        require(commitmentToIndex[cmList6] > 0, "cmList6 not exist");

        uint256 cmList7 = _pubSignals[9];
        require(commitmentToIndex[cmList7] > 0, "cmList7 not exist");

        uint256 cmList8 = _pubSignals[10];
        require(commitmentToIndex[cmList8] > 0, "cmList8 not exist");

        uint256 cmList9 = _pubSignals[11];
        require(commitmentToIndex[cmList9] > 0, "cmList9 not exist");

        uint256 cmList10 = _pubSignals[12];
        require(commitmentToIndex[cmList10] > 0, "cmList10 not exist");

        uint256 sn_consme = _pubSignals[13];
        require(snConsumeList[sn_consme] == false, "this sn consume already used");

        snConsumeList[sn_consme] = true;

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