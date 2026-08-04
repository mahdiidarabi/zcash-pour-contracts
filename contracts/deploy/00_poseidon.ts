import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
const { deploy } = hre.deployments;
const { deployer } = await hre.getNamedAccounts();

for (const lib of ["PoseidonT2", "PoseidonT3", "PoseidonT4"] as const) {
    await deploy(lib, {
    contract: `poseidon-solidity/${lib}.sol:${lib}`,
    from: deployer,
    log: true,
    });
}
};

export default func;
func.tags = ["Poseidon"];