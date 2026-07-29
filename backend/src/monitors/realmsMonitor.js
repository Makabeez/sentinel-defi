/**
 * Sentinel — Realms proposal monitor
 *
 * Watches live SPL Governance proposals and scores them for capture risk.
 * Built from the BonkDAO post-mortem (Jul 7 2026): an attacker bought ~$4M of
 * voting power, opened a proposal, and it sat live for six days with ~99.9% of
 * cast weight in one cluster. Every one of those facts is on-chain and readable
 * before execution.
 *
 * Signals:
 *   CAPTURE       one voter cluster holds >= 90% of cast weight
 *   SOLO_PASS     the top voter alone can clear the approval threshold
 *   FRESH_CAPITAL top voter's governance deposit was created after the proposal
 *   APATHY        proposal is passing on fewer than N distinct voters
 *   CONCENTRATION Herfindahl index above threshold
 *
 * Usage:
 *   node realmsMonitor.js --discover bonk          # find a realm pubkey by name
 *   node realmsMonitor.js --once                   # one scan, print JSON
 *   node realmsMonitor.js                          # loop on POLL_INTERVAL
 *
 * Wire into the backend:
 *   const { createRealmsMonitor } = require('./monitors/realmsMonitor');
 *   const monitor = createRealmsMonitor({ connection, onAlert: alertBus.emit });
 *   monitor.start();
 */

'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const {
  getGovernanceAccounts,
  pubkeyFilter,
  Realm,
  Governance,
  Proposal,
  VoteRecord,
  TokenOwnerRecord,
  ProposalState,
} = require('@solana/spl-governance');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Shared spl-governance instance. DAOs may deploy their own — add them here. */
const GOVERNANCE_PROGRAMS = (process.env.GOVERNANCE_PROGRAM_IDS ||
  'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Realms to watch. Resolve pubkeys with `--discover <name>` before filling this in.
 * Leave empty to scan every realm on the configured programs (slow, but thorough).
 */
const WATCHED_REALMS = (process.env.WATCHED_REALMS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const THRESHOLDS = {
  captureShare: 0.9,       // top cluster share of cast weight -> CAPTURE
  concentrationHhi: 0.5,   // Herfindahl index -> CONCENTRATION
  apathyVoterCount: 10,    // distinct voters below this -> APATHY
  freshCapitalDays: 30,    // deposit newer than this, relative to proposal open
};

const POLL_INTERVAL = Number(process.env.REALMS_POLL_INTERVAL || 5 * 60 * 1000);

const RPC_URL =
  process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL ||
  (process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

// ---------------------------------------------------------------------------
// SDK shims — spl-governance changed accessor shapes between 0.3.x releases,
// so read defensively rather than trusting one signature.
// ---------------------------------------------------------------------------

function toNumber(bnish) {
  if (bnish === undefined || bnish === null) return 0;
  if (typeof bnish === 'number') return bnish;
  if (typeof bnish === 'bigint') return Number(bnish);
  if (typeof bnish.toNumber === 'function') {
    try {
      return bnish.toNumber();
    } catch {
      return Number(bnish.toString());
    }
  }
  return Number(bnish.toString?.() ?? 0);
}

function voteWeight(record) {
  const account = record.account ?? record;
  const yes =
    typeof account.getYesVoteWeight === 'function' ? account.getYesVoteWeight() : undefined;
  const no =
    typeof account.getNoVoteWeight === 'function' ? account.getNoVoteWeight() : undefined;
  const total = toNumber(yes) + toNumber(no);
  if (total > 0) return { yes: toNumber(yes), no: toNumber(no), total };

  // v2 multi-choice fallback
  const approve = (account.vote?.approveChoices || []).reduce(
    (sum, c) => sum + toNumber(c.weight),
    0
  );
  const deny = toNumber(account.vote?.deny ? account.voterWeight : 0);
  return { yes: approve, no: deny, total: approve + deny };
}

function proposalVoteThreshold(governance) {
  const cfg = governance?.account?.config ?? governance?.config ?? {};
  const t =
    cfg.communityVoteThreshold?.value ??
    cfg.voteThresholdPercentage?.value ??
    cfg.communityVoteThreshold ??
    cfg.voteThresholdPercentage;
  const pct = toNumber(t);
  return pct > 0 && pct <= 100 ? pct / 100 : 0.6; // conservative default
}

function maxVotingSeconds(governance) {
  const cfg = governance?.account?.config ?? governance?.config ?? {};
  return toNumber(cfg.maxVotingTime) || 3 * 24 * 3600;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Herfindahl-Hirschman index over voter shares. 1.0 = one voter holds everything. */
function herfindahl(shares) {
  return shares.reduce((sum, s) => sum + s * s, 0);
}

function analyseVoteRecords(records) {
  const byVoter = new Map();
  for (const record of records) {
    const account = record.account ?? record;
    const owner = account.governingTokenOwner?.toBase58?.() ?? String(account.governingTokenOwner);
    const { yes, no, total } = voteWeight(record);
    const prev = byVoter.get(owner) || { yes: 0, no: 0, total: 0, pubkey: owner };
    byVoter.set(owner, {
      pubkey: owner,
      yes: prev.yes + yes,
      no: prev.no + no,
      total: prev.total + total,
    });
  }

  const voters = [...byVoter.values()].sort((a, b) => b.total - a.total);
  const castTotal = voters.reduce((sum, v) => sum + v.total, 0);
  const yesTotal = voters.reduce((sum, v) => sum + v.yes, 0);
  const shares = castTotal > 0 ? voters.map((v) => v.total / castTotal) : [];

  return {
    voters,
    voterCount: voters.length,
    castTotal,
    yesTotal,
    topVoter: voters[0] || null,
    topShare: shares[0] || 0,
    hhi: herfindahl(shares),
  };
}

/**
 * Fresh-capital check: when was this voter's governance deposit first created?
 * The TokenOwnerRecord PDA is created on first deposit, so its oldest signature
 * is the deposit date. A deposit that postdates the proposal is the BonkDAO
 * pattern — capital bought specifically to vote.
 */
async function depositAgeSeconds(connection, tokenOwnerRecordPubkey) {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(tokenOwnerRecordPubkey),
      { limit: 1000 }
    );
    if (!sigs.length) return null;
    const oldest = sigs[sigs.length - 1];
    return oldest.blockTime ?? null;
  } catch (err) {
    console.warn('[realms] deposit age lookup failed:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

async function fetchAccounts(connection, programId, accountClass, filters = []) {
  return getGovernanceAccounts(connection, new PublicKey(programId), accountClass, filters);
}

async function discoverRealms(connection, nameFragment) {
  const results = [];
  for (const programId of GOVERNANCE_PROGRAMS) {
    const realms = await fetchAccounts(connection, programId, Realm);
    for (const realm of realms) {
      const name = realm.account?.name ?? '';
      if (!nameFragment || name.toLowerCase().includes(nameFragment.toLowerCase())) {
        results.push({ name, pubkey: realm.pubkey.toBase58(), programId });
      }
    }
  }
  return results;
}

async function scanRealm(connection, programId, realmPubkey) {
  const governances = await fetchAccounts(connection, programId, Governance, [
    pubkeyFilter(1, new PublicKey(realmPubkey)),
  ]);

  const findings = [];

  for (const governance of governances) {
    const proposals = await fetchAccounts(connection, programId, Proposal, [
      pubkeyFilter(1, governance.pubkey),
    ]);

    const live = proposals.filter((p) => {
      const state = p.account?.state;
      return state === ProposalState.Voting || state === ProposalState.SigningOff;
    });

    for (const proposal of live) {
      const records = await fetchAccounts(connection, programId, VoteRecord, [
        pubkeyFilter(1, proposal.pubkey),
      ]);

      const metrics = analyseVoteRecords(records);
      const threshold = proposalVoteThreshold(governance);
      const openedAt = toNumber(proposal.account?.votingAt);
      const closesAt = openedAt + maxVotingSeconds(governance);

      findings.push({
        realm: realmPubkey,
        programId,
        governance: governance.pubkey.toBase58(),
        proposal: proposal.pubkey.toBase58(),
        name: proposal.account?.name ?? '',
        state: proposal.account?.state,
        openedAt,
        closesAt,
        secondsRemaining: Math.max(0, closesAt - Math.floor(Date.now() / 1000)),
        threshold,
        ...metrics,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

async function scoreProposal(connection, finding) {
  const alerts = [];
  const { topVoter, topShare, voterCount, hhi, castTotal, yesTotal, threshold } = finding;

  if (castTotal === 0) return alerts;

  if (topShare >= THRESHOLDS.captureShare) {
    alerts.push({
      severity: 'critical',
      code: 'CAPTURE',
      message:
        `Proposal "${finding.name}" — one voter holds ${(topShare * 100).toFixed(2)}% ` +
        `of cast weight across ${voterCount} voter(s).`,
      voter: topVoter?.pubkey,
    });
  }

  // Can the top voter clear the bar alone?
  if (topVoter && castTotal > 0) {
    const soloShareOfYes = yesTotal > 0 ? topVoter.yes / yesTotal : 0;
    if (soloShareOfYes >= threshold) {
      alerts.push({
        severity: 'critical',
        code: 'SOLO_PASS',
        message:
          `Proposal "${finding.name}" clears its ${(threshold * 100).toFixed(0)}% threshold ` +
          `on a single voter's weight.`,
        voter: topVoter.pubkey,
      });
    }
  }

  if (voterCount > 0 && voterCount < THRESHOLDS.apathyVoterCount) {
    alerts.push({
      severity: voterCount <= 3 ? 'high' : 'medium',
      code: 'APATHY',
      message:
        `Proposal "${finding.name}" is live with only ${voterCount} distinct voter(s). ` +
        `${Math.round(finding.secondsRemaining / 3600)}h remaining.`,
    });
  }

  if (hhi >= THRESHOLDS.concentrationHhi && topShare < THRESHOLDS.captureShare) {
    alerts.push({
      severity: 'medium',
      code: 'CONCENTRATION',
      message: `Proposal "${finding.name}" — voter concentration HHI ${hhi.toFixed(3)}.`,
    });
  }

  // Fresh capital: did the top voter's deposit predate the proposal?
  if (topVoter && topShare >= 0.5) {
    // Resolve the voter's TokenOwnerRecord by scanning the realm rather than
    // deriving the PDA — the seed needs the governing token mint, which differs
    // between community and council votes.
    const records = await fetchAccounts(connection, finding.programId, TokenOwnerRecord, [
      pubkeyFilter(1, new PublicKey(finding.realm)),
    ]);
    const match = records.find(
      (r) => r.account?.governingTokenOwner?.toBase58?.() === topVoter.pubkey
    );

    if (match) {
      const createdAt = await depositAgeSeconds(connection, match.pubkey);
      if (createdAt && finding.openedAt) {
        const ageDays = (finding.openedAt - createdAt) / 86400;
        if (ageDays < THRESHOLDS.freshCapitalDays) {
          alerts.push({
            severity: 'critical',
            code: 'FRESH_CAPITAL',
            message:
              `Top voter on "${finding.name}" deposited governance tokens ` +
              `${ageDays < 0 ? 'after' : `${ageDays.toFixed(1)} days before`} the proposal opened.`,
            voter: topVoter.pubkey,
          });
        }
      }
    }
  }

  return alerts.map((a) => ({
    ...a,
    source: 'realms-monitor',
    proposal: finding.proposal,
    realm: finding.realm,
    url: `https://app.realms.today/dao/${finding.realm}/proposal/${finding.proposal}`,
    detectedAt: new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

function createRealmsMonitor({
  connection,
  realms = WATCHED_REALMS,
  programs = GOVERNANCE_PROGRAMS,
  onAlert = (alert) => console.log('[realms:alert]', JSON.stringify(alert)),
  intervalMs = POLL_INTERVAL,
} = {}) {
  const conn = connection || new Connection(RPC_URL, 'confirmed');
  const seen = new Set();
  let timer = null;

  async function scanOnce() {
    const findings = [];
    for (const programId of programs) {
      const targets = realms.length
        ? realms
        : (await fetchAccounts(conn, programId, Realm)).map((r) => r.pubkey.toBase58());

      for (const realm of targets) {
        try {
          findings.push(...(await scanRealm(conn, programId, realm)));
        } catch (err) {
          console.warn(`[realms] scan failed for ${realm}:`, err.message);
        }
      }
    }

    const alerts = [];
    for (const finding of findings) {
      for (const alert of await scoreProposal(conn, finding)) {
        const key = `${alert.proposal}:${alert.code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        alerts.push(alert);
        onAlert(alert);
      }
    }

    return { findings, alerts };
  }

  return {
    scanOnce,
    start() {
      scanOnce().catch((e) => console.error('[realms] initial scan failed:', e));
      timer = setInterval(() => scanOnce().catch((e) => console.error('[realms]', e)), intervalMs);
      console.log(`[realms] monitor started, interval ${intervalMs / 1000}s`);
      return timer;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createRealmsMonitor, scanRealm, discoverRealms, analyseVoteRecords, THRESHOLDS };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const connection = new Connection(RPC_URL, 'confirmed');

  (async () => {
    if (args[0] === '--discover') {
      const found = await discoverRealms(connection, args[1] || '');
      console.table(found);
      return;
    }

    const monitor = createRealmsMonitor({ connection });

    if (args.includes('--once')) {
      const { findings, alerts } = await monitor.scanOnce();
      console.log(JSON.stringify({ proposals: findings.length, findings, alerts }, null, 2));
      return;
    }

    monitor.start();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

