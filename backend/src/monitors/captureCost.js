/**
 * Sentinel — governance capture cost
 *
 * The BonkDAO attack was priced in public, months in advance. The DAO ran a 1%
 * approval quorum; clearing it cost roughly $4.4M in BONK against a treasury
 * worth about $20M. Nobody had to wait for a proposal to see that — the number
 * was sitting in the governance config the whole time.
 *
 * This computes it for any realm:
 *
 *   captureCost  = quorum share of supply x token price
 *   prize        = total treasury value (SPL tokens + native SOL)
 *   ratio        = prize / captureCost
 *
 * ratio > 1 means the treasury is worth more than the votes needed to take it.
 * That is a standing invitation, not an incident.
 *
 *   node src/monitors/captureCost.js --realm 84pGFuy1Y27ApK67ApethaPvexeDWA66zNV8gm38TVeQ
 *   node src/monitors/captureCost.js --realm <pubkey> --json
 *
 * Prices come from DefiLlama (already a Sentinel dependency), not Jupiter —
 * one less API surface that changes shape.
 */

'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const splGov = require('@solana/spl-governance');
const { getGovernanceAccounts, pubkeyFilter, Realm, Governance } = splGov;

const GOVERNANCE_PROGRAMS = (process.env.GOVERNANCE_PROGRAM_IDS ||
  'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

const RPC_DELAY_MS = Number(process.env.RPC_DELAY_MS || 300);
const WSOL = 'So11111111111111111111111111111111111111112';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let callCount = 0;
async function throttled(label, fn) {
  callCount += 1;
  process.stderr.write(`\r[capture] rpc calls: ${callCount} (${label})          `);
  await sleep(RPC_DELAY_MS);
  return fn();
}

function toNumber(bnish) {
  if (bnish === undefined || bnish === null) return 0;
  if (typeof bnish === 'number') return bnish;
  if (typeof bnish.toNumber === 'function') {
    try {
      return bnish.toNumber();
    } catch {
      return Number(bnish.toString());
    }
  }
  return Number(bnish.toString?.() ?? 0);
}

function usd(n) {
  if (!isFinite(n)) return 'n/a';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Governance config
// ---------------------------------------------------------------------------

/**
 * Approval quorum as a fraction of total supply.
 * spl-governance expresses this as YesVotePercentage — the share of max voter
 * weight that must vote yes for a proposal to pass.
 */
function quorumFraction(governance) {
  const cfg = governance?.account?.config ?? {};
  const candidates = [
    cfg.communityVoteThreshold?.value,
    cfg.voteThresholdPercentage?.value,
    cfg.communityVoteThreshold,
    cfg.voteThresholdPercentage,
  ];
  for (const c of candidates) {
    const pct = toNumber(c);
    if (pct > 0 && pct <= 100) return pct / 100;
  }
  return null;
}

function holdUpSeconds(governance) {
  const cfg = governance?.account?.config ?? {};
  return toNumber(cfg.minInstructionHoldUpTime ?? cfg.proposalCoolOffTime ?? 0);
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

async function fetchPrices(mints) {
  const unique = [...new Set(mints)].filter(Boolean);
  const prices = {};
  const CHUNK = 40;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const url =
      'https://coins.llama.fi/prices/current/' +
      batch.map((m) => `solana:${m}`).join(',');
    try {
      const res = await fetch(url);
      const json = await res.json();
      for (const [key, val] of Object.entries(json.coins || {})) {
        prices[key.replace('solana:', '')] = {
          price: val.price,
          symbol: val.symbol,
        };
      }
    } catch (err) {
      console.warn(`\n[capture] price lookup failed: ${err.message}`);
    }
  }
  return prices;
}

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

async function nativeTreasury(programId, governancePubkey) {
  if (typeof splGov.getNativeTreasuryAddress === 'function') {
    try {
      return await splGov.getNativeTreasuryAddress(new PublicKey(programId), governancePubkey);
    } catch {
      /* fall through */
    }
  }
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('native-treasury'), governancePubkey.toBuffer()],
    new PublicKey(programId)
  );
  return pda;
}

/**
 * Treasury holdings across every account the DAO controls. Both the governance
 * account itself and its native treasury PDA can own token accounts, and DAO
 * treasuries are usually SPL tokens rather than SOL — which is exactly the
 * mistake that makes a native-balance check report an empty treasury.
 */
async function treasuryHoldings(connection, programId, governances) {
  const holdings = new Map(); // mint -> ui amount
  let lamports = 0;

  for (const governance of governances) {
    const owners = [governance.pubkey, await nativeTreasury(programId, governance.pubkey)];

    for (const owner of owners) {
      try {
        lamports += await connection.getBalance(owner);
      } catch {
        /* ignore */
      }

      try {
        const accounts = await throttled('token accounts', () =>
          connection.getParsedTokenAccountsByOwner(owner, {
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
          })
        );
        for (const { account } of accounts.value) {
          const info = account.data?.parsed?.info;
          if (!info) continue;
          const amount = Number(info.tokenAmount?.uiAmount || 0);
          if (amount <= 0) continue;
          holdings.set(info.mint, (holdings.get(info.mint) || 0) + amount);
        }
      } catch (err) {
        console.warn(`\n[capture] token scan failed for ${owner.toBase58()}: ${err.message}`);
      }
    }
  }

  if (lamports > 0) {
    holdings.set(WSOL, (holdings.get(WSOL) || 0) + lamports / 1e9);
  }

  return holdings;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

async function analyseRealm(connection, programId, realmPubkey) {
  const realmKey = new PublicKey(realmPubkey);

  const realmAccount = await throttled('realm', () =>
    connection.getAccountInfo(realmKey)
  );
  if (!realmAccount) throw new Error(`realm ${realmPubkey} not found on ${programId}`);

  const realms = await throttled('realm decode', () =>
    getGovernanceAccounts(connection, new PublicKey(programId), Realm, [])
  );
  const realm = realms.find((r) => r.pubkey.equals(realmKey));
  if (!realm) throw new Error(`realm ${realmPubkey} not owned by ${programId}`);

  const communityMint = realm.account.communityMint.toBase58();

  const governances = await throttled('governances', () =>
    getGovernanceAccounts(connection, new PublicKey(programId), Governance, [
      pubkeyFilter(1, realmKey),
    ])
  );

  const supplyInfo = await throttled('supply', () =>
    connection.getTokenSupply(new PublicKey(communityMint))
  );
  const supply = Number(supplyInfo.value.uiAmount || 0);

  const holdings = await treasuryHoldings(connection, programId, governances);

  const prices = await fetchPrices([communityMint, ...holdings.keys()]);
  const communityPrice = prices[communityMint]?.price || 0;

  let prize = 0;
  const treasuryLines = [];
  for (const [mint, amount] of holdings) {
    const price = prices[mint]?.price || 0;
    const value = amount * price;
    prize += value;
    if (value > 0) {
      treasuryLines.push({
        symbol: prices[mint]?.symbol || mint.slice(0, 6),
        amount,
        value,
      });
    }
  }
  treasuryLines.sort((a, b) => b.value - a.value);

  const results = governances.map((governance) => {
    const q = quorumFraction(governance);
    const quorumTokens = q === null ? null : supply * q;
    const captureCost = quorumTokens === null ? null : quorumTokens * communityPrice;
    return {
      governance: governance.pubkey.toBase58(),
      quorumPct: q === null ? null : q * 100,
      quorumTokens,
      captureCost,
      holdUpHours: holdUpSeconds(governance) / 3600,
      ratio: captureCost && captureCost > 0 ? prize / captureCost : null,
    };
  });

  return {
    realm: realmPubkey,
    programId,
    name: realm.account.name,
    communityMint,
    communityPrice,
    supply,
    prize,
    treasuryLines,
    governances: results,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const realmIdx = args.indexOf('--realm');
  const asJson = args.includes('--json');

  const realm = realmIdx !== -1 ? args[realmIdx + 1] : process.env.WATCHED_REALMS;
  if (!realm) {
    console.error('Pass --realm <pubkey> or set WATCHED_REALMS');
    process.exit(1);
  }

  // Backtest overrides: price the takeover under historical conditions.
  const priceIdx = args.indexOf('--price');
  const prizeIdx = args.indexOf('--prize');
  const priceOverride = priceIdx !== -1 ? Number(args[priceIdx + 1]) : null;
  const prizeOverride = prizeIdx !== -1 ? Number(args[prizeIdx + 1]) : null;

  const connection = new Connection(RPC_URL, 'confirmed');

  let report = null;
  let lastErr = null;
  for (const programId of GOVERNANCE_PROGRAMS) {
    try {
      report = await analyseRealm(connection, programId, realm.split(',')[0]);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  process.stderr.write('\n\n');

  if (!report) throw lastErr || new Error('could not analyse realm');

  if (priceOverride !== null || prizeOverride !== null) {
    if (priceOverride !== null) report.communityPrice = priceOverride;
    if (prizeOverride !== null) report.prize = prizeOverride;
    for (const g of report.governances) {
      g.captureCost = g.quorumTokens === null ? null : g.quorumTokens * report.communityPrice;
      g.ratio = g.captureCost && g.captureCost > 0 ? report.prize / g.captureCost : null;
    }
    console.log('*** BACKTEST MODE — figures overridden, not live chain state ***\n');
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`DAO:            ${report.name}`);
  console.log(`Realm:          ${report.realm}`);
  console.log(`Community mint: ${report.communityMint}`);
  console.log(
    `Token price:    ${report.communityPrice ? `$${report.communityPrice.toExponential(3)}` : 'unpriced'}`
  );
  console.log(`Supply:         ${report.supply.toLocaleString()}`);
  console.log(`Treasury value: ${usd(report.prize)}`);

  if (report.treasuryLines.length && prizeOverride === null) {
    console.log('\nTreasury composition:');
    console.table(
      report.treasuryLines.slice(0, 10).map((l) => ({
        asset: l.symbol,
        amount: l.amount.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        value: usd(l.value),
      }))
    );
  }

  console.log('\nCapture cost per governance:');
  console.table(
    report.governances.map((g) => ({
      governance: `${g.governance.slice(0, 8)}…`,
      quorum: g.quorumPct === null ? 'unknown' : `${g.quorumPct}%`,
      votesNeeded:
        g.quorumTokens === null
          ? '—'
          : g.quorumTokens.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      captureCost: g.captureCost === null ? '—' : usd(g.captureCost),
      timelock: g.holdUpHours ? `${g.holdUpHours.toFixed(1)}h` : 'NONE',
      'prize/cost': g.ratio === null ? '—' : `${g.ratio.toFixed(2)}x`,
    }))
  );

  const worst = report.governances
    .filter((g) => g.ratio !== null)
    .sort((a, b) => b.ratio - a.ratio)[0];

  console.log('');
  if (!worst) {
    console.log('VERDICT: quorum config unreadable — cannot price capture.');
  } else if (worst.ratio > 1) {
    console.log(
      `VERDICT: EXPLOITABLE BY CONSTRUCTION — ${usd(worst.captureCost)} of votes ` +
        `controls ${usd(report.prize)} of treasury (${worst.ratio.toFixed(2)}x).`
    );
    if (!worst.holdUpHours) {
      console.log('         No timelock. Execution is immediate on passage.');
    }
  } else {
    console.log(
      `VERDICT: capture costs ${usd(worst.captureCost)} for ${usd(report.prize)} ` +
        `of treasury (${worst.ratio.toFixed(2)}x) — not profitable on its face.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
