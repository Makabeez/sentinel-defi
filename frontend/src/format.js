export function duration(seconds) {
  if (!seconds) return null;
  const h = seconds / 3600;
  if (h >= 48 && h % 24 === 0) return `${h / 24} days`;
  if (h >= 1) return `${+h.toFixed(1)} hour${h === 1 ? '' : 's'}`;
  return `${Math.round(seconds / 60)} minutes`;
}

export function controlSentence(p) {
  if (p.error) return 'Not scored yet. Sentinel only scores programs whose upgrade authority it can read on-chain.';
  const wait = duration(p.timelockSeconds);
  const delay = wait ? `Changes wait ${wait} before they take effect.` : 'Changes take effect immediately.';
  switch (p.model) {
    case 'multisig':
      return `${p.threshold} of ${p.members} signers can replace this program. ${delay}`;
    case 'single-key':
      return `One private key can replace this program. ${delay}`;
    case 'dao':
      return `A DAO vote can replace this program. ${delay}`;
    case 'immutable':
      return 'This program can’t be changed by anyone.';
    default:
      return 'Controlled by a program-derived address Sentinel hasn’t resolved yet.';
  }
}

export function ago(ts) {
  if (!ts) return null;
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function usd(n, digits) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${n.toLocaleString('en-US', { maximumFractionDigits: digits ?? 0 })}`;
  if (n >= 1) return `$${n.toFixed(digits ?? 2)}`;
  return `$${n.toFixed(digits ?? 4)}`;
}

export function shortAddr(a) {
  return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—';
}

export function pct(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`;
}

export function day(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
