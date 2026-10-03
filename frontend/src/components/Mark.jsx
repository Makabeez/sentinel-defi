import { useEffect, useState } from 'react';

// The Sentinel mark, animated once on load: four seats sign in turn, then one
// seat is flagged — a multisig at quorum with something wrong in it.
const C = 2 * Math.PI * 44;
const P = C / 7;
const SEAT = (P - 6).toFixed(3);
const REST = (C - (P - 6)).toFixed(3);

const SIGN_ORDER = [0, 1, 2, 3];
const FLAG_SEAT = 5;

export default function Mark({ animate = true, size }) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [step, setStep] = useState(animate && !reduced ? 0 : SIGN_ORDER.length + 1);

  useEffect(() => {
    if (step > SIGN_ORDER.length) return undefined;
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 500 : 420);
    return () => clearTimeout(t);
  }, [step]);

  const seatColor = (i) => {
    if (i === FLAG_SEAT && step > SIGN_ORDER.length) return '#ffb020';
    const signedAt = SIGN_ORDER.indexOf(i);
    if (signedAt !== -1 && step > signedAt) return '#7c5cff';
    return '#3a4358';
  };

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label="Sentinel mark: a seven-seat signer ring with four seats signed and one flagged"
    >
      <g transform="rotate(-90 60 60)">
        {Array.from({ length: 7 }, (_, i) => (
          <circle
            key={i}
            className="seat"
            cx="60"
            cy="60"
            r="44"
            fill="none"
            strokeWidth="9"
            stroke={seatColor(i)}
            strokeDasharray={`${SEAT} ${REST}`}
            strokeDashoffset={(-i * P).toFixed(3)}
          />
        ))}
      </g>
      <circle cx="60" cy="60" r="17" fill="#c9d1e3" />
      <circle cx="60" cy="60" r="6.5" fill="#0d0f16" />
    </svg>
  );
}
