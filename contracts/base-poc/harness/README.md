# Gas-free UX harness (Base Sepolia)

Live companion to the contract-level proof in
`../test/gasless/AgentVouchEvm.Gasless4337.t.sol`. It runs the AgentVouch core flow —
register, author bond, vouch, listing, purchase, voucher revenue claim, author proceeds
withdrawal — on **Base Sepolia**, where every actor is a **Coinbase Smart Account** and
a **paymaster** (Coinbase Developer Platform) sponsors all gas. It prints each user's
ETH balance (stays flat — zero gas) and the USDC revenue split the flow produced.

## What you provide

| Need | Where |
|---|---|
| A CDP paymaster + bundler URL | https://portal.cdp.coinbase.com → Paymaster (Base Sepolia). Its policy must allowlist the deployed AgentVouch contract **and** the USDC `approve` call. |
| A funded deployer key | Any Base Sepolia EOA with a little test ETH (faucet: https://www.alchemy.com/faucets/base-sepolia) — used once to deploy the contract. |
| Test USDC | https://faucet.circle.com (Base Sepolia) — sent to the three smart-account addresses the harness prints. |

The smart-account **owner** keys never send transactions and never need ETH.

## Steps

```bash
# 0. From contracts/base-poc: deploy the contract
export DEPLOYER_PRIVATE_KEY=0x...
forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast
#   -> note the "AgentVouchEvm deployed:" address

# 1. Harness deps + config
cd harness && npm install
cp .env.example .env
#   set CDP_RPC_URL and AGENTVOUCH_ADDRESS in .env

# 2. Generate persistent smart-account owners (prints keys + addresses)
npm run demo
#   -> paste the printed *_OWNER_PK lines into .env

# 3. Fund the three printed smart-account addresses with >= 10 test USDC each, then:
npm run demo
```

On the final run you'll see each UserOp's sponsored gas, then a report showing the
users' ETH deltas are `0` and the USDC split (buyer −10, voucher −6, author −4).

## Notes

- No contract changes are needed for gas-free UX: `AgentVouchEvm` keys every action off
  `msg.sender`, so a smart account is simply the actor and the paymaster covers gas.
- `typecheck`: `npm run typecheck`.
- This is a decision instrument on the isolated POC; it does not touch the Solana
  program or any production flow.
