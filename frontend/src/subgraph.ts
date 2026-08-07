// Reads from the subgraph. Plain fetch -- the queries are fixed strings.

import { SUBGRAPH_URL } from "./config";

async function query<T>(gql: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables }),
  });

  if (!response.ok) {
    throw new Error(`subgraph returned ${response.status}`);
  }

  const body = await response.json();
  if (body.errors) {
    throw new Error(body.errors[0]?.message ?? "subgraph error");
  }

  return body.data as T;
}

export interface PoolStats {
  commitmentCount: string;
  nullifierCount: string;
  mintCount: string;
  pourCount: string;
  burnCount: string;
  totalSupply: string;
}

export interface CommitmentRow {
  id: string;
  commit: string;
  index: string;
  source: "MINT" | "POUR";
  blockTimestamp: string;
  transactionHash: string;
}

export interface NullifierRow {
  snConsume: string;
  source: "POUR" | "BURN";
  blockTimestamp: string;
  transactionHash: string;
}

// Pool entity is a singleton keyed by the bytes of the string "pool".
const POOL_ID = "0x706f6f6c";

export async function poolStats(): Promise<{ pool: PoolStats | null; block: number }> {
  const data = await query<{ pool: PoolStats | null; _meta: { block: { number: number } } }>(`
    query {
      pool(id: "${POOL_ID}") {
        commitmentCount nullifierCount mintCount pourCount burnCount totalSupply
      }
      _meta { block { number } }
    }
  `);

  return { pool: data.pool, block: data._meta.block.number };
}

export async function commitments(first = 100): Promise<CommitmentRow[]> {
  const data = await query<{ commitments: CommitmentRow[] }>(`
    query {
      commitments(first: ${first}, orderBy: index, orderDirection: desc) {
        id commit index source blockTimestamp transactionHash
      }
    }
  `);

  return data.commitments;
}

export async function nullifiers(first = 100): Promise<NullifierRow[]> {
  const data = await query<{ nullifiers: NullifierRow[] }>(`
    query {
      nullifiers(first: ${first}, orderBy: blockTimestamp, orderDirection: desc) {
        snConsume source blockTimestamp transactionHash
      }
    }
  `);

  return data.nullifiers;
}

export interface UserActivity {
  mintCount: string;
  pourCount: string;
  burnCount: string;
  totalMinted: string;
  totalBurned: string;
  mints: { value: string; commit: string; transactionHash: string }[];
  pours: { transactionHash: string; nullifier: { snConsume: string } | null }[];
  burns: { value: string | null; recipient: string | null; transactionHash: string }[];
}

export async function userActivity(address: string): Promise<UserActivity | null> {
  const data = await query<{ user: UserActivity | null }>(
    `
    query ($id: ID!) {
      user(id: $id) {
        mintCount pourCount burnCount totalMinted totalBurned
        mints(first: 25, orderBy: blockTimestamp, orderDirection: desc) {
          value commit transactionHash
        }
        pours(first: 25, orderBy: blockTimestamp, orderDirection: desc) {
          transactionHash nullifier { snConsume }
        }
        burns(first: 25, orderBy: blockTimestamp, orderDirection: desc) {
          value recipient transactionHash
        }
      }
    }
  `,
    { id: address.toLowerCase() }
  );

  return data.user;
}

// Is this commitment in the pool yet? The subgraph lags the chain by a block or
// two, so a just-minted note can be absent even though pour() would accept it.
export async function commitmentExists(commit: string): Promise<boolean> {
  const data = await query<{ commitments: { id: string }[] }>(
    `query ($c: BigInt!) { commitments(where: { commit: $c }, first: 1) { id } }`,
    { c: commit }
  );

  return data.commitments.length > 0;
}
