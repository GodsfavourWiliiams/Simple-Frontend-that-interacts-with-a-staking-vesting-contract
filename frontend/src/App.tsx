import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { ABI } from "./abi";

const ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;
const fmt = (v: bigint) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const date = (s: bigint) => new Date(Number(s) * 1000).toLocaleDateString();
const DAY = 86400;

type Pos = { id: number; amount: bigint; unlock: bigint; tier: number; pending: bigint };
type Data = { symbol: string; balance: bigint; totalStaked: bigint; pool: bigint; paused: boolean; isOwner: boolean;
  tiers: { lock: number; mult: number }[]; positions: Pos[]; v: { total: bigint; released: bigint; cliff: bigint; revoked: boolean }; releasable: bigint };

export default function App() {
  const [account, setAccount] = useState<string>();
  const [c, setC] = useState<Contract>();
  const [d, setD] = useState<Data>();
  const [amount, setAmount] = useState("");
  const [tier, setTier] = useState(0);
  const [adm, setAdm] = useState({ who: "", total: "", cliff: "30", dur: "180", fund: "" });
  const [status, setStatus] = useState<{ msg: string; ok: boolean }>();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const eth = (window as any).ethereum;
    if (!eth) return setStatus({ msg: "No wallet found. Install MetaMask.", ok: false });
    const signer = await new BrowserProvider(eth).getSigner();
    setAccount(await signer.getAddress());
    setC(new Contract(ADDRESS, ABI, signer));
  };

  const refresh = useCallback(async () => {
    if (!c || !account) return;
    try {
      const [symbol, balance, totalStaked, pool, paused, owner, raw, v, releasable] = await Promise.all([
        c.symbol(), c.balanceOf(account), c.totalStaked(), c.rewardPool(), c.paused(), c.owner(),
        c.getPositions(account), c.vestings(account), c.releasable(account),
      ]);
      const tiers = await Promise.all([0, 1, 2].map(async (i) => { const t = await c.tiers(i); return { lock: Number(t.lock) / DAY, mult: Number(t.multBps) / 10000 }; }));
      const positions: Pos[] = await Promise.all(raw.map(async (p: any, id: number) => ({
        id, amount: p.amount, unlock: p.unlock, tier: Number(p.tier), open: p.open, pending: p.open ? await c.pendingOf(account, id) : 0n,
      }))).then((a: any[]) => a.filter((p) => p.open));
      setD({ symbol, balance, totalStaked, pool, paused, isOwner: owner.toLowerCase() === account.toLowerCase(),
        tiers, positions, v: { total: v.total, released: v.released, cliff: v.cliff, revoked: v.revoked }, releasable });
    } catch { setStatus({ msg: "Could not read contract. Check address and network.", ok: false }); }
  }, [c, account]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 10000); return () => clearInterval(t); }, [refresh]);

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(true); setStatus(undefined);
    try { await (await fn()).wait(); setStatus({ msg: `${label} confirmed`, ok: true }); setAmount(""); await refresh(); }
    catch (e: any) { setStatus({ msg: e?.shortMessage || e?.reason || "Transaction failed", ok: false }); }
    finally { setBusy(false); }
  };

  const parse = (s: string) => { try { return parseEther(s || "0"); } catch { return 0n; } };
  const sym = d?.symbol ?? "";
  const apr = (i: number) => d ? `${(10 * d.tiers[i].mult).toFixed(0)}% APR` : "";

  return (
    <div className="wrap">
      <h1>Staking and Vesting</h1>
      {!ADDRESS && <p className="err">Set VITE_CONTRACT_ADDRESS in frontend/.env</p>}
      {!account ? <button onClick={connect} disabled={!ADDRESS}>Connect wallet</button>
        : <p style={{ color: "var(--muted)" }}>Connected: {account.slice(0, 6)}...{account.slice(-4)} {d?.paused && <b className="err"> (paused)</b>}</p>}

      {d && (<>
        <div className="card grid">
          <div className="stat"><small>Wallet</small><b>{fmt(d.balance)} {sym}</b></div>
          <div className="stat"><small>Total staked</small><b>{fmt(d.totalStaked)} {sym}</b></div>
          <div className="stat"><small>Reward pool</small><b>{fmt(d.pool)} {sym}</b></div>
        </div>

        <div className="card">
          <h2>New stake</h2>
          <div className="row">
            {d.tiers.map((t, i) => (
              <button key={i} className={tier === i ? "" : "alt"} onClick={() => setTier(i)}>{t.lock}d lock, {apr(i)}</button>
            ))}
          </div>
          <div className="row">
            <input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button disabled={busy || d.paused || parse(amount) === 0n} onClick={() => run("Stake", () => c!.stake(parse(amount), tier))}>Stake</button>
          </div>
          <small style={{ color: "var(--muted)" }}>Leaving before the lock ends costs a 10% penalty.</small>
        </div>

        <div className="card">
          <h2>Your positions</h2>
          {d.positions.length === 0 && <p style={{ color: "var(--muted)" }}>No active positions.</p>}
          {d.positions.map((p) => {
            const early = Date.now() / 1000 < Number(p.unlock);
            return (
              <div key={p.id} className="pos">
                <div><b>{fmt(p.amount)} {sym}</b> <small>{apr(p.tier)}, unlocks {date(p.unlock)}</small></div>
                <div className="row">
                  <span>Pending: {fmt(p.pending)}</span>
                  <button disabled={busy || p.pending === 0n} onClick={() => run("Claim", () => c!.claim(p.id))}>Claim</button>
                  <button className="alt" disabled={busy} onClick={() => run("Unstake", () => c!.unstake(p.id))}>{early ? "Unstake (10% penalty)" : "Unstake"}</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <h2>Vesting</h2>
          {d.v.total === 0n ? <p style={{ color: "var(--muted)" }}>No vesting schedule for this wallet.</p> : (
            <div className="grid">
              <div className="stat"><small>Total{d.v.revoked ? " (revoked)" : ""}</small><b>{fmt(d.v.total)} {sym}</b></div>
              <div className="stat"><small>Released</small><b>{fmt(d.v.released)} {sym}</b></div>
              <div className="stat"><small>Releasable now</small><b>{fmt(d.releasable)} {sym}</b></div>
              <div className="stat"><small>Cliff ends</small><b>{date(d.v.cliff)}</b></div>
            </div>
          )}
          <div className="row"><button disabled={busy || d.releasable === 0n} onClick={() => run("Release", () => c!.release())}>Release vested tokens</button></div>
        </div>

        {d.isOwner && (
          <div className="card">
            <h2>Admin</h2>
            <div className="row">
              <input placeholder="Fund pool amount" value={adm.fund} onChange={(e) => setAdm({ ...adm, fund: e.target.value })} />
              <button disabled={busy || parse(adm.fund) === 0n} onClick={() => run("Fund", () => c!.fundRewardPool(parse(adm.fund)))}>Fund pool</button>
            </div>
            <div className="row">
              <input placeholder="Beneficiary 0x..." value={adm.who} onChange={(e) => setAdm({ ...adm, who: e.target.value })} />
              <input placeholder="Total" value={adm.total} onChange={(e) => setAdm({ ...adm, total: e.target.value })} />
              <input placeholder="Cliff days" value={adm.cliff} onChange={(e) => setAdm({ ...adm, cliff: e.target.value })} />
              <input placeholder="Duration days" value={adm.dur} onChange={(e) => setAdm({ ...adm, dur: e.target.value })} />
            </div>
            <div className="row">
              <button disabled={busy || !adm.who || parse(adm.total) === 0n}
                onClick={() => run("Vesting created", () => c!.createVesting(adm.who, parse(adm.total), BigInt(+adm.cliff * DAY), BigInt(+adm.dur * DAY)))}>Create vesting</button>
              <button className="alt" disabled={busy || !adm.who} onClick={() => run("Revoked", () => c!.revokeVesting(adm.who))}>Revoke vesting</button>
              <button className="alt" disabled={busy} onClick={() => run(d.paused ? "Unpaused" : "Paused", () => (d.paused ? c!.unpause() : c!.pause()))}>{d.paused ? "Unpause" : "Pause"}</button>
            </div>
          </div>
        )}
      </>)}
      {status && <p className={status.ok ? "ok" : "err"}>{status.msg}</p>}
    </div>
  );
}
