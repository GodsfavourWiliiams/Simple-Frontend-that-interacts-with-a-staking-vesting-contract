import { ethers } from "hardhat";

async function main() {
  const token = await ethers.deployContract("StakingToken", [ethers.parseEther("1000000")]);
  await token.waitForDeployment();
  console.log("StakingToken deployed to:", await token.getAddress());
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
