import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
const { deploy, get } = hre.deployments;
const { deployer } = await hre.getNamedAccounts();

const [t2, t3, t4] = await Promise.all([
    get("PoseidonT2"), get("PoseidonT3"), get("PoseidonT4"),
]);

await deploy("ZcashPourPool", {
    from: deployer,
    args: [],
    libraries: {
    PoseidonT2: t2.address,
    PoseidonT3: t3.address,
    PoseidonT4: t4.address,
    },
    log: true,
    waitConfirmations: hre.network.live ? 5 : 1,
});
};

export default func;
func.tags = ["ZcashPourPool"];
func.dependencies = ["Poseidon"];