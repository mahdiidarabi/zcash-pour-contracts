// Wallet and contract access.
//
// Injected provider only -- no WalletConnect. Every screen also offers an
// Etherscan fallback, so the page still works end to end for someone with no
// wallet at all.

import { BrowserProvider, Contract, type JsonRpcSigner } from "ethers";
import { CHAIN_ID, CHAIN_NAME, POOL_ABI, POOL_ADDRESS } from "./config";

const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);

export function hasWallet(): boolean {
  return typeof (window as any).ethereum !== "undefined";
}

export async function connect(): Promise<{ address: string; signer: JsonRpcSigner }> {
  if (!hasWallet()) {
    throw new Error("no injected wallet found");
  }

  const injected = (window as any).ethereum;
  const provider = new BrowserProvider(injected);
  await provider.send("eth_requestAccounts", []);

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    // Ask rather than fail. 4902 means the chain is not in the wallet yet.
    try {
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } catch (e: any) {
      throw new Error(
        e?.code === 4902
          ? `add ${CHAIN_NAME} to your wallet first`
          : `switch your wallet to ${CHAIN_NAME}`
      );
    }
  }

  const signer = await new BrowserProvider(injected).getSigner();
  return { address: await signer.getAddress(), signer };
}

export function pool(signer: JsonRpcSigner): Contract {
  return new Contract(POOL_ADDRESS, POOL_ABI, signer);
}

export function txUrl(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function writeContractUrl(): string {
  return `https://sepolia.etherscan.io/address/${POOL_ADDRESS}#writeContract`;
}

// Wallets and nodes bury the useful part of a revert. Dig it out so the screen
// can show "already committed" instead of a stack of JSON-RPC wrapping.
export function readableError(e: any): string {
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return "rejected in wallet";

  const reason = e?.reason ?? e?.info?.error?.message ?? e?.shortMessage ?? e?.message;
  return typeof reason === "string" ? reason : "transaction failed";
}
