// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice ERC20 with tiered staking, a funded reward pool, early-exit penalty and revocable vesting.
contract StakingToken is ERC20, Ownable, Pausable, ReentrancyGuard {
    uint256 public constant BASE_APR_BPS = 1000;   // 10% APR at 1x
    uint256 public constant PENALTY_BPS = 1000;    // 10% penalty for leaving before unlock
    uint256 private constant YEAR = 365 days;

    struct Tier { uint64 lock; uint16 multBps; }   // multBps: 10000 = 1x
    struct Position { uint256 amount; uint64 start; uint64 unlock; uint64 lastClaim; uint8 tier; bool open; }
    struct Vesting { uint256 total; uint256 released; uint64 start; uint64 cliff; uint64 duration; bool revoked; }

    Tier[3] public tiers;
    mapping(address => Position[]) private _positions;
    mapping(address => Vesting) public vestings;
    uint256 public totalStaked;
    uint256 public rewardPool;

    event Staked(address indexed user, uint256 id, uint256 amount, uint8 tier);
    event Unstaked(address indexed user, uint256 id, uint256 amount, uint256 penalty);
    event RewardClaimed(address indexed user, uint256 id, uint256 amount);
    event PoolFunded(uint256 amount);
    event VestingCreated(address indexed beneficiary, uint256 total, uint64 cliff, uint64 duration);
    event VestingReleased(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 returned);

    constructor(uint256 initialSupply) ERC20("Staking Token", "STK") Ownable(msg.sender) {
        tiers[0] = Tier(30 days, 10000);
        tiers[1] = Tier(90 days, 15000);
        tiers[2] = Tier(180 days, 20000);
        _mint(msg.sender, initialSupply);
    }

    // ---------- Admin ----------
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function fundRewardPool(uint256 amount) external onlyOwner {
        _transfer(msg.sender, address(this), amount);
        rewardPool += amount;
        emit PoolFunded(amount);
    }

    // ---------- Staking ----------
    function positionCount(address user) external view returns (uint256) { return _positions[user].length; }
    function getPositions(address user) external view returns (Position[] memory) { return _positions[user]; }

    function pendingOf(address user, uint256 id) public view returns (uint256) {
        Position memory p = _positions[user][id];
        if (!p.open) return 0;
        uint256 apr = BASE_APR_BPS * tiers[p.tier].multBps / 10_000;
        return p.amount * apr * (block.timestamp - p.lastClaim) / (YEAR * 10_000);
    }

    function stake(uint256 amount, uint8 tier) external whenNotPaused nonReentrant {
        require(amount > 0 && tier < tiers.length, "bad params");
        _transfer(msg.sender, address(this), amount);
        uint64 nowTs = uint64(block.timestamp);
        _positions[msg.sender].push(Position(amount, nowTs, nowTs + tiers[tier].lock, nowTs, tier, true));
        totalStaked += amount;
        emit Staked(msg.sender, _positions[msg.sender].length - 1, amount, tier);
    }

    function claim(uint256 id) external nonReentrant { require(_claim(msg.sender, id) > 0, "nothing to claim"); }

    function _claim(address user, uint256 id) internal returns (uint256 paid) {
        Position storage p = _positions[user][id];
        require(p.open, "closed");
        uint256 owed = pendingOf(user, id);
        paid = owed > rewardPool ? rewardPool : owed; // never pay more than the funded pool
        p.lastClaim = uint64(block.timestamp);
        if (paid > 0) {
            rewardPool -= paid;
            _transfer(address(this), user, paid);
            emit RewardClaimed(user, id, paid);
        }
    }

    function unstake(uint256 id) external nonReentrant {
        Position storage p = _positions[msg.sender][id];
        require(p.open, "closed");
        _claim(msg.sender, id);
        uint256 amount = p.amount;
        uint256 penalty = block.timestamp < p.unlock ? amount * PENALTY_BPS / 10_000 : 0;
        p.open = false;
        totalStaked -= amount;
        rewardPool += penalty; // penalties feed the reward pool
        _transfer(address(this), msg.sender, amount - penalty);
        emit Unstaked(msg.sender, id, amount - penalty, penalty);
    }

    // ---------- Vesting ----------
    function createVesting(address who, uint256 total, uint64 cliffSeconds, uint64 durationSeconds)
        external onlyOwner whenNotPaused
    {
        require(vestings[who].total == 0, "exists");
        require(total > 0 && durationSeconds > 0 && cliffSeconds <= durationSeconds, "bad params");
        _transfer(msg.sender, address(this), total);
        uint64 s = uint64(block.timestamp);
        vestings[who] = Vesting(total, 0, s, s + cliffSeconds, durationSeconds, false);
        emit VestingCreated(who, total, s + cliffSeconds, durationSeconds);
    }

    function vestedAmount(address who) public view returns (uint256) {
        Vesting memory v = vestings[who];
        if (v.total == 0) return 0;
        if (v.revoked || block.timestamp >= v.start + v.duration) return v.total;
        if (block.timestamp < v.cliff) return 0;
        return v.total * (block.timestamp - v.start) / v.duration;
    }

    function releasable(address who) public view returns (uint256) {
        return vestedAmount(who) - vestings[who].released;
    }

    function release() external nonReentrant {
        uint256 amount = releasable(msg.sender);
        require(amount > 0, "nothing to release");
        vestings[msg.sender].released += amount;
        _transfer(address(this), msg.sender, amount);
        emit VestingReleased(msg.sender, amount);
    }

    /// @notice Stops a schedule: already vested tokens stay claimable, the rest returns to the owner.
    function revokeVesting(address who) external onlyOwner nonReentrant {
        Vesting storage v = vestings[who];
        require(v.total > 0 && !v.revoked, "cannot revoke");
        uint256 vested = vestedAmount(who);
        uint256 returned = v.total - vested;
        v.total = vested;
        v.revoked = true;
        if (returned > 0) _transfer(address(this), owner(), returned);
        emit VestingRevoked(who, returned);
    }
}
