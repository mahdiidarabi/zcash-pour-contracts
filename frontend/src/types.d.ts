// Neither package ships types. We use a handful of functions from each and the
// real contract is enforced by note.test.ts and by the chain, not by TypeScript.
declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{ proof: any; publicSignals: string[] }>;
    verify(vkey: any, publicSignals: string[], proof: any): Promise<boolean>;
  };
}

declare module "circomlibjs" {
  export function buildPoseidon(): Promise<any>;
  export function buildPoseidonReference(): Promise<any>;
}
