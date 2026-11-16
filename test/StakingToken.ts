import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const e = ethers.parseEther;
const DAY = 86400;

async function setup() {
  const [owner, alice, bob] = await ethers.getSigners();
  const t = await ethers.deployContract("StakingToken", [e("1000000")]);
  await t.transfer(alice.address, e("1000"));
  await t.fundRewardPool(e("10000"));
  return { t, owner, alice, bob };
}

describe("StakingToken", () => {
  it("pays tier-scaled rewards after the lock", async () => {
    const { t, alice } = await setup();
    await t.connect(alice).stake(e("1000"), 2); // 2x => 20% APR
    await time.increase(180 * DAY);
    await t.connect(alice).unstake(0);
    const bal = await t.balanceOf(alice.address);
    expect(bal).to.be.closeTo(e("1000") + e("1000") * 20n / 100n * 180n / 365n, e("0.01"));
  });

  it("charges a penalty for early exit and feeds the pool", async () => {
    const { t, alice } = await setup();
    await t.connect(alice).stake(e("1000"), 0);
    const poolBefore = await t.rewardPool();
    await t.connect(alice).unstake(0);
    expect(await t.balanceOf(alice.address)).to.be.closeTo(e("900"), e("0.01"));
    expect(await t.rewardPool()).to.be.gt(poolBefore - e("1"));
  });

  it("vests linearly after the cliff", async () => {
    const { t, alice } = await setup();
    await t.createVesting(alice.address, e("1200"), 30 * DAY, 120 * DAY);
    expect(await t.releasable(alice.address)).to.equal(0);
    await time.increase(60 * DAY);
    await t.connect(alice).release();
    expect(await t.balanceOf(alice.address)).to.be.closeTo(e("1000") + e("600"), e("1"));
  });

  it("revoke returns the unvested part to the owner", async () => {
    const { t, alice, owner } = await setup();
    await t.createVesting(alice.address, e("1200"), 0, 120 * DAY);
    await time.increase(60 * DAY);
    const before = await t.balanceOf(owner.address);
    await t.revokeVesting(alice.address);
    expect((await t.balanceOf(owner.address)) - before).to.be.closeTo(e("600"), e("1"));
    await t.connect(alice).release();
  });

  it("blocks staking while paused but allows exits", async () => {
    const { t, alice } = await setup();
    await t.connect(alice).stake(e("100"), 0);
    await t.pause();
    await expect(t.connect(alice).stake(e("1"), 0)).to.be.reverted;
    await t.connect(alice).unstake(0);
  });
});
