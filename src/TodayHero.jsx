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
  const tone = goalBand(value) === 'target'
    ? 'var(--good)'
    : goalBand(value) === 'empty'
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

function Bars({ data, target, height = 64 }) {
  const max = Math.max(target || 1, ...data.map(day => day.minutes || 0), 1);
  return (
    <div style={{ display:'grid', gridTemplateColumns:`repeat(${data.length}, minmax(0,1fr))`, gap:8 }}>
      {data.map((day, index) => {
        const barHeight = ((day.minutes || 0) / max) * height;
        const band = goalBand(day.minutes || 0);
        const tone = band === 'target'
          ? 'var(--good)'
          : band === 'empty'
            ? 'rgba(255,255,255,0.08)'
            : 'var(--bad)';
        return (
          <div key={`${day.day}-${index}`} style={{ display:'grid', gridTemplateRows:`${height}px auto`, gap:6, alignItems:'end' }}>
            <div style={{ position:'relative', height }}>
              <div
                className="tdg-bar"
                style={{
                  position:'absolute',
                  left:'50%',
                  bottom:0,
                  transform:'translateX(-50%)',
                  width:'78%',
                  height: Math.max(2, barHeight),
                  borderRadius: 6,
                  background: tone,
                  opacity: tone.startsWith('rgba') ? 0.4 : 0.9,
                  animationDelay: `${index * 60}ms`,
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 600 }}>{day.day}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function TodayHero({
  workedMinutes = 0,
  goalMinutes = 480,
  clockIn = '',
  week = [],
  shippedThisWeek = 0,
  streakDays = 0,
}) {
  const pct = Math.round((workedMinutes / (goalMinutes || 1)) * 100);
  return (
    <div
      className="glass"
      style={{
        borderRadius: 'var(--r-lg, 20px)',
        padding: 22,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -80,
          top: -80,
          width: 280,
          height: 280,
          borderRadius: '50%',
          background: 'radial-gradient(circle, oklch(0.65 0.22 var(--accent-h) / 0.5), transparent 70%)',
          filter: 'blur(20px)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 26, alignItems: 'center', position: 'relative' }}>
        <Ring value={workedMinutes} max={goalMinutes}>
          <span className="tdg-num">{fmtHm(workedMinutes)}</span>
          <span className="small">of {fmtHm(goalMinutes)}</span>
        </Ring>

        <div>
          <div className="tdg-eyebrow" style={{ marginBottom: 4 }}>Focus today</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.05 }}>
            {pct}% of goal
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {clockIn && <span className="tdg-chip">Clock-in {clockIn}</span>}
            {shippedThisWeek > 0 && <span className="tdg-chip good">{shippedThisWeek} shipped this week</span>}
            {streakDays > 0 && <span className="tdg-chip accent">{streakDays}-day streak</span>}
          </div>
        </div>

        {week.length > 0 && (
          <div style={{ width: 250, alignSelf: 'stretch', display:'flex', flexDirection:'column', justifyContent:'center' }}>
            <div className="tdg-eyebrow" style={{ marginBottom: 8 }}>This week</div>
            <Bars data={week} target={goalMinutes} height={52} />
          </div>
        )}
      </div>
    </div>
  );
}
