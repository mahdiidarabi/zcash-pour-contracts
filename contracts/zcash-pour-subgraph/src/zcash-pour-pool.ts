import { BigInt, Bytes, Address, ethereum } from "@graphprotocol/graph-ts";
import {
  CommitBurnt as CommitBurntEvent,
  Minted as MintedEvent,
  Poured as PouredEvent,
  ZcashPourPool,
} from "../generated/ZcashPourPool/ZcashPourPool";
import { Burn, Commitment, Mint, Nullifier, Pool, Pour, User } from "../generated/schema";

const ZERO = BigInt.zero();
const ONE = BigInt.fromI32(1);

const POOL_ID = Bytes.fromUTF8("pool");

// burn(uint256 _value, uint256 _r, uint256 _rho, uint256 _sk, address _recipient)
const BURN_SELECTOR = "0x5bf927a0";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Commitments and nullifiers are field elements, so they key their own entity.
// Padded to 32 bytes big-endian so ids are fixed width and sort sensibly.
function idFromBigInt(value: BigInt): Bytes {
  let hex = value.toHexString().slice(2);
  while (hex.length < 64) {
    hex = "0" + hex;
  }
  return Bytes.fromHexString("0x" + hex);
}

function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

function getOrCreateUser(address: Address, timestamp: BigInt): User {
  let user = User.load(address);

  if (user == null) {
    user = new User(address);
    user.address = address;
    user.mintCount = ZERO;
    user.pourCount = ZERO;
    user.burnCount = ZERO;
    user.totalMinted = ZERO;
    user.totalBurned = ZERO;
    user.firstSeenAt = timestamp;
  }

  user.lastSeenAt = timestamp;
  return user;
}

function getOrCreatePool(): Pool {
  let pool = Pool.load(POOL_ID);

  if (pool == null) {
    pool = new Pool(POOL_ID);
    pool.commitmentCount = ZERO;
    pool.nullifierCount = ZERO;
    pool.mintCount = ZERO;
    pool.pourCount = ZERO;
    pool.burnCount = ZERO;
    pool.totalSupply = ZERO;
    pool.lastUpdatedAt = ZERO;
  }

  return pool;
}

// A pour is three logs in one transaction -- one CommitBurnt and two Poured --
// so the entity is keyed by transaction hash and whichever handler runs first
// creates it. Never assume an order.
function getOrCreatePour(event: ethereum.Event, user: User): Pour {
  let id = event.transaction.hash;
  let pour = Pour.load(id);

  if (pour == null) {
    pour = new Pour(id);
    pour.submitter = user.id;
    pour.blockNumber = event.block.number;
    pour.blockTimestamp = event.block.timestamp;
    pour.transactionHash = event.transaction.hash;
    pour.save();
  }

  return pour;
}

// The contract is the authority on totalSupply. Deriving it from events would
// need a value on every burn, which CommitBurnt does not carry.
function refreshPool(pool: Pool, event: ethereum.Event): void {
  let bound = ZcashPourPool.bind(event.address);
  let supply = bound.try_totalSupply();

  if (!supply.reverted) {
    pool.totalSupply = supply.value;
  }

  pool.lastUpdatedAt = event.block.timestamp;
  pool.save();
}

class BurnArgs {
  value: BigInt;
  recipient: Address;

  constructor(value: BigInt, recipient: Address) {
    this.value = value;
    this.recipient = recipient;
  }
}

// CommitBurnt carries neither the burned value nor the recipient, but burn()
// puts both in public calldata -- so recover them from the transaction input.
//
// This only works when burn() was the top-level call: event.transaction.input
// is the outer transaction's data, so a burn routed through another contract
// decodes to nothing. Returns null in that case rather than guessing.
function decodeBurnCalldata(input: Bytes): BurnArgs | null {
  // selector + five static 32-byte words
  if (input.length < 4 + 5 * 32) {
    return null;
  }

  let selector = Bytes.fromUint8Array(input.subarray(0, 4));
  if (selector.toHexString() != BURN_SELECTOR) {
    return null;
  }

  let payload = Bytes.fromUint8Array(input.subarray(4));
  let decoded = ethereum.decode("(uint256,uint256,uint256,uint256,address)", payload);

  if (decoded == null) {
    return null;
  }

  let args = decoded.toTuple();
  return new BurnArgs(args[0].toBigInt(), args[4].toAddress());
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

export function handleMinted(event: MintedEvent): void {
  let user = getOrCreateUser(event.params.submitter, event.block.timestamp);
  let pool = getOrCreatePool();

  let mintId = eventId(event);

  // The commitment is keyed by its own value. mint() rejects a duplicate, so
  // this is always a fresh entity.
  let commitment = new Commitment(idFromBigInt(event.params.commit));
  commitment.commit = event.params.commit;
  commitment.index = event.params.commitIndex;
  commitment.source = "MINT";
  commitment.mint = mintId;
  commitment.submitter = user.id;
  commitment.blockNumber = event.block.number;
  commitment.blockTimestamp = event.block.timestamp;
  commitment.transactionHash = event.transaction.hash;
  commitment.save();

  let mint = new Mint(mintId);
  mint.value = event.params.value;
  mint.commit = event.params.commit;
  mint.r = event.params.r;
  mint.snProduce = event.params.snProduce;
  mint.commitIndex = event.params.commitIndex;
  mint.commitment = commitment.id;
  mint.submitter = user.id;
  mint.blockNumber = event.block.number;
  mint.blockTimestamp = event.block.timestamp;
  mint.transactionHash = event.transaction.hash;
  mint.save();

  user.mintCount = user.mintCount.plus(ONE);
  user.totalMinted = user.totalMinted.plus(event.params.value);
  user.save();

  pool.mintCount = pool.mintCount.plus(ONE);
  pool.commitmentCount = pool.commitmentCount.plus(ONE);
  refreshPool(pool, event);
}

// Fires twice per pour, once per output commitment. Counters that should move
// once per pour live in handleCommitBurnt instead.
export function handlePoured(event: PouredEvent): void {
  let user = getOrCreateUser(event.params.submitter, event.block.timestamp);
  user.save();

  let pool = getOrCreatePool();
  let pour = getOrCreatePour(event, user);

  let commitment = new Commitment(idFromBigInt(event.params.commit));
  commitment.commit = event.params.commit;
  commitment.index = event.params.commitIndex;
  commitment.source = "POUR";
  commitment.pour = pour.id;
  commitment.submitter = user.id;
  commitment.blockNumber = event.block.number;
  commitment.blockTimestamp = event.block.timestamp;
  commitment.transactionHash = event.transaction.hash;
  commitment.save();

  pool.commitmentCount = pool.commitmentCount.plus(ONE);
  refreshPool(pool, event);
}

// One nullifier, from either a pour or a burn. isBurnt says which.
export function handleCommitBurnt(event: CommitBurntEvent): void {
  let user = getOrCreateUser(event.params.submitter, event.block.timestamp);
  let pool = getOrCreatePool();

  let nullifier = new Nullifier(idFromBigInt(event.params.snConsume));
  nullifier.snConsume = event.params.snConsume;
  nullifier.submitter = user.id;
  nullifier.blockNumber = event.block.number;
  nullifier.blockTimestamp = event.block.timestamp;
  nullifier.transactionHash = event.transaction.hash;

  if (event.params.isBurnt) {
    let burn = new Burn(eventId(event));
    burn.snConsume = event.params.snConsume;
    burn.nullifier = nullifier.id;
    burn.submitter = user.id;
    burn.blockNumber = event.block.number;
    burn.blockTimestamp = event.block.timestamp;
    burn.transactionHash = event.transaction.hash;

    let args = decodeBurnCalldata(event.transaction.input);
    if (args != null) {
      burn.value = args.value;
      burn.recipient = args.recipient;
      user.totalBurned = user.totalBurned.plus(args.value);
    }
    burn.save();

    nullifier.source = "BURN";
    nullifier.burn = burn.id;

    user.burnCount = user.burnCount.plus(ONE);
    pool.burnCount = pool.burnCount.plus(ONE);
  } else {
    let pour = getOrCreatePour(event, user);

    nullifier.source = "POUR";
    nullifier.pour = pour.id;

    pour.nullifier = nullifier.id;
    pour.save();

    user.pourCount = user.pourCount.plus(ONE);
    pool.pourCount = pool.pourCount.plus(ONE);
  }

  nullifier.save();
  user.save();

  pool.nullifierCount = pool.nullifierCount.plus(ONE);
  refreshPool(pool, event);
}
