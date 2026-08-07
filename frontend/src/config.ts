export const CHAIN_ID = 11155111; // Sepolia
export const CHAIN_NAME = "Sepolia";

export const POOL_ADDRESS = "0x9097c70e0aCE543FE9cE07393b3865864cEF6C5f";

export const SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/97495/zcash-pour-subgraph/version/latest";

export const REPO_URL = "https://github.com/mahdiidarabi/zcash-pour-contracts";
export const WRITING_URL = "https://mahdidarabi.medium.com/list/reading-list";

export const EXPLORER = `https://sepolia.etherscan.io/address/${POOL_ADDRESS}`;

export const CIRCUIT = {
  wasm: "/circuit/ZcashPour.wasm",
  zkey: "/circuit/ZcashPour.zkey",
  vkey: "/circuit/verification_key.json",
  manifest: "/circuit/manifest.json",
};

// pour() takes exactly ten, and every one must already exist on chain.
export const CM_LIST_SIZE = 10;

// pour range-checks both outputs with Num2Bits(128).
export const MAX_POUR_VALUE = 2n ** 128n;

// Only what this app calls. The full ABI is in contracts/artifacts.
export const POOL_ABI = [
  "function mint(uint256 _value, uint256 _cm, uint256 _r, uint256 _snProduce) payable",
  "function pour(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256[14] _pubSignals)",
  "function burn(uint256 _value, uint256 _r, uint256 _rho, uint256 _sk, address _recipient)",
  "function totalSupply() view returns (uint256)",
  "function commitmentIndex() view returns (uint256)",
  "function commitmentToIndex(uint256) view returns (uint256)",
  "function snConsumeList(uint256) view returns (bool)",
];
