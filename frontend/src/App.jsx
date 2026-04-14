import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8081';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// ============================================
// HOOKS
// ============================================
function useSentinel() {
  const [protocols, setProtocols] = useState([]);
  const [tvl, setTvl] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [oracles, setOracles] = useState({});
  const [cascadeRisk, setCascadeRisk] = useState(null);
  const [funding, setFunding] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();

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
        case 'alert':
          setAlerts(prev => [msg.data, ...prev].slice(0, 100));
          break;
        case 'tvl':
          setTvl(msg.data);
          break;
        case 'oracles':
          setOracles(msg.data);
          break;
        case 'cascadeRisk':
          setCascadeRisk(msg.data);
          break;
        case 'funding':
          setFunding(msg.data);
          break;
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { protocols, tvl, alerts, oracles, cascadeRisk, funding, connected };
}

// ============================================
// COMPONENTS
// ============================================
const SEVERITY_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#06b6d4',
  info: '#64748b',
};

const RISK_COLORS = {
  critical: '#ef4444',
  elevated: '#f97316',
  moderate: '#eab308',
  low: '#10b981',
};

function CascadeGauge({ risk }) {
  if (!risk) return null;
  const color = RISK_COLORS[risk.level] || '#64748b';
  const pct = Math.min(100, risk.systemMax);

  return (
    <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13, color: '#94a3b8', fontFamily: 'mono', letterSpacing: '0.1em' }}>
          CASCADE RISK
        </h3>
        <span style={{
          background: color + '22', color, padding: '3px 10px', borderRadius: 4,
          fontSize: 11, fontWeight: 700, fontFamily: 'mono', textTransform: 'uppercase',
        }}>
          {risk.level}
        </span>
      </div>

      {/* Gauge bar */}
      <div style={{ height: 8, background: 'rgba(30,41,59,0.8)', borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 4,
          background: `linear-gradient(90deg, #10b981, #eab308, #ef4444)`,
          transition: 'width 1s ease',
        }} />
      </div>

      {/* Per-protocol scores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        {Object.entries(risk.protocols).map(([id, score]) => (
          <div key={id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 10px', background: 'rgba(30,41,59,0.5)', borderRadius: 6,
          }}>
            <span style={{ fontSize: 11, color: '#cbd5e1' }}>{id}</span>
            <span style={{
              fontSize: 12, fontWeight: 700, fontFamily: 'mono',
              color: score > 50 ? '#ef4444' : score > 25 ? '#eab308' : '#10b981',
            }}>{score}</span>
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
    <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8', fontFamily: 'mono', letterSpacing: '0.1em' }}>
        ORACLE STATUS (PYTH)
      </h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {entries.map(([symbol, o]) => {
          const statusColor = o.status === 'healthy' ? '#10b981' : o.status === 'stale' ? '#f97316' : '#ef4444';
          return (
            <div key={symbol} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              background: 'rgba(30,41,59,0.5)', borderRadius: 8,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, minWidth: 80 }}>{symbol}</span>
              <span style={{ fontSize: 13, fontFamily: 'mono', color: '#e2e8f0', fontWeight: 700 }}>
                ${o.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <span style={{
                fontSize: 10, fontFamily: 'mono', marginLeft: 'auto',
                color: Math.abs(o.deviationFromTwap) > 1 ? '#eab308' : '#64748b',
              }}>
                {o.deviationFromTwap >= 0 ? '+' : ''}{o.deviationFromTwap?.toFixed(3)}% vs TWAP
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
    <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8', fontFamily: 'mono', letterSpacing: '0.1em' }}>
        PROTOCOL TVL
      </h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {protocols.map(proto => {
          const history = tvl[proto.id] || [];
          const latest = history[history.length - 1];
          if (!latest) return null;

          return (
            <div key={proto.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: 'rgba(30,41,59,0.5)', borderRadius: 8,
              borderLeft: `3px solid ${proto.color}`,
              opacity: proto.status === 'frozen' ? 0.5 : 1,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{proto.name}</span>
                  {proto.status === 'frozen' && (
                    <span style={{
                      fontSize: 9, background: 'rgba(239,68,68,0.2)', color: '#ef4444',
                      padding: '1px 6px', borderRadius: 3, fontWeight: 700, fontFamily: 'mono',
                    }}>FROZEN</span>
                  )}
                </div>
                <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'mono' }}>{proto.type}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'mono', color: '#e2e8f0' }}>
                  ${(latest.tvl / 1e6).toFixed(1)}M
                </div>
                <div style={{
                  fontSize: 10, fontFamily: 'mono',
                  color: latest.change1h >= 0 ? '#10b981' : '#ef4444',
                }}>
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

function AlertFeed({ alerts }) {
  return (
    <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8', fontFamily: 'mono', letterSpacing: '0.1em' }}>
        LIVE ALERTS
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
        {alerts.length === 0 && (
          <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: 20 }}>
            No alerts yet — monitoring active
          </div>
        )}
        {alerts.map(a => (
          <div key={a.id} style={{
            padding: '10px 12px', background: 'rgba(30,41,59,0.5)', borderRadius: 8,
            borderLeft: `3px solid ${SEVERITY_COLORS[a.severity]}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, fontFamily: 'mono', textTransform: 'uppercase',
                color: SEVERITY_COLORS[a.severity],
              }}>{a.severity}</span>
              <span style={{ fontSize: 9, color: '#475569', fontFamily: 'mono' }}>
                {new Date(a.timestamp).toLocaleTimeString()}
              </span>
              <span style={{ fontSize: 9, color: '#475569', fontFamily: 'mono', marginLeft: 'auto' }}>
                {a.protocol}
              </span>
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
    <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8', fontFamily: 'mono', letterSpacing: '0.1em' }}>
        CEX FUNDING RATES (SOL)
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { label: 'Binance', value: funding.binance },
          { label: 'Bybit', value: funding.bybit },
        ].map(({ label, value }) => {
          if (value === null) return null;
          const pct = (value * 100).toFixed(4);
          const isExtreme = Math.abs(value) > 0.001;
          return (
            <div key={label} style={{ padding: '12px', background: 'rgba(30,41,59,0.5)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'mono', marginBottom: 4 }}>{label}</div>
              <div style={{
                fontSize: 18, fontWeight: 700, fontFamily: 'mono',
                color: isExtreme ? '#ef4444' : value >= 0 ? '#10b981' : '#f97316',
              }}>
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

// ============================================
// MAIN APP
// ============================================
export default function App() {
  const { protocols, tvl, alerts, oracles, cascadeRisk, funding, connected } = useSentinel();
  const [tab, setTab] = useState('overview');

  return (
    <div style={{
      minHeight: '100vh', background: '#060a14', color: '#e2e8f0',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
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
            fontSize: 16, fontWeight: 800,
          }}>S</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>SENTINEL</h1>
            <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'mono', letterSpacing: '0.08em' }}>
              SOLANA DEFI SECURITY INTELLIGENCE
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cascadeRisk && (
            <span style={{
              fontSize: 10, fontWeight: 700, fontFamily: 'mono', textTransform: 'uppercase',
              padding: '4px 10px', borderRadius: 4,
              background: (RISK_COLORS[cascadeRisk.level] || '#64748b') + '22',
              color: RISK_COLORS[cascadeRisk.level] || '#64748b',
            }}>
              RISK: {cascadeRisk.level}
            </span>
          )}
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#10b981' : '#ef4444',
            boxShadow: connected ? '0 0 8px rgba(16,185,129,0.5)' : '0 0 8px rgba(239,68,68,0.5)',
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
          DRIFT PROTOCOL — $285M exploit (Apr 1). Protocol frozen. DPRK-attributed (UNC4736). 12+ protocols affected.
          Sentinel would have flagged: multisig change (Mar 27), fake CVT token oracle manipulation, abnormal vault outflows.
        </span>
      </div>

      {/* Tabs */}
      <nav style={{
        display: 'flex', gap: 0, padding: '0 24px', borderBottom: '1px solid rgba(51,65,85,0.2)',
        background: 'rgba(6,10,20,0.6)',
      }}>
        {['overview', 'alerts', 'oracles'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t ? '#06b6d4' : '#64748b',
            borderBottom: tab === t ? '2px solid #06b6d4' : '2px solid transparent',
            fontSize: 12, fontWeight: 600, fontFamily: 'mono', textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            {t}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <CascadeGauge risk={cascadeRisk} />
            <FundingPanel funding={funding} />
            <TVLPanel tvl={tvl} protocols={protocols} />
            <AlertFeed alerts={alerts.slice(0, 20)} />
          </div>
        )}

        {tab === 'alerts' && (
          <AlertFeed alerts={alerts} />
        )}

        {tab === 'oracles' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <OraclePanel oracles={oracles} />
            <FundingPanel funding={funding} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: 16, fontSize: 10, color: '#334155', fontFamily: 'mono',
      }}>
        Sentinel v1.0 — Solana Frontier Hackathon 2026 — @Makabeez
      </footer>
    </div>
  );
}
