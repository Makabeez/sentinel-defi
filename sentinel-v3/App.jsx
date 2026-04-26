import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8081';

// ============================================
// EMBEDDED DEMO DATA (real snapshots)
// ============================================
const DEMO_PROTOCOLS = [
  { id: 'kamino', name: 'Kamino Finance', type: 'lending', programId: 'KLend2g3cP87ber8vVKTFotQYkqGR2rBZqydXgSF3M6', color: '#FF6B35' },
  { id: 'marginfi', name: 'MarginFi', type: 'lending', programId: 'MFv2hWf31Z9kbCa1snEPYctwafyhdJB7oS7qJRXYHne', color: '#DCE775' },
  { id: 'solend', name: 'Solend', type: 'lending', programId: 'So1endDq2YkqhipRh3WViPa8hFSq6z6jK3JAqp9nh6D', color: '#7C4DFF' },
  { id: 'jupiter-lend', name: 'Jupiter Lend', type: 'lending', programId: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', color: '#00BFA5' },
  { id: 'drift', name: 'Drift Protocol', type: 'perp-dex', programId: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH', color: '#E040FB', status: 'frozen' },
];

const DEMO_TVL = {
  kamino: [{ protocol: 'kamino', tvl: 1827600000, timestamp: Date.now(), change1h: 0.12, change24h: -1.3 }],
  marginfi: [{ protocol: 'marginfi', tvl: 46700000, timestamp: Date.now(), change1h: -0.08, change24h: -2.1 }],
  solend: [{ protocol: 'solend', tvl: 72400000, timestamp: Date.now(), change1h: 0.05, change24h: 0.4 }],
  'jupiter-lend': [{ protocol: 'jupiter-lend', tvl: 939900000, timestamp: Date.now(), change1h: 0.22, change24h: 1.1 }],
  drift: [{ protocol: 'drift', tvl: 238000000, timestamp: Date.now(), change1h: 0.0, change24h: 0.0 }],
};

const DEMO_ORACLES = {
  'SOL/USD': { symbol: 'SOL/USD', price: 84.67, confidence: 0.062, publishTime: Date.now() / 1000, deviationFromTwap: -0.018, status: 'healthy' },
  'BTC/USD': { symbol: 'BTC/USD', price: 74415.00, confidence: 21.72, publishTime: Date.now() / 1000, deviationFromTwap: 0.004, status: 'healthy' },
  'ETH/USD': { symbol: 'ETH/USD', price: 2276.42, confidence: 1.19, publishTime: Date.now() / 1000, deviationFromTwap: -0.007, status: 'healthy' },
  'USDC/USD': { symbol: 'USDC/USD', price: 0.9998, confidence: 0.0005, publishTime: Date.now() / 1000, deviationFromTwap: -0.001, status: 'healthy' },
  'JUP/USD': { symbol: 'JUP/USD', price: 0.17, confidence: 0.0002, publishTime: Date.now() / 1000, deviationFromTwap: -0.09, status: 'healthy' },
};

const DEMO_RISK = {
  protocols: { kamino: 0, marginfi: 5, solend: 0, 'jupiter-lend': 10, drift: 40 },
  systemAvg: 11, systemMax: 40, level: 'moderate', timestamp: Date.now(),
};

const DEMO_FUNDING = { binance: -0.00006316, bybit: -0.00010427, timestamp: Date.now() };

// REAL alerts captured from live backend
const REAL_ALERTS = [
  {
    id: 'real-1', timestamp: new Date('2026-04-19T17:28:28Z').getTime(),
    severity: 'critical', type: 'oracle_deviation', protocol: 'system',
    title: 'JUP/USD oracle deviated -5.17% from TWAP',
    description: 'Current: $0.1587 | TWAP(5m): $0.1673. Potential oracle manipulation or flash crash. Sentinel flagged this automatically.',
  },
  {
    id: 'real-2', timestamp: new Date('2026-04-17T04:21:48Z').getTime(),
    severity: 'high', type: 'tvl_drop', protocol: 'jupiter-lend',
    title: 'Jupiter Lend TVL down -8.5% in 1h',
    description: 'Significant outflow detected on Jupiter Lend. Current TVL dropped from ~$1.03B to ~$939M. Monitoring for cascade effects.',
  },
  {
    id: 'real-3', timestamp: new Date('2026-04-17T04:26:48Z').getTime(),
    severity: 'high', type: 'tvl_drop', protocol: 'jupiter-lend',
    title: 'Jupiter Lend TVL down -8.5% in 1h (continued)',
    description: 'Sustained outflow on Jupiter Lend. No recovery in 5 minutes. Cross-protocol impact being assessed.',
  },
];

// Drift hack timeline
const DRIFT_HACK_TIMELINE = [
  {
    id: 'drift-1', timestamp: new Date('2026-03-11T00:00:00Z').getTime(),
    severity: 'medium', type: 'suspicious_funding', protocol: 'drift',
    title: 'Suspicious wallet funded via Tornado Cash (10 ETH)',
    description: 'New wallet received 10 ETH from Tornado Cash, then began interacting with Drift vaults. Sentinel flags all new wallets interacting with monitored protocols within 24h of mixer activity.',
  },
  {
    id: 'drift-2', timestamp: new Date('2026-03-12T09:00:00Z').getTime(),
    severity: 'low', type: 'new_token_listing', protocol: 'drift',
    title: 'New token CarbonVote (CVT) deployed with minimal liquidity',
    description: 'CVT token created with ~$500 in seeded liquidity and wash trading. Sentinel monitors new tokens that appear as collateral on lending/perp protocols.',
  },
  {
    id: 'drift-3', timestamp: new Date('2026-03-27T00:00:00Z').getTime(),
    severity: 'critical', type: 'governance_change', protocol: 'drift',
    title: 'CRITICAL: Drift Security Council timelock REMOVED',
    description: 'Multisig migrated from 3/5 with timelock to 2/5 WITHOUT timelock. This eliminates the detection window for malicious admin actions. Sentinel would have triggered an immediate critical alert.',
  },
  {
    id: 'drift-4', timestamp: new Date('2026-03-28T00:00:00Z').getTime(),
    severity: 'high', type: 'durable_nonce', protocol: 'drift',
    title: 'Pre-signed durable nonce transactions detected',
    description: 'Two admin-level transactions were pre-signed using durable nonces and left dormant. Sentinel monitors durable nonce accounts linked to protocol multisigs.',
  },
  {
    id: 'drift-5', timestamp: new Date('2026-04-01T16:00:00Z').getTime(),
    severity: 'critical', type: 'exploit_executed', protocol: 'drift',
    title: 'EXPLOIT: $285M drained from Drift vaults in 12 minutes',
    description: 'Pre-signed durable nonce transactions executed. Attacker gained Security Council powers, introduced fraudulent withdrawal mechanism, drained $155M JLP, $60M USDC, $11M CBBTC, and more.',
  },
  {
    id: 'drift-6', timestamp: new Date('2026-04-01T16:15:00Z').getTime(),
    severity: 'critical', type: 'cascade_alert', protocol: 'system',
    title: 'CASCADE: 12+ protocols exposed to Drift contagion',
    description: 'Sentinel maps cross-protocol exposure: Reflect Money (paused), Ranger Finance ($900K exposed), PiggyBank ($106K), Project0 (borrowing halted). TVL alerts triggered across Kamino, Jupiter Lend, MarginFi.',
  },
];

// Governance accounts being monitored
const GOVERNANCE_ACCOUNTS = [
  { label: 'Drift Security Council', protocol: 'drift', pubkey: 'DRiFTGejL2AHo2bSTBEzTpCKNerLCGMfrazr6gCh2xKH', status: 'frozen', lastChecked: '2026-04-15 15:51' },
  { label: 'Drift Admin Authority', protocol: 'drift', pubkey: 'DRfTnEVxAYBiHnvM7CbBGacg6D4LRGF7BaWNkjbnp9ae', status: 'frozen', lastChecked: '2026-04-15 15:51' },
  { label: 'Kamino Admin', protocol: 'kamino', pubkey: 'KAMino9rK6Mr1rxWk3Cq3xvGSfoBhqFpBJCMBM6nhz8', status: 'active', lastChecked: '2026-04-19 23:51' },
  { label: 'MarginFi Admin', protocol: 'marginfi', pubkey: 'MRGNWSHaWmz3CPFcYt3Dqt2LBYhQaxDgdBbJbMvhAQi', status: 'active', lastChecked: '2026-04-19 23:51' },
];

// ============================================
// HOOKS
// ============================================
function useSentinel() {
  const [protocols, setProtocols] = useState(DEMO_PROTOCOLS);
  const [tvl, setTvl] = useState(DEMO_TVL);
  const [alerts, setAlerts] = useState(REAL_ALERTS);
  const [oracles, setOracles] = useState(DEMO_ORACLES);
  const [cascadeRisk, setCascadeRisk] = useState(DEMO_RISK);
  const [funding, setFunding] = useState(DEMO_FUNDING);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState('connecting');
  const wsRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      const timeout = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) { ws.close(); setMode('demo'); } }, 3000);
      ws.onopen = () => { clearTimeout(timeout); setConnected(true); setMode('live'); };
      ws.onclose = () => { clearTimeout(timeout); setConnected(false); if (mode !== 'demo') setMode('demo'); };
      ws.onerror = () => { clearTimeout(timeout); ws.close(); setMode('demo'); };
      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
          case 'init':
            setProtocols(msg.data.protocols); setTvl(msg.data.tvl);
            setAlerts(prev => [...msg.data.alerts, ...REAL_ALERTS].slice(0, 100));
            setOracles(msg.data.oracles); setCascadeRisk(msg.data.cascadeRisk); break;
          case 'alert': setAlerts(prev => [msg.data, ...prev].slice(0, 100)); break;
          case 'tvl': setTvl(msg.data); break;
          case 'oracles': setOracles(msg.data); break;
          case 'cascadeRisk': setCascadeRisk(msg.data); break;
          case 'funding': setFunding(msg.data); break;
        }
      };
    } catch { setMode('demo'); }
  }, []);

  useEffect(() => {
    if (mode !== 'demo') return;
    const interval = setInterval(() => {
      setOracles(prev => {
        const updated = { ...prev };
        for (const key of Object.keys(updated)) {
          const o = { ...updated[key] };
          o.price = o.price + (Math.random() - 0.5) * 0.002 * o.price;
          o.deviationFromTwap = o.deviationFromTwap + (Math.random() - 0.5) * 0.01;
          o.publishTime = Date.now() / 1000;
          updated[key] = o;
        }
        return updated;
      });
      setFunding(prev => ({
        ...prev,
        binance: prev.binance + (Math.random() - 0.5) * 0.00001,
        bybit: prev.bybit + (Math.random() - 0.5) * 0.00001,
        timestamp: Date.now(),
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, [mode]);

  useEffect(() => { connect(); return () => wsRef.current?.close(); }, [connect]);
  return { protocols, tvl, alerts, oracles, cascadeRisk, funding, connected, mode };
}

// ============================================
// STYLES
// ============================================
const SEV = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#06b6d4', info: '#64748b' };
const RISK_C = { critical: '#ef4444', elevated: '#f97316', moderate: '#eab308', low: '#10b981' };
const card = { background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 12, padding: 20 };
const mono = { fontFamily: "'JetBrains Mono', monospace" };
const sTitle = { margin: 0, fontSize: 12, color: '#94a3b8', letterSpacing: '0.12em', ...mono };
const badge = (bg, color) => ({
  padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', ...mono,
  background: bg, color,
});

// ============================================
// COMPONENTS
// ============================================
function CascadeGauge({ risk }) {
  if (!risk) return null;
  const color = RISK_C[risk.level] || '#64748b';
  const pct = Math.min(100, risk.systemMax);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={sTitle}>CASCADE RISK</h3>
        <span style={badge(color + '22', color)}>{risk.level}</span>
      </div>
      <div style={{ height: 10, background: 'rgba(30,41,59,0.8)', borderRadius: 5, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 5, background: `linear-gradient(90deg, #10b981 0%, #eab308 50%, #ef4444 100%)`, transition: 'width 1s ease' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
        {Object.entries(risk.protocols).map(([id, score]) => {
          const proto = DEMO_PROTOCOLS.find(p => p.id === id);
          return (
            <div key={id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', background: 'rgba(30,41,59,0.5)', borderRadius: 8,
              borderLeft: `3px solid ${proto?.color || '#475569'}`,
            }}>
              <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 500 }}>{proto?.name?.split(' ')[0] || id}</span>
              <span style={{ fontSize: 13, fontWeight: 700, ...mono, color: score > 50 ? '#ef4444' : score > 25 ? '#eab308' : '#10b981' }}>{score}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OraclePanel({ oracles }) {
  return (
    <div style={card}>
      <h3 style={{ ...sTitle, marginBottom: 14 }}>PYTH ORACLE STATUS</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {Object.entries(oracles).map(([symbol, o]) => {
          const sc = o.status === 'healthy' ? '#10b981' : o.status === 'stale' ? '#f97316' : '#ef4444';
          const isUSD = symbol.includes('USDC') || symbol.includes('USDT');
          return (
            <div key={symbol} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              background: 'rgba(30,41,59,0.5)', borderRadius: 8, transition: 'background 0.2s',
            }}>
              <div style={{ position: 'relative' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: sc }} />
                <div style={{ position: 'absolute', top: -2, left: -2, width: 14, height: 14, borderRadius: '50%', background: sc, opacity: 0.3, animation: 'pulse 2s infinite' }} />
              </div>
              <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, minWidth: 80 }}>{symbol}</span>
              <span style={{ fontSize: 15, fontWeight: 700, ...mono, color: '#e2e8f0' }}>
                ${isUSD ? o.price?.toFixed(4) : o.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{
                  fontSize: 11, ...mono,
                  color: Math.abs(o.deviationFromTwap) > 1 ? '#ef4444' : Math.abs(o.deviationFromTwap) > 0.5 ? '#eab308' : '#64748b',
                }}>
                  {o.deviationFromTwap >= 0 ? '+' : ''}{o.deviationFromTwap?.toFixed(3)}% TWAP
                </div>
                <div style={{ fontSize: 9, color: '#475569', ...mono }}>
                  conf: ±${o.confidence?.toFixed(o.confidence < 1 ? 4 : 2)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TVLPanel({ tvl, protocols }) {
  const totalTVL = protocols.reduce((sum, p) => {
    const h = tvl[p.id] || [];
    return sum + (h[h.length - 1]?.tvl || 0);
  }, 0);

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={sTitle}>PROTOCOL TVL</h3>
        <span style={{ fontSize: 14, fontWeight: 700, ...mono, color: '#e2e8f0' }}>
          ${(totalTVL / 1e9).toFixed(2)}B total
        </span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {protocols.map(proto => {
          const history = tvl[proto.id] || [];
          const latest = history[history.length - 1];
          if (!latest) return null;
          const pctOfTotal = (latest.tvl / totalTVL * 100).toFixed(1);
          return (
            <div key={proto.id} style={{
              padding: '12px 14px', background: 'rgba(30,41,59,0.5)', borderRadius: 8,
              borderLeft: `3px solid ${proto.color}`, opacity: proto.status === 'frozen' ? 0.5 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{proto.name}</span>
                  {proto.status === 'frozen' && <span style={badge('rgba(239,68,68,0.2)', '#ef4444')}>FROZEN</span>}
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, ...mono, color: '#e2e8f0' }}>
                  ${(latest.tvl / 1e6).toFixed(1)}M
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1, height: 4, background: 'rgba(51,65,85,0.5)', borderRadius: 2, marginRight: 12 }}>
                  <div style={{ width: `${pctOfTotal}%`, height: '100%', background: proto.color, borderRadius: 2, transition: 'width 1s' }} />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: 10, ...mono, color: latest.change1h >= 0 ? '#10b981' : '#ef4444' }}>
                    {latest.change1h >= 0 ? '+' : ''}{latest.change1h.toFixed(2)}% 1h
                  </span>
                  <span style={{ fontSize: 10, ...mono, color: latest.change24h >= 0 ? '#10b981' : '#ef4444' }}>
                    {latest.change24h >= 0 ? '+' : ''}{latest.change24h.toFixed(1)}% 24h
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlertFeed({ alerts, title, maxHeight }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={sTitle}>{title || 'LIVE ALERTS'}</h3>
        <span style={{ fontSize: 10, ...mono, color: '#475569' }}>{alerts.length} events</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: maxHeight || 500, overflowY: 'auto' }}>
        {alerts.length === 0 && <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: 30 }}>No alerts — monitoring active</div>}
        {alerts.map(a => (
          <div key={a.id} style={{
            padding: '12px 14px', background: 'rgba(30,41,59,0.5)', borderRadius: 8,
            borderLeft: `3px solid ${SEV[a.severity]}`, transition: 'background 0.2s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={badge(SEV[a.severity] + '22', SEV[a.severity])}>{a.severity}</span>
              <span style={{ fontSize: 10, color: '#475569', ...mono }}>
                {new Date(a.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(a.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ fontSize: 10, color: '#475569', ...mono, marginLeft: 'auto', background: 'rgba(51,65,85,0.5)', padding: '2px 6px', borderRadius: 3 }}>{a.protocol}</span>
            </div>
            <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, marginBottom: 3 }}>{a.title}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{a.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FundingPanel({ funding }) {
  if (!funding) return null;
  return (
    <div style={card}>
      <h3 style={{ ...sTitle, marginBottom: 14 }}>CEX FUNDING RATES (SOL)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[{ label: 'Binance', value: funding.binance }, { label: 'Bybit', value: funding.bybit }].map(({ label, value }) => {
          if (value === null) return null;
          const pct = (value * 100).toFixed(4);
          const isExtreme = Math.abs(value) > 0.001;
          const direction = value >= 0 ? 'LONGS PAY' : 'SHORTS PAY';
          return (
            <div key={label} style={{ padding: 14, background: 'rgba(30,41,59,0.5)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#64748b', ...mono, marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, ...mono, color: isExtreme ? '#ef4444' : value >= 0 ? '#10b981' : '#f97316' }}>
                {value >= 0 ? '+' : ''}{pct}%
              </div>
              <div style={{ fontSize: 9, color: '#475569', ...mono, marginTop: 4 }}>{direction} / 8h</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(30,41,59,0.3)', borderRadius: 6, fontSize: 10, color: '#64748b', ...mono, lineHeight: 1.5 }}>
        Extreme funding (&gt;0.1%) signals crowded positioning and elevated liquidation cascade risk. Sentinel correlates CEX funding with on-chain DeFi exposure.
      </div>
    </div>
  );
}

function GovernancePanel() {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h3 style={sTitle}>GOVERNANCE MONITOR</h3>
        <span style={badge('rgba(6,182,212,0.15)', '#06b6d4')}>4 accounts tracked</span>
      </div>
      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
        Monitors multisig admin accounts for data changes, key rotations, and timelock modifications.
        The Drift exploit was enabled by a timelock removal on March 27 — Sentinel would have flagged it as critical.
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {GOVERNANCE_ACCOUNTS.map((acc, i) => {
          const proto = DEMO_PROTOCOLS.find(p => p.id === acc.protocol);
          const isFrozen = acc.status === 'frozen';
          return (
            <div key={i} style={{
              padding: '12px 14px', background: 'rgba(30,41,59,0.5)', borderRadius: 8,
              borderLeft: `3px solid ${proto?.color || '#475569'}`, opacity: isFrozen ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{acc.label}</span>
                <span style={badge(
                  isFrozen ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                  isFrozen ? '#ef4444' : '#10b981'
                )}>{isFrozen ? 'FROZEN' : 'MONITORING'}</span>
              </div>
              <div style={{ fontSize: 10, ...mono, color: '#64748b' }}>
                {acc.pubkey.slice(0, 8)}...{acc.pubkey.slice(-8)}
              </div>
              <div style={{ fontSize: 9, ...mono, color: '#475569', marginTop: 4 }}>
                Protocol: {acc.protocol} | Last checked: {acc.lastChecked}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8 }}>
        <div style={{ fontSize: 11, color: '#fca5a5', fontWeight: 600, marginBottom: 4 }}>What Sentinel detects:</div>
        <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.6 }}>
          Multisig key rotations, timelock parameter changes, admin authority transfers, durable nonce account creation/advancement linked to protocol governance wallets. These are the exact attack vectors used in the Drift $285M exploit.
        </div>
      </div>
    </div>
  );
}

function DriftHackReplay() {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h3 style={{ ...sTitle, margin: 0 }}>DRIFT HACK REPLAY</h3>
        <span style={badge('rgba(239,68,68,0.15)', '#ef4444')}>$285M EXPLOIT</span>
        <span style={badge('rgba(139,92,246,0.15)', '#8b5cf6')}>DPRK-ATTRIBUTED</span>
      </div>
      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
        On April 1, 2026, North Korean state hackers (UNC4736) drained $285M from Drift Protocol in 12 minutes.
        The attack was staged over 3 weeks with multiple on-chain signals. This timeline shows what Sentinel would have detected at each stage.
      </p>
      <div style={{ position: 'relative', paddingLeft: 24 }}>
        <div style={{ position: 'absolute', left: 7, top: 0, bottom: 0, width: 2, background: 'linear-gradient(180deg, #eab308, #ef4444)' }} />
        {DRIFT_HACK_TIMELINE.map((evt) => (
          <div key={evt.id} style={{ position: 'relative', marginBottom: 20, paddingLeft: 20 }}>
            <div style={{
              position: 'absolute', left: -10, top: 6, width: 14, height: 14, borderRadius: '50%',
              background: SEV[evt.severity], boxShadow: `0 0 12px ${SEV[evt.severity]}55`,
              border: '2px solid rgba(6,10,20,0.8)',
            }} />
            <div style={{ fontSize: 10, color: '#64748b', ...mono, marginBottom: 4 }}>
              {new Date(evt.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {' '}{new Date(evt.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{
              padding: '12px 14px', background: 'rgba(30,41,59,0.5)', borderRadius: 8,
              borderLeft: `3px solid ${SEV[evt.severity]}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={badge(SEV[evt.severity] + '22', SEV[evt.severity])}>{evt.severity}</span>
                <span style={{ fontSize: 10, ...mono, color: '#475569' }}>{evt.type}</span>
              </div>
              <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>{evt.title}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>{evt.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsBar({ oracles, protocols, tvl, alerts }) {
  const solPrice = oracles['SOL/USD']?.price || 0;
  const btcPrice = oracles['BTC/USD']?.price || 0;
  const totalAlerts = alerts.length;
  const totalTVL = protocols.reduce((s, p) => s + (tvl[p.id]?.[tvl[p.id]?.length - 1]?.tvl || 0), 0);

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20,
    }}>
      {[
        { label: 'SOL', value: `$${solPrice.toFixed(2)}`, color: '#9945FF' },
        { label: 'BTC', value: `$${(btcPrice / 1000).toFixed(1)}K`, color: '#F7931A' },
        { label: 'TOTAL TVL', value: `$${(totalTVL / 1e9).toFixed(2)}B`, color: '#06b6d4' },
        { label: 'ALERTS', value: totalAlerts.toString(), color: totalAlerts > 0 ? '#f97316' : '#10b981' },
      ].map(({ label, value, color }) => (
        <div key={label} style={{
          background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.3)',
          borderRadius: 10, padding: '14px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, ...mono, color }}>{value}</div>
          <div style={{ fontSize: 9, color: '#64748b', letterSpacing: '0.12em', fontWeight: 600, ...mono, marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// MAIN APP
// ============================================
export default function App() {
  const { protocols, tvl, alerts, oracles, cascadeRisk, funding, connected, mode } = useSentinel();
  const [tab, setTab] = useState('overview');

  const tabs = ['overview', 'drift hack replay', 'governance', 'alerts', 'oracles'];

  return (
    <div style={{ minHeight: '100vh', background: '#060a14', color: '#e2e8f0', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={{
        borderBottom: '1px solid rgba(51,65,85,0.3)', padding: '12px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(6,10,20,0.95)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, fontWeight: 800, color: '#fff',
          }}>S</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>SENTINEL</h1>
            <span style={{ fontSize: 9, color: '#64748b', ...mono, letterSpacing: '0.08em' }}>SOLANA DEFI SECURITY INTELLIGENCE</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={badge(
            mode === 'live' ? 'rgba(16,185,129,0.15)' : 'rgba(139,92,246,0.15)',
            mode === 'live' ? '#10b981' : '#8b5cf6'
          )}>
            {mode === 'live' ? '● LIVE' : mode === 'demo' ? '◆ DEMO' : '○ ...'}
          </span>
          {cascadeRisk && <span style={badge((RISK_C[cascadeRisk.level] || '#64748b') + '22', RISK_C[cascadeRisk.level] || '#64748b')}>RISK: {cascadeRisk.level}</span>}
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#10b981' : mode === 'demo' ? '#8b5cf6' : '#ef4444',
            boxShadow: `0 0 8px ${connected ? 'rgba(16,185,129,0.5)' : 'rgba(139,92,246,0.5)'}`,
          }} />
        </div>
      </header>

      {/* Banner */}
      <div style={{
        background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid rgba(239,68,68,0.15)',
        padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 13 }}>⚠</span>
        <span style={{ fontSize: 11, color: '#fca5a5', ...mono }}>
          DRIFT PROTOCOL — $285M exploit (Apr 1, 2026). DPRK-attributed (UNC4736). Protocol frozen. See "Drift Hack Replay" tab.
        </span>
      </div>

      {/* Tabs */}
      <nav style={{
        display: 'flex', gap: 0, padding: '0 24px', borderBottom: '1px solid rgba(51,65,85,0.2)',
        background: 'rgba(6,10,20,0.6)', overflowX: 'auto',
      }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t ? '#06b6d4' : '#64748b',
            borderBottom: tab === t ? '2px solid #06b6d4' : '2px solid transparent',
            fontSize: 11, fontWeight: 600, ...mono, textTransform: 'uppercase',
            letterSpacing: '0.08em', whiteSpace: 'nowrap', transition: 'color 0.2s',
          }}>
            {t === 'governance' ? '🔐 ' : t === 'drift hack replay' ? '🔴 ' : ''}{t}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        {tab === 'overview' && (
          <>
            <StatsBar oracles={oracles} protocols={protocols} tvl={tvl} alerts={alerts} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
              <CascadeGauge risk={cascadeRisk} />
              <FundingPanel funding={funding} />
              <TVLPanel tvl={tvl} protocols={protocols} />
              <OraclePanel oracles={oracles} />
              <div style={{ gridColumn: '1 / -1' }}>
                <AlertFeed alerts={alerts} title="DETECTED EVENTS" maxHeight={350} />
              </div>
            </div>
          </>
        )}
        {tab === 'drift hack replay' && <DriftHackReplay />}
        {tab === 'governance' && <GovernancePanel />}
        {tab === 'alerts' && <AlertFeed alerts={[...REAL_ALERTS, ...DRIFT_HACK_TIMELINE]} title="ALL DETECTED EVENTS" />}
        {tab === 'oracles' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
            <OraclePanel oracles={oracles} />
            <FundingPanel funding={funding} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: 20, fontSize: 10, color: '#334155', ...mono }}>
        Sentinel v1.0 — Solana Frontier Hackathon 2026 — @Makabeez —{' '}
        <a href="https://github.com/Makabeez/sentinel-defi" target="_blank" rel="noreferrer" style={{ color: '#475569' }}>GitHub</a>
        {' | '}
        <a href="https://x.com/geiserjoe2" target="_blank" rel="noreferrer" style={{ color: '#475569' }}>X/Twitter</a>
      </footer>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: rgba(15,23,42,0.5); }
        ::-webkit-scrollbar-thumb { background: rgba(51,65,85,0.5); border-radius: 2px; }
        button:hover { color: #06b6d4 !important; }
      `}</style>
    </div>
  );
}
