import { useEffect, useMemo, useState } from 'react';
import useSentinel from './useSentinel';
import Mark from './components/Mark';
import SeatRing from './components/SeatRing';
import { API_URL, BONK_CASE, DRIFT_TIMELINE, LINKS } from './data';
import { ago, controlSentence, day, duration, pct, shortAddr, usd } from './format';

const TIER_LABEL = {
  excellent: 'Strong',
  good: 'Good',
  fair: 'Fair',
  weak: 'Weak',
  critical: 'Critical',
};

function useTick(ms = 15_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/* ------------------------------------------------------------------ header */

function Header({ mode, lastUpdate }) {
  useTick();
  const label =
    mode === 'live' ? 'Live' : mode === 'offline' ? 'Live data unavailable' : 'Connecting';
  return (
    <header className="topbar">
      <div className="wrap">
        <a className="brand" href="#top" aria-label="Sentinel home">
          <Mark animate={false} size={28} />
          <span className="brand-word">SENTINEL</span>
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#governance">Governance</a>
          <a href="#wallet">Check a wallet</a>
          <a href="#cases">Case files</a>
          <a href="#markets">Markets</a>
          <a href="#signals">Signals</a>
        </nav>
        <div className="status" data-mode={mode} role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>{label}</strong>
            {mode === 'live' && lastUpdate ? `, updated ${ago(lastUpdate)}` : ''}
          </span>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------- hero */

function Hero({ trust, trustSource }) {
  const scored = trust?.protocols?.filter((p) => !p.error) || [];
  const noDelay = scored.filter((p) => !p.timelockSeconds && p.model !== 'immutable').length;
  const singleKey = scored.filter((p) => p.model === 'single-key').length;

  return (
    <section className="hero" id="top">
      <div className="wrap">
        <div>
          <h1>Who can rewrite the code holding your money?</h1>
          <p>
            Sentinel reads the upgrade keys, multisig thresholds and timelocks of Solana lending
            protocols straight from chain state, scores them, and alerts the moment one gets weaker.
          </p>
          <div className="actions">
            <a className="btn btn-primary" href="#governance">
              See the scores
            </a>
            <a className="btn btn-quiet" href="#wallet">
              Check a wallet
            </a>
          </div>
          {scored.length > 0 && (
            <div className="hero-facts">
              <span>
                <b className="num">{scored.length}</b> protocols scored on-chain
              </span>
              <span>
                <b className="num">{noDelay}</b> can be upgraded with no delay
              </span>
              <span>
                <b className="num">{singleKey}</b> controlled by a single key
              </span>
              {trust?.updatedAt && (
                <span className="hero-checked">
                  {trustSource === 'snapshot' ? 'Snapshot from ' : 'Read from chain '}
                  <b>{trustSource === 'snapshot' ? day(trust.updatedAt) : ago(Date.parse(trust.updatedAt))}</b>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="hero-mark">
          <Mark />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- governance */

function factorColor(points, max) {
  const r = max ? points / max : 0;
  if (r >= 0.75) return 'var(--signed)';
  if (r >= 0.4) return 'var(--idle)';
  if (r > 0) return 'var(--flagged)';
  return 'var(--breach)';
}

function ProtocolRow({ p }) {
  const [open, setOpen] = useState(false);
  const scored = !p.error;
  const detailId = `detail-${p.id}`;

  return (
    <article className="protocol" data-open={open}>
      <button
        className="protocol-row"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={detailId}
      >
        <SeatRing protocol={p} />
        <div>
          <h3 className="protocol-name">
            {p.name}
            <span className={`tier tier-${scored ? p.tier : 'unscored'}`}>
              {scored ? TIER_LABEL[p.tier] || p.tier : 'Not scored'}
            </span>
          </h3>
          <p className="protocol-sentence">{controlSentence(p)}</p>
        </div>
        <div className="protocol-score">
          <div className="score-number">
            {scored ? p.score : '—'}
            {scored && <small>/100</small>}
          </div>
          <svg className="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="protocol-detail" id={detailId}>
          <div>
            {scored ? (
              p.factors.map((f) => (
                <div className="factor" key={f.label}>
                  <span>{f.label}</span>
                  <span className="num">
                    {f.points}/{f.max}
                  </span>
                  <div className="factor-bar">
                    <span style={{ width: `${(f.points / f.max) * 100}%`, background: factorColor(f.points, f.max) }} />
                  </div>
                </div>
              ))
            ) : (
              <p className="protocol-sentence">
                The registered address for this protocol is a token mint, not a program. It stays
                unscored until the real program ID is confirmed on-chain.
              </p>
            )}
            {p.stale && (
              <p className="footnote">
                The last check failed ({p.lastError}). Showing the previous verified reading.
              </p>
            )}
          </div>
          <dl className="facts">
            {p.programId && (
              <>
                <dt>Program</dt>
                <dd>
                  <a className="addr" href={LINKS.account(p.programId)} target="_blank" rel="noreferrer">
                    {p.programId}
                  </a>
                </dd>
              </>
            )}
            {p.authority && (
              <>
                <dt>Upgrade authority</dt>
                <dd>
                  <a className="addr" href={LINKS.account(p.authority)} target="_blank" rel="noreferrer">
                    {p.authority}
                  </a>
                </dd>
              </>
            )}
            {p.multisig && (
              <>
                <dt>Squads multisig</dt>
                <dd>
                  <a className="addr" href={LINKS.account(p.multisig)} target="_blank" rel="noreferrer">
                    {p.multisig}
                  </a>
                </dd>
              </>
            )}
            {scored && (
              <>
                <dt>Timelock</dt>
                <dd>{duration(p.timelockSeconds) || 'None'}</dd>
              </>
            )}
            {p.lastActivity && (
              <>
                <dt>Authority last used</dt>
                <dd>{ago(p.lastActivity * 1000)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </article>
  );
}

function Governance({ trust, trustSource }) {
  const rows = useMemo(() => {
    const list = trust?.protocols || [];
    return [...list].sort((a, b) => {
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      return (a.score ?? 0) - (b.score ?? 0);
    });
  }, [trust]);

  return (
    <section className="section" id="governance">
      <div className="wrap">
        <div className="section-head">
          <h2>Upgrade control, weakest first</h2>
          <p>
            Each ring is the real signer set behind a program’s upgrade key. Violet seats are the
            signatures needed to ship new code. Open a row to see the score breakdown and the
            accounts it was read from.
          </p>
        </div>

        {trustSource === 'snapshot' && (
          <div className="notice" role="note">
            Live scores are unavailable right now. Showing the last verified snapshot from{' '}
            {day(trust.updatedAt)}.
          </div>
        )}

        {trustSource === 'loading' ? (
          <p className="empty">Reading governance accounts…</p>
        ) : (
          <div className="board">
            {rows.map((p) => (
              <ProtocolRow key={p.id || p.name} p={p} />
            ))}
          </div>
        )}

        <p className="board-foot">
          Scores weigh who holds the upgrade authority (45 points), the timelock before changes land
          (30) and how recently the authority was used (25). They describe who can replace a
          program’s code — not who controls its treasury or risk parameters. Audits aren’t scored
          because they aren’t on-chain.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ wallet */

function Wallet({ trust }) {
  const [address, setAddress] = useState('');
  const [state, setState] = useState({ status: 'idle' });

  const check = async (e) => {
    e.preventDefault();
    const a = address.trim();
    if (a.length < 32 || a.length > 44) {
      setState({ status: 'error', message: 'Paste a Solana wallet address — 32 to 44 characters.' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const res = await fetch(`${API_URL}/api/wallet/${a}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The scan failed.');
      if (body.weakestScore === undefined) throw new Error('The API is running an older version. Try again later.');
      setState({ status: 'done', result: body });
    } catch (err) {
      setState({
        status: 'error',
        message:
          err instanceof TypeError
            ? 'Sentinel’s API is unreachable right now, so wallets can’t be checked.'
            : err.message,
      });
    }
  };

  const byId = Object.fromEntries((trust?.protocols || []).map((p) => [p.id, p]));
  const r = state.result;

  return (
    <section className="section" id="wallet">
      <div className="wrap">
        <div className="section-head">
          <h2>Check a wallet</h2>
          <p>
            Paste an address to find its open positions on Kamino, Solend, MarginFi and Drift, and
            who can change the code those positions sit in.
          </p>
        </div>

        <form className="scan" onSubmit={check}>
          <label className="visually-hidden" htmlFor="addr">
            Solana wallet address
          </label>
          <input
            id="addr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Solana wallet address"
            autoComplete="off"
            spellCheck="false"
          />
          <button className="btn btn-primary" type="submit" disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Checking…' : 'Check wallet'}
          </button>
        </form>
        {state.status === 'error' && <p className="scan-error">{state.message}</p>}

        {r && (
          <div className="scan-result" aria-live="polite">
            <div className="scan-summary">
              <span>
                Wallet <b className="addr">{shortAddr(r.address)}</b>
              </span>
              <span>
                <b className="num">{r.solBalance.toFixed(2)}</b> SOL
              </span>
              <span>
                <b className="num">{r.exposure.length}</b> protocol{r.exposure.length === 1 ? '' : 's'} with positions
              </span>
              {r.weakestScore != null && (
                <span>
                  Weakest upgrade control <b className="num">{r.weakestScore}/100</b>
                </span>
              )}
            </div>

            {r.exposure.length === 0 ? (
              <p className="empty">
                No open positions on Kamino, Solend, MarginFi or Drift for this wallet.
              </p>
            ) : (
              <div className="board">
                {r.exposure.map((e) => {
                  const p = byId[e.protocol] || { ...e, name: e.name, score: e.trustScore };
                  return (
                    <div className="protocol" key={e.protocol}>
                      <div className="protocol-row" style={{ cursor: 'default' }}>
                        <SeatRing protocol={p} />
                        <div>
                          <h3 className="protocol-name">
                            {e.name}
                            <span className="tier tier-fair">
                              {e.positions} {e.positionKind}
                              {e.positions === 1 ? '' : 's'}
                            </span>
                          </h3>
                          <p className="protocol-sentence">{controlSentence(p)}</p>
                        </div>
                        <div className="protocol-score">
                          <div className="score-number">
                            {e.trustScore ?? '—'}
                            {e.trustScore != null && <small>/100</small>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {r.unchecked?.length > 0 && (
              <p className="footnote">Couldn’t check {r.unchecked.join(', ')} this time.</p>
            )}
            <p className="footnote">Jupiter Lend positions aren’t checked yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- case files */

function Cases() {
  const b = BONK_CASE;
  return (
    <section className="section" id="cases">
      <div className="wrap">
        <div className="section-head">
          <h2>Case files</h2>
          <p>Two 2026 governance failures, and what was readable on-chain before the money moved.</p>
        </div>

        <div className="cases">
          <article className="case">
            <h3>BonkDAO: the attack was priced in public</h3>
            <p className="case-sub">Proposal BIP #76, filed 30 June and executed 6 July 2026. About $20M lost.</p>
            <div className="capture">
              <div>
                <div className="ratio num">{b.ratio}×</div>
                <p className="ratio-caption">
                  The treasury was worth five times what it cost to buy the vote.
                </p>
              </div>
              <div className="compare">
                <div className="compare-row">
                  <header>
                    <span>Votes needed to pass a proposal</span>
                    <b className="num">${b.captureCost}M</b>
                  </header>
                  <div className="compare-bar">
                    <span style={{ width: `${(b.captureCost / b.treasury) * 100}%`, background: 'var(--flagged)' }} />
                  </div>
                </div>
                <div className="compare-row">
                  <header>
                    <span>Treasury those votes controlled</span>
                    <b className="num">${b.treasury}M</b>
                  </header>
                  <div className="compare-bar">
                    <span style={{ width: '100%', background: 'var(--idle)' }} />
                  </div>
                </div>
                <p className="footnote">
                  A 1% approval quorum against BONK’s supply meant {b.votesNeeded} carried a
                  proposal. No timelock stood between the vote and the transfer.
                </p>
              </div>
            </div>
            <p className="case-note">
              The same DAO ran a second governance with a 10% quorum. Capture there cost twice the
              prize ({b.strictRatio}×), so nobody tried. One config field was the whole difference.{' '}
              <a href={LINKS.realm(b.realm)} target="_blank" rel="noreferrer">
                Open the realm on Realms
              </a>
            </p>
          </article>

          <article className="case">
            <h3>Drift: the timelock went first</h3>
            <p className="case-sub">Four on-chain signals in the three weeks before $285M was drained on 1 April 2026.</p>
            <ol className="timeline">
              {DRIFT_TIMELINE.map((e) => (
                <li key={e.date + e.title}>
                  <time dateTime={e.date}>{day(e.date)}</time>
                  <span className="tl-rail" aria-hidden="true">
                    <i style={{ background: e.critical ? 'var(--breach)' : 'var(--idle)' }} />
                  </span>
                  <div className="tl-body">
                    <h4>{e.title}</h4>
                    <p>{e.body}</p>
                    {e.flag && <span className="tl-flag">Sentinel flags: {e.flag}</span>}
                  </div>
                </li>
              ))}
            </ol>
            <p className="case-note">
              The 27 March change — a threshold lowered and a timelock removed — is exactly what
              Sentinel’s watcher checks every hour, and it alerts on both.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- markets */

function Markets({ oracles, tvl, protocols, funding }) {
  useTick(5_000);
  const feeds = Object.values(oracles || {});
  const rows = protocols
    .map((p) => {
      const h = tvl[p.id] || [];
      return { ...p, latest: h[h.length - 1] };
    })
    .filter((p) => p.latest)
    .sort((a, b) => b.latest.tvl - a.latest.tvl);
  const max = Math.max(1, ...rows.map((r) => r.latest.tvl));

  return (
    <section className="section" id="markets">
      <div className="wrap">
        <div className="section-head">
          <h2>Market signals</h2>
          <p>
            Prices are read from Pyth’s price accounts on Solana — the same data the lending
            protocols consume. A feed that drifts from its five-minute average or stops updating
            raises a signal.
          </p>
        </div>

        <div className="markets">
          <div>
            <h3 className="panel-title">
              Oracle prices <span>Pyth, on-chain</span>
            </h3>
            {feeds.length === 0 ? (
              <p className="empty">Waiting for the first oracle read.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Feed</th>
                    <th scope="col" className="r">
                      Price
                    </th>
                    <th scope="col" className="r">
                      vs 5-min avg
                    </th>
                    <th scope="col" className="r">
                      Age
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {feeds.map((o) => {
                    const dev = o.deviationFromTwap ?? 0;
                    const dot = o.status === 'healthy' ? '' : o.status === 'stale' ? 'dot-warn' : 'dot-bad';
                    return (
                      <tr key={o.symbol}>
                        <td className="sym">
                          <span className={`dot ${dot}`} aria-hidden="true" />
                          {o.symbol}
                          <span className="visually-hidden">, {o.status}</span>
                        </td>
                        <td className="r num">{usd(o.price, o.price < 2 ? 4 : 2)}</td>
                        <td className={`r num ${Math.abs(dev) > 0.5 ? 'neg' : ''}`}>{pct(dev, 3)}</td>
                        <td className="r num">{ago(o.publishTime * 1000)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 className="panel-title">
              Deposits <span>DefiLlama TVL</span>
            </h3>
            {rows.length === 0 ? (
              <p className="empty">Waiting for TVL data.</p>
            ) : (
              rows.map((p) => (
                <div className="tvl-row" key={p.id}>
                  <span className="name">{p.name}</span>
                  <span className="num">
                    {usd(p.latest.tvl)}
                    {p.latest.change24h ? (
                      <span className={p.latest.change24h >= 0 ? 'pos' : 'neg'}>
                        {' '}
                        {pct(p.latest.change24h, 1)}
                      </span>
                    ) : null}
                  </span>
                  <div className="tvl-bar">
                    <span style={{ width: `${(p.latest.tvl / max) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
            {funding && (funding.binance != null || funding.bybit != null) ? (
              <>
                <div className="funding">
                  {funding.binance != null && (
                    <div>
                      SOL funding, Binance
                      <b className="num">{pct(funding.binance * 100, 4)}</b>
                    </div>
                  )}
                  {funding.bybit != null && (
                    <div>
                      SOL funding, Bybit
                      <b className="num">{pct(funding.bybit * 100, 4)}</b>
                    </div>
                  )}
                </div>
                <p className="footnote">
                  Funding is per 8 hours. Above 0.1% means crowded positioning and higher liquidation
                  risk across lending markets.
                </p>
              </>
            ) : (
              <p className="footnote">Funding rates are unavailable right now.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- signals */

function normalize(alerts, governance) {
  const fromFeed = (alerts || []).map((a) => ({
    key: a.id || `${a.type}-${a.timestamp}`,
    time: a.timestamp,
    severity: a.severity,
    title: a.title,
    body: a.description,
  }));
  const fromGov = (governance || []).map((a) => ({
    key: `${a.code}-${a.programId}-${a.detectedAt}`,
    time: Date.parse(a.detectedAt),
    severity: a.severity,
    title: a.code
      ?.toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase()),
    body: a.message,
  }));
  return [...fromGov, ...fromFeed].sort((a, b) => b.time - a.time).slice(0, 40);
}

function Signals({ alerts, trust }) {
  useTick(30_000);
  const items = normalize(alerts, trust?.alerts);
  return (
    <section className="section" id="signals">
      <div className="wrap">
        <div className="section-head">
          <h2>Signals</h2>
          <p>
            Governance changes, oracle deviations and liquidity drops, newest first. Critical
            governance changes also go out on Telegram.
          </p>
        </div>
        <div className="feed">
          {items.length === 0 ? (
            <p className="empty">
              Nothing to report. Sentinel checks oracles every 30 seconds and governance every hour;
              anything that weakens a protocol shows up here.
            </p>
          ) : (
            items.map((s) => (
              <div className="signal" key={s.key}>
                <time dateTime={new Date(s.time).toISOString()}>{ago(s.time)}</time>
                <div>
                  <h4>
                    <span className={`sev sev-${s.severity}`}>
                      {s.severity?.[0].toUpperCase() + s.severity?.slice(1)}
                    </span>
                    {s.title}
                  </h4>
                  {s.body && <p>{s.body}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ footer */

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <span>Sentinel is open source and reads only public chain data. Built by @Makabeez.</span>
        <nav aria-label="Elsewhere">
          <a href={LINKS.repo} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={LINKS.x} target="_blank" rel="noreferrer">
            X
          </a>
        </nav>
      </div>
    </footer>
  );
}

export default function App() {
  const s = useSentinel();
  return (
    <>
      <Header mode={s.mode} lastUpdate={s.lastUpdate} />
      <main>
        <Hero trust={s.trust} trustSource={s.trustSource} />
        <Governance trust={s.trust} trustSource={s.trustSource} />
        <Wallet trust={s.trust} />
        <Cases />
        <Markets oracles={s.oracles} tvl={s.tvl} protocols={s.protocols} funding={s.funding} />
        <Signals alerts={s.alerts} trust={s.trust} />
      </main>
      <Footer />
    </>
  );
}
