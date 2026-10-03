// A protocol's upgrade authority drawn as a ring of signer seats, the same
// visual language as the Sentinel mark: violet seats are the ones needed to
// approve a change, slate seats are the rest of the signer set.

const C = {
  signed: '#7c5cff',
  idle: '#3a4358',
  flagged: '#ffb020',
  breach: '#ff5a6e',
  core: '#c9d1e3',
};

function arc(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function describeRing(p) {
  if (p.error) return 'Not scored';
  if (p.model === 'multisig' && p.members) return `${p.threshold} of ${p.members} signers`;
  if (p.model === 'single-key') return 'Single private key';
  if (p.model === 'immutable') return 'Immutable';
  if (p.model === 'dao') return 'DAO vote';
  return 'Unresolved controller';
}

export default function SeatRing({ protocol, size = 76 }) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(5, size * 0.09);
  const r = size / 2 - stroke / 2 - 1;
  const label = describeRing(protocol);
  const { model, members, threshold, error } = protocol;

  let seats = [];
  let center = null;
  let dashed = false;

  if (error || (!members && model !== 'single-key' && model !== 'immutable')) {
    dashed = true;
  } else if (model === 'single-key') {
    seats = [{ color: C.breach, full: true }];
    center = '1';
  } else if (model === 'immutable') {
    seats = [{ color: C.signed, full: true }];
  } else {
    const n = Math.min(members, 30);
    const t = Math.min(threshold, n);
    seats = Array.from({ length: n }, (_, i) => ({ color: i < t ? C.signed : C.idle }));
    center = `${threshold}/${members}`;
  }

  const gap = seats.length > 12 ? 0.07 : 0.12;
  const start = -Math.PI / 2;
  const step = (2 * Math.PI) / Math.max(seats.length, 1);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <title>{label}</title>
      {dashed && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.idle} strokeWidth={stroke * 0.5} strokeDasharray="3 5" />
      )}
      {seats.map((s, i) =>
        s.full ? (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke} />
        ) : (
          <path
            key={i}
            d={arc(cx, cy, r, start + i * step + gap / 2, start + (i + 1) * step - gap / 2)}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
          />
        )
      )}
      {center && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill={C.core}
          style={{
            fontFamily: 'Archivo, system-ui, sans-serif',
            fontVariationSettings: "'wdth' 75",
            fontWeight: 650,
            fontSize: size * (center.length > 3 ? 0.2 : 0.24),
          }}
        >
          {center}
        </text>
      )}
      {dashed && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#8a93a8"
          style={{ fontFamily: 'Archivo, system-ui, sans-serif', fontSize: size * 0.24, fontWeight: 600 }}
        >
          ?
        </text>
      )}
    </svg>
  );
}
