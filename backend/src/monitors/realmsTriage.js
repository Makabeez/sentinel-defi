/**
 * Sentinel — realm triage v2
 *
 * Name search returns squatters. Mint filtering narrows it, but anyone can
 * create a realm referencing a mint they don't control. What an impostor cannot
 * fake is treasury balance and proposal history.
 *
 *   node src/monitors/realmsTriage.js --mint <mint> --shallow   # cheap first pass
 *   node src/monitors/realmsTriage.js --mint <mint>             # full profile
 *   node src/monitors/realmsTriage.js --realms <pubkey,pubkey>
 *
 * Needs a real RPC. Public mainnet-beta will 429 on getProgramAccounts.
 *   export HELIUS_API_KEY=<key>
 *
 * Tuning:
 *   RPC_DELAY_MS   pause between heavy calls (default 300)
 */

'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const splGov = require('@solana/spl-governance');
const { getGovernanceAccounts, pubkeyFilter, Realm, Governance, Proposal } = splGov;

const GOVERNANCE_PROGRAMS = (process.env.GOVERNANCE_PROGRAM_IDS ||
  'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const RPC_URL =
  process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL ||
  (process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

const RPC_DELAY_MS = Number(process.env.RPC_DELAY_MS || 300);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every heavy RPC call goes through here — sequential, spaced, and counted. */
let callCount = 0;
async function throttled(label, fn) {
  callCount += 1;
  process.stderr.write(`\r[triage] rpc calls: ${callCount} (${label})          `);
  await sleep(RPC_DELAY_MS);
  return fn();
}

function base58(x) {
  return x?.toBase58?.() ?? (x ? String(x) : null);
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

/** Native treasury PDA for a governance account. */
async function nativeTreasury(programId, governancePubkey) {
  if (typeof splGov.getNativeTreasuryAddress === 'function') {
    try {
      return await splGov.getNativeTreasuryAddress(new PublicKey(programId), governancePubkey);
    } catch {
      /* fall through to manual derivation */
    }
  }
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('native-treasury'), governancePubkey.toBuffer()],
    new PublicKey(programId)
  );
  return pda;
}

async function profileRealm(connection, programId, realmAccount, { shallow }) {
  const realmPubkey = realmAccount.pubkey;

  const governances = await throttled('governances', () =>
    getGovernanceAccounts(connection, new PublicKey(programId), Governance, [
      pubkeyFilter(1, realmPubkey),
    ])
  );

  const row = {
    name: realmAccount.account?.name ?? '',
    realm: base58(realmPubkey),
    council: base58(realmAccount.account?.config?.councilMint) ? 'yes' : 'no',
    governances: governances.length,
    treasurySOL: 0,
    proposals: shallow ? '—' : 0,
    voting: shallow ? '—' : 0,
    lastProposal: '—',
  };

  // Treasury balance — getBalance is cheap, so run it even in shallow mode.
  let lamports = 0;
  for (const governance of governances.slice(0, 25)) {
    try {
      const treasury = await nativeTreasury(programId, governance.pubkey);
      lamports += await connection.getBalance(treasury);
    } catch {
      /* ignore individual treasury misses */
    }
  }
  row.treasurySOL = Number((lamports / 1e9).toFixed(3));

  if (shallow) return row;

  let proposalCount = 0;
  let votingCount = 0;
  let latestProposalAt = 0;

  for (const governance of governances) {
    const proposals = await throttled('proposals', () =>
      getGovernanceAccounts(connection, new PublicKey(programId), Proposal, [
        pubkeyFilter(1, governance.pubkey),
      ])
    );
    proposalCount += proposals.length;
    for (const p of proposals) {
      const opened = toNumber(p.account?.votingAt) || toNumber(p.account?.draftAt);
      if (opened > latestProposalAt) latestProposalAt = opened;
      if (p.account?.state === 2) votingCount += 1; // ProposalState.Voting
    }
  }

  row.proposals = proposalCount;
  row.voting = votingCount;
  row.lastProposal = latestProposalAt
    ? new Date(latestProposalAt * 1000).toISOString().slice(0, 10)
    : '—';

  return row;
}

async function main() {
  const args = process.argv.slice(2);
  const shallow = args.includes('--shallow');
  const mintIdx = args.indexOf('--mint');
  const realmsIdx = args.indexOf('--realms');

  if (RPC_URL.includes('api.mainnet-beta.solana.com')) {
    console.warn(
      '[triage] WARNING: using the public RPC. getProgramAccounts will rate-limit.\n' +
        '         export HELIUS_API_KEY=<key> before running this.\n'
    );
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const rows = [];

  for (const programId of GOVERNANCE_PROGRAMS) {
    let candidates = [];

    if (mintIdx !== -1) {
      const mint = new PublicKey(args[mintIdx + 1]);
      candidates = await throttled('realms', () =>
        getGovernanceAccounts(connection, new PublicKey(programId), Realm, [
          pubkeyFilter(1, mint),
        ])
      );
      console.error(`\n[triage] ${candidates.length} realm(s) reference mint ${mint.toBase58()}`);
    } else if (realmsIdx !== -1) {
      const wanted = new Set(args[realmsIdx + 1].split(',').map((s) => s.trim()));
      const all = await throttled('realms', () =>
        getGovernanceAccounts(connection, new PublicKey(programId), Realm)
      );
      candidates = all.filter((r) => wanted.has(r.pubkey.toBase58()));
    } else {
      console.error('Pass --mint <mint> or --realms <pubkey,pubkey>');
      process.exit(1);
    }

    for (const realm of candidates) {
      try {
        rows.push(await profileRealm(connection, programId, realm, { shallow }));
      } catch (err) {
        console.warn(`\n[triage] failed on ${realm.pubkey.toBase58()}: ${err.message}`);
      }
    }
  }

  process.stderr.write('\n\n');

  rows.sort(
    (a, b) =>
      b.treasurySOL - a.treasurySOL ||
      (Number(b.proposals) || 0) - (Number(a.proposals) || 0) ||
      b.governances - a.governances
  );
  console.table(rows);

  if (rows.length) {
    console.log('\nRanked by treasury, then proposal history. Top candidate:');
    console.log(`  export WATCHED_REALMS=${rows[0].realm}`);
    console.log(`  https://app.realms.today/dao/${rows[0].realm}`);
    console.log('\nOpen that URL and confirm it is the DAO you think it is before trusting it.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
