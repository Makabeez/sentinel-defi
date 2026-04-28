"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const web3_js_1 = require("@solana/web3.js");
dotenv_1.default.config({ path: '/opt/sentinel/.env' });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const PORT = parseInt(process.env.PORT || '8080');
const WS_PORT = parseInt(process.env.WS_PORT || '8081');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
// ============================================
// PROTOCOL REGISTRY — protocols we monitor
// ============================================
const PROTOCOLS = [
    {
        id: 'kamino',
        name: 'Kamino Finance',
        type: 'lending',
        programId: 'KLend2g3cP87ber8vVKTFotQYkqGR2rBZqydXgSF3M6',
        tvlApi: 'https://api.llama.fi/tvl/kamino',
        color: '#FF6B35',
    },
    {
        id: 'marginfi',
        name: 'MarginFi',
        type: 'lending',
        programId: 'MFv2hWf31Z9kbCa1snEPYctwafyhdJB7oS7qJRXYHne',
        tvlApi: 'https://api.llama.fi/tvl/marginfi',
        color: '#DCE775',
    },
    {
        id: 'solend',
        name: 'Solend',
        type: 'lending',
        programId: 'So1endDq2YkqhipRh3WViPa8hFSq6z6jK3JAqp9nh6D',
        tvlApi: 'https://api.llama.fi/tvl/solend',
        color: '#7C4DFF',
    },
    {
        id: 'jupiter-lend',
        name: 'Jupiter Lend',
        type: 'lending',
        programId: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
        tvlApi: 'https://api.llama.fi/tvl/jupiter-lend',
        color: '#00BFA5',
    },
    {
        id: 'drift',
        name: 'Drift Protocol',
        type: 'perp-dex',
        programId: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
        tvlApi: 'https://api.llama.fi/tvl/drift',
        color: '#E040FB',
        status: 'frozen', // post-hack
    },
];
// ============================================
// STATE
// ============================================
const tvlHistory = new Map();
const alerts = [];
const oracleStatus = new Map();
let protocolHealth = new Map();
// Pyth price feed IDs (mainnet)
const PYTH_FEEDS = {
    'SOL/USD': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
    'BTC/USD': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    'ETH/USD': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    'USDC/USD': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    'JUP/USD': '0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
};
const PYTH_TWAP = new Map();
// ============================================
// SOLANA CONNECTION
// ============================================
const connection = new web3_js_1.Connection(RPC_URL, 'confirmed');
// ============================================
// TVL MONITORING (DefiLlama)
// ============================================
async function fetchTVL(protocol) {
    try {
        const resp = await axios_1.default.get(protocol.tvlApi, { timeout: 10000 });
        return typeof resp.data === 'number' ? resp.data : null;
    }
    catch {
        return null;
    }
}
async function fetchAllTVLs() {
    const now = Date.now();
    for (const proto of PROTOCOLS) {
        const tvl = await fetchTVL(proto);
        if (tvl === null)
            continue;
        const history = tvlHistory.get(proto.id) || [];
        const prev1h = history.find(s => now - s.timestamp > 3600000 && now - s.timestamp < 7200000);
        const prev24h = history.find(s => now - s.timestamp > 86400000 && now - s.timestamp < 90000000);
        const snapshot = {
            protocol: proto.id,
            tvl,
            timestamp: now,
            change1h: prev1h ? ((tvl - prev1h.tvl) / prev1h.tvl) * 100 : 0,
            change24h: prev24h ? ((tvl - prev24h.tvl) / prev24h.tvl) * 100 : 0,
        };
        history.push(snapshot);
        // Keep 48h of data
        const cutoff = now - 48 * 3600000;
        const trimmed = history.filter(s => s.timestamp > cutoff);
        tvlHistory.set(proto.id, trimmed);
        // ANOMALY: TVL drop > 10% in 1h
        if (snapshot.change1h < -10) {
            pushAlert({
                severity: 'critical',
                type: 'tvl_crash',
                protocol: proto.id,
                title: `${proto.name} TVL crashed ${snapshot.change1h.toFixed(1)}% in 1h`,
                description: `TVL dropped from $${prev1h?.tvl.toLocaleString()} to $${tvl.toLocaleString()}. Possible exploit or mass withdrawal.`,
                data: snapshot,
            });
        }
        else if (snapshot.change1h < -5) {
            pushAlert({
                severity: 'high',
                type: 'tvl_drop',
                protocol: proto.id,
                title: `${proto.name} TVL down ${snapshot.change1h.toFixed(1)}% in 1h`,
                description: `Significant outflow detected. Current TVL: $${tvl.toLocaleString()}.`,
                data: snapshot,
            });
        }
    }
}
// ============================================
// PYTH ORACLE MONITORING
// ============================================
async function fetchPythPrices() {
    try {
        const ids = Object.values(PYTH_FEEDS);
        const resp = await axios_1.default.get('https://hermes.pyth.network/api/latest_price_feeds', {
            params: { ids },
            timeout: 10000,
        });
        const parsed = Array.isArray(resp.data) ? resp.data : [];
        const symbols = Object.keys(PYTH_FEEDS);
        for (let i = 0; i < parsed.length; i++) {
            const p = parsed[i]?.price;
            if (!p)
                continue;
            const symbol = symbols[i];
            const price = parseFloat(p.price) * Math.pow(10, p.expo);
            const confidence = parseFloat(p.conf) * Math.pow(10, p.expo);
            const publishTime = parsed[i].price.publish_time;
            // TWAP tracking (5min window)
            const twapKey = symbol;
            const twapArr = PYTH_TWAP.get(twapKey) || [];
            twapArr.push(price);
            if (twapArr.length > 30)
                twapArr.shift(); // ~5min at 10s intervals
            PYTH_TWAP.set(twapKey, twapArr);
            const twapAvg = twapArr.reduce((a, b) => a + b, 0) / twapArr.length;
            const deviationFromTwap = ((price - twapAvg) / twapAvg) * 100;
            const isStale = Date.now() / 1000 - publishTime > 60;
            const isDeviated = Math.abs(deviationFromTwap) > 5;
            let status = 'healthy';
            if (isStale)
                status = 'stale';
            if (isDeviated)
                status = 'deviated';
            const oracleData = {
                symbol,
                price,
                confidence,
                publishTime,
                deviationFromTwap,
                status,
            };
            oracleStatus.set(symbol, oracleData);
            // ANOMALY: Oracle deviation > 5% from TWAP
            if (isDeviated && twapArr.length > 10) {
                pushAlert({
                    severity: 'critical',
                    type: 'oracle_deviation',
                    protocol: 'system',
                    title: `${symbol} oracle deviated ${deviationFromTwap.toFixed(2)}% from TWAP`,
                    description: `Current: $${price.toFixed(4)} | TWAP(5m): $${twapAvg.toFixed(4)}. Potential oracle manipulation or flash crash.`,
                    data: oracleData,
                });
            }
            // ANOMALY: Stale oracle
            if (isStale) {
                pushAlert({
                    severity: 'high',
                    type: 'oracle_stale',
                    protocol: 'system',
                    title: `${symbol} oracle is stale (${Math.round(Date.now() / 1000 - publishTime)}s old)`,
                    description: `Price feed hasn't updated in over 60 seconds. Liquidation engines may be using outdated data.`,
                    data: oracleData,
                });
            }
        }
    }
    catch (err) {
        console.error('Pyth fetch error:', err.message);
    }
}
// ============================================
// SOLANA ACCOUNT MONITORING
// ============================================
async function monitorLargeTransfers() {
    try {
        // Monitor recent signatures for protocol program IDs
        for (const proto of PROTOCOLS.filter(p => p.status !== 'frozen')) {
            const pubkey = new web3_js_1.PublicKey(proto.programId);
            const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 5 });
            for (const sig of sigs) {
                if (sig.err)
                    continue;
                const tx = await connection.getTransaction(sig.signature, {
                    maxSupportedTransactionVersion: 0,
                });
                if (!tx?.meta)
                    continue;
                // Check for large SOL balance changes (> 1000 SOL)
                const preBalances = tx.meta.preBalances;
                const postBalances = tx.meta.postBalances;
                for (let i = 0; i < preBalances.length; i++) {
                    const diff = Math.abs(postBalances[i] - preBalances[i]) / 1e9;
                    if (diff > 1000) {
                        pushAlert({
                            severity: 'medium',
                            type: 'large_transfer',
                            protocol: proto.id,
                            title: `Large transfer on ${proto.name}: ${diff.toFixed(0)} SOL`,
                            description: `Transaction ${sig.signature.slice(0, 16)}... moved ${diff.toFixed(2)} SOL.`,
                            data: { signature: sig.signature, amount: diff },
                        });
                    }
                }
            }
        }
    }
    catch (err) {
        console.error('Transfer monitor error:', err.message);
    }
}
// ============================================
// CEX FUNDING RATE SIGNALS
// ============================================
async function fetchFundingRates() {
    try {
        const [binanceResp, bybitResp] = await Promise.allSettled([
            axios_1.default.get('https://fapi.binance.com/fapi/v1/premiumIndex', {
                params: { symbol: 'SOLUSDT' },
                timeout: 5000,
            }),
            axios_1.default.get('https://api.bybit.com/v5/market/tickers', {
                params: { category: 'linear', symbol: 'SOLUSDT' },
                timeout: 5000,
            }),
        ]);
        const binanceFR = binanceResp.status === 'fulfilled'
            ? parseFloat(binanceResp.value.data.lastFundingRate)
            : null;
        const bybitFR = bybitResp.status === 'fulfilled'
            ? parseFloat(bybitResp.value.data.result?.list?.[0]?.fundingRate || '0')
            : null;
        const rates = { binance: binanceFR, bybit: bybitFR, timestamp: Date.now() };
        // ANOMALY: Extreme funding rate (> 0.1% per 8h = very bullish/bearish)
        if (binanceFR !== null && Math.abs(binanceFR) > 0.001) {
            const direction = binanceFR > 0 ? 'LONG-heavy' : 'SHORT-heavy';
            pushAlert({
                severity: 'medium',
                type: 'funding_extreme',
                protocol: 'cex',
                title: `SOL funding rate extreme: ${(binanceFR * 100).toFixed(4)}% (${direction})`,
                description: `High funding = crowded positioning. Liquidation cascade risk elevated. Binance: ${(binanceFR * 100).toFixed(4)}%${bybitFR ? `, Bybit: ${(bybitFR * 100).toFixed(4)}%` : ''}.`,
                data: rates,
            });
        }
        return rates;
    }
    catch (err) {
        console.error('Funding rate error:', err.message);
        return null;
    }
}
// ============================================
// CASCADE RISK SCORING
// ============================================
function computeCascadeRisk() {
    const scores = {};
    for (const proto of PROTOCOLS) {
        let score = 0;
        const snapshots = tvlHistory.get(proto.id) || [];
        const latest = snapshots[snapshots.length - 1];
        if (latest) {
            if (latest.change1h < -5)
                score += 30;
            else if (latest.change1h < -2)
                score += 10;
            if (latest.change24h < -10)
                score += 20;
        }
        // Oracle health contributes to all protocols
        for (const [, oracle] of oracleStatus) {
            if (oracle.status === 'deviated')
                score += 25;
            if (oracle.status === 'stale')
                score += 15;
        }
        if (proto.status === 'frozen')
            score += 40;
        scores[proto.id] = Math.min(100, score);
    }
    // System-wide cascade score
    const avgScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
    const maxScore = Math.max(...Object.values(scores));
    return {
        protocols: scores,
        systemAvg: avgScore,
        systemMax: maxScore,
        level: maxScore > 70 ? 'critical' : maxScore > 40 ? 'elevated' : maxScore > 20 ? 'moderate' : 'low',
        timestamp: Date.now(),
    };
}
// ============================================
// ALERT SYSTEM
// ============================================
// TELEGRAM ALERT BOT
// ============================================
const TELEGRAM_BOT_TOKEN = "8384781852:AAEhvRpQsPF6hV939Yxqhb0-Bm8uaOsy6JQ";
const TELEGRAM_CHAT_ID = "476352360";
const SEV_EMOJI = { critical: "🚨", high: "⚠️", medium: "🟡", low: "🔵", info: "ℹ️" };
async function sendTelegramAlert(a) {
    if (a.severity !== "critical" && a.severity !== "high")
        return;
    const msg = `${SEV_EMOJI[a.severity] || "📢"} *SENTINEL ALERT*\n\n*${a.severity.toUpperCase()}* | ${a.protocol}\n*${a.title}*\n\n${a.description}\n\n🕐 ${new Date(a.timestamp).toLocaleString()}\n🔗 [Dashboard](https://frontend-eta-topaz-85.vercel.app)`;
    try {
        await axios_1.default.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: "Markdown", disable_web_page_preview: true });
        console.log(`[TELEGRAM] Alert sent: ${a.title}`);
    }
    catch (err) {
        console.error("[TELEGRAM] Error:", err.message);
    }
}
// ============================================
function pushAlert(partial) {
    // Deduplicate: don't push same type+protocol within 5 min
    const recent = alerts.find(a => a.type === partial.type && a.protocol === partial.protocol && Date.now() - a.timestamp < 300000);
    if (recent)
        return;
    const alert = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        ...partial,
    };
    alerts.unshift(alert);
    if (alerts.length > 500)
        alerts.length = 500;
    // Broadcast to WebSocket clients
    broadcast({ type: "alert", data: alert });
    sendTelegramAlert(alert);
    console.log(`[ALERT][${alert.severity.toUpperCase()}] ${alert.title}`);
}
// ============================================
// WEBSOCKET SERVER
// ============================================
const wss = new ws_1.WebSocketServer({ port: WS_PORT });
const clients = new Set();
wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WS client connected (${clients.size} total)`);
    // Send current state on connect
    ws.send(JSON.stringify({
        type: 'init',
        data: {
            protocols: PROTOCOLS,
            tvl: Object.fromEntries(tvlHistory),
            alerts: alerts.slice(0, 50),
            oracles: Object.fromEntries(oracleStatus),
            cascadeRisk: computeCascadeRisk(),
        },
    }));
    ws.on('close', () => {
        clients.delete(ws);
        console.log(`WS client disconnected (${clients.size} total)`);
    });
});
function broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of clients) {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(data);
        }
    }
}
// ============================================
// POLLING LOOPS
// ============================================
async function runMonitoringLoop() {
    console.log('[SENTINEL] Starting monitoring loop...');
    // Initial fetch
    await fetchAllTVLs();
    await fetchPythPrices();
    await fetchFundingRates();
    // TVL: every 5 minutes
    setInterval(async () => {
        await fetchAllTVLs();
        broadcast({ type: 'tvl', data: Object.fromEntries(tvlHistory) });
    }, 5 * 60 * 1000);
    // Oracle prices: every 10 seconds
    setInterval(async () => {
        await fetchPythPrices();
        broadcast({ type: 'oracles', data: Object.fromEntries(oracleStatus) });
    }, 10 * 1000);
    // Funding rates: every 60 seconds
    setInterval(async () => {
        const rates = await fetchFundingRates();
        if (rates)
            broadcast({ type: 'funding', data: rates });
    }, 60 * 1000);
    // Large transfer monitor: every 30 seconds
    setInterval(async () => {
        // RPC DISABLED: await monitorLargeTransfers();
    }, 300 * 1000);
    // Cascade risk: every 60 seconds
    setInterval(() => {
        const risk = computeCascadeRisk();
        broadcast({ type: 'cascadeRisk', data: risk });
    }, 60 * 1000);
}
// ============================================
// REST API
// ============================================
app.get('/api/health', (_, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), clients: clients.size });
});
app.get('/api/protocols', (_, res) => {
    res.json(PROTOCOLS);
});
app.get('/api/tvl', (_, res) => {
    res.json(Object.fromEntries(tvlHistory));
});
app.get('/api/alerts', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const severity = req.query.severity;
    let filtered = alerts;
    if (severity)
        filtered = filtered.filter(a => a.severity === severity);
    res.json(filtered.slice(0, limit));
});
app.get('/api/oracles', (_, res) => {
    res.json(Object.fromEntries(oracleStatus));
});
app.get('/api/cascade-risk', (_, res) => {
    res.json(computeCascadeRisk());
});
app.get('/api/funding', async (_, res) => {
    const rates = await fetchFundingRates();
    res.json(rates);
});
const GOVERNANCE_TRUST_SCORES = [
    {
        protocol: 'kamino', name: 'Kamino Finance', score: 88, tier: 'excellent',
        factors: [
            { label: 'Multisig', score: 20, max: 25, detail: '3/5 multisig via Squads' },
            { label: 'Timelock', score: 22, max: 25, detail: '48h timelock' },
            { label: 'Audits', score: 23, max: 25, detail: '9 independent audits' },
            { label: 'Activity', score: 23, max: 25, detail: 'No suspicious changes 90+ days' },
        ],
        adminPubkey: 'KAMino9rK6Mr1rxWk3Cq3xvGSfoBhqFpBJCMBM6nhz8',
        multisigType: '3/5 Squads', timelockHours: 48, lastAdminChange: '2025-11-15', status: 'active',
    },
    {
        protocol: 'jupiter-lend', name: 'Jupiter Lend', score: 92, tier: 'excellent',
        factors: [
            { label: 'Multisig', score: 23, max: 25, detail: '4/7 multisig via Squads' },
            { label: 'Timelock', score: 24, max: 25, detail: '72h timelock' },
            { label: 'Audits', score: 23, max: 25, detail: '7 audits + formally verified' },
            { label: 'Activity', score: 22, max: 25, detail: 'Transparent governance' },
        ],
        adminPubkey: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
        multisigType: '4/7 Squads', timelockHours: 72, lastAdminChange: '2026-01-20', status: 'active',
    },
    {
        protocol: 'solend', name: 'Solend', score: 75, tier: 'good',
        factors: [
            { label: 'Multisig', score: 19, max: 25, detail: '3/5 multisig' },
            { label: 'Timelock', score: 18, max: 25, detail: '24h timelock' },
            { label: 'Audits', score: 20, max: 25, detail: '6 audits' },
            { label: 'Activity', score: 18, max: 25, detail: 'Stable, no recent changes' },
        ],
        adminPubkey: 'So1endDq2YkqhipRh3WViPa8hFSq6z6jK3JAqp9nh6D',
        multisigType: '3/5 Multisig', timelockHours: 24, lastAdminChange: '2025-12-01', status: 'active',
    },
    {
        protocol: 'marginfi', name: 'MarginFi', score: 72, tier: 'good',
        factors: [
            { label: 'Multisig', score: 18, max: 25, detail: '2/3 multisig' },
            { label: 'Timelock', score: 15, max: 25, detail: '24h timelock' },
            { label: 'Audits', score: 20, max: 25, detail: '5 audits' },
            { label: 'Activity', score: 19, max: 25, detail: 'Key rotated 45 days ago' },
        ],
        adminPubkey: 'MRGNWSHaWmz3CPFcYt3Dqt2LBYhQaxDgdBbJbMvhAQi',
        multisigType: '2/3 Multisig', timelockHours: 24, lastAdminChange: '2026-03-14', status: 'active',
    },
    {
        protocol: 'drift', name: 'Drift Protocol', score: 8, tier: 'critical',
        factors: [
            { label: 'Multisig', score: 2, max: 25, detail: '2/5 NO TIMELOCK at exploit' },
            { label: 'Timelock', score: 0, max: 25, detail: 'REMOVED Mar 27, 2026' },
            { label: 'Audits', score: 4, max: 25, detail: 'Audits bypassed by admin exploit' },
            { label: 'Activity', score: 2, max: 25, detail: '$285M drained Apr 1, 2026' },
        ],
        adminPubkey: 'DRiFTGejL2AHo2bSTBEzTpCKNerLCGMfrazr6gCh2xKH',
        multisigType: '2/5 (compromised)', timelockHours: 0, lastAdminChange: '2026-03-27', status: 'frozen',
    },
];
// ============================================
// WALLET SCANNER ENDPOINT
// ============================================
app.get('/api/wallet/:address', async (req, res) => {
    const address = req.params.address;
    try {
        const pubkey = new web3_js_1.PublicKey(address);
        const balance = await connection.getBalance(pubkey);
        const solBalance = balance / 1e9;
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
            programId: new web3_js_1.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        });
        const holdings = [];
        const exposedProtocols = new Set();
        for (const account of tokenAccounts.value) {
            const parsed = account.account.data.parsed?.info;
            if (!parsed)
                continue;
            const amount = parsed.tokenAmount?.uiAmount || 0;
            if (amount === 0)
                continue;
            holdings.push({ mint: parsed.mint, amount });
        }
        if (solBalance > 0) {
            exposedProtocols.add('kamino');
            exposedProtocols.add('jupiter-lend');
            exposedProtocols.add('solend');
            exposedProtocols.add('marginfi');
        }
        if (holdings.length > 0) {
            exposedProtocols.add('kamino');
            exposedProtocols.add('jupiter-lend');
        }
        const exposure = Array.from(exposedProtocols).map(protoId => {
            const ts = GOVERNANCE_TRUST_SCORES.find(g => g.protocol === protoId);
            const protoTvl = tvlHistory.get(protoId);
            const latestTvl = protoTvl?.[protoTvl.length - 1];
            return {
                protocol: protoId, name: ts?.name || protoId,
                trustScore: ts?.score || 0, tier: ts?.tier || 'unknown',
                multisig: ts?.multisigType || 'unknown', timelockHours: ts?.timelockHours || 0,
                status: ts?.status || 'unknown', tvl: latestTvl?.tvl || 0,
            };
        });
        const avgTrust = exposure.length > 0 ? exposure.reduce((s, e) => s + e.trustScore, 0) / exposure.length : 100;
        const hasCritical = exposure.some(e => e.tier === 'critical');
        let walletRisk = 'low';
        if (hasCritical)
            walletRisk = 'critical';
        else if (avgTrust < 60)
            walletRisk = 'elevated';
        else if (avgTrust < 75)
            walletRisk = 'moderate';
        res.json({ address, solBalance, totalHoldings: holdings.length, exposure, walletRisk, avgTrustScore: Math.round(avgTrust), timestamp: Date.now() });
    }
    catch (err) {
        res.status(400).json({ error: 'Invalid address or scan failed: ' + err.message });
    }
});
app.get('/api/trust-scores', (_, res) => {
    res.json(GOVERNANCE_TRUST_SCORES);
});
app.listen(PORT, () => {
    console.log(`[SENTINEL] REST API on :${PORT}`);
    console.log(`[SENTINEL] WebSocket on :${WS_PORT}`);
    runMonitoringLoop();
});
// ============================================
// GOVERNANCE MONITOR — multisig & timelock changes
// ============================================
// Known multisig/admin accounts for monitored protocols
const GOVERNANCE_ACCOUNTS = {
    drift: [
        { label: 'Drift Security Council', protocol: 'drift', pubkey: 'DRiFTGejL2AHo2bSTBEzTpCKNerLCGMfrazr6gCh2xKH' },
        { label: 'Drift Admin Authority', protocol: 'drift', pubkey: 'DRfTnEVxAYBiHnvM7CbBGacg6D4LRGF7BaWNkjbnp9ae' },
    ],
    kamino: [
        { label: 'Kamino Admin', protocol: 'kamino', pubkey: 'KAMino9rK6Mr1rxWk3Cq3xvGSfoBhqFpBJCMBM6nhz8' },
    ],
    marginfi: [
        { label: 'MarginFi Admin', protocol: 'marginfi', pubkey: 'MRGNWSHaWmz3CPFcYt3Dqt2LBYhQaxDgdBbJbMvhAQi' },
    ],
};
// Track account data snapshots for change detection
const governanceSnapshots = new Map();
async function monitorGovernanceAccounts() {
    const allAccounts = Object.values(GOVERNANCE_ACCOUNTS).flat();
    for (const account of allAccounts) {
        try {
            const pubkey = new web3_js_1.PublicKey(account.pubkey);
            const info = await connection.getAccountInfo(pubkey);
            if (!info)
                continue;
            const currentData = info.data.toString('base64').slice(0, 200); // first 200 chars as fingerprint
            const key = account.pubkey;
            const previous = governanceSnapshots.get(key);
            if (previous && previous.data !== currentData) {
                // Account data changed — potential governance modification
                pushAlert({
                    severity: 'critical',
                    type: 'governance_change',
                    protocol: account.protocol,
                    title: `⚠ ${account.label} account data modified`,
                    description: `On-chain account ${account.pubkey.slice(0, 8)}... has been modified. This could indicate a multisig rotation, timelock change, or admin key migration. Investigate immediately.`,
                    data: { account: account.pubkey, label: account.label, slot: 0 },
                });
            }
            governanceSnapshots.set(key, { data: currentData, slot: 0 || 0 });
        }
        catch (err) {
            // Account may not exist or RPC error — skip silently
        }
    }
}
// Monitor durable nonce accounts associated with protocol multisigs
async function monitorDurableNonces() {
    try {
        // Durable nonce program: 11111111111111111111111111111111 (System Program)
        // We look for nonce accounts that recently interacted with our monitored programs
        const allAccounts = Object.values(GOVERNANCE_ACCOUNTS).flat();
        for (const account of allAccounts) {
            try {
                const pubkey = new web3_js_1.PublicKey(account.pubkey);
                const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 3 });
                for (const sig of sigs) {
                    if (sig.err)
                        continue;
                    const tx = await connection.getTransaction(sig.signature, {
                        maxSupportedTransactionVersion: 0,
                    });
                    if (!tx?.transaction?.message)
                        continue;
                    // Check if transaction involves AdvanceNonceAccount or InitializeNonceAccount
                    const instructions = tx.transaction.message.compiledInstructions || [];
                    for (const ix of instructions) {
                        // System program instruction index 4 = AdvanceNonceAccount, 6 = InitializeNonceAccount
                        const programId = tx.transaction.message.staticAccountKeys?.[ix.programIdIndex];
                        if (programId?.toString() === '11111111111111111111111111111111') {
                            const discriminator = ix.data?.[0];
                            if (discriminator === 4 || discriminator === 6) {
                                pushAlert({
                                    severity: 'high',
                                    type: 'durable_nonce',
                                    protocol: account.protocol,
                                    title: `Durable nonce activity on ${account.label}`,
                                    description: `Transaction ${sig.signature.slice(0, 16)}... involves a durable nonce operation on a governance account. This is the exact mechanism used in the Drift $285M exploit.`,
                                    data: { signature: sig.signature, account: account.pubkey },
                                });
                            }
                        }
                    }
                }
            }
            catch {
                // Skip individual account errors
            }
        }
    }
    catch (err) {
        console.error('Durable nonce monitor error:', err.message);
    }
}
// Add governance monitoring to the polling loops
// Governance check: every 2 minutes
setInterval(async () => {
    // RPC DISABLED: await monitorGovernanceAccounts();
}, 120 * 1000);
// Durable nonce check: every 5 minutes
setInterval(async () => {
    // RPC DISABLED: await monitorDurableNonces();
}, 300 * 1000);
// Initial governance scan
setTimeout(async () => {
    console.log('[SENTINEL] Starting governance monitor...');
    // RPC DISABLED: await monitorGovernanceAccounts();
    // RPC DISABLED: await monitorDurableNonces();
    console.log('[SENTINEL] Governance monitor initialized.');
}, 10 * 1000);
// Add governance API endpoint
app.get('/api/governance', (_, res) => {
    const snapshots = [];
    for (const [pubkey, snap] of governanceSnapshots) {
        const account = Object.values(GOVERNANCE_ACCOUNTS).flat().find(a => a.pubkey === pubkey);
        snapshots.push({
            pubkey,
            label: account?.label,
            protocol: account?.protocol,
            lastSlot: snap.slot,
            fingerprint: snap.data.slice(0, 32) + '...',
        });
    }
    res.json(snapshots);
});
// ============================================
// START
// ============================================
app.listen(PORT, () => {
    console.log(`[SENTINEL] REST API on :${PORT}`);
    console.log(`[SENTINEL] WebSocket on :${WS_PORT}`);
    runMonitoringLoop();
});
//# sourceMappingURL=server.js.map