import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8081';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// ============================================
// EMBEDDED DEMO DATA (real snapshots from live backend)
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
  'SOL/USD': { symbol: 'SOL/USD', price: 83.65, confidence: 0.062, publishTime: Date.now() / 1000, deviationFromTwap: -0.018, status: 'healthy' },
  'BTC/USD': { symbol: 'BTC/USD', price: 74314.59, confidence: 21.72, publishTime: Date.now() / 1000, deviationFromTwap: 0.004, status: 'healthy' },
  'ETH/USD': { symbol: 'ETH/USD', price: 2332.26, confidence: 1.19, publishTime: Date.now() / 1000, deviationFromTwap: -0.007, status: 'healthy' },
  'USDC/USD': { symbol: 'USDC/USD', price: 0.9998, confidence: 0.0005, publishTime: Date.now() / 1000, deviationFromTwap: -0.001, status: 'healthy' },
  'JUP/USD': { symbol: 'JUP/USD', price: 0.1665, confidence: 0.0002, publishTime: Date.now() / 1000, deviationFromTwap: -0.09, status: 'healthy' },
};

const DEMO_RISK = {
  protocols: { kamino: 0, marginfi: 0, solend: 0, 'jupiter-lend': 0, drift: 40 },
  systemAvg: 8, systemMax: 40, level: 'moderate', timestamp: Date.now(),
};

const DEMO_FUNDING = { binance: -0.00006316, bybit: -0.00010427, timestamp: Date.now() };

// Drift hack timeline — what Sentinel WOULD have caught
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
    title: '⚠ CRITICAL: Drift Security Council timelock REMOVED',
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
    title: '🚨 EXPLOIT: $285M drained from Drift vaults in 12 minutes',
    description: 'Pre-signed durable nonce transactions executed. Attacker gained Security Council powers, introduced fraudulent withdrawal mechanism, drained $155M JLP, $60M USDC, $11M CBBTC, and more. Sentinel cascade alert triggered across 12+ affected protocols.',
  },
  {
    id: 'drift-6', timestamp: new Date('2026-04-01T16:15:00Z').getTime(),
    severity: 'critical', type: 'cascade_alert', protocol: 'system',
    title: '🔴 CASCADE: 12+ protocols exposed to Drift contagion',
    description: 'Sentinel maps cross-protocol exposure: Reflect Money (paused), Ranger Finance ($900K exposed), PiggyBank ($106K), Project0 (borrowing halted). TVL alerts triggered across Kamino, Jupiter Lend, MarginFi.',
  },
];

// ============================================
// HOOKS
// ============================================
function useSentinel() {
  const [protocols, setProtocols] = useState(DEMO_PROTOCOLS);
  const [tvl, setTvl] = useState(DEMO_TVL);
  const [alerts, setAlerts] = useState([]);
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

      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          setMode('demo');
        }
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        setConnected(true);
        setMode('live');
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        setConnected(false);
        if (mode !== 'demo') setMode('demo');
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        setMode('demo');
      };

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
          case 'init':
            setProtocols(msg.data.protocols);
            setTvl(msg.data.tvl);
            setAlerts(msg.data.alerts);
            setOracles(msg.data.oracles);
            setCascadeRisk(msg.data.cascadeRisk);
            break;
          case 'alert': setAlerts(prev => [msg.data, ...prev].slice(0, 100)); break;
          case 'tvl': setTvl(msg.data); break;
          case 'oracles': setOracles(msg.data); break;
          case 'cascadeRisk': setCascadeRisk(msg.data); break;
          case 'funding': setFunding(msg.data); break;
        }
      };
    } catch {
      setMode('demo');
    }
  }, []);

  // Simulate oracle price ticks in demo mode
  useEffect(() => {
    if (mode !== 'demo') return;
    const interval = setInterval(() => {
      setOracles(prev => {
        const updated = { ...prev };
        for (const key of Object.keys(updated)) {
          const o = { ...updated[key] };
          const jitter = (Math.random() - 0.5) * 0.002 * o.price;
          o.price = o.price + jitter;
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
// COMPONENTS
// ============================================
const SEV = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#06b6d4', info: '#64748b' };
const RISK_C = { critical: '#ef4444', elevated: '#f97316', moderate: '#eab308', low: '#10b981' };

function CascadeGauge({ risk }) {
  if (!risk) return null;
  const color = RISK_C[risk.level] || '#64748b';
  const pct = Math.min(100, risk.systemMax);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={sectionTitle}>CASCADE RISK</h3>
        <span style={{ ...badge, background: color + '22', color }}>{risk.level}</span>
      </div>
      <div style={{ height: 8, background: 'rgba(30,41,59,0.8)', borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #10b981, #eab308, #ef4444)', transition: 'width 1s ease' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        {Object.entries(risk.protocols).map(([id, score]) => (
          <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'rgba(30,41,59,0.5)', borderRadius: 6 }}>
            <span style={{ fontSize: 11, color: '#cbd5e1' }}>{id}</span>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'mono', color: score > 50 ? '#ef4444' : score > 25 ? '#eab308' : '#10b981' }}>{score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OraclePanel({ oracles }) {
  const entries = Object.entries(oracles);
  if (entries.length === 0) return null;
  return (
    <div style={card}>
      <h3 style={{ ...sectionTitle, marginBottom: 14 }}>ORACLE STATUS (PYTH)</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {entries.map(([symbol, o]) => {
          const sc = o.status === 'healthy' ? '#10b981' : o.status === 'stale' ? '#f97316' : '#ef4444';
          return (
            <div key={symbol} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(30,41,59,0.5)', borderRadius: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: sc, flexShrink: 0, boxShadow: `0 0 6px ${sc}44` }} />
              <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, minWidth: 80 }}>{symbol}</span>
              <span style={{ fontSize: 13, fontFamily: 'mono', color: '#e2e8f0', fontWeight: 700 }}>
                ${o.price?.toLocaleString(undefined, { maximumFractionDigits: symbol.includes('USD/') ? 4 : 2 })}
              </span>
              <span style={{ fontSize: 10, fontFamily: 'mono', marginLeft: 'auto', color: Math.abs(o.deviationFromTwap) > 1 ? '#eab308' : '#64748b' }}>
                {o.deviationFromTwap >= 0 ? '+' : ''}{o.deviationFromTwap?.toFixed(3)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TVLPanel({ tvl, protocols }) {
  return (
    <div style={card}>
      <h3 style={{ ...sectionTitle, marginBottom: 14 }}>PROTOCOL TVL</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {protocols.map(proto => {
          const history = tvl[proto.id] || [];
          const latest = history[history.length - 1];
          if (!latest) return null;
          return (
            <div key={proto.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: 'rgba(30,41,59,0.5)', borderRadius: 8, borderLeft: `3px solid ${proto.color}`,
              opacity: proto.status === 'frozen' ? 0.5 : 1,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{proto.name}</span>
                  {proto.status === 'frozen' && <span style={{ fontSize: 9, background: 'rgba(239,68,68,0.2)', color: '#ef4444', padding: '1px 6px', borderRadius: 3, fontWeight: 700, fontFamily: 'mono' }}>FROZEN</span>}
                </div>
                <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'mono' }}>{proto.type}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'mono', color: '#e2e8f0' }}>${(latest.tvl / 1e6).toFixed(1)}M</div>
                <div style={{ fontSize: 10, fontFamily: 'mono', color: latest.change1h >= 0 ? '#10b981' : '#ef4444' }}>
                  {latest.change1h >= 0 ? '+' : ''}{latest.change1h.toFixed(2)}% 1h
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlertFeed({ alerts, title }) {
  return (
    <div style={card}>
      <h3 style={{ ...sectionTitle, marginBottom: 14 }}>{title || 'LIVE ALERTS'}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 500, overflowY: 'auto' }}>
        {alerts.length === 0 && <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: 20 }}>No alerts — monitoring active</div>}
        {alerts.map(a => (
          <div key={a.id} style={{ padding: '10px 12px', background: 'rgba(30,41,59,0.5)', borderRadius: 8, borderLeft: `3px solid ${SEV[a.severity]}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'mono', textTransform: 'uppercase', color: SEV[a.severity] }}>{a.severity}</span>
              <span style={{ fontSize: 9, color: '#475569', fontFamily: 'mono' }}>
                {new Date(a.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(a.timestamp).toLocaleTimeString()}
              </span>
              <span style={{ fontSize: 9, color: '#475569', fontFamily: 'mono', marginLeft: 'auto' }}>{a.protocol}</span>
            </div>
            <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, marginBottom: 2 }}>{a.title}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{a.description}</div>
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
      <h3 style={{ ...sectionTitle, marginBottom: 14 }}>CEX FUNDING RATES (SOL)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[{ label: 'Binance', value: funding.binance }, { label: 'Bybit', value: funding.bybit }].map(({ label, value }) => {
          if (value === null) return null;
          const pct = (value * 100).toFixed(4);
          const isExtreme = Math.abs(value) > 0.001;
          return (
            <div key={label} style={{ padding: 12, background: 'rgba(30,41,59,0.5)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'mono', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'mono', color: isExtreme ? '#ef4444' : value >= 0 ? '#10b981' : '#f97316' }}>
                {value >= 0 ? '+' : ''}{pct}%
              </div>
              <div style={{ fontSize: 9, color: '#475569', fontFamily: 'mono' }}>per 8h</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DriftHackReplay() {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <h3 style={{ ...sectionTitle, margin: 0 }}>DRIFT HACK REPLAY</h3>
        <span style={{ fontSize: 9, background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontFamily: 'mono' }}>$285M EXPLOIT</span>
      </div>
      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 16px', lineHeight: 1.4 }}>
        Timeline of events Sentinel would have detected. The attack was staged over 3 weeks — multiple signals were visible on-chain before the April 1 execution.
      </p>
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <div style={{ position: 'absolute', left: 5, top: 0, bottom: 0, width: 2, background: 'rgba(51,65,85,0.4)' }} />
        {DRIFT_HACK_TIMELINE.map((evt, i) => (
          <div key={evt.id} style={{ position: 'relative', marginBottom: 16, paddingLeft: 16 }}>
            <div style={{
              position: 'absolute', left: -7, top: 4, width: 12, height: 12, borderRadius: '50%',
              background: SEV[evt.severity], boxShadow: `0 0 8px ${SEV[evt.severity]}66`,
            }} />
            <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'mono', marginBottom: 2 }}>
              {new Date(evt.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {' '}{new Date(evt.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{
              padding: '10px 12px', background: 'rgba(30,41,59,0.5)', borderRadius: 8,
              borderLeft: `3px solid ${SEV[evt.severity]}`,
            }}>
              <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, marginBottom: 3 }}>{evt.title}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{evt.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const card = { background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 12, padding: 20 };
const sectionTitle = { margin: 0, fontSize: 13, color: '#94a3b8', fontFamily: 'mono', letterSpacing: '0.1em' };
const badge = { padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: 'mono', textTransform: 'uppercase' };

// ============================================
// MAIN APP
// ============================================
export default function App() {
  const { protocols, tvl, alerts, oracles, cascadeRisk, funding, connected, mode } = useSentinel();
  const [tab, setTab] = useState('overview');

  return (
    <div style={{ minHeight: '100vh', background: '#060a14', color: '#e2e8f0', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={{
        borderBottom: '1px solid rgba(51,65,85,0.3)', padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(6,10,20,0.95)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
          }}>S</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>SENTINEL</h1>
            <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'mono', letterSpacing: '0.08em' }}>
              SOLANA DEFI SECURITY INTELLIGENCE
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontSize: 9, fontFamily: 'mono', padding: '3px 8px', borderRadius: 4,
            background: mode === 'live' ? 'rgba(16,185,129,0.15)' : 'rgba(139,92,246,0.15)',
            color: mode === 'live' ? '#10b981' : '#8b5cf6',
            fontWeight: 700,
          }}>
            {mode === 'live' ? '● LIVE' : mode === 'demo' ? '◆ DEMO' : '○ CONNECTING'}
          </span>
          {cascadeRisk && (
            <span style={{ ...badge, background: (RISK_C[cascadeRisk.level] || '#64748b') + '22', color: RISK_C[cascadeRisk.level] || '#64748b' }}>
              RISK: {cascadeRisk.level}
            </span>
          )}
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#10b981' : mode === 'demo' ? '#8b5cf6' : '#ef4444',
            boxShadow: `0 0 8px ${connected ? 'rgba(16,185,129,0.5)' : mode === 'demo' ? 'rgba(139,92,246,0.5)' : 'rgba(239,68,68,0.5)'}`,
          }} />
        </div>
      </header>

      {/* Drift hack banner */}
      <div style={{
        background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)',
        padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>⚠</span>
        <span style={{ fontSize: 11, color: '#fca5a5', fontFamily: 'mono' }}>
          DRIFT PROTOCOL — $285M exploit (Apr 1, 2026). DPRK-attributed. Protocol frozen. See "Drift Hack Replay" tab for full timeline.
        </span>
      </div>

      {/* Tabs */}
      <nav style={{
        display: 'flex', gap: 0, padding: '0 24px', borderBottom: '1px solid rgba(51,65,85,0.2)',
        background: 'rgba(6,10,20,0.6)', overflowX: 'auto',
      }}>
        {['overview', 'drift hack replay', 'alerts', 'oracles'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t ? '#06b6d4' : '#64748b',
            borderBottom: tab === t ? '2px solid #06b6d4' : '2px solid transparent',
            fontSize: 12, fontWeight: 600, fontFamily: 'mono', textTransform: 'uppercase',
            letterSpacing: '0.08em', whiteSpace: 'nowrap',
          }}>
            {t}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
            <CascadeGauge risk={cascadeRisk} />
            <FundingPanel funding={funding} />
            <TVLPanel tvl={tvl} protocols={protocols} />
            <OraclePanel oracles={oracles} />
            <div style={{ gridColumn: '1 / -1' }}>
              <AlertFeed alerts={alerts.length > 0 ? alerts.slice(0, 10) : DRIFT_HACK_TIMELINE.slice(-3)} title={alerts.length > 0 ? 'LIVE ALERTS' : 'RECENT NOTABLE EVENTS'} />
            </div>
          </div>
        )}

        {tab === 'drift hack replay' && <DriftHackReplay />}

        {tab === 'alerts' && <AlertFeed alerts={alerts.length > 0 ? alerts : DRIFT_HACK_TIMELINE} title={alerts.length > 0 ? 'ALL ALERTS' : 'DRIFT HACK — FULL ALERT TIMELINE'} />}

        {tab === 'oracles' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
            <OraclePanel oracles={oracles} />
            <FundingPanel funding={funding} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: 16, fontSize: 10, color: '#334155', fontFamily: 'mono' }}>
        Sentinel v1.0 — Solana Frontier Hackathon 2026 — @Makabeez —{' '}
        <a href="https://github.com/Makabeez/sentinel-defi" target="_blank" style={{ color: '#475569' }}>GitHub</a>
      </footer>
    </div>
  );
}
