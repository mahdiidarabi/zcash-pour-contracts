import { HardhatUserConfig } from "hardhat/config";
  import "@nomicfoundation/hardhat-toolbox";
  import * as dotenv from "dotenv";

  dotenv.config();

  const config: HardhatUserConfig = {
    solidity: {
      version: "0.8.28",
      settings: {
        // The generated Groth16 verifier is one big assembly block; the
        // optimizer makes a real difference to its deploy and call cost.
        optimizer: { enabled: true, runs: 200 },
      },
    },
    networks: {
      hardhat: {},
      sepolia: {
        url: process.env.SEPOLIA_RPC_URL ?? "",
        accounts: process.env.DEPLOYER_PRIVATE_KEY
          ? [process.env.DEPLOYER_PRIVATE_KEY]
          : [],
      },
    },
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    },
  };

  export default config;