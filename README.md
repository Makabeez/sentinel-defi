# Sentinel — Solana Governance Security Layer

> Monitoring the humans behind the smart contracts. Governance trust scores, wallet risk scanning, and real-time anomaly detection for Solana DeFi.

**Live Demo:** [https://frontend-eta-topaz-85.vercel.app](https://frontend-eta-topaz-85.vercel.app)
**Hackathon:** Solana Frontier (Colosseum) — April 6 – May 11, 2026

---

## The Problem

On April 1, 2026, Drift Protocol was exploited for **$285 million** — the largest DeFi hack of the year. The attack wasn't a smart contract bug. It was a **governance failure**:

- **Mar 11:** Attacker wallet funded via Tornado Cash
- **Mar 27:** Security Council timelock **removed** (multisig changed from 3/5 to 2/5 with zero timelock)
- **Mar 28:** Durable nonce transactions pre-signed and left dormant
- **Apr 1:** $285M drained in 12 minutes. 12+ protocols affected.

Five days later, Solana Foundation launched STRIDE — a security program with 24/7 threat monitoring and formal verification. But STRIDE's own documentation acknowledges: **formal verification would not have caught this attack**. The exploit targeted the gap between on-chain correctness and off-chain human trust.

**No tool monitors the human layer — who controls the admin keys, what their timelock settings are, and when governance parameters change.** Sentinel fills that gap.

## The Solution

Sentinel is a **governance-focused security layer** for Solana DeFi. While STRIDE and Hypernative monitor smart contracts, Sentinel monitors the **people controlling them**.

### 1. Governance Trust Scores
Every monitored protocol receives a trust score (0-100) based on four factors:
- **Multisig configuration** — How many signers? What threshold?
- **Timelock duration** — How long before admin changes take effect?
- **Audit history** — How many independent audits?
- **Admin activity** — Any suspicious recent changes?

Jupiter Lend scores 92/100 (4/7 multisig, 72h timelock, formally verified). Drift scored 8/100 at the time of exploit (2/5 multisig, zero timelock, compromised).

### 2. Wallet Risk Scanner
Enter any Solana wallet address to see:
- Which protocols you're exposed to
- The governance trust score for each
- Your overall wallet risk level
- Specific governance weaknesses in protocols you use

### 3. Real-Time Anomaly Detection
- **Oracle deviations** — Pyth price feeds vs 5-minute TWAP (caught JUP/USD -5.17% deviation on Apr 19)
- **TVL crashes** — Cross-protocol monitoring via DefiLlama (caught Jupiter Lend -8.5% drop on Apr 17)
- **Funding rate extremes** — Binance/Bybit SOL funding as cascade risk signal
- **Governance changes** — Admin account data modifications, timelock changes, multisig rotations
- **Telegram alerts** — Critical and high severity events pushed instantly

### 4. Drift Hack Replay
Interactive timeline showing the 6 on-chain signals Sentinel would have detected before and during the $285M exploit — from Tornado Cash funding on March 11 through cascade alerts on April 1.

## Why This Is Different

| Tool | What it monitors | Drift hack? |
|------|-----------------|-------------|
| STRIDE / Asymmetric | Smart contract correctness | Would NOT have caught it |
| Hypernative | Transaction-level threats | Detected during exploit, not before |
| Range Security | Real-time tx alerting | No governance layer |
| DefiLlama | TVL metrics | No admin monitoring |
| **Sentinel** | **Governance + human layer** | **Would have flagged timelock removal 5 days before** |

## Architecture

```
┌─────────────────────────────────────┐
│      React Frontend (Vercel)        │
│  Wallet Scanner / Trust Scores      │
│  Dashboard / Alerts / Hack Replay   │
└──────────────┬──────────────────────┘
               │ WebSocket + REST
┌──────────────▼──────────────────────┐
│      Node.js Backend (VPS)          │
│  Express API + WS Server            │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Anomaly Detection Engine   │    │
│  │  • Governance Monitor       │    │
│  │  • Oracle TWAP Tracker      │    │
│  │  • TVL Crash Detector       │    │
│  │  • Funding Rate Signals     │    │
│  │  • Cascade Risk Scorer      │    │
│  │  • Wallet Scanner           │    │
│  │  • Telegram Alert Bot       │    │
│  └─────────────────────────────┘    │
└──────┬─────┬──────┬─────┬───────────┘
       │     │      │     │
┌──────▼┐ ┌──▼───┐ ┌▼────┐ ┌▼──────┐
│ Pyth  │ │DeFi  │ │Helius│ │Binance│
│Network│ │Llama │ │ RPC  │ │Bybit  │
│Oracles│ │ TVL  │ │Solana│ │CEX API│
└───────┘ └──────┘ └─────┘ └───────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite |
| Backend | Node.js, TypeScript, Express, WebSocket |
| Blockchain | Solana Web3.js, Helius RPC |
| Oracles | Pyth Network Hermes API |
| TVL Data | DefiLlama API |
| CEX Data | Binance + Bybit Futures API |
| Alerts | Telegram Bot API |
| Infra | PM2, Nginx, Vercel |

## Protocols Monitored

| Protocol | Type | Trust Score | Status |
|----------|------|-------------|--------|
| Jupiter Lend | Lending | 92/100 (Excellent) | Active |
| Kamino Finance | Lending | 88/100 (Excellent) | Active |
| Solend | Lending | 75/100 (Good) | Active |
| MarginFi | Lending | 72/100 (Good) | Active |
| Drift Protocol | Perp DEX | 8/100 (Critical) | Frozen |

## Real Alerts Detected

These events were caught by Sentinel's live monitoring:

- **Apr 19:** JUP/USD oracle deviated -5.17% from TWAP (Critical)
- **Apr 17:** Jupiter Lend TVL dropped 8.5% in 1 hour (High)

## Business Model

1. **Governance-as-a-Service** — Protocols pay for continuous governance monitoring and trust score certification
2. **Premium Wallet Scanner** — Subscription for institutional traders wanting personalized exposure reports
3. **Alert API** — Webhook/Telegram/Discord alerts for protocols monitoring ecosystem governance health

## Local Setup

### Backend

```bash
cd backend
cp ../.env.example ../.env  # Add your Helius API key
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend automatically falls back to demo mode with real cached data when the backend is unreachable.

## Roadmap

- [x] Governance trust scores for 5 Solana protocols
- [x] Wallet risk scanner with protocol exposure mapping
- [x] Real-time Pyth oracle monitoring with TWAP deviation detection
- [x] TVL crash detection across protocols
- [x] CEX funding rate signals
- [x] Cascade risk scoring engine
- [x] Drift hack replay timeline
- [x] Telegram alert bot
- [ ] On-chain governance change detection via account subscriptions
- [ ] Durable nonce watchdog for protocol admin wallets
- [ ] Historical governance change log with timeline visualization
- [ ] Discord bot integration
- [ ] Additional protocols: Flash Trade, Zeta Markets, Mango Markets
- [ ] Automated trust score updates based on live governance data

## Team

**@Makabeez** — Solo founder. Managing Director background in air logistics, transitioned to DeFi development. Built The Scavenger (Polymarket liquidation bot), Frontier Overwatch (Sui/EVE intelligence dashboard), and ARCA (CI/CD security agent). Sentinel combines trading bot architecture with on-chain intelligence to solve the governance security gap exposed by the Drift hack.

## License

MIT

---

*The next $285M exploit won't be a smart contract bug — it'll be another governance failure. Sentinel watches the humans so you don't have to.*
