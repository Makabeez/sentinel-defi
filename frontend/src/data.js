// Static content for the dashboard.
//
// SNAPSHOT is the fallback shown only when the live API is unreachable. Every
// value in it was read from Solana mainnet by backend/src/monitors/trustScore.js;
// the page labels it with its date so it is never mistaken for live data.

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8081';

export const SNAPSHOT = {
  "updatedAt": "2026-10-03T18:34:46.232Z",
  "protocols": [
    {
      "id": "kamino",
      "name": "Kamino Finance",
      "programId": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
      "score": 76,
      "tier": "good",
      "model": "multisig",
      "authority": "GzFgdRJXmawPhGeBsyRCDLx4jAKPsvbUqoqitzppkzkW",
      "multisig": "6hhBGCtmg7tPWUSgp3LG6X2rsmYWAc4tNsA6G4CnfQbM",
      "threshold": 5,
      "members": 10,
      "timelockSeconds": 86400,
      "lastActivity": 1787234644,
      "factors": [
        {
          "label": "Multisig (Squads v4 5/10)",
          "points": 38,
          "max": 45
        },
        {
          "label": "24h timelock",
          "points": 22,
          "max": 30
        },
        {
          "label": "Authority last used 20 Aug 2026",
          "points": 16,
          "max": 25
        }
      ]
    },
    {
      "id": "marginfi",
      "name": "MarginFi",
      "programId": "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
      "score": 48,
      "tier": "weak",
      "model": "multisig",
      "authority": "J3oBkTkDXU3TcAggJEa3YeBZE5om5yNAdTtLVNXFD47",
      "multisig": "7FCPipJWVbPbdHymVt1gJYwKciakkJz5GahdQySemvHk",
      "threshold": 7,
      "members": 15,
      "timelockSeconds": 0,
      "lastActivity": 1788547473,
      "factors": [
        {
          "label": "Multisig (Squads v4 7/15)",
          "points": 38,
          "max": 45
        },
        {
          "label": "No timelock — changes land immediately",
          "points": 0,
          "max": 30
        },
        {
          "label": "Authority last used 4 Sep 2026",
          "points": 10,
          "max": 25
        }
      ]
    },
    {
      "id": "solend",
      "name": "Solend",
      "programId": "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo",
      "score": 29,
      "tier": "critical",
      "model": "single-key",
      "authority": "RY93CZYe5g6drtG7W9PmHRPzaBLZ1uwihTzayQTmJfh",
      "multisig": null,
      "threshold": null,
      "members": null,
      "timelockSeconds": 0,
      "lastActivity": 1775290101,
      "factors": [
        {
          "label": "Single key controls upgrades",
          "points": 4,
          "max": 45
        },
        {
          "label": "No timelock — changes land immediately",
          "points": 0,
          "max": 30
        },
        {
          "label": "Authority last used 4 Apr 2026",
          "points": 25,
          "max": 25
        }
      ]
    },
    {
      "id": "jupiter-lend",
      "name": "Jupiter Lend",
      "programId": null,
      "error": "program ID not verified"
    },
    {
      "id": "drift",
      "name": "Drift Protocol",
      "programId": "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
      "score": 65,
      "tier": "fair",
      "model": "multisig",
      "authority": "8jj7zJgdr5bDndc7evM74FMGwzLPmd4u4QxNzFi1BMai",
      "multisig": "7qipzLR9j1JcvdxE1XJEFgvoyFmgBpgw5hMdHBMPcJtM",
      "threshold": 4,
      "members": 7,
      "timelockSeconds": 3600,
      "lastActivity": 1782763021,
      "factors": [
        {
          "label": "Multisig (Squads v4 4/7)",
          "points": 38,
          "max": 45
        },
        {
          "label": "1.0h timelock — minimal delay",
          "points": 6,
          "max": 30
        },
        {
          "label": "Authority last used 29 Jun 2026",
          "points": 21,
          "max": 25
        }
      ]
    }
  ],
  "alerts": []
};

// BonkDAO, BIP #76. Figures reproduced by backend/src/monitors/captureCost.js
// from the realm's governance config and BONK supply.
export const BONK_CASE = {
  realm: '84pGFuy1Y27ApK67ApethaPvexeDWA66zNV8gm38TVeQ',
  votesNeeded: '879,946,007,523 BONK',
  captureCost: 3.96,
  treasury: 20,
  ratio: '5.05',
  strictRatio: '0.51',
};

// Drift, 1 April 2026. Each entry is something visible on-chain beforehand.
export const DRIFT_TIMELINE = [
  {
    date: '2026-03-11',
    title: 'A fresh wallet is funded through a mixer',
    body: 'A new wallet receives 10 ETH from Tornado Cash and starts interacting with Drift vaults.',
    flag: 'New wallet touching a monitored protocol within 24 hours of mixer activity',
  },
  {
    date: '2026-03-12',
    title: 'A near-empty token appears',
    body: 'CarbonVote (CVT) launches with about $500 of seeded liquidity and wash trading.',
    flag: 'Thin-liquidity token showing up as potential collateral',
  },
  {
    date: '2026-03-27',
    title: 'The Security Council timelock is removed',
    body: 'The multisig moves from 3 of 5 with a timelock to 2 of 5 with none. Admin actions now land instantly.',
    flag: 'Timelock removed and threshold lowered, both critical alerts',
    critical: true,
  },
  {
    date: '2026-03-28',
    title: 'Admin transactions are pre-signed and parked',
    body: 'Two admin-level transactions are signed with durable nonces and left dormant.',
    flag: 'Durable nonce accounts linked to a protocol multisig',
  },
  {
    date: '2026-04-01',
    title: '$285M leaves the vaults in 12 minutes',
    body: 'The parked transactions execute. The attacker takes Security Council powers and drains JLP, USDC and cbBTC.',
    critical: true,
  },
];

export const LINKS = {
  repo: 'https://github.com/Makabeez/sentinel-defi',
  x: 'https://x.com/geiserjoe2',
  realm: (id) => `https://app.realms.today/dao/${id}`,
  account: (id) => `https://solscan.io/account/${id}`,
};
