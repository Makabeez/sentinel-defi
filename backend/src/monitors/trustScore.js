/**
 * Sentinel — governance trust score, derived on-chain
 *
 * Replaces hand-typed scores with values read from chain state. Every number
 * here traces to an account you can inspect yourself.
 *
 * What it reads, for any Solana program:
 *   1. Program upgrade authority     — can anyone replace the code, and who?
 *   2. Authority model               — immutable / DAO / multisig / single key
 *   3. Timelock                      — Squads time_lock or governance hold-up
 *   4. Change recency                — when the authority or bytecode last moved
 *
 * What it deliberately does NOT score: audits. Audit counts are not on-chain,
 * and inventing a number for them is how trust scores become decoration.
 *
 * Usage:
 *   node src/monitors/trustScore.js                        # score the registry
 *   node src/monitors/trustScore.js --programs <id>,<id>
 *   node src/monitors/trustScore.js --json
 *   node src/monitors/trustScore.js --watch                # poll + alert on change
 *
 * Alerts fire on the transitions that precede exploits:
 *   AUTHORITY_CHANGED   upgrade authority replaced
 *   TIMELOCK_REDUCED    delay shortened or removed
 *   THRESHOLD_LOWERED   multisig made easier to clear
 *   PROGRAM_UPGRADED    bytecode redeployed
 *   SCORE_DROP          composite fell by 10+
 *
 * Env:
 *   SOLANA_RPC_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SENTINEL_WEBHOOK_URL
 *   SENTINEL_API           registry source (default http://localhost:8080)
 *   TRUST_POLL_INTERVAL    watch interval ms (default 900000 = 15 min)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Connection, PublicKey } = require('@solana/web3.js');
const splGov = require('@solana/spl-governance');
const { resolveVault } = require('./squadsResolver');

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

const SENTINEL_API = process.env.SENTINEL_API || 'http://localhost:8080';
const STATE_PATH =
  process.env.TRUST_STATE_PATH || path.join(__dirname, '../../.sentinel-trust-state.json');
const POLL_INTERVAL = Number(process.env.TRUST_POLL_INTERVAL || 15 * 60 * 1000);
const RPC_DELAY_MS = Number(process.env.RPC_DELAY_MS || 250);

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const BPF_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';
const SQUADS_V4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const SPL_GOVERNANCE = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Chain reads
// ---------------------------------------------------------------------------

/**
 * An upgradeable program account holds only a pointer:
 *   [u32 enum = 2][pubkey programdata]
 * Slice it rather than downloading the account.
 */
async function programDataAddress(connection, programId) {
  const info = await connection.getAccountInfo(new PublicKey(programId), {
    dataSlice: { offset: 0, length: 36 },
  });
  if (!info) return { error: 'program account not found' };
  if (!info.executable) {
    return {
      error: `not an executable program (owner ${info.owner.toBase58().slice(0, 12)}… — likely a token mint or wallet)`,
    };
  }
  if (info.owner.toBase58() !== BPF_UPGRADEABLE) {
    // Executable, but under a loader with no upgrade path: the code cannot change.
    return { immutable: true, reason: 'deployed under a non-upgradeable loader' };
  }
  if (info.data.length < 36) return { error: 'unexpected program account layout' };
  return { programData: new PublicKey(info.data.subarray(4, 36)) };
}

/**
 * ProgramData layout:
 *   [u32 enum = 3][u64 last_deploy_slot][u8 has_authority][pubkey authority][bytecode...]
 * The dataSlice keeps this cheap — the bytecode can be megabytes.
 */
async function readProgramData(connection, programDataPubkey) {
  const info = await connection.getAccountInfo(programDataPubkey, {
    dataSlice: { offset: 0, length: 45 },
  });
  if (!info || info.data.length < 13) return { error: 'programdata unreadable' };

  const lastDeploySlot = Number(info.data.readBigUInt64LE(4));
  const hasAuthority = info.data[12] === 1;
  const authority =
    hasAuthority && info.data.length >= 45
      ? new PublicKey(info.data.subarray(13, 45))
      : null;

  return { lastDeploySlot, authority };
}

/** Squads v4 Multisig (anchor): 8 disc | create_key 32 | config_authority 32 | threshold u16 | time_lock u32 */
function decodeSquads(data) {
  try {
    if (data.length < 78) return null;
    const threshold = data.readUInt16LE(72);
    const timeLock = data.readUInt32LE(74);
    // members Vec sits after rent_collector Option<Pubkey> + bump; probe both shapes
    let cursor = 94;
    const hasRentCollector = data[cursor] === 1;
    cursor += hasRentCollector ? 33 : 1;
    cursor += 1; // bump
    let memberCount = null;
    if (data.length >= cursor + 4) {
      const n = data.readUInt32LE(cursor);
      if (n > 0 && n < 500) memberCount = n;
    }
    // Sanity gate: a threshold above the member count means we mis-parsed.
    if (threshold < 1 || (memberCount !== null && threshold > memberCount)) return null;
    return { threshold, timeLockSeconds: timeLock, memberCount };
  } catch {
    return null;
  }
}

async function classifyAuthority(connection, authority) {
  if (!authority) return { model: 'immutable', detail: 'upgrade authority revoked' };

  // A System-Program-owned address is only a "single key" if it is ON the ed25519
  // curve. Off-curve means it is a PDA — a Squads vault or program authority with
  // no private key in existence. Conflating the two libels well-governed protocols.
  const onCurve = PublicKey.isOnCurve(authority.toBytes());

  const info = await connection.getAccountInfo(authority);
  if (!info) {
    return onCurve
      ? {
          model: 'single-key',
          detail: 'unfunded keypair holds upgrade authority',
          authority: authority.toBase58(),
        }
      : {
          model: 'pda',
          detail: 'PDA (no account data) — resolve the controlling program manually',
          authority: authority.toBase58(),
        };
  }

  const owner = info.owner.toBase58();

  if (owner === SYSTEM_PROGRAM) {
    if (onCurve) {
      return {
        model: 'single-key',
        detail: 'a single keypair can replace the program',
        authority: authority.toBase58(),
      };
    }
    // Off-curve: a PDA. Try to resolve it to the Squads multisig behind it,
    // because "PDA" alone hides the difference between 7-of-17 and 1-of-1.
    let squads = null;
    try {
      squads = await resolveVault(connection, authority);
    } catch (err) {
      console.warn(`[trust] squads resolution failed: ${err.message}`);
    }

    if (squads && squads.threshold) {
      return {
        model: 'multisig',
        detail: `Squads v4 ${squads.threshold}/${squads.members}`,
        authority: authority.toBase58(),
        threshold: squads.threshold,
        members: squads.members,
        timelockSeconds: squads.timeLockSeconds,
        multisig: squads.multisig,
      };
    }

    if (squads && squads.multisig) {
      // Vault resolved but the config read failed — say so rather than implying
      // this is an unknown controller. Re-running will pick it up from cache.
      return {
        model: 'pda',
        detail: `Squads vault of ${squads.multisig.slice(0, 8)}… — config read failed, retry`,
        authority: authority.toBase58(),
        multisig: squads.multisig,
      };
    }

    return {
      model: 'pda',
      detail: 'PDA — no private key; not a Squads vault, controller unresolved',
      authority: authority.toBase58(),
    };
  }

  if (owner === SQUADS_V4) {
    const decoded = decodeSquads(info.data);
    if (decoded) {
      return {
        model: 'multisig',
        detail: `Squads v4 ${decoded.threshold}/${decoded.memberCount ?? '?'}`,
        authority: authority.toBase58(),
        threshold: decoded.threshold,
        members: decoded.memberCount,
        timelockSeconds: decoded.timeLockSeconds,
      };
    }
    return {
      model: 'multisig',
      detail: 'Squads v4 (config not parsed)',
      authority: authority.toBase58(),
    };
  }

  if (owner === SPL_GOVERNANCE) {
    try {
      const accounts = await splGov.getGovernanceAccounts(
        connection,
        new PublicKey(SPL_GOVERNANCE),
        splGov.Governance,
        []
      );
      const match = accounts.find((a) => a.pubkey.equals(authority));
      const cfg = match?.account?.config ?? {};
      const holdUp = Number(cfg.minInstructionHoldUpTime ?? 0);
      const thr =
        cfg.communityVoteThreshold?.value ?? cfg.voteThresholdPercentage?.value ?? null;
      return {
        model: 'dao',
        detail: `spl-governance${thr ? `, ${thr}% quorum` : ''}`,
        authority: authority.toBase58(),
        quorumPct: thr ? Number(thr) : null,
        timelockSeconds: holdUp,
      };
    } catch {
      return { model: 'dao', detail: 'spl-governance', authority: authority.toBase58() };
    }
  }

  return {
    model: 'program-controlled',
    detail: `owned by ${owner.slice(0, 8)}… (unidentified)`,
    authority: authority.toBase58(),
    ownerProgram: owner,
  };
}

async function lastAuthorityActivity(connection, programDataPubkey) {
  try {
    const sigs = await connection.getSignaturesForAddress(programDataPubkey, { limit: 1 });
    return sigs[0]?.blockTime ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scoring — three factors, all derivable. Audits are excluded on purpose.
// ---------------------------------------------------------------------------

function scoreAuthority(cls) {
  switch (cls.model) {
    case 'immutable':
      return { points: 45, max: 45, label: 'Immutable — code cannot be replaced' };
    case 'dao':
      return { points: 32, max: 45, label: `DAO-governed (${cls.detail})` };
    case 'multisig': {
      const t = cls.threshold ?? 0;
      const m = cls.members ?? 0;
      let p = 20;
      if (t >= 2) p = 26;
      if (t >= 3 && m >= 5) p = 34;
      if (t >= 4 && m >= 7) p = 38;
      return { points: p, max: 45, label: `Multisig (${cls.detail})` };
    }
    case 'program-controlled':
      return { points: 18, max: 45, label: `Program-controlled (${cls.detail})` };
    case 'pda':
      return {
        points: 22,
        max: 45,
        label: `PDA-controlled — ${cls.detail} [VERIFY]`,
      };
    default:
      return { points: 4, max: 45, label: 'Single key controls upgrades' };
  }
}

function scoreTimelock(cls) {
  const s = cls.timelockSeconds ?? 0;
  if (cls.model === 'immutable') return { points: 30, max: 30, label: 'No upgrade path' };
  if (cls.model === 'pda' && !s)
    return { points: 12, max: 30, label: 'Timelock unknown — controlling program unresolved' };
  if (!s) return { points: 0, max: 30, label: 'No timelock — changes land immediately' };
  const hours = s / 3600;
  if (hours >= 72) return { points: 30, max: 30, label: `${hours.toFixed(0)}h timelock` };
  if (hours >= 24) return { points: 22, max: 30, label: `${hours.toFixed(0)}h timelock` };
  if (hours >= 6) return { points: 14, max: 30, label: `${hours.toFixed(1)}h timelock` };
  return { points: 6, max: 30, label: `${hours.toFixed(1)}h timelock — minimal delay` };
}

function scoreRecency(lastActivity) {
  if (!lastActivity) return { points: 20, max: 25, label: 'No recent authority activity found' };
  const days = (Date.now() / 1000 - lastActivity) / 86400;
  if (days >= 180) return { points: 25, max: 25, label: `Quiet for ${days.toFixed(0)} days` };
  if (days >= 90) return { points: 21, max: 25, label: `Last change ${days.toFixed(0)}d ago` };
  if (days >= 30) return { points: 16, max: 25, label: `Last change ${days.toFixed(0)}d ago` };
  if (days >= 7) return { points: 10, max: 25, label: `Changed ${days.toFixed(0)}d ago` };
  return { points: 3, max: 25, label: `Changed ${days.toFixed(1)}d ago — very recent` };
}

function tierFor(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'weak';
  return 'critical';
}

async function scoreProgram(connection, { id, name, programId }) {
  const base = { id, name, programId, scoredAt: new Date().toISOString() };

  const addr = await programDataAddress(connection, programId);
  if (addr.error) return { ...base, error: addr.error };

  let cls;
  let lastDeploySlot = null;
  let lastActivity = null;

  if (addr.immutable) {
    cls = { model: 'immutable', detail: addr.reason };
  } else {
    await sleep(RPC_DELAY_MS);
    const pd = await readProgramData(connection, addr.programData);
    if (pd.error) return { ...base, error: pd.error };
    lastDeploySlot = pd.lastDeploySlot;
    await sleep(RPC_DELAY_MS);
    cls = await classifyAuthority(connection, pd.authority);
    await sleep(RPC_DELAY_MS);
    lastActivity = await lastAuthorityActivity(connection, addr.programData);
  }

  const factors = [scoreAuthority(cls), scoreTimelock(cls), scoreRecency(lastActivity)];
  const score = factors.reduce((s, f) => s + f.points, 0);

  return {
    ...base,
    score,
    tier: tierFor(score),
    model: cls.model,
    authority: cls.authority ?? null,
    threshold: cls.threshold ?? null,
    members: cls.members ?? null,
    timelockSeconds: cls.timelockSeconds ?? 0,
    lastDeploySlot,
    lastActivity,
    factors,
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

async function loadRegistry(programsArg) {
  if (programsArg) {
    return programsArg.split(',').map((p) => {
      const [programId, name] = p.split(':');
      return { id: (name || programId).toLowerCase(), name: name || programId, programId };
    });
  }
  try {
    const res = await fetch(`${SENTINEL_API}/api/protocols`);
    const list = await res.json();
    return list
      .filter((p) => p.programId)
      .map((p) => ({ id: p.id, name: p.name, programId: p.programId }));
  } catch (err) {
    throw new Error(
      `could not load registry from ${SENTINEL_API}/api/protocols (${err.message}). ` +
        'Pass --programs <id>[:name],... instead.'
    );
  }
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`[trust] could not persist state: ${err.message}`);
  }
}

function diffAgainst(previous, current) {
  if (!previous) return [];
  const alerts = [];
  const base = {
    protocol: current.name,
    programId: current.programId,
    detectedAt: new Date().toISOString(),
    source: 'trust-score',
  };

  if (previous.authority !== current.authority) {
    alerts.push({
      ...base,
      severity: 'critical',
      code: 'AUTHORITY_CHANGED',
      message: `${current.name}: upgrade authority changed from ${previous.authority || 'none'} to ${current.authority || 'none'}.`,
    });
  }

  if ((current.timelockSeconds || 0) < (previous.timelockSeconds || 0)) {
    alerts.push({
      ...base,
      severity: 'critical',
      code: 'TIMELOCK_REDUCED',
      message: `${current.name}: timelock cut from ${(previous.timelockSeconds / 3600).toFixed(1)}h to ${(current.timelockSeconds / 3600).toFixed(1)}h.`,
    });
  }

  if (
    previous.threshold != null &&
    current.threshold != null &&
    current.threshold < previous.threshold
  ) {
    alerts.push({
      ...base,
      severity: 'critical',
      code: 'THRESHOLD_LOWERED',
      message: `${current.name}: multisig threshold lowered from ${previous.threshold} to ${current.threshold}.`,
    });
  }

  if (
    previous.lastDeploySlot &&
    current.lastDeploySlot &&
    current.lastDeploySlot !== previous.lastDeploySlot
  ) {
    alerts.push({
      ...base,
      severity: 'high',
      code: 'PROGRAM_UPGRADED',
      message: `${current.name}: bytecode redeployed at slot ${current.lastDeploySlot}.`,
    });
  }

  if (previous.score != null && current.score != null && previous.score - current.score >= 10) {
    alerts.push({
      ...base,
      severity: 'high',
      code: 'SCORE_DROP',
      message: `${current.name}: trust score fell ${previous.score} → ${current.score}.`,
    });
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function deliver(alert) {
  console.log(`[trust:${alert.severity}] ${alert.code} — ${alert.message}`);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: `🛡 SENTINEL — ${alert.severity.toUpperCase()}\n${alert.code}\n\n${alert.message}\n\nProgram: ${alert.programId}`,
        }),
      });
    } catch (err) {
      console.warn(`[trust] telegram delivery failed: ${err.message}`);
    }
  }

  const hook = process.env.SENTINEL_WEBHOOK_URL;
  if (hook) {
    try {
      await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
      });
    } catch (err) {
      console.warn(`[trust] webhook delivery failed: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function scoreAll(connection, registry) {
  const results = [];
  for (const entry of registry) {
    try {
      results.push(await scoreProgram(connection, entry));
    } catch (err) {
      results.push({ ...entry, error: err.message });
    }
  }
  return results;
}

async function runOnce(connection, registry, { alerting }) {
  const results = await scoreAll(connection, registry);
  const state = loadState();
  const alerts = [];

  for (const r of results) {
    if (r.error) continue;
    if (alerting) {
      for (const alert of diffAgainst(state[r.programId], r)) {
        alerts.push(alert);
        await deliver(alert);
      }
    }
    state[r.programId] = {
      score: r.score,
      authority: r.authority,
      threshold: r.threshold,
      timelockSeconds: r.timelockSeconds,
      lastDeploySlot: r.lastDeploySlot,
    };
  }

  saveState(state);
  return { results, alerts };
}

function printTable(results) {
  console.table(
    results.map((r) =>
      r.error
        ? { protocol: r.name, score: '—', tier: 'error', model: r.error, timelock: '—' }
        : {
            protocol: r.name,
            score: `${r.score}/100`,
            tier: r.tier,
            model: r.model,
            timelock: r.timelockSeconds
              ? `${(r.timelockSeconds / 3600).toFixed(0)}h`
              : 'NONE',
          }
    )
  );

  for (const r of results) {
    if (r.error) continue;
    console.log(`\n${r.name} — ${r.score}/100 (${r.tier})`);
    for (const f of r.factors) console.log(`  ${f.points}/${f.max}  ${f.label}`);
    if (r.authority) console.log(`  authority: ${r.authority}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const programsIdx = args.indexOf('--programs');
  const asJson = args.includes('--json');
  const watch = args.includes('--watch');

  const connection = new Connection(RPC_URL, 'confirmed');
  const registry = await loadRegistry(programsIdx !== -1 ? args[programsIdx + 1] : null);

  if (watch) {
    console.log(`[trust] watching ${registry.length} programs every ${POLL_INTERVAL / 60000} min`);
    // First pass seeds the baseline without alerting on everything at once.
    const seeded = fs.existsSync(STATE_PATH);
    await runOnce(connection, registry, { alerting: seeded });
    if (!seeded) console.log('[trust] baseline captured — alerts start from the next pass');
    setInterval(() => {
      runOnce(connection, registry, { alerting: true }).catch((e) =>
        console.error('[trust] pass failed:', e.message)
      );
    }, POLL_INTERVAL);
    return;
  }

  const { results } = await runOnce(connection, registry, { alerting: false });
  if (asJson) console.log(JSON.stringify(results, null, 2));
  else printTable(results);
}

module.exports = { scoreProgram, scoreAll, diffAgainst, runOnce, loadRegistry };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
