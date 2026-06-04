import React from 'react';
import { goalBand } from './utils/timeClock.js';

const fmtHm = mins => {
  const total = Math.max(0, Math.round(mins || 0));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};

function Ring({ value, max, size = 88, thickness = 8, children }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  const band = goalBand(value);
  const tone = band === 'target'
    ? 'var(--good)'
    : band === 'below'
      ? '#fbbf24'
      : band === 'empty'
        ? 'rgba(255,255,255,0.16)'
        : 'var(--bad)';
  return (
    <div className="tdg-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={thickness} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={tone}
          strokeWidth={thickness}
          fill="none"
          strokeDasharray={`${circumference * pct} ${circumference}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(.2,.7,.2,1)' }}
        />
      </svg>
      <div className="tdg-ring-label">{children}</div>
    </div>
  );
}

export default function TodayHero({
  workedMinutes = 0,
  goalMinutes = 480,
  clockIn = '',
  shippedThisWeek = 0,
  streakDays = 0,
  compact = false,
}) {
  const pct = Math.round((workedMinutes / (goalMinutes || 1)) * 100);
  const ringSize = compact ? 58 : 88;
  return (
    <div
      className="glass"
      style={{
        borderRadius: 'var(--r-lg, 20px)',
        padding: compact ? 12 : 22,
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -80,
          top: -80,
          width: compact ? 170 : 280,
          height: compact ? 170 : 280,
          borderRadius: '50%',
          background: 'radial-gradient(circle, oklch(0.65 0.22 var(--accent-h) / 0.5), transparent 70%)',
          filter: 'blur(20px)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: compact ? 12 : 24, alignItems: 'center', position: 'relative' }}>
        <Ring value={workedMinutes} max={goalMinutes} size={ringSize} thickness={compact ? 6 : 8}>
          <span className="tdg-num">{fmtHm(workedMinutes)}</span>
          <span className="small">of {fmtHm(goalMinutes)}</span>
        </Ring>

        <div>
          <div className="tdg-eyebrow" style={{ marginBottom: 4 }}>Focus today</div>
          <div style={{ fontSize: compact ? 20 : 30, fontWeight: 800, letterSpacing: 0, lineHeight: 1.05 }}>
            {pct}% of goal
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {clockIn && <span className="tdg-chip">Clock-in {clockIn}</span>}
            {shippedThisWeek > 0 && <span className="tdg-chip good">{shippedThisWeek} shipped this week</span>}
            {streakDays > 0 && <span className="tdg-chip accent">{streakDays}-day streak</span>}
          </div>
        </div>

      </div>
    </div>
  );
}
