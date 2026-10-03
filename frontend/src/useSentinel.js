import { useEffect, useRef, useState } from 'react';
import { API_URL, WS_URL, SNAPSHOT } from './data';

// Live data comes from two places: the WebSocket pushes oracle, TVL and alert
// updates as they happen; REST fills everything in on load and keeps working if
// a network blocks WebSockets. If both fail, the page shows the dated snapshot.

async function getJSON(path) {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export default function useSentinel() {
  const [protocols, setProtocols] = useState([]);
  const [tvl, setTvl] = useState({});
  const [oracles, setOracles] = useState({});
  const [funding, setFunding] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [trust, setTrust] = useState(null);
  const [trustState, setTrustState] = useState('loading');
  const [ws, setWs] = useState('connecting');
  const [api, setApi] = useState('connecting');
  const [lastUpdate, setLastUpdate] = useState(null);
  const sock = useRef(null);

  // REST: initial load, then refresh slow-moving data.
  useEffect(() => {
    let alive = true;

    const loadAll = async () => {
      const results = await Promise.allSettled([
        getJSON('/api/protocols'),
        getJSON('/api/tvl'),
        getJSON('/api/oracles'),
        getJSON('/api/funding'),
        getJSON('/api/alerts?limit=50'),
        getJSON('/api/trust-scores'),
      ]);
      if (!alive) return;
      const [p, t, o, f, a, ts] = results;
      if (p.status === 'fulfilled') setProtocols(p.value);
      if (t.status === 'fulfilled') setTvl(t.value);
      if (o.status === 'fulfilled') setOracles(o.value);
      if (f.status === 'fulfilled') setFunding(f.value);
      if (a.status === 'fulfilled') setAlerts(a.value);
      if (ts.status === 'fulfilled' && ts.value?.protocols?.length) {
        setTrust(ts.value);
        setTrustState('chain');
      } else {
        setTrustState((prev) => (prev === 'chain' ? prev : 'missing'));
      }

      const ok = results.some((r) => r.status === 'fulfilled');
      setApi(ok ? 'ok' : 'down');
      if (ok) setLastUpdate(Date.now());
    };

    loadAll();
    const id = setInterval(loadAll, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // WebSocket: push updates, reconnect with backoff.
  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer;

    const connect = () => {
      let s;
      try {
        s = new WebSocket(WS_URL);
      } catch {
        setWs('down');
        return;
      }
      sock.current = s;

      s.onopen = () => {
        retry = 0;
        setWs('open');
      };
      s.onclose = () => {
        setWs('down');
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry));
      };
      s.onerror = () => s.close();
      s.onmessage = (evt) => {
        let msg;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }
        setLastUpdate(Date.now());
        switch (msg.type) {
          case 'init':
            setProtocols(msg.data.protocols || []);
            setTvl(msg.data.tvl || {});
            setOracles(msg.data.oracles || {});
            setAlerts(msg.data.alerts || []);
            break;
          case 'alert':
            setAlerts((prev) => [msg.data, ...prev].slice(0, 100));
            break;
          case 'tvl':
            setTvl(msg.data);
            break;
          case 'oracles':
            setOracles(msg.data);
            break;
          case 'funding':
            setFunding(msg.data);
            break;
          default:
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      sock.current?.close();
    };
  }, []);

  const live = ws === 'open' || api === 'ok';
  const offline = ws === 'down' && api === 'down';

  return {
    mode: live ? 'live' : offline ? 'offline' : 'connecting',
    protocols,
    tvl,
    oracles,
    funding,
    alerts,
    trust: trust || (trustState === 'missing' ? SNAPSHOT : null),
    trustSource: trust ? 'chain' : trustState === 'missing' ? 'snapshot' : 'loading',
    lastUpdate,
  };
}
