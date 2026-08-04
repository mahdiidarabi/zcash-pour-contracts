import { newMockEvent } from "matchstick-as"
import { ethereum, BigInt } from "@graphprotocol/graph-ts"
import {
  CommitmentSubmitted,
  SnConsumeSubmitted
} from "../generated/ZcashPourPool/ZcashPourPool"

export function createCommitmentSubmittedEvent(
  commitIndex: BigInt,
  commit: BigInt
): CommitmentSubmitted {
  let commitmentSubmittedEvent = changetype<CommitmentSubmitted>(newMockEvent())

  commitmentSubmittedEvent.parameters = new Array()

  commitmentSubmittedEvent.parameters.push(
    new ethereum.EventParam(
      "commitIndex",
      ethereum.Value.fromUnsignedBigInt(commitIndex)
    )
  )
  commitmentSubmittedEvent.parameters.push(
    new ethereum.EventParam("commit", ethereum.Value.fromUnsignedBigInt(commit))
  )

  return commitmentSubmittedEvent
}

export function createSnConsumeSubmittedEvent(
  snConsume: BigInt
): SnConsumeSubmitted {
  let snConsumeSubmittedEvent = changetype<SnConsumeSubmitted>(newMockEvent())

  snConsumeSubmittedEvent.parameters = new Array()

  snConsumeSubmittedEvent.parameters.push(
    new ethereum.EventParam(
      "snConsume",
      ethereum.Value.fromUnsignedBigInt(snConsume)
    )
  )

  return snConsumeSubmittedEvent
}
