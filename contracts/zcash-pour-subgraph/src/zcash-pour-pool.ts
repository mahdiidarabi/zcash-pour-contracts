import {
  CommitmentSubmitted as CommitmentSubmittedEvent,
  SnConsumeSubmitted as SnConsumeSubmittedEvent
} from "../generated/ZcashPourPool/ZcashPourPool"
import { CommitmentSubmitted, SnConsumeSubmitted } from "../generated/schema"

export function handleCommitmentSubmitted(
  event: CommitmentSubmittedEvent
): void {
  let entity = new CommitmentSubmitted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.commitIndex = event.params.commitIndex
  entity.commit = event.params.commit

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleSnConsumeSubmitted(event: SnConsumeSubmittedEvent): void {
  let entity = new SnConsumeSubmitted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.snConsume = event.params.snConsume

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
