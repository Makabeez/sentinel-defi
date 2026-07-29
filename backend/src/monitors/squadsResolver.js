/**
 * Sentinel — Squads vault resolver
 *
 * Most Solana protocols hand program upgrade authority to a Squads vault, which
 * is a PDA. On its own an upgrade authority PDA tells you only "no private key
 * exists" — it hides whether the multisig behind it is a 7-of-17 with a real
 * timelock or a 1-of-1 with none. That distinction is the whole point of a
 * governance score, so it has to be resolved rather than flagged as unknown.
 *
 * A vault PDA can't be reversed, so we go forwards: enumerate every Squads
 * multisig account (keys only — one getProgramAccounts with a zero-length
 * dataSlice), derive each one's vault PDAs locally, and look for the authority
 * in that map. Derivation is local maths, so the whole index costs a single RPC
 * call regardless of how many multisigs exist.
 *
 * Results are cached to disk permanently — a vault's parent multisig never
 * changes — so the expensive index build happens once, on a cache miss.
 * Negative results are cached with a TTL, since a protocol may migrate later.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('@solana/web3.js');
const bs58lib = require('bs58');
const multisig = require('@sqds/multisig');

const bs58 = bs58lib.default || bs58lib;

/** Anchor discriminator for the Multisig account: sha256("account:Multisig")[0..8] */
const MULTISIG_DISCRIMINATOR = Buffer.from([224, 116, 121, 186, 68, 161, 79, 236]);

/** Vault indexes to derive per multisig. Protocols almost always use 0. */
const VAULT_INDEXES = Number(process.env.SQUADS_VAULT_INDEXES || 3);

const CACHE_PATH =
  process.env.SQUADS_CACHE_PATH || path.join(__dirname, '../../.sentinel-squads-cache.json');

const NEGATIVE_TTL_MS = 7 * 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn(`[squads] cache write failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

let vaultIndex = null; // in-process memo, vaultPda -> { multisig, vaultIndex }

async function buildVaultIndex(connection) {
  if (vaultIndex) return vaultIndex;

  console.log('[squads] building vault index (one getProgramAccounts, keys only)...');
  const accounts = await connection.getProgramAccounts(multisig.PROGRAM_ID, {
    dataSlice: { offset: 0, length: 0 },
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(MULTISIG_DISCRIMINATOR) } }],
  });

  const map = new Map();
  for (const { pubkey } of accounts) {
    for (let i = 0; i < VAULT_INDEXES; i++) {
      try {
        const [vault] = multisig.getVaultPda({ multisigPda: pubkey, index: i });
        map.set(vault.toBase58(), { multisig: pubkey.toBase58(), vaultIndex: i });
      } catch {
        /* skip underivable index */
      }
    }
  }

  console.log(`[squads] indexed ${accounts.length} multisigs → ${map.size} vault PDAs`);
  vaultIndex = map;
  return map;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

async function readMultisigConfig(connection, multisigPubkey) {
  const account = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    new PublicKey(multisigPubkey)
  );
  return {
    threshold: Number(account.threshold),
    members: account.members.length,
    timeLockSeconds: Number(account.timeLock),
    transactionIndex: Number(account.transactionIndex),
  };
}

/**
 * Resolve an upgrade-authority PDA to the Squads multisig that controls it.
 * Returns null when the authority is not a Squads vault.
 */
async function resolveVault(connection, authority) {
  const key = authority.toBase58 ? authority.toBase58() : String(authority);
  const cache = loadCache();
  const hit = cache[key];

  if (hit && hit.multisig) {
    try {
      const config = await readMultisigConfig(connection, hit.multisig);
      return { multisig: hit.multisig, vaultIndex: hit.vaultIndex, ...config };
    } catch (err) {
      console.warn(`[squads] cached multisig unreadable: ${err.message}`);
    }
  }

  if (hit && hit.notFound && Date.now() - hit.checkedAt < NEGATIVE_TTL_MS) {
    return null;
  }

  const index = await buildVaultIndex(connection);
  const found = index.get(key);

  if (!found) {
    cache[key] = { notFound: true, checkedAt: Date.now() };
    saveCache(cache);
    return null;
  }

  cache[key] = { multisig: found.multisig, vaultIndex: found.vaultIndex };
  saveCache(cache);

  try {
    const config = await readMultisigConfig(connection, found.multisig);
    return { multisig: found.multisig, vaultIndex: found.vaultIndex, ...config };
  } catch (err) {
    console.warn(`[squads] config read failed: ${err.message}`);
    return { multisig: found.multisig, vaultIndex: found.vaultIndex };
  }
}

module.exports = { resolveVault, buildVaultIndex, readMultisigConfig, MULTISIG_DISCRIMINATOR };

// ---------------------------------------------------------------------------
// CLI — resolve addresses passed as arguments
// ---------------------------------------------------------------------------

if (require.main === module) {
  const { Connection } = require('@solana/web3.js');
  const rpc =
    process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpc, 'confirmed');
  const targets = process.argv.slice(2);

  if (!targets.length) {
    console.error('Pass one or more authority addresses to resolve.');
    process.exit(1);
  }

  (async () => {
    for (const t of targets) {
      const r = await resolveVault(connection, new PublicKey(t));
      if (!r) console.log(`${t}  ->  not a Squads vault`);
      else
        console.log(
          `${t}  ->  ${r.threshold}/${r.members} multisig ${r.multisig}, ` +
            `timelock ${r.timeLockSeconds}s (vault #${r.vaultIndex})`
        );
    }
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
