import React from 'react';
import { TARGET_WORK_TOLERANCE, goalBand } from './utils/timeClock.js';

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

function Bars({ data, target, height = 64 }) {
  const lowerTarget = Math.max(0, (target || 0) - TARGET_WORK_TOLERANCE);
  const upperTarget = (target || 0) + TARGET_WORK_TOLERANCE;
  const max = Math.max(upperTarget || 1, ...data.map(day => day.minutes || 0), 1);
  const lowerBottom = `${Math.min(100, (lowerTarget / max) * 100)}%`;
  const bandHeight = `${Math.max(0, ((upperTarget - lowerTarget) / max) * 100)}%`;
  return (
    <div style={{ position:'relative' }}>
      <div style={{ position:'absolute', left:0, right:0, bottom:`calc(${lowerBottom} + 18px)`, height:bandHeight, background:'rgba(31,212,123,0.08)', borderTop:'1px dashed rgba(188,255,214,0.35)', borderBottom:'1px dashed rgba(188,255,214,0.35)', pointerEvents:'none' }} />
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${data.length}, minmax(0,1fr))`, gap:10, position:'relative' }}>
        {data.map((day, index) => {
          const barHeight = ((day.minutes || 0) / max) * height;
          const band = goalBand(day.minutes || 0);
          const tone = band === 'target'
            ? 'var(--good)'
            : band === 'below'
              ? '#fbbf24'
              : band === 'empty'
                ? 'rgba(255,255,255,0.08)'
                : 'var(--bad)';
          return (
            <div key={`${day.day}-${index}`} style={{ display:'grid', gridTemplateRows:`${height}px 12px`, gap:6, alignItems:'end', minWidth:0 }}>
              <div style={{ position:'relative', height }}>
                <div
                  className="tdg-bar"
                  style={{
                    position:'absolute',
                    left:'50%',
                    bottom:0,
                    transform:'translateX(-50%)',
                    width:'58%',
                    maxWidth:28,
                    height: Math.max(day.minutes ? 3 : 2, barHeight),
                    borderRadius: 6,
                    background: tone,
                    opacity: tone.startsWith('rgba') ? 0.35 : 0.92,
                    animationDelay: `${index * 60}ms`,
                  }}
                />
              </div>
              <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 700, textAlign:'center', whiteSpace:'nowrap' }}>{day.day}</span>
            </div>
          );
        })}
      </div>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) minmax(320px, 380px)', gap: 24, alignItems: 'center', position: 'relative' }}>
        <Ring value={workedMinutes} max={goalMinutes}>
          <span className="tdg-num">{fmtHm(workedMinutes)}</span>
          <span className="small">of {fmtHm(goalMinutes)}</span>
        </Ring>

        <div>
          <div className="tdg-eyebrow" style={{ marginBottom: 4 }}>Focus today</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 0, lineHeight: 1.05 }}>
            {pct}% of goal
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {clockIn && <span className="tdg-chip">Clock-in {clockIn}</span>}
            {shippedThisWeek > 0 && <span className="tdg-chip good">{shippedThisWeek} shipped this week</span>}
            {streakDays > 0 && <span className="tdg-chip accent">{streakDays}-day streak</span>}
          </div>
        </div>

        {week.length > 0 && (
          <div style={{ width: '100%', alignSelf: 'center', display:'flex', flexDirection:'column', justifyContent:'center', paddingRight: 4 }}>
            <div className="tdg-eyebrow" style={{ marginBottom: 8 }}>This week</div>
            <Bars data={week} target={goalMinutes} height={58} />
          </div>
        )}
      </div>
    </div>
  );
}
