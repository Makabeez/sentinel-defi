# Sentinel — Solana DeFi Security Intelligence Platform

> Real-time cross-protocol risk monitoring, anomaly detection, and liquidation cascade prediction for Solana DeFi.

**Live Demo:** [https://frontend-eta-topaz-85.vercel.app](https://frontend-eta-topaz-85.vercel.app)
**Hackathon:** Solana Frontier (Colosseum) — April 6 – May 11, 2026

---

## The Problem

On April 1, 2026, Drift Protocol was exploited for **$285 million** — the largest DeFi hack of the year and the second-largest in Solana history. The attack was staged over **3 weeks** with multiple on-chain signals visible before execution:

- **Mar 11:** Attacker wallet funded via Tornado Cash
- **Mar 27:** Security Council timelock **removed** (multisig changed from 3/5 to 2/5 with zero timelock)
- **Mar 28:** Durable nonce transactions pre-signed and left dormant
- **Apr 1:** $285M drained in 12 minutes. 12+ protocols affected by cascade.

**No tool existed to detect these signals in real-time across protocols.**

Existing solutions (DefiLlama, CoinGlass, block explorers) are fragmented — they monitor individual metrics but don't correlate cross-protocol risk or detect governance-level attack vectors.

## The Solution

Sentinel is a **protocol-agnostic DeFi security intelligence platform** that monitors the Solana ecosystem in real-time across three layers:

### 1. Risk Radar Dashboard
Cross-protocol monitoring of TVL movements, oracle health, and funding rate divergences across Kamino, MarginFi, Solend, Jupiter Lend, and Drift.

### 2. Anomaly Detection Engine
Automated detection of:
- **TVL crashes** (>5% drop in 1 hour triggers alert)
- **Oracle deviations** (>5% from 5-minute TWAP — the exact vector used in the Drift exploit via fake CVT token)
- **Stale oracle feeds** (>60 seconds without update)
- **Extreme funding rates** (crowded positioning = liquidation cascade risk)
- **Large on-chain transfers** (>1000 SOL movements on protocol accounts)

### 3. Cascade Risk Scoring
Composite risk score per protocol combining TVL trends, oracle health, funding rate stress, and protocol status. System-wide cascade level: Low → Moderate → Elevated → Critical.

## Drift Hack Replay

Sentinel includes an interactive timeline reconstruction showing **exactly what would have been detected** before and during the Drift exploit. This demonstrates the platform's value proposition with a real-world $285M case study.

## Architecture

```
┌─────────────────────────────────┐
│     React Frontend (Vercel)     │
│  Dashboard / Alerts / Oracles   │
│  Drift Hack Replay Timeline     │
└──────────────┬──────────────────┘
               │ WebSocket + REST
┌──────────────▼──────────────────┐
│     Node.js Backend (VPS)       │
│  Express API + WS Server        │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Anomaly Detection Engine │  │
│  │  • TVL Monitor            │  │
│  │  • Oracle TWAP Tracker    │  │
│  │  • Funding Rate Signals   │  │
│  │  • Transfer Scanner       │  │
│  │  • Cascade Risk Scorer    │  │
│  └───────────────────────────┘  │
└──────┬─────┬──────┬─────┬───────┘
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
| Frontend | React 18, Vite, Recharts |
| Backend | Node.js, TypeScript, Express, WebSocket |
| Blockchain | Solana Web3.js, Helius RPC |
| Oracles | Pyth Network Hermes API |
| TVL Data | DefiLlama API |
| CEX Data | Binance + Bybit Futures API |
| Infra | PM2, Nginx, Vercel |

## Business Model

1. **Keeper Fees** — Automated liquidation execution on Solana lending protocols (protocol-native revenue)
2. **Premium Analytics** — Subscription tier for institutional traders wanting real-time cross-protocol risk intelligence
3. **Alert API** — Webhook/Telegram/Discord alerts for DeFi protocols wanting to monitor their ecosystem exposure

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

## Protocols Monitored

| Protocol | Type | Status |
|----------|------|--------|
| Kamino Finance | Lending | Active |
| MarginFi | Lending | Active |
| Solend | Lending | Active |
| Jupiter Lend | Lending | Active |
| Drift Protocol | Perp DEX | Frozen (post-exploit) |

## Roadmap

- [ ] Governance monitor (multisig changes, timelock modifications)
- [ ] Durable nonce account tracking for protocol admin wallets
- [ ] Telegram/Discord alert bot
- [ ] Historical risk data and backtesting
- [ ] Additional protocols: Flash Trade, Zeta Markets, Mango Markets
- [ ] Keeper bot integration for automated liquidation execution

## Team

**@Makabeez** — Solo builder. Background in DeFi trading bots, on-chain intelligence dashboards, and cross-protocol analytics. Previous hackathon projects: Frontier Overwatch (EVE Frontier/Sui), The Scavenger (Polymarket liquidation bot), ARCA (CI/CD security agent).

## License

MIT

---

*Built for the Solana Frontier Hackathon 2026. Sentinel exists because the next $285M exploit shouldn't catch the ecosystem off guard.*
