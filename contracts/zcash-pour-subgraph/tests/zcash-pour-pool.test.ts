import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { BigInt } from "@graphprotocol/graph-ts"
import { CommitmentSubmitted } from "../generated/schema"
import { CommitmentSubmitted as CommitmentSubmittedEvent } from "../generated/ZcashPourPool/ZcashPourPool"
import { handleCommitmentSubmitted } from "../src/zcash-pour-pool"
import { createCommitmentSubmittedEvent } from "./zcash-pour-pool-utils"

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/subgraphs/developing/creating/unit-testing-framework/#tests-structure

describe("Describe entity assertions", () => {
  beforeAll(() => {
    let commitIndex = BigInt.fromI32(234)
    let commit = BigInt.fromI32(234)
    let newCommitmentSubmittedEvent = createCommitmentSubmittedEvent(
      commitIndex,
      commit
    )
    handleCommitmentSubmitted(newCommitmentSubmittedEvent)
  })

  afterAll(() => {
    clearStore()
  })

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/subgraphs/developing/creating/unit-testing-framework/#write-a-unit-test

  test("CommitmentSubmitted created and stored", () => {
    assert.entityCount("CommitmentSubmitted", 1)

    // 0xa16081f360e3847006db660bae1c6d1b2e17ec2a is the default address used in newMockEvent() function
    assert.fieldEquals(
      "CommitmentSubmitted",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "commitIndex",
      "234"
    )
    assert.fieldEquals(
      "CommitmentSubmitted",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "commit",
      "234"
    )

    // More assert options:
    // https://thegraph.com/docs/en/subgraphs/developing/creating/unit-testing-framework/#asserts
  })
})
