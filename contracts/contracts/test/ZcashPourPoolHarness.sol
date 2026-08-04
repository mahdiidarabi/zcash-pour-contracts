// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../ZcashPourPool.sol";

// TEST ONLY -- never deploy this.
//
// pour() requires every cm_list entry to already exist in the pool, so the pour
// and burn suites need a way to seed commitments without minting real ETH for
// each one. That is exactly the backdoor that must not exist in production: it
// lets anyone forge membership in the anonymity set, and it inserts commitments
// with no deposit behind them.
//
// Keeping it in a subclass under contracts/test/ means the deploy scripts, which
// target ZcashPourPool, can never pick it up by accident.
contract ZcashPourPoolHarness is ZcashPourPool {
    function mockAddCommitment(uint256 _cm) public {
        indexToCommitment[commitmentIndex] = _cm;
        commitmentToIndex[_cm] = commitmentIndex;
        commitmentIndex++;
    }
}
