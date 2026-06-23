import { useCallback, useState } from "react";
import { formatEther, type Address, type Hex } from "viem";
import type { SmartAccount } from "viem/account-abstraction";
import {
  ACCOUNT_KINDS,
  createAccount,
  type AccountKind,
  type Role,
} from "./accounts";
import {
  agentVouchAddress,
  cdpRpcUrl,
  circleFaucetUrl,
  explorerAddressUrl,
  explorerTxUrl,
  MIN_PAID_PRICE_USDC,
} from "./config";
import {
  computeListingId,
  createSkillListing,
  formatUsdc,
  getEthBalance,
  getUsdcBalance,
  purchaseSkill,
  registerAgent,
  skillIdHashFrom,
  usdcMicros,
  type StepResult,
} from "./flow";

const shortHex = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Balances {
  eth: bigint;
  usdc: bigint;
}
type Accounts = Record<Role, SmartAccount>;
type AddressMap = Record<Role, Address>;
type BalanceMap = Record<Role, Balances>;
interface ReceiptRow {
  label: string;
  result: StepResult;
}

const ZERO_BAL: Balances = { eth: 0n, usdc: 0n };
const ZERO_BALANCES: BalanceMap = { author: ZERO_BAL, buyer: ZERO_BAL };

export function App() {
  const [kind, setKind] = useState<AccountKind>("localKey");
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [addresses, setAddresses] = useState<AddressMap | null>(null);
  const [balances, setBalances] = useState<BalanceMap>(ZERO_BALANCES);

  const [setupBusy, setSetupBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("Sentiment Analyzer");
  const [description, setDescription] = useState(
    "Classifies text sentiment with confidence scores.",
  );
  const [skillId, setSkillId] = useState("sentiment-analyzer-v1");
  const [priceUsdc, setPriceUsdc] = useState("1");

  const [registered, setRegistered] = useState(false);
  const [listing, setListing] = useState<{ id: Hex; priceMicros: bigint } | null>(
    null,
  );
  const [purchased, setPurchased] = useState(false);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);

  const cdpReady = Boolean(cdpRpcUrl);

  const refreshBalances = useCallback(async (addrs: AddressMap) => {
    const roles: Role[] = ["author", "buyer"];
    const next: BalanceMap = { author: ZERO_BAL, buyer: ZERO_BAL };
    await Promise.all(
      roles.map(async (r) => {
        const [eth, usdc] = await Promise.all([
          getEthBalance(addrs[r]),
          getUsdcBalance(addrs[r]),
        ]);
        next[r] = { eth, usdc };
      }),
    );
    setBalances(next);
  }, []);

  function selectKind(next: AccountKind) {
    if (next === kind) return;
    setKind(next);
    setAccounts(null);
    setAddresses(null);
    setBalances(ZERO_BALANCES);
    setRegistered(false);
    setListing(null);
    setPurchased(false);
    setReceipts([]);
    setError(null);
  }

  async function setupAccounts() {
    setSetupBusy(true);
    setError(null);
    try {
      // Sequential so passkey mode shows two clearly-labeled prompts (author, then buyer).
      const author = await createAccount(kind, "author");
      const buyer = await createAccount(kind, "buyer");
      const addrs: AddressMap = { author: author.address, buyer: buyer.address };
      setAccounts({ author, buyer });
      setAddresses(addrs);
      await refreshBalances(addrs);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSetupBusy(false);
    }
  }

  async function run(
    label: string,
    fn: () => Promise<StepResult>,
    after?: () => void,
  ) {
    setBusy(label);
    setError(null);
    try {
      const result = await fn();
      setReceipts((prev) => [{ label, result }, ...prev]);
      after?.();
      if (addresses) await refreshBalances(addresses);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  function doRegister() {
    if (!accounts) return;
    run(
      "Register agent (author)",
      () => registerAgent(accounts.author, "ipfs://agentvouch-demo-author"),
      () => setRegistered(true),
    );
  }

  function doList() {
    if (!accounts || !addresses) return;
    const priceMicros = usdcMicros(priceUsdc);
    const skillIdHash = skillIdHashFrom(skillId.trim() || name.trim());
    const id = computeListingId(addresses.author, skillIdHash);
    run(
      "List skill (author)",
      () =>
        createSkillListing(accounts.author, {
          skillIdHash,
          uri: `ipfs://skill/${skillId.trim() || "demo"}`,
          name: name.trim(),
          description: description.trim(),
          priceMicros,
        }),
      () => setListing({ id, priceMicros }),
    );
  }

  function doPurchase() {
    if (!accounts || !listing) return;
    run(
      "Buy skill (buyer)",
      () => purchaseSkill(accounts.buyer, listing.id, listing.priceMicros),
      () => setPurchased(true),
    );
  }

  const priceNum = Number(priceUsdc);
  const priceValid =
    Number.isFinite(priceNum) && priceNum >= MIN_PAID_PRICE_USDC;
  const buyerFunded =
    listing != null && balances.buyer.usdc >= listing.priceMicros;

  return (
    <div className="wrap">
      <header>
        <h1>AgentVouch — Gas-Free Demo</h1>
        <p className="subtitle">
          Base Sepolia · register → list → buy with <strong>zero gas</strong>{" "}
          (every action is a paymaster-sponsored UserOp).
        </p>
        <div className="chips">
          <span className="chip accent">⛽ gas sponsored</span>
          <a
            className="chip"
            href={explorerAddressUrl(agentVouchAddress)}
            target="_blank"
            rel="noreferrer"
          >
            contract {shortHex(agentVouchAddress)} ↗
          </a>
          <span className="chip">chain eip155:84532</span>
        </div>
      </header>

      {!cdpReady && (
        <div className="banner warn">
          <strong>Read-only:</strong> reads + account addresses work, but sending
          sponsored actions needs <span className="mono">VITE_CDP_RPC_URL</span>.
          Copy <span className="mono">.env.example</span> →{" "}
          <span className="mono">.env.local</span>, paste your CDP Paymaster &amp;
          Bundler URL, and restart the dev server.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      <section>
        <p className="section-title">1 · Account model</p>
        <div className="kinds">
          {ACCOUNT_KINDS.map((k) => (
            <button
              key={k.kind}
              className={`kind${kind === k.kind ? " selected" : ""}`}
              disabled={!k.enabled || setupBusy || busy != null}
              onClick={() => selectKind(k.kind)}
            >
              <div className="kind-label">{k.label}</div>
              <div className="kind-blurb">{k.blurb}</div>
              {!k.enabled && <span className="kind-tag">pending spike</span>}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <p className="subtitle">
          Two roles share the flow: the <strong>author</strong> registers + lists,
          the <strong>buyer</strong> purchases. Only the buyer needs test USDC.
        </p>
        {!accounts && (
          <button
            className="primary"
            data-testid="btn-setup"
            onClick={setupAccounts}
            disabled={setupBusy}
          >
            {setupBusy
              ? "Setting up…"
              : kind === "passkey"
                ? "Create passkeys (2 prompts) →"
                : "Set up accounts →"}
          </button>
        )}
      </section>

      {addresses && (
        <section>
          <p className="section-title">2 · Smart accounts</p>
          <div className="accounts">
            {(["author", "buyer"] as Role[]).map((role) => (
              <div className="card" key={role}>
                <div className="account-role">{role}</div>
                <div className="addr-line">
                  <a
                    className="addr mono"
                    href={explorerAddressUrl(addresses[role])}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortHex(addresses[role])}
                  </a>
                  <button
                    className="ghost"
                    onClick={() =>
                      navigator.clipboard?.writeText(addresses[role])
                    }
                  >
                    copy
                  </button>
                </div>
                <div className="bal-row">
                  <span className="label">ETH</span>
                  <span className="mono">{formatEther(balances[role].eth)}</span>
                  <span className="muted">gas sponsored</span>
                </div>
                <div className="bal-row">
                  <span className="label">USDC</span>
                  <span className="mono">{formatUsdc(balances[role].usdc)}</span>
                  <span className="muted">
                    {role === "buyer" ? "needs ≥ price" : "needs none"}
                  </span>
                </div>
                {role === "buyer" && (
                  <a
                    className="faucet"
                    href={circleFaucetUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Fund with test USDC (Circle faucet) →
                  </a>
                )}
              </div>
            ))}
          </div>
          <div className="spacer" />
          <button
            className="ghost"
            onClick={() => addresses && refreshBalances(addresses)}
          >
            ↻ refresh balances
          </button>
        </section>
      )}

      {accounts && (
        <section>
          <p className="section-title">3 · The journey</p>

          <div className={`step${registered ? " done" : ""}`}>
            <div className="step-num">{registered ? "✓" : "1"}</div>
            <div className="step-body">
              <div className="step-title">Register the agent</div>
              <div className="step-sub">
                Author calls <span className="mono">registerAgent</span> — free, no
                USDC.
              </div>
              <button
                className="primary"
                data-testid="btn-register"
                onClick={doRegister}
                disabled={!cdpReady || registered || busy != null}
              >
                {busy === "Register agent (author)"
                  ? "Signing…"
                  : registered
                    ? "Registered ✓"
                    : "Register (author)"}
              </button>
            </div>
          </div>

          <div className={`step${listing ? " done" : ""}`}>
            <div className="step-num">{listing ? "✓" : "2"}</div>
            <div className="step-body">
              <div className="step-title">List a skill</div>
              <div className="step-sub">
                Author calls <span className="mono">createSkillListing</span> —
                paid listing, free to post.
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Skill name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={listing != null}
                  />
                </div>
                <div className="field">
                  <label>Price (USDC)</label>
                  <input
                    value={priceUsdc}
                    onChange={(e) => setPriceUsdc(e.target.value)}
                    disabled={listing != null}
                    inputMode="decimal"
                  />
                </div>
              </div>
              <div className="field">
                <label>Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={listing != null}
                  rows={2}
                />
              </div>
              <div className="field">
                <label>Skill ID (unique per author; bump it to re-list)</label>
                <input
                  value={skillId}
                  onChange={(e) => setSkillId(e.target.value)}
                  disabled={listing != null}
                />
              </div>
              <button
                className="primary"
                data-testid="btn-list"
                onClick={doList}
                disabled={
                  !cdpReady ||
                  !registered ||
                  listing != null ||
                  !name.trim() ||
                  !priceValid ||
                  busy != null
                }
              >
                {busy === "List skill (author)"
                  ? "Signing…"
                  : listing
                    ? "Listed ✓"
                    : "List skill (author)"}
              </button>
              {!priceValid && (
                <div className="hint">
                  Min paid price is {MIN_PAID_PRICE_USDC} USDC.
                </div>
              )}
            </div>
          </div>

          <div className={`step${purchased ? " done" : ""}`}>
            <div className="step-num">{purchased ? "✓" : "3"}</div>
            <div className="step-body">
              <div className="step-title">Buy the skill</div>
              <div className="step-sub">
                Buyer calls <span className="mono">approve</span> +{" "}
                <span className="mono">purchaseSkill</span> in one UserOp
                {listing ? ` · ${formatUsdc(listing.priceMicros)} USDC` : ""}.
              </div>
              <button
                className="primary"
                data-testid="btn-buy"
                onClick={doPurchase}
                disabled={
                  !cdpReady ||
                  !listing ||
                  purchased ||
                  !buyerFunded ||
                  busy != null
                }
              >
                {busy === "Buy skill (buyer)"
                  ? "Signing…"
                  : purchased
                    ? "Purchased ✓"
                    : "Buy skill (buyer)"}
              </button>
              {listing && !buyerFunded && !purchased && (
                <div className="hint">
                  Buyer needs ≥ {formatUsdc(listing.priceMicros)} USDC — fund the
                  buyer account above, then ↻ refresh balances.
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {receipts.length > 0 && (
        <section>
          <p className="section-title">Receipts</p>
          <div className="card">
            {receipts.map((row, i) => (
              <div className="receipt" key={i}>
                <div className="receipt-label">{row.label}</div>
                <div className="receipt-meta">
                  <span className="ok">✓ on-chain</span>
                  <span className="muted">
                    gas sponsored {formatEther(row.result.actualGasCost)} ETH · you
                    paid 0
                  </span>
                </div>
                <div className="receipt-links">
                  <a
                    href={explorerTxUrl(row.result.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    tx {shortHex(row.result.txHash)} ↗
                  </a>
                  <span className="mono muted">
                    userOp {shortHex(row.result.userOpHash)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
