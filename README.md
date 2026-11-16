# Staking and Vesting dApp

An ERC20 (`StakingToken`) with tiered staking, a funded reward pool, an early-exit penalty, revocable vesting and pause control, plus a React + ethers v6 UI.

## How it works
- **Staking tiers:** 30d lock at 10% APR, 90d at 15%, 180d at 20%. Each stake is its own position.
- **Rewards** are paid from a pool the owner funds, never minted, so payouts are capped by the pool.
- **Early exit:** unstaking before unlock costs 10%, which goes back into the reward pool.
- **Vesting:** linear with a cliff. The owner can revoke, and the unvested part returns to the owner.
- **Pause** blocks new stakes and vesting, but users can always unstake and release.

## Run locally
```bash
npm install
npx hardhat node                 # terminal 1
npm run deploy:local             # terminal 2, copy the printed address
cd frontend && cp .env.example .env   # paste the address
npm install && npm run dev
```
Add the Hardhat network (http://127.0.0.1:8545, chain 31337) in MetaMask and import a Hardhat test key.

## Tests
```bash
npx hardhat test
```

## Sepolia
Set `SEPOLIA_RPC_URL` and `PRIVATE_KEY`, run `npm run deploy:sepolia`, then put the address in `frontend/.env`.
