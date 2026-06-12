import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import IconRail from './IconRail.jsx';
import MentionTextarea, { MentionProvider } from './MentionTextarea.jsx';
import { wikilinksToMarkdown, isWikilinkHref, wikilinkTarget } from './utils/mentions.js';
import { parseTask, parseProperty, parseProject, parseDailyNote, parseMeeting, parsePerson, parseOrganization, readMdFiles, readDirNames, readImageFiles } from './utils/parser.js';
import { idbGet, idbSet, idbDel, lsGet, lsSet, lsDel } from './utils/storage.js';
import { fmt, tod, isToday, isOver, longDate, appendNoteToMd, appendPropertyCommentToMd, updateCommentLog, deleteCommentLog, appendDailySectionEntry, appendDailyTimeClockEvent, buildDailyNoteMd, buildTrackerRow, appendTrackerRow, buildMeetingMd, buildNewTaskMd, buildNewPropertyMd, buildNewProjectMd, buildNewPersonMd, buildNewOrganizationMd, kebabSlug, finishRecurrentTaskInstance, markTaskDone, postponeTaskDates, postponeTaskDatesByMonths, replaceDailyTimeClockRows, setDailyWorkStatus, setPropertyCover, touchDateModified, updateTaskDates, updateTaskThreadSubject } from './utils/formatter.js';
import { TARGET_WORK_MINUTES, TARGET_WORK_TOLERANCE, WORK_CHART_MAX_MINUTES, WEEKDAY_LABELS, WORK_EVENT_ORDER, WORK_STATUS_LABELS, dashboardStats, goalBand, minutesFromTime, workStats } from './utils/timeClock.js';

const REFRESH_MS  = 5 * 60 * 1000;
const WARN_MS     = 60 * 60 * 1000;
const WARN_CHK_MS = 30 * 1000;

const FOLDER_DEFS = [
  { key:'tasks',      label:'Tasks',      mode:'readwrite', required:true,  desc:'Where your task .md files live (e.g. TaskNotes/Tasks)' },
  { key:'done',       label:'Done / Archive', mode:'readwrite', required:false, desc:'Optional folder for completed or archived task .md files' },
  { key:'meetings',   label:'Meetings',   mode:'readwrite', required:false, desc:'Where meeting notes created by TaskDash should be saved' },
  { key:'projects',   label:'Projects',   mode:'readwrite', required:false, desc:'For project autocomplete and project editing' },
  { key:'properties', label:'Properties', mode:'readwrite', required:false, desc:'For building autocomplete and property comments' },
  { key:'clients',    label:'Clients',    mode:'read',      required:false, desc:'For client autocomplete' },
  { key:'people',     label:'People',     mode:'readwrite', required:false, desc:'For "waiting for" autocomplete and adding new people' },
  { key:'organizations', label:'Organizations', mode:'readwrite', required:false, desc:'For organization notes, autocomplete, and adding new organizations' },
  { key:'attachments', label:'Attachments', mode:'readwrite', required:false, desc:'For property cover images and uploads' },
  { key:'daily',      label:'Daily Notes', mode:'readwrite', required:false, desc:'Where TaskDash should auto-create YYYY-MM-DD daily notes' },
];
const REF_KEYS = ['projects','properties','clients','people','organizations'];
const FOLDER_SETUP_SEEN = 'folderSetupV2Seen';
const WRITE_BACKUPS_KEY = 'taskdashWriteBackups';
const SAVED_FILTERS_KEY = 'taskdashSavedFilters';
const FOLDER_LABELS = Object.fromEntries(FOLDER_DEFS.map(def => [def.key, def.label]));
const HIDDEN_TASK_TAG = 'lifeos';
const TEXT_PRIMARY = '#1d2421';
const TEXT_SECONDARY = '#5a615b';
const TEXT_MUTED = '#8a928d';
const TEXT_FAINT = '#9aa19c';
const BRAND_GRADIENT = 'linear-gradient(180deg,#23a564,#13733f)';
const BRAND_SHADOW = '0 8px 18px rgba(16,96,60,0.30), inset 0 1px 0 rgba(255,255,255,0.32)';
const BRAND_SURFACE = 'rgba(20,120,72,0.10)';
const BRAND_SURFACE_STRONG = 'rgba(20,120,72,0.16)';
const BRAND_BORDER = 'rgba(20,120,72,0.20)';
const BRAND_BORDER_STRONG = 'rgba(20,120,72,0.42)';
const BRAND_TEXT = '#115c34';
const BRAND_LABEL = '#5f9d79';
const GLASS_INNER = 'rgba(255,255,255,0.55)';
const GLASS_BORDER = 'rgba(255,255,255,0.60)';

const STATUS_COLORS = {
  done:          { bg:'rgba(20,120,72,0.10)',   color:'#13733f' },
  'in-progress': { bg:'rgba(91,141,239,0.10)',  color:'#3f6fd0' },
  todo:          { bg:'rgba(91,141,239,0.10)',  color:'#3f6fd0' },
  none:          { bg:'rgba(90,97,91,0.10)',    color:'#5a615b' },
};

function hasHiddenTaskTag(task) {
  return (task.tags || []).some(tag => {
    const normalized = String(tag).trim().replace(/^#/, '').toLowerCase().replace(/[\s_-]/g, '');
    return normalized === HIDDEN_TASK_TAG || normalized.startsWith(`${HIDDEN_TASK_TAG}/`);
  });
}

function isBrainDumpTask(task) {
  return [task?.title, task?.filename, task?.id]
    .filter(Boolean)
    .some(value => /^BD(?:\s|-)/i.test(String(value).trim()));
}

async function rememberWriteBackup(handle, oldText) {
  if (!oldText || typeof oldText !== 'string' || oldText.length > 500000) return;
  try {
    const backups = (await idbGet(WRITE_BACKUPS_KEY)) || [];
    const next = [
      {
        at: new Date().toISOString(),
        filename: handle?.name || 'Unknown file',
        content: oldText,
        size: oldText.length,
        preview: oldText.replace(/\s+/g, ' ').trim().slice(0, 180),
      },
      ...backups,
    ].slice(0, 25);
    await idbSet(WRITE_BACKUPS_KEY, next);
    window.dispatchEvent(new CustomEvent('taskdash-backups-updated'));
  } catch(e) {
    console.warn('backup capture failed', e);
  }
}

async function writeFile(handle, content) {
  if (typeof content === 'string') {
    try {
      const oldText = await (await handle.getFile()).text();
      if (oldText && oldText !== content) await rememberWriteBackup(handle, oldText);
    } catch(e) {
      console.warn('pre-write backup skipped', e);
    }
  }
  const w = await handle.createWritable();
  await w.write(content); await w.close();
}

async function readHandleText(handle) {
  return await (await handle.getFile()).text();
}

async function removeFileAtPath(rootDir, path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let dir = rootDir;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  await dir.removeEntry(name);
}

function Toast({ msg, onClose }) {
  return (
    <div style={{ position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', zIndex:999,
      padding:'12px 20px', borderRadius:10, background:'rgba(208,150,52,0.12)',
      border:'1px solid rgba(208,150,52,0.28)', color:'#a9791f', fontSize:13, fontWeight:600,
      display:'flex', alignItems:'center', gap:12, boxShadow:'0 12px 32px rgba(20,40,30,0.12)',
      backdropFilter:'blur(12px)', maxWidth:440, fontFamily:'inherit' }}>
      <span>{msg}</span>
      <button onClick={onClose} style={{ background:'none', border:'none', color:'#a9791f', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
    </div>
  );
}

function PBadge({ p }) {
  return <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, textTransform:'uppercase', letterSpacing:'0.05em',
    background:p==='high'?'rgba(225,91,79,0.10)':'rgba(91,87,176,0.10)', color:p==='high'?'#c2533f':'#5b57b0', fontFamily:"'JetBrains Mono', monospace" }}>{p}</span>;
}

function SBadge({ s }) {
  const c = STATUS_COLORS[s] || STATUS_COLORS.none;
  return <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, textTransform:'uppercase', letterSpacing:'0.05em', background:c.bg, color:c.color, fontFamily:"'JetBrains Mono', monospace" }}>{s}</span>;
}

function parseLogText(text) {
  const m = text.match(/^\[(\d{2}:\d{2})\]\s*([\s\S]*)$/);
  return m ? { time:m[1], body:m[2] } : { time:null, body:text };
}

function logOccurrence(logs, index) {
  const target = logs[index];
  if (!target) return 0;
  return logs.slice(0, index).filter(l => l.date === target.date && l.text === target.text).length;
}

function taskDescriptionText(raw = '') {
  const withoutFrontmatter = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n?/, '');
  const wrappedDescription = withoutFrontmatter.match(/^\s*(?:---|___)\s*\n([\s\S]*?)\n(?:---|___)\s*(?=\n|$)/);
  const body = wrappedDescription ? wrappedDescription[1] : withoutFrontmatter;
  return body
    .split(/\n### (?:\[\[)?(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/)[0]
    .replace(/^#{1,6}\s+Task descri(?:p)?tion\s*\n?/i, '')
    .replace(/^#\s+.+\n?/, '')
    .trim();
}

function initials(text = '') {
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || '?';
}

function noteBodyText(raw = '') {
  return raw
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/^#\s+.+\n?/, '')
    .trim();
}

function markdownSectionText(raw = '', heading) {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const match = text.match(new RegExp(`(^|\\n)##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*(?=\\n|$)`, 'i'));
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.search(/\n##\s+/);
  return rest.slice(0, next === -1 ? undefined : next).trim();
}

function splitIntoBulletPoints(text = '') {
  const compact = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!compact) return [];
  if (/^-\s+/m.test(compact)) {
    return compact
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^-\s+/.test(line))
      .map(line => line.replace(/^-\s+/, ''));
  }
  const sentences = compact
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const bullets = [];
  for (let index = 0; index < sentences.length; index += 2) bullets.push(sentences.slice(index, index + 2).join(' '));
  return bullets;
}

function parseMeetingView(raw = '') {
  const body = noteBodyText(raw);
  const field = label => body.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i'))?.[1]?.trim() || '';
  const linkedContext = markdownSectionText(body, 'Linked context')
    .split('\n')
    .map(line => line.trim())
    .map(line => line.match(/^- \*\*(.+?):\*\*\s*(.+)$/))
    .filter(Boolean)
    .map(([, label, value]) => ({
      label,
      values: value.split(',').map(item => item.trim().replace(/^\[\[|\]\]$/g, '')).filter(Boolean),
    }));
  const notes = splitIntoBulletPoints(markdownSectionText(body, 'Notes'));
  return {
    date: field('Date'),
    start: field('Start'),
    end: field('End'),
    duration: field('Duration'),
    linkedContext,
    notes,
  };
}

function MarkdownBody({ children, emptyText = 'No Markdown content yet.', compact = false }) {
  const text = String(children || '').trim();
  if (!text) return <div style={{ color:TEXT_MUTED }}>{emptyText}</div>;
  return (
    <div className={`markdown-body${compact ? ' markdown-compact' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, href, children: linkChildren, ...props }) => isWikilinkHref(href)
            ? <span className="wikilink" title={`Linked note: ${wikilinkTarget(href)}`}>{linkChildren}</span>
            : <a {...props} href={href} target="_blank" rel="noreferrer">{linkChildren}</a>,
          img: ({ node: _node, ...props }) => <img {...props} loading="lazy" />,
          input: ({ node: _node, ...props }) => <input {...props} disabled />,
        }}
      >
        {wikilinksToMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}

function DetailPatternPanel({ eyebrow, title, subtitle, action, children }) {
  return (
    <div style={{ flex:1, minHeight:0, overflow:'hidden', padding:'18px 24px 20px', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:12, flexShrink:0 }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:6 }}>{eyebrow}</div>
          <h2 style={{ margin:0, fontSize:26, color:TEXT_PRIMARY, letterSpacing:0, lineHeight:1.1 }}>{title}</h2>
          {subtitle && <div style={{ fontSize:13, color:'rgba(90,97,91,0.78)', marginTop:6 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function DetailIdentityCard({ avatarText, avatarRadius = 999, title, subtitle, chips = [], action }) {
  return (
    <section className="glass-thin" style={{ borderRadius:16, padding:'12px 14px', marginBottom:10, flexShrink:0 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:14, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
          <div style={{ width:42, height:42, borderRadius:avatarRadius, background:BRAND_GRADIENT, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:900, flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
            {avatarText}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:18, color:TEXT_PRIMARY, fontWeight:800, lineHeight:1.1 }}>{title}</div>
            {subtitle && <div style={{ fontSize:12, color:'rgba(90,97,91,0.72)', marginTop:5 }}>{subtitle}</div>}
            {!!chips.length && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:8 }}>
                {chips.map(chip => (
                  <span key={chip} style={{ padding:'5px 9px', borderRadius:999, fontSize:10, fontWeight:800, color:TEXT_PRIMARY, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)' }}>
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {action}
      </div>
    </section>
  );
}

function DetailMetricStrip({ metrics }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:10, marginBottom:10, flexShrink:0 }}>
      {metrics.map(({ label, value, tone }) => {
        const displayValue = value ?? '--';
        const valueText = String(displayValue);
        return (
          <section key={label} className="glass-thin" style={{ borderRadius:12, padding:'10px 12px', minWidth:0 }}>
            <div style={{ fontSize:valueText.length > 7 ? 16 : 24, fontWeight:850, color:tone || TEXT_PRIMARY, lineHeight:1.08, fontVariantNumeric:'tabular-nums', overflowWrap:'anywhere' }}>{displayValue}</div>
            <div style={{ fontSize:9, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.12em', marginTop:7 }}>{label}</div>
          </section>
        );
      })}
    </div>
  );
}

function DetailNotesEditor({ meta, value, onChange, minHeight = 360, placeholder }) {
  return (
    <section className="glass-thin" style={{ borderRadius:16, padding:'14px', minHeight:0, flex:'1 1 0', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:5 }}>Notes (Markdown)</div>
          {meta && <div style={{ fontSize:12, color:'rgba(90,97,91,0.72)' }}>{meta}</div>}
        </div>
      </div>
      <MentionTextarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        spellCheck={false}
        style={{ flex:1, width:'100%', resize:'none', padding:'16px 18px', borderRadius:14, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.62)', color:'#222a25', outline:'none', fontFamily:"'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace", fontSize:13, lineHeight:1.7 }}
      />
    </section>
  );
}

function DetailMarkdownCard({ label = 'Notes', children, minHeight = 260 }) {
  return (
    <section className="glass-thin" style={{ borderRadius:16, padding:'14px 16px', minHeight:0, flex:'1 1 0', overflowY:'auto' }}>
      <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:10 }}>{label}</div>
      {children}
    </section>
  );
}

function DetailMarkdownEditorCard({ meta, value, onChange, emptyText }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="glass-thin" style={{ borderRadius:16, padding:'14px', minHeight:0, flex:'1 1 0', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:10, flexShrink:0 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:5 }}>Notes (Markdown)</div>
          {meta && <div style={{ fontSize:12, color:'rgba(90,97,91,0.72)' }}>{meta}</div>}
        </div>
        <button onClick={()=>setEditing(value => !value)} style={{ padding:'6px 10px', borderRadius:999, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:BRAND_TEXT, fontSize:10, fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>
          {editing ? 'Preview' : 'Edit'}
        </button>
      </div>
      {editing ? (
        <MentionTextarea
          value={value}
          onChange={onChange}
          spellCheck={false}
          style={{ flex:1, width:'100%', resize:'none', padding:'16px 18px', borderRadius:14, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.62)', color:'#222a25', outline:'none', fontFamily:"'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace", fontSize:13, lineHeight:1.7 }}
        />
      ) : (
        <div style={{ flex:1, minHeight:0, overflowY:'auto', borderRadius:14, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.62)', padding:'16px 18px' }}>
          <MarkdownBody emptyText={emptyText}>{value}</MarkdownBody>
        </div>
      )}
    </section>
  );
}

function DetailRawMarkdownEditorCard({ meta, value, onChange, placeholder = 'Edit this note...' }) {
  return (
    <section className="glass-thin" style={{ borderRadius:16, padding:'14px', minHeight:0, flex:'1 1 0', display:'flex', flexDirection:'column' }}>
      <div style={{ marginBottom:10, flexShrink:0 }}>
        <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:5 }}>Full note (Markdown)</div>
        {meta && <div style={{ fontSize:12, color:'rgba(90,97,91,0.72)' }}>{meta}</div>}
      </div>
      <MentionTextarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        spellCheck={false}
        style={{ flex:1, width:'100%', resize:'none', padding:'16px 18px', borderRadius:14, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.62)', color:'#222a25', outline:'none', fontFamily:"'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace", fontSize:13, lineHeight:1.7 }}
      />
    </section>
  );
}

function ScreenLogo() {
  return (
    <div aria-hidden="true" style={{ position:'absolute', right:16, bottom:12, zIndex:8, pointerEvents:'none', opacity:0.22 }}>
      <div style={{ width:32, height:32, borderRadius:9, display:'grid', placeItems:'center', background:'linear-gradient(150deg,#24a661,#0d733f)', color:'#fff', boxShadow:'0 8px 18px rgba(15,107,63,0.22), inset 0 1px 0 rgba(255,255,255,0.35)' }}>
        <svg width="23" height="23" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 16H20.5" />
          <path d="M7.5 10.5L16.5 16L7.5 21.5" />
          <path d="M16.5 8H25.5" />
          <path d="M16.5 8V24" />
          <path d="M16.5 12H23" />
        </svg>
      </div>
    </div>
  );
}

function CommentCard({ log, index, onSave, onDelete }) {
  const { time, body } = parseLogText(log.text);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const editRows = Math.max(5, draft.split('\n').length + 2);

  useEffect(() => {
    setDraft(body);
    setEditing(false);
  }, [body, log.date, log.text]);

  return (
    <div style={{ width:'100%', minWidth:0, maxWidth:'100%', height:'auto', minHeight:'max-content', boxSizing:'border-box', marginBottom:10, padding:'14px 16px', borderRadius:10, background:BRAND_SURFACE, border:`1px solid ${BRAND_BORDER}`, overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:8 }}>
        <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:700 }}>{log.date}{time?` · ${time}`:''}</div>
        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
          {editing ? (
            <>
              <button onClick={()=>{ setDraft(body); setEditing(false); }} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', cursor:'pointer', fontSize:10, fontWeight:800, fontFamily:'inherit' }}>Cancel</button>
              <button onClick={()=>onSave(index, draft)} disabled={!draft.trim()} style={{ padding:'4px 8px', borderRadius:7, border:'none', background:'rgba(20,120,72,0.14)', color:'#13733f', cursor:draft.trim()?'pointer':'not-allowed', opacity:draft.trim()?1:0.4, fontSize:10, fontWeight:800, fontFamily:'inherit' }}>Save</button>
            </>
          ) : (
            <>
              <button onClick={()=>setEditing(true)} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:BRAND_TEXT, cursor:'pointer', fontSize:10, fontWeight:800, fontFamily:'inherit' }}>Edit</button>
              <button onClick={()=>onDelete(index)} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid rgba(225,91,79,0.2)', background:'rgba(225,91,79,0.08)', color:'#c2533f', cursor:'pointer', fontSize:10, fontWeight:800, fontFamily:'inherit' }}>Delete</button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <MentionTextarea value={draft} onChange={e=>setDraft(e.target.value)} rows={editRows}
          style={{ display:'block', width:'100%', minWidth:0, maxWidth:'100%', minHeight:120, maxHeight:360, boxSizing:'border-box', padding:'11px 12px', borderRadius:8, resize:'vertical', background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.66)', color:'#222a25', fontSize:13, lineHeight:1.55, outline:'none', fontFamily:'inherit', whiteSpace:'pre-wrap', overflowWrap:'anywhere', overflowY:'auto', overflowX:'hidden' }}/>
      ) : (
        <MarkdownBody>{body}</MarkdownBody>
      )}
    </div>
  );
}

function safeFilename(title) {
  return title.trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 180) || 'Untitled task';
}

function isIsoDate(value) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function parseQuickCaptureText(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tags = [];
  let due = '';
  let dueInvalid = '';
  let priority = 'normal';
  const titleParts = [];
  for (const word of words) {
    if (/^#\w+/.test(word)) tags.push(word.slice(1));
    else if (/^!(high|normal|low)$/i.test(word)) priority = word.slice(1).toLowerCase();
    else if (/^due:/i.test(word)) {
      due = word.split(':').slice(1).join(':');
      if (!isIsoDate(due)) dueInvalid = due;
    }
    else if (/^today$/i.test(word)) due = tod();
    else if (/^tomorrow$/i.test(word)) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      due = tod(d);
    } else {
      titleParts.push(word);
    }
  }
  return {
    title: titleParts.join(' ').trim(),
    priority,
    status:'none',
    due: isIsoDate(due) ? due : '',
    dueInvalid,
    scheduled:'',
    contexts:'work',
    client:'',
    building:'',
    waitingfor:'',
    projects:[],
    extraTags: tags.join(', '),
    body:'',
    timeEstimate:'',
    recurrent:false,
  };
}

async function checkFolderAvailable(handle) {
  try {
    const iterator = handle.entries();
    await iterator.next();
    return null;
  } catch(e) {
    return e;
  }
}

function buildDiagnostics({ tasks, projects, properties, refs, dirs, folderStats, folderIssues, backups }) {
  const issues = [];
  const duplicateGroups = Object.values(tasks.reduce((acc, t) => {
    const key = (t.title || '').trim().toLowerCase();
    if (!key) return acc;
    acc[key] = acc[key] || [];
    acc[key].push(t);
    return acc;
  }, {})).filter(group => group.length > 1);

  duplicateGroups.forEach(group => {
    issues.push({ level:'warning', text:`Duplicate task title "${group[0].title}" appears ${group.length} times.`, detail:group.map(t => t.id).join(' | ') });
  });
  tasks.forEach(t => {
    if (!/^---\n[\s\S]*?\n---/.test(t.raw || '')) issues.push({ level:'warning', text:`${t.filename} has no frontmatter.`, detail:t.id });
    if (!isIsoDate(t.due)) issues.push({ level:'error', text:`${t.filename} has invalid due date "${t.due}".`, detail:'Use YYYY-MM-DD.' });
    if (!isIsoDate(t.scheduled)) issues.push({ level:'error', text:`${t.filename} has invalid scheduled date "${t.scheduled}".`, detail:'Use YYYY-MM-DD.' });
    if (!t.dateCreated) issues.push({ level:'info', text:`${t.filename} has no dateCreated.`, detail:t.id });
  });

  if (!dirs.tasks) issues.push({ level:'error', text:'Tasks folder is not connected.', detail:'TaskDash needs this to be your mission control.' });
  if (!dirs.meetings) issues.push({ level:'warning', text:'Meetings folder is not connected.', detail:'Meeting notes need a dedicated folder.' });
  if (!dirs.daily) issues.push({ level:'warning', text:'Daily Notes folder is not connected.', detail:'Time tracking and daily review need it.' });
  if (!dirs.people) issues.push({ level:'info', text:'People folder is not connected.', detail:'People autocomplete and person creation are limited.' });
  Object.entries(folderIssues || {}).forEach(([key, issue]) => {
    issues.push({
      level: key === 'tasks' ? 'error' : 'warning',
      text: `${FOLDER_LABELS[key] || key} folder is unavailable.`,
      detail: `${issue.name || 'Saved folder'} may have been moved, renamed, or deleted. Reconnect it in Configure folders.`,
    });
  });

  return {
    issues,
    duplicateGroups,
    counts: {
      tasks: tasks.length,
      openTasks: tasks.filter(t => !t.archived && t.status !== 'done').length,
      doneTasks: tasks.filter(t => t.archived || t.status === 'done').length,
      projects: projects.length,
      properties: properties.length,
      people: refs.people.length,
      backups: backups.length,
    },
    folderStats,
  };
}

function projectFilename(title) {
  const name = safeFilename(title).replace(/^project\s*-\s*/i, '');
  return `Project - ${name || 'Untitled project'}.md`;
}

function coverExtension(file) {
  const fromName = file?.name?.match(/\.(png|jpe?g|gif|webp|avif)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  const byType = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  return byType[file?.type] || 'png';
}

async function uniqueFileNameInDir(dir, preferredName) {
  const dot = preferredName.lastIndexOf('.');
  const stem = dot === -1 ? preferredName : preferredName.slice(0, dot);
  const ext = dot === -1 ? '' : preferredName.slice(dot);
  let name = preferredName;
  let suffix = 2;
  while (true) {
    try {
      await dir.getFileHandle(name);
      name = `${stem}-${suffix++}${ext}`;
    } catch (e) {
      if (e.name === 'NotFoundError') return name;
      throw e;
    }
  }
}

const inputBase = {
  width:'100%', padding:'9px 12px', borderRadius:8,
  background:GLASS_INNER, border:`1px solid ${GLASS_BORDER}`,
  color:TEXT_PRIMARY, fontSize:14, outline:'none', fontFamily:'inherit', colorScheme:'light',
  boxShadow:'inset 0 1px 4px rgba(20,40,30,0.05)',
};
const labelBase = { fontSize:11, color:TEXT_MUTED, fontWeight:700, letterSpacing:'0.10em', textTransform:'uppercase', display:'block', marginBottom:6, fontFamily:"'JetBrains Mono', monospace" };

function Field({ label, children, compact = false }) {
  return (
    <div style={{ marginBottom:compact ? 0 : 11 }}>
      <label style={labelBase}>{label}</label>
      {children}
    </div>
  );
}

function dateFromStr(dateStr) {
  return new Date(`${dateStr}T12:00:00`);
}

function addDays(dateStr, amount) {
  const d = dateFromStr(dateStr);
  d.setDate(d.getDate() + amount);
  return tod(d);
}

function daysOpenSince(dateValue) {
  const created = String(dateValue || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!created) return null;
  const days = Math.floor((dateFromStr(tod()) - dateFromStr(created)) / 86400000);
  return Math.max(0, days);
}

function taskAgeTone(days) {
  if (days === null) return { color:TEXT_MUTED, border:'rgba(90,97,91,0.18)', bg:'rgba(90,97,91,0.06)' };
  if (days <= 15) return { color:'#13733f', border:'rgba(20,120,72,0.28)', bg:'rgba(20,120,72,0.10)' };
  if (days <= 31) return { color:'#a9791f', border:'rgba(208,150,52,0.24)', bg:'rgba(208,150,52,0.13)' };
  return { color:'#c2533f', border:'rgba(225,91,79,0.24)', bg:'rgba(225,91,79,0.10)' };
}

function monthLabel(monthStr) {
  return dateFromStr(`${monthStr}-01`).toLocaleDateString('en-US', { month:'long', year:'numeric' });
}

function monthDates(monthStr) {
  const first = dateFromStr(`${monthStr}-01`);
  const last = new Date(first);
  last.setMonth(last.getMonth() + 1, 0);
  const dates = [];
  for (let day = 1; day <= last.getDate(); day++) dates.push(`${monthStr}-${String(day).padStart(2, '0')}`);
  return dates;
}

function weekDates(dateStr) {
  const d = dateFromStr(dateStr);
  const day = d.getDay() || 7;
  const monday = addDays(dateStr, 1 - day);
  return Array.from({ length:5 }, (_, i) => addDays(monday, i));
}

function prevMonth(monthStr) {
  const d = dateFromStr(`${monthStr}-01`);
  d.setMonth(d.getMonth() - 1);
  return tod(d).slice(0, 7);
}

function nextMonth(monthStr) {
  const d = dateFromStr(`${monthStr}-01`);
  d.setMonth(d.getMonth() + 1);
  return tod(d).slice(0, 7);
}

function dateSpan(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) return [];
  const dates = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

function formatMinutes(minutes) {
  return `${Math.max(0, Math.round(minutes || 0))} min`;
}

function formatHoursMinutes(minutes) {
  const mins = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function rangeBand(minutes, targetMinutes, toleranceMinutes) {
  if (!minutes) return 'empty';
  if (minutes < targetMinutes - toleranceMinutes) return 'below';
  if (minutes > targetMinutes + toleranceMinutes) return 'above';
  return 'target';
}

function workBandTone(minutes, targetMinutes = TARGET_WORK_MINUTES, toleranceMinutes = TARGET_WORK_TOLERANCE) {
  const band = rangeBand(minutes, targetMinutes, toleranceMinutes);
  if (band === 'target') return { band, fill:'linear-gradient(180deg,#28a767,#10623a)', text:'#13733f', glow:'0 10px 22px rgba(20,40,30,0.16)' };
  if (band === 'empty') return { band, fill:'rgba(40,60,50,0.08)', text:TEXT_MUTED, glow:'none' };
  if (band === 'below') return { band, fill:'#d8a23c', text:'#a9791f', glow:'0 10px 18px rgba(208,150,52,0.12)' };
  return { band, fill:'linear-gradient(180deg,#ea8479,#d6493d)', text:'#c2533f', glow:'0 10px 18px rgba(225,91,79,0.14)' };
}

function rowsFromTimeDraft(draft) {
  return WORK_EVENT_ORDER
    .map(event => ({ time: draft[event], event }))
    .filter(row => /^\d{2}:\d{2}$/.test(row.time || ''))
    .sort((a, b) => minutesFromTime(a.time) - minutesFromTime(b.time));
}

function normalizedTimeRows(rows) {
  if (!Array.isArray(rows)) return rowsFromTimeDraft(rows);
  return rows
    .filter(row => WORK_EVENT_ORDER.includes(row.event) && /^\d{2}:\d{2}$/.test(row.time || ''))
    .map(row => ({ time: row.time, event: row.event }))
    .sort((a, b) => minutesFromTime(a.time) - minutesFromTime(b.time));
}

function splitNoteDocument(raw = '') {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const frontmatter = text.match(/^(---\n[\s\S]*?\n---\n?)/)?.[1] || '';
  const afterFrontmatter = text.slice(frontmatter.length);
  const heading = afterFrontmatter.match(/^(#\s+.+\n?)/)?.[1] || '';
  const body = afterFrontmatter.slice(heading.length).replace(/^\n+/, '');
  return { frontmatter, heading, body };
}

function replaceNoteBody(raw = '', nextBody = '') {
  const { frontmatter, heading } = splitNoteDocument(raw);
  const body = String(nextBody || '').replace(/^\n+/, '').trimEnd();
  const parts = [frontmatter, heading].filter(Boolean);
  const prefix = parts.join('');
  if (!prefix) return body ? `${body}\n` : '';
  return `${prefix}${body ? `\n${body}\n` : '\n'}`;
}

function normalizeLinkTarget(value = '') {
  return String(value || '').trim().replace(/^\[\[|\]\]$/g, '').toLowerCase();
}

function includesWikiLink(raw = '', value = '') {
  const token = normalizeLinkTarget(value);
  if (!token) return false;
  return String(raw || '').toLowerCase().includes(`[[${token}]]`);
}

function personLinkTokens(person) {
  return [person?.title, person?.company]
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function personMetrics(person, tasks, meetings, isClosedTask) {
  if (!person) return { waitingFor:0, meetings:0, tasksLinked:0 };
  const tokens = personLinkTokens(person);
  const matchesTask = (task) => {
    const waitingFor = normalizeLinkTarget(task.waitingfor);
    return tokens.some(token => waitingFor && waitingFor === normalizeLinkTarget(token))
      || tokens.some(token => includesWikiLink(task.raw, token));
  };
  const matchesMeeting = (meeting) => tokens.some(token => includesWikiLink(meeting.raw, token));

  return {
    waitingFor: tasks.filter(task => !isClosedTask(task) && tokens.some(token => normalizeLinkTarget(task.waitingfor) === normalizeLinkTarget(token))).length,
    meetings: meetings.filter(matchesMeeting).length,
    tasksLinked: tasks.filter(matchesTask).length,
  };
}

function projectMetrics(project, tasks, isClosedTask) {
  if (!project) return { status:'--', openTasks:0, tasksLinked:0 };
  const tokens = [project.title, project.filename, project.id]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const matchesTask = task => (task.projects || []).some(projectName =>
      tokens.some(token => normalizeLinkTarget(projectName) === normalizeLinkTarget(token)))
    || tokens.some(token => includesWikiLink(task.raw, token));
  const linkedTasks = tasks.filter(matchesTask);
  return {
    status: project.status || 'active',
    openTasks: linkedTasks.filter(task => !isClosedTask(task)).length,
    tasksLinked: linkedTasks.length,
  };
}

function organizationMetrics(organization, tasks, meetings, isClosedTask) {
  if (!organization) return { details:0, meetings:0, tasksLinked:0 };
  const tokens = [organization.title, organization.filename, organization.id]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const matchesRaw = raw => tokens.some(token => includesWikiLink(raw, token));
  const linkedTasks = tasks.filter(task => matchesRaw(task.raw));
  return {
    details: [organization.industry, organization.website, organization.email, organization.phone].filter(Boolean).length,
    meetings: meetings.filter(meeting => matchesRaw(meeting.raw)).length,
    tasksLinked: linkedTasks.filter(task => !isClosedTask(task)).length,
  };
}

const HEATMAP_SLOT_MINUTES = 30;
const HEATMAP_SLOTS = Array.from({ length: 48 }, (_, index) => index * HEATMAP_SLOT_MINUTES);

function formatSlotLabel(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function dailyWorkSegments(note) {
  const rows = (note?.timeClock || [])
    .map(row => ({ ...row, minutes:minutesFromTime(row.time) }))
    .filter(row => row.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  const clockIn = rows.find(row => row.event === 'Clock in')?.minutes;
  const clockOut = [...rows].reverse().find(row => row.event === 'Clock out')?.minutes;
  if (clockIn === undefined || clockOut === undefined || clockOut <= clockIn) return [];

  let segments = [{ start:clockIn, end:clockOut }];
  let breakStart = null;
  rows.forEach(row => {
    if (row.event === 'Break start') breakStart = row.minutes;
    if (row.event === 'Break finish' && breakStart !== null && row.minutes > breakStart) {
      const start = breakStart;
      const end = row.minutes;
      segments = segments.flatMap(segment => {
        if (end <= segment.start || start >= segment.end) return [segment];
        return [
          { start:segment.start, end:Math.max(segment.start, start) },
          { start:Math.min(segment.end, end), end:segment.end },
        ].filter(part => part.end > part.start);
      });
      breakStart = null;
    }
  });
  return segments;
}

function timeHeatmapDays(days) {
  const rows = WEEKDAY_LABELS.map(label => ({
    label,
    days:0,
    minutes:Array(HEATMAP_SLOTS.length).fill(0),
  }));

  days.forEach(day => {
    if (!day.note || day.creditedDay) return;
    const weekday = (dateFromStr(day.date).getDay() + 6) % 7;
    const segments = dailyWorkSegments(day.note);
    if (!segments.length) return;
    rows[weekday].days += 1;
    HEATMAP_SLOTS.forEach((slotStart, slotIndex) => {
      const slotEnd = slotStart + HEATMAP_SLOT_MINUTES;
      const activeMinutes = segments.reduce((sum, segment) => (
        sum + Math.max(0, Math.min(segment.end, slotEnd) - Math.max(segment.start, slotStart))
      ), 0);
      rows[weekday].minutes[slotIndex] += activeMinutes;
    });
  });

  rows.forEach(row => {
    row.average = row.minutes.map(minutes => row.days ? Math.round(minutes / row.days) : 0);
    row.total = row.average.reduce((sum, minutes) => sum + minutes, 0);
  });
  return rows;
}

function parseTrackerRows(raw = '') {
  return String(raw || '')
    .split('\n')
    .map(line => line.trim())
    .map(line => {
      const match = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/);
      if (!match || /^Date$/i.test(match[1]) || /^-+$/.test(match[1].replace(/\s+/g, ''))) return null;
      const date = normalizeLinkTarget(match[1]);
      const linked = /^\[\[.*\]\]$/.test(match[2].trim());
      const taskLabel = match[2].trim().replace(/^\[\[|\]\]$/g, '');
      return /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? { date, taskLabel, linked, minutes: Number(match[3]) || 0 }
        : null;
    })
    .filter(Boolean);
}

function ComboInput({ value, onChange, options = [], placeholder }) {
  const [input, setInput] = useState(value || '');
  const [open, setOpen] = useState(false);
  const filtered = options
    .filter(o => !input.trim() || o.toLowerCase().includes(input.trim().toLowerCase()))
    .slice(0, 8);

  useEffect(() => { setInput(value || ''); }, [value]);

  return (
    <div style={{ position:'relative' }}>
      <input value={input} onFocus={()=>setOpen(true)} onChange={e=>{ setInput(e.target.value); onChange(e.target.value); setOpen(true); }} onBlur={()=>setTimeout(()=>setOpen(false), 120)}
        placeholder={placeholder || 'Pick or type...'} style={inputBase}/>
      {open && filtered.length > 0 && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:40, maxHeight:190, overflowY:'auto', padding:4, borderRadius:9, background:'#f7faf8', border:'1px solid rgba(255,255,255,0.68)', boxShadow:'0 12px 30px rgba(20,40,30,0.14)' }}>
          {filtered.map(option => (
            <button key={option} type="button" onMouseDown={e=>{ e.preventDefault(); setInput(option); onChange(option); setOpen(false); }}
              style={{ width:'100%', textAlign:'left', padding:'7px 9px', borderRadius:7, border:'none', background:'transparent', color:'#222a25', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChipMulti({ value, onChange, options, placeholder }) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = (options || [])
    .filter(o => !value.includes(o))
    .filter(o => !input.trim() || o.toLowerCase().includes(input.trim().toLowerCase()))
    .slice(0, 8);
  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (!value.includes(v)) onChange([...value, v]);
    setInput('');
  };
  const addOption = (option) => {
    if (!value.includes(option)) onChange([...value, option]);
    setInput('');
    setOpen(false);
  };
  return (
    <div style={{ position:'relative' }}>
    <div style={{ ...inputBase, display:'flex', flexWrap:'wrap', gap:5, padding:'5px 6px' }}>
      {value.map(p => (
        <span key={p} style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:14, background:BRAND_SURFACE_STRONG, color:BRAND_TEXT, display:'inline-flex', alignItems:'center', gap:5 }}>
          {p}
          <button type="button" onClick={() => onChange(value.filter(x => x !== p))} style={{ background:'none', border:'none', color:BRAND_TEXT, cursor:'pointer', fontSize:14, lineHeight:1, padding:0 }}>×</button>
        </span>
      ))}
      <input value={input} onFocus={()=>setOpen(true)} onChange={e=>{ setInput(e.target.value); setOpen(true); }}
        onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();add();} else if(e.key==='Backspace'&&!input&&value.length){onChange(value.slice(0,-1));}}}
        onBlur={()=>setTimeout(()=>{ setOpen(false); add(); }, 120)}
        placeholder={placeholder||'Type and press Enter'}
        style={{ flex:1, minWidth:120, background:'transparent', border:'none', color:'#222a25', fontSize:13, outline:'none', fontFamily:'inherit', padding:'4px' }}/>
    </div>
    {open && filtered.length > 0 && (
      <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:40, maxHeight:190, overflowY:'auto', padding:4, borderRadius:9, background:'#f7faf8', border:'1px solid rgba(255,255,255,0.68)', boxShadow:'0 12px 30px rgba(20,40,30,0.14)' }}>
        {filtered.map(option => (
          <button key={option} type="button" onMouseDown={e=>{ e.preventDefault(); addOption(option); }}
            style={{ width:'100%', textAlign:'left', padding:'7px 9px', borderRadius:7, border:'none', background:'transparent', color:'#222a25', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
            {option}
          </button>
        ))}
      </div>
    )}
    </div>
  );
}

export default function App() {
  // ── Folder handles (one per folder type) ──
  const [dirs,      setDirs]      = useState({});           // { tasks: handle, ... }
  const [savedDirs, setSavedDirs] = useState({});           // pending permission (resume)
  const [setupBusy, setSetupBusy] = useState(false);
  const [bootDone,  setBootDone]  = useState(false);
  const [folderSetupOpen, setFolderSetupOpen] = useState(false);

  // ── Reference autocomplete lists (filenames without .md) ──
  const [refs, setRefs] = useState({ projects:[], properties:[], clients:[], people:[] });
  const [view, setView] = useState('mission');
  const [folderStats, setFolderStats] = useState({});
  const [folderIssues, setFolderIssues] = useState({});
  const [writeBackups, setWriteBackups] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);

  // ── Property library state ──
  const [properties,       setProperties]       = useState([]);
  const [propertyHandles,  setPropertyHandles]  = useState({});
  const [propertyImages,   setPropertyImages]   = useState({});
  const [propertySel,      setPropertySel]      = useState(null);
  const [propertySearch,   setPropertySearch]   = useState('');
  const [propertyComment,  setPropertyComment]  = useState('');
  const [propertyDraft,    setPropertyDraft]    = useState('');
  const [propertyLoadError, setPropertyLoadError] = useState('');

  // â”€â”€ Project library state â”€â”€
  const [projects,       setProjects]       = useState([]);
  const [projectHandles, setProjectHandles] = useState({});
  const [projectSel,     setProjectSel]     = useState(null);
  const [projectSearch,  setProjectSearch]  = useState('');
  const [projectDraft,   setProjectDraft]   = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  // People library state
  const [people,        setPeople]        = useState([]);
  const [personHandles, setPersonHandles] = useState({});
  const [personSel,     setPersonSel]     = useState(null);
  const [personDraft,   setPersonDraft]   = useState('');

  // Organization library state
  const [organizations, setOrganizations] = useState([]);
  const [orgHandles,    setOrgHandles]    = useState({});
  const [orgSel,        setOrgSel]        = useState(null);
  const [orgDraft,      setOrgDraft]      = useState('');
  const [orgSearch,     setOrgSearch]     = useState('');
  const [newOrgOpen,    setNewOrgOpen]    = useState(false);

  // Meeting library state
  const [meetings,      setMeetings]      = useState([]);
  const [meetingSel,    setMeetingSel]    = useState(null);

  // â”€â”€ Daily note state â”€â”€
  const [dailyNote,   setDailyNote]   = useState(null);
  const [dailyHandle, setDailyHandle] = useState(null);
  const [dailyInputs, setDailyInputs] = useState({ notes:'', reflections:'', brainDump:'' });
  const [workDate,    setWorkDate]    = useState(tod());
  const [workMonth,   setWorkMonth]   = useState(tod().slice(0, 7));
  const [workNotes,   setWorkNotes]   = useState({});
  const [workHandles, setWorkHandles] = useState({});
  const [timeNotes,   setTimeNotes]   = useState([]);

  // ── Tasks / timer / UI state ──
  const [tasks,         setTasks]         = useState([]);
  const [taskHandles,   setTaskHandles]   = useState({});
  const [trackerHandle, setTrackerHandle] = useState(null);
  const [trackerRows,   setTrackerRows]   = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [lastSync,      setLastSync]      = useState(null);
  const [needsRefresh,  setNeedsRefresh]  = useState(false);
  const [syncBusy,      setSyncBusy]      = useState(false);
  const [timer,         setTimer]         = useState(null);
  const [tick,          setTick]          = useState(0);
  const [sel,           setSel]           = useState(null);
  const [note,          setNote]          = useState('');
  const [threadSubjectDraft, setThreadSubjectDraft] = useState('');
  const [filt,          setFilt]          = useState('all');
  const [taskSearch,    setTaskSearch]    = useState('');
  const [filterName,    setFilterName]    = useState('');
  const [toast,         setToast]         = useState(null);
  const [showAdHoc,     setShowAdHoc]     = useState(false);
  const [adHocInput,    setAdHocInput]    = useState('');
  const [adHocName,     setAdHocName]     = useState('');
  const [meetingOpen,   setMeetingOpen]   = useState(false);
  const [meetingTitle,  setMeetingTitle]  = useState('');
  const [meetingNotes,  setMeetingNotes]  = useState('');
  const [meetingLinks,  setMeetingLinks]  = useState({ clients:[], properties:[], tasks:[], people:[] });
  const [newTaskOpen,   setNewTaskOpen]   = useState(false);
  const [newPropertyOpen, setNewPropertyOpen] = useState(false);
  const [newPersonOpen, setNewPersonOpen] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState('');

  const adHocRef        = useRef('');
  const meetingTitleRef = useRef('');
  const meetingNotesRef = useRef('');
  const meetingStartRef = useRef(null);
  const warnedRef       = useRef(null);
  const tickRef         = useRef();
  const syncRef         = useRef();
  const nudgeRef        = useRef();
  const imageUrlsRef    = useRef({});

  // ── Load saved handles on boot, query permissions ──
  useEffect(() => {
    (async () => {
      const ah = lsGet('adHocName');
      if (ah) { setAdHocName(ah); adHocRef.current = ah; }
      const at = lsGet('activeTimer');
      if (at && Date.now()-at.start < 86400000) setTimer(at);
      else if (at) lsDel('activeTimer');
      try {
        setSavedFilters(lsGet(SAVED_FILTERS_KEY) || []);
        setWriteBackups((await idbGet(WRITE_BACKUPS_KEY)) || []);
      } catch(e) {
        console.warn('local preferences load skipped', e);
      }

      try {
        // Migrate legacy single-folder key
        const legacy = await idbGet('vault');
        if (legacy && !(await idbGet('vault_tasks'))) {
          await idbSet('vault_tasks', legacy);
          await idbDel('vault');
        }

        const live = {}, saved = {};
        for (const def of FOLDER_DEFS) {
          const h = await idbGet(`vault_${def.key}`);
          if (!h) continue;
          try {
            const perm = await h.queryPermission({ mode: def.mode });
            if (perm === 'granted') live[def.key] = h;
            else saved[def.key] = h;
          } catch {
            saved[def.key] = h;
          }
        }
        setDirs(live);
        setSavedDirs(saved);
        if (live.tasks || live.done) await loadAll(live);
        if (live.tasks && REF_KEYS.every(k => !live[k] && !saved[k]) && !lsGet(FOLDER_SETUP_SEEN)) {
          setFolderSetupOpen(true);
        }
      } catch(e) { console.error(e); }
      setBootDone(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timer) tickRef.current = setInterval(() => setTick(t=>t+1), 1000);
    else clearInterval(tickRef.current);
    return () => clearInterval(tickRef.current);
  }, [timer]);

  useEffect(() => {
    return () => Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
  }, []);

  useEffect(() => {
    const refresh = async () => {
      try { setWriteBackups((await idbGet(WRITE_BACKUPS_KEY)) || []); }
      catch(e) { console.warn('backup refresh skipped', e); }
    };
    window.addEventListener('taskdash-backups-updated', refresh);
    return () => window.removeEventListener('taskdash-backups-updated', refresh);
  }, []);

  useEffect(() => {
    clearTimeout(nudgeRef.current);
    if (!lastSync) return;
    setNeedsRefresh(false);
    nudgeRef.current = setTimeout(() => setNeedsRefresh(true), REFRESH_MS);
    return () => clearTimeout(nudgeRef.current);
  }, [lastSync]);

  useEffect(() => {
    if (!timer) { warnedRef.current = null; return; }
    const chk = setInterval(() => {
      if (Date.now()-timer.start > WARN_MS && warnedRef.current !== timer.start) {
        warnedRef.current = timer.start;
        const name = timer.taskId==='__email__' ? 'Email'
          : timer.taskId==='__meeting__' ? (meetingTitleRef.current || 'Meeting')
          : timer.taskId==='__adhoc__' ? adHocRef.current
          : tasks.find(t=>t.id===timer.taskId)?.title || 'this task';
        setToast(`⏰ Over 1 hour on "${name}" — time to switch?`);
      }
    }, WARN_CHK_MS);
    return () => clearInterval(chk);
  }, [timer, tasks]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const project = projects.find(p => p.id === projectSel);
    setProjectDraft(project?.raw || '');
  }, [projectSel, projects]);

  useEffect(() => {
    const property = properties.find(p => p.id === propertySel);
    setPropertyDraft(property?.raw || '');
  }, [propertySel, properties]);

  useEffect(() => {
    const person = people.find(p => p.id === personSel);
    setPersonDraft(person?.raw || '');
  }, [personSel, people]);

  useEffect(() => {
    const organization = organizations.find(o => o.id === orgSel);
    setOrgDraft(organization?.raw || '');
  }, [orgSel, organizations]);

  const loadFiles = useCallback(async (dir, doneDir = null) => {
    try {
      const raw = [];
      const activeRaw = dir ? await readMdFiles(dir) : [];
      const doneRaw = doneDir ? await readMdFiles(doneDir, [], '__done__') : [];
      raw.push(...activeRaw, ...doneRaw);
      const parsed = raw.flatMap(f => {
        try { return [parseTask(f.name, f.text)]; }
        catch(e) {
          console.warn(`Skipped unparseable task: ${f.name}`, e);
          return [];
        }
      })
        .sort((a,b) => (a.due||'9999') > (b.due||'9999') ? 1 : -1);
      setTasks(parsed);
      setFolderStats(prev => ({ ...prev, tasks: activeRaw.length, done: doneRaw.length }));
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setTaskHandles(handles);
      try {
        if (!dir) throw new Error('No tasks folder configured');
        const th = await dir.getFileHandle('timetracker.md', { create:true });
        setTrackerHandle(th);
        setTrackerRows(parseTrackerRows(await (await th.getFile()).text()));
      } catch {
        setTrackerRows([]);
      }
      setLastSync(Date.now());
      setNeedsRefresh(false);
      setSel(prev => {
        if (prev && parsed.some(t => t.id === prev)) return prev;
        return parsed.find(t => !hasHiddenTaskTag(t) && !t.archived)?.id || parsed.find(t => !t.archived)?.id || parsed[0]?.id || null;
      });
    } catch(e) {
      console.error(e);
      setToast(`Task sync failed: ${e.message}`);
    }
  }, []);

  const loadProperties = useCallback(async (dir) => {
    try {
      const raw = await readMdFiles(dir, [], '', { includeUnderscore: true });
      const skipped = [];
      const parsed = raw.flatMap(f => {
        try { return [parseProperty(f.name, f.text)]; }
        catch(e) {
          skipped.push({ name: f.name, message: e.message });
          console.warn(`Skipped unparseable property: ${f.name}`, e);
          return [];
        }
      })
        .sort((a,b) => a.title.localeCompare(b.title));
      setProperties(parsed);
      setPropertyLoadError(skipped.length
        ? `${skipped.length} property note${skipped.length === 1 ? '' : 's'} could not be read:\n${skipped.map(s => `• ${s.name} — ${s.message}`).join('\n')}`
        : '');
      setFolderStats(prev => ({ ...prev, properties: raw.length }));
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setPropertyHandles(handles);
      setPropertySel(prev => prev && parsed.some(p => p.id === prev) ? prev : (parsed[0]?.id || null));
    } catch(e) {
      console.error('properties load failed', e);
      setProperties([]);
      setPropertyHandles({});
      setPropertySel(null);
      setPropertyLoadError(`Properties folder could not be read: ${e.message}`);
      setToast(`Properties sync failed: ${e.message}`);
    }
  }, []);

  const loadProjects = useCallback(async (dir) => {
    try {
      const raw = (await readMdFiles(dir, [], '', { includeUnderscore: true })).filter(f => /^project\b/i.test(f.name.replace(/\.md$/i, '').trim()));
      const parsed = raw.map(f => parseProject(f.name, f.text))
        .sort((a,b) => a.title.localeCompare(b.title));
      setProjects(parsed);
      setFolderStats(prev => ({ ...prev, projects: raw.length }));
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setProjectHandles(handles);
      setProjectSel(prev => prev && parsed.some(p => p.id === prev) ? prev : (parsed[0]?.id || null));
    } catch(e) { console.error('projects load failed', e); }
  }, []);

  const loadPeople = useCallback(async (dir) => {
    try {
      const raw = await readMdFiles(dir, [], '', { includeUnderscore: true });
      const parsed = raw.map(f => parsePerson(f.name, f.text))
        .sort((a,b) => a.title.localeCompare(b.title));
      setPeople(parsed);
      setFolderStats(prev => ({ ...prev, people: raw.length }));
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setPersonHandles(handles);
      setPersonSel(prev => prev && parsed.some(p => p.id === prev) ? prev : (parsed[0]?.id || null));
    } catch(e) { console.error('people load failed', e); }
  }, []);

  const loadOrganizations = useCallback(async (dir) => {
    try {
      const raw = await readMdFiles(dir, [], '', { includeUnderscore: true });
      const parsed = raw.map(f => parseOrganization(f.name, f.text))
        .sort((a,b) => a.title.localeCompare(b.title));
      setOrganizations(parsed);
      setFolderStats(prev => ({ ...prev, organizations: raw.length }));
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setOrgHandles(handles);
      setOrgSel(prev => prev && parsed.some(o => o.id === prev) ? prev : (parsed[0]?.id || null));
    } catch(e) { console.error('organizations load failed', e); }
  }, []);

  const loadMeetings = useCallback(async (dir) => {
    try {
      const raw = await readMdFiles(dir, [], '', { includeUnderscore: true });
      const parsed = raw.map(f => parseMeeting(f.name, f.text))
        .sort((a, b) => (b.dateCreated || b.date || '').localeCompare(a.dateCreated || a.date || '') || a.title.localeCompare(b.title));
      setMeetings(parsed);
      setFolderStats(prev => ({ ...prev, meetings: raw.length }));
      setMeetingSel(prev => prev && parsed.some(m => m.id === prev) ? prev : (parsed[0]?.id || null));
    } catch(e) { console.error('meetings load failed', e); }
  }, []);

  const readDailyNoteForDate = useCallback(async (dir, dateStr, create = false) => {
    if (!dir) return null;
    const filename = `${dateStr}.md`;
    try {
      const fh = await dir.getFileHandle(filename, { create });
      const file = await fh.getFile();
      let text = await file.text();
      if (!text.trim() && create) {
        text = buildDailyNoteMd(dateStr);
        await writeFile(fh, text);
      }
      const parsed = parseDailyNote(filename, text);
      return { handle:fh, note:parsed };
    } catch(e) {
      if (e.name !== 'NotFoundError') console.error('daily note load failed', e);
      return null;
    }
  }, []);

  const ensureDailyNote = useCallback(async (dir) => {
    const result = await readDailyNoteForDate(dir, tod(), true);
    if (result) {
      const { handle:fh, note:parsed } = result;
      setDailyHandle(fh);
      setDailyNote(parsed);
      setWorkHandles(prev => ({ ...prev, [tod()]: fh }));
      setWorkNotes(prev => ({ ...prev, [tod()]: parsed }));
      return parsed;
    }
    return null;
  }, [readDailyNoteForDate]);

  const loadTimeNotes = useCallback(async (dir) => {
    try {
      const raw = await readMdFiles(dir);
      const parsed = raw.flatMap(file => {
        try { return [parseDailyNote(file.name, file.text)]; }
        catch(e) {
          console.warn(`Skipped unparseable daily note: ${file.name}`, e);
          return [];
        }
      }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      setTimeNotes(parsed);
      setFolderStats(prev => ({ ...prev, daily: raw.length }));
    } catch(e) {
      console.error('daily notes dashboard load failed', e);
    }
  }, []);

  const loadWorkNotes = useCallback(async (dates, createDate = null) => {
    if (!dirs.daily) return;
    const uniqueDates = [...new Set(dates.filter(Boolean))];
    const nextNotes = {};
    const nextHandles = {};
    for (const dateStr of uniqueDates) {
      const result = await readDailyNoteForDate(dirs.daily, dateStr, dateStr === createDate);
      if (result) {
        nextNotes[dateStr] = result.note;
        nextHandles[dateStr] = result.handle;
      }
    }
    setWorkNotes(prev => ({ ...prev, ...nextNotes }));
    setWorkHandles(prev => ({ ...prev, ...nextHandles }));
  }, [dirs.daily, readDailyNoteForDate]);

  useEffect(() => {
    if (!dirs.daily) return;
    loadWorkNotes([...monthDates(workMonth), ...weekDates(workDate), tod()]);
  }, [dirs.daily, workMonth, workDate, loadWorkNotes]);

  const loadAttachmentImages = useCallback(async (dir) => {
    try {
      const raw = await readImageFiles(dir);
      setFolderStats(prev => ({ ...prev, attachments: raw.length }));
      const next = {};
      for (const item of raw) {
        const file = await item.handle.getFile();
        if (file.size > 0) next[item.name.toLowerCase()] = URL.createObjectURL(file);
      }
      Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
      imageUrlsRef.current = next;
      setPropertyImages(next);
    } catch(e) { console.error('attachment image load failed', e); }
  }, []);

  const loadRefs = useCallback(async (liveDirs) => {
    const out = { projects:[], properties:[], clients:[], people:[], organizations:[] };
    for (const k of REF_KEYS) {
      if (!liveDirs[k]) continue;
      try {
        const names = await readDirNames(liveDirs[k], { projectOnly: k === 'projects' });
        out[k] = [...new Set(names)].sort();
      } catch(e) { console.error(`failed to read ${k}`, e); }
    }
    setRefs(out);
    setFolderStats(prev => ({ ...prev, refs: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])) }));
  }, []);

  const clearUnavailableFolderData = useCallback((keys) => {
    if (keys.includes('tasks')) { setTasks([]); setTaskHandles({}); setTrackerHandle(null); setTrackerRows([]); setSel(null); }
    if (keys.includes('done')) setTasks(prev => prev.filter(t => !String(t.id).startsWith('__done__/')));
    if (keys.includes('projects')) { setProjects([]); setProjectHandles({}); setProjectSel(null); setProjectDraft(''); }
    if (keys.includes('properties')) { setProperties([]); setPropertyHandles({}); setPropertySel(null); setPropertyLoadError(''); }
    if (keys.includes('people')) { setPeople([]); setPersonHandles({}); setPersonSel(null); setPersonDraft(''); }
    if (keys.includes('organizations')) { setOrganizations([]); setOrgHandles({}); setOrgSel(null); setOrgDraft(''); }
    if (keys.includes('meetings')) { setMeetings([]); setMeetingSel(null); setMeetingOpen(false); setMeetingTitle(''); setMeetingNotes(''); setMeetingLinks({ clients:[], properties:[], tasks:[], people:[] }); meetingTitleRef.current = ''; meetingNotesRef.current = ''; meetingStartRef.current = null; }
    if (keys.includes('daily')) { setDailyNote(null); setDailyHandle(null); setDailyInputs({ notes:'', reflections:'', brainDump:'' }); setWorkNotes({}); setWorkHandles({}); setTimeNotes([]); }
    if (keys.includes('attachments')) {
      Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
      imageUrlsRef.current = {};
      setPropertyImages({});
    }
    setRefs(prev => {
      const next = { ...prev };
      keys.filter(k => REF_KEYS.includes(k)).forEach(k => { next[k] = []; });
      return next;
    });
  }, []);

  const loadAll = useCallback(async (liveDirs) => {
    const available = {};
    const unavailable = {};

    for (const [key, handle] of Object.entries(liveDirs || {})) {
      if (!handle) continue;
      const error = await checkFolderAvailable(handle);
      if (error) unavailable[key] = { name: handle.name, message: error.message || error.name || 'Folder unavailable' };
      else available[key] = handle;
    }

    const unavailableKeys = Object.keys(unavailable);
    setFolderIssues(prev => {
      const next = { ...prev, ...unavailable };
      Object.keys(available).forEach(key => { delete next[key]; });
      return next;
    });
    if (unavailableKeys.length) {
      setDirs(prev => {
        const next = { ...prev };
        unavailableKeys.forEach(key => { delete next[key]; });
        return next;
      });
      setSavedDirs(prev => {
        const next = { ...prev };
        unavailableKeys.forEach(key => { delete next[key]; });
        return next;
      });
      clearUnavailableFolderData(unavailableKeys);
      await Promise.all(unavailableKeys.map(key => idbDel(`vault_${key}`)));
      const labels = unavailableKeys.map(key => FOLDER_LABELS[key] || key).join(', ');
      setToast(`${labels} folder ${unavailableKeys.length === 1 ? 'is' : 'are'} unavailable. Reconnect in Configure folders.`);
    }

    if (available.tasks) await loadFiles(available.tasks, available.done);
    await loadRefs(available);
    if (available.projects) await loadProjects(available.projects);
    if (available.properties) await loadProperties(available.properties);
    if (available.people) await loadPeople(available.people);
    if (available.organizations) await loadOrganizations(available.organizations);
    if (available.meetings) await loadMeetings(available.meetings);
    if (available.attachments) await loadAttachmentImages(available.attachments);
    if (available.daily) {
      await ensureDailyNote(available.daily);
      await loadTimeNotes(available.daily);
    }
    if (Object.keys(available).length) {
      setLastSync(Date.now());
      setNeedsRefresh(false);
    }
  }, [loadFiles, loadRefs, loadProjects, loadProperties, loadPeople, loadOrganizations, loadMeetings, loadAttachmentImages, ensureDailyNote, loadTimeNotes, clearUnavailableFolderData]);

  useEffect(() => {
    if (!dirs.tasks && !dirs.done && !dirs.meetings && !dirs.projects && !dirs.properties && !dirs.daily && !dirs.attachments) return;
    syncRef.current = setInterval(() => loadAll(dirs), REFRESH_MS);
    return () => clearInterval(syncRef.current);
  }, [dirs, loadAll]);

  const forceSyncAll = async () => {
    if (syncBusy) return;
    if (!Object.keys(dirs).length) {
      alert('Configure folders first.');
      return;
    }
    setSyncBusy(true);
    setNeedsRefresh(false);
    setFilt('all');
    setTaskSearch('');
    setProjectSearch('');
    setPropertySearch('');
    setPeopleSearch('');
    try {
      await loadAll(dirs);
      setWriteBackups((await idbGet(WRITE_BACKUPS_KEY)) || []);
      setToast('Force sync complete');
    } catch(e) {
      console.error('force sync failed', e);
      alert('Force sync failed: ' + e.message);
    } finally {
      setSyncBusy(false);
    }
  };

  // ── Setup & permission flow ──
  const pickFolder = async (key) => {
    const def = FOLDER_DEFS.find(d => d.key===key);
    setSetupBusy(true);
    try {
      const dir = await window.showDirectoryPicker({ mode: def.mode });
      await idbSet(`vault_${key}`, dir);
      const next = { ...dirs, [key]: dir };
      setDirs(next);
      setSavedDirs(prev => { const c = {...prev}; delete c[key]; return c; });
      setFolderIssues(prev => { const c = {...prev}; delete c[key]; return c; });
      if (key === 'tasks' || key === 'done') {
        setFolderSetupOpen(true);
        await loadFiles(next.tasks, next.done);
      }
      else {
        if (key === 'projects') await loadProjects(dir);
        if (key === 'properties') await loadProperties(dir);
        if (key === 'people') await loadPeople(dir);
        if (key === 'organizations') await loadOrganizations(dir);
        if (key === 'meetings') await loadMeetings(dir);
        if (key === 'attachments') await loadAttachmentImages(dir);
        if (key === 'daily') {
          await ensureDailyNote(dir);
          await loadTimeNotes(dir);
        }
        await loadRefs(next);
      }
    } catch(e) { if (e.name!=='AbortError') alert('Error: '+e.message); }
    setSetupBusy(false);
  };

  const resumeFolder = async (key) => {
    const def = FOLDER_DEFS.find(d => d.key===key);
    const h = savedDirs[key]; if (!h) return;
    setSetupBusy(true);
    try {
      const perm = await h.requestPermission({ mode: def.mode });
      if (perm === 'granted') {
        const next = { ...dirs, [key]: h };
        setDirs(next);
        setSavedDirs(prev => { const c = {...prev}; delete c[key]; return c; });
        setFolderIssues(prev => { const c = {...prev}; delete c[key]; return c; });
        if (key === 'tasks' || key === 'done') {
          setFolderSetupOpen(true);
          await loadFiles(next.tasks, next.done);
        }
        else {
          if (key === 'projects') await loadProjects(h);
          if (key === 'properties') await loadProperties(h);
          if (key === 'people') await loadPeople(h);
          if (key === 'organizations') await loadOrganizations(h);
          if (key === 'meetings') await loadMeetings(h);
          if (key === 'attachments') await loadAttachmentImages(h);
          if (key === 'daily') {
            await ensureDailyNote(h);
            await loadTimeNotes(h);
          }
          await loadRefs(next);
        }
      }
    } catch(e) { console.error(e); }
    setSetupBusy(false);
  };

  const resumeAll = async () => {
    setSetupBusy(true);
    const next = { ...dirs };
    const stillSaved = {};
    for (const def of FOLDER_DEFS) {
      const h = savedDirs[def.key]; if (!h) continue;
      try {
        const perm = await h.requestPermission({ mode: def.mode });
        if (perm === 'granted') next[def.key] = h;
        else stillSaved[def.key] = h;
      } catch(e) { console.error(e); }
    }
    setDirs(next);
    setSavedDirs(stillSaved);
    setFolderIssues(prev => {
      const c = { ...prev };
      Object.keys(next).forEach(key => { delete c[key]; });
      return c;
    });
    await loadAll(next);
    if (next.tasks && REF_KEYS.every(k => !next[k])) setFolderSetupOpen(true);
    setSetupBusy(false);
  };

  const clearFolder = async (key) => {
    await idbDel(`vault_${key}`);
    setDirs(prev => { const c = {...prev}; delete c[key]; return c; });
    setSavedDirs(prev => { const c = {...prev}; delete c[key]; return c; });
    setFolderIssues(prev => { const c = {...prev}; delete c[key]; return c; });
    if (key === 'tasks') { setTasks([]); setTaskHandles({}); setTrackerHandle(null); setTrackerRows([]); }
    else if (key === 'done') await loadFiles(dirs.tasks, null);
    else if (key === 'projects') { setProjects([]); setProjectHandles({}); setProjectSel(null); setProjectDraft(''); }
    else if (key === 'properties') { setProperties([]); setPropertyHandles({}); setPropertySel(null); setPropertyLoadError(''); }
    else if (key === 'people') { setPeople([]); setPersonHandles({}); setPersonSel(null); setPersonDraft(''); }
    else if (key === 'organizations') { setOrganizations([]); setOrgHandles({}); setOrgSel(null); setOrgDraft(''); }
    else if (key === 'meetings') { setMeetings([]); setMeetingSel(null); setMeetingOpen(false); setMeetingTitle(''); setMeetingNotes(''); setMeetingLinks({ clients:[], properties:[], tasks:[], people:[] }); meetingTitleRef.current = ''; meetingNotesRef.current = ''; meetingStartRef.current = null; }
    else if (key === 'daily') { setDailyNote(null); setDailyHandle(null); setDailyInputs({ notes:'', reflections:'', brainDump:'' }); setWorkNotes({}); setWorkHandles({}); setTimeNotes([]); }
    else if (key === 'attachments') {
      Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
      imageUrlsRef.current = {};
      setPropertyImages({});
    }
    else setRefs(prev => ({ ...prev, [key]: [] }));
  };

  const resetAll = async () => {
    if (!confirm('Forget all configured folders on this device?')) return;
    for (const def of FOLDER_DEFS) await idbDel(`vault_${def.key}`);
    lsDel(FOLDER_SETUP_SEEN);
    setDirs({}); setSavedDirs({}); setFolderIssues({});
    setTasks([]); setTaskHandles({}); setTrackerHandle(null); setTrackerRows([]);
    setProjects([]); setProjectHandles({}); setProjectSel(null); setProjectDraft('');
    setProperties([]); setPropertyHandles({}); setPropertySel(null); setPropertyLoadError('');
    setMeetings([]); setMeetingSel(null); setMeetingOpen(false); setMeetingTitle(''); setMeetingNotes(''); setMeetingLinks({ clients:[], properties:[], tasks:[], people:[] }); meetingTitleRef.current = ''; meetingNotesRef.current = ''; meetingStartRef.current = null;
    setDailyNote(null); setDailyHandle(null); setDailyInputs({ notes:'', reflections:'', brainDump:'' }); setWorkNotes({}); setWorkHandles({}); setTimeNotes([]);
    Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
    imageUrlsRef.current = {};
    setPropertyImages({});
    setRefs({ projects:[], properties:[], clients:[], people:[] });
  };

  const finishFolderSetup = () => {
    if (!dirs.tasks) return;
    lsSet(FOLDER_SETUP_SEEN, true);
    setFolderSetupOpen(false);
  };

  // ── Timer logic ──
  const getTime = useCallback((id) => {
    return timer?.taskId===id ? Date.now()-timer.start : 0;
  }, [timer, tick]);

  const stop = useCallback(async () => {
    if (!timer) return;
    const dur = Date.now()-timer.start;
    if (trackerHandle) {
      try {
        const existing = await (await trackerHandle.getFile()).text();
        const isLinked = !['__email__','__meeting__','__adhoc__'].includes(timer.taskId);
        const label = isLinked
          ? tasks.find(t=>t.id===timer.taskId)?.filename || timer.taskId.replace('.md','')
          : timer.taskId==='__adhoc__' ? adHocRef.current
          : timer.taskId==='__email__' ? 'Email' : meetingTitleRef.current||'Meeting';
        const nextTracker = appendTrackerRow(existing, buildTrackerRow(tod(), label, isLinked, dur));
        await writeFile(trackerHandle, nextTracker);
        setTrackerRows(parseTrackerRows(nextTracker));
      } catch(e) { console.error('timetracker write failed', e); }
    }
    setTimer(null); lsDel('activeTimer');
  }, [timer, tasks, trackerHandle]);

  const saveMeetingFile = useCallback(async () => {
    if (!dirs.meetings || !meetingStartRef.current) {
      if (!dirs.meetings) setToast('Pick a Meetings folder before saving meeting notes.');
      return;
    }
    const title     = meetingTitleRef.current.trim();
    const startTime = meetingStartRef.current;
    const endTime   = Date.now();
    const timeLabel = new Date(startTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false}).replace(':','');
    const filename  = `Meeting - ${tod()} - ${title || timeLabel}.md`;
    const content   = buildMeetingMd(title || `Meeting ${timeLabel}`, meetingNotesRef.current, startTime, endTime, meetingLinks);
    try {
      const fh = await dirs.meetings.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadMeetings(dirs.meetings);
      setToast(`Saved meeting note "${filename.replace(/\.md$/i, '')}"`);
    } catch(e) { console.error('meeting save failed', e); }
  }, [dirs.meetings, meetingLinks, loadMeetings]);

  const start = useCallback(async (id) => {
    if (timer) await stop();
    const at = { taskId:id, start:Date.now() };
    setTimer(at); setSel(id); lsSet('activeTimer', at);
  }, [timer, stop]);

  const startMeeting = useCallback(async () => {
    if (!dirs.meetings) {
      setView('meetings');
      setFolderSetupOpen(true);
      setToast('Pick a Meetings folder before starting a meeting note.');
      return;
    }
    meetingTitleRef.current = ''; meetingNotesRef.current = '';
    meetingStartRef.current = Date.now();
    setMeetingTitle(''); setMeetingNotes(''); setMeetingLinks({ clients:[], properties:[], tasks:[], people:[] });
    if (timer && timer.taskId!=='__meeting__') await stop();
    const at = { taskId:'__meeting__', start:Date.now() };
    setTimer(at); lsSet('activeTimer', at);
    setMeetingOpen(true);
    setView('meetings');
  }, [dirs.meetings, timer, stop]);

  const stopMeeting = useCallback(async () => {
    await saveMeetingFile();
    if (timer?.taskId === '__meeting__') await stop();
    setMeetingOpen(false);
  }, [saveMeetingFile, stop, timer]);

  const startAdHoc = async () => {
    if (!adHocInput.trim()) return;
    const name = adHocInput.trim();
    setAdHocName(name); adHocRef.current = name;
    lsSet('adHocName', name);
    setAdHocInput(''); setShowAdHoc(false);
    await start('__adhoc__');
  };

  const addNote = async () => {
    if (!note.trim() || !sel) return;
    const handle = taskHandles[sel];
    if (handle) {
      try {
        const task = tasks.find(t => t.id===sel);
        const latest = await readHandleText(handle);
        const updated = appendNoteToMd(latest, note.trim());
        await writeFile(handle, updated);
        setTasks(prev => prev.map(t => t.id===sel ? parseTask(t.id, updated) : t));
      } catch(e) { console.error('note write failed', e); }
    }
    setNote('');
  };

  const editTaskComment = async (index, nextBody) => {
    const task = tasks.find(t => t.id === sel);
    const log = task?.logs?.[index];
    const handle = sel ? taskHandles[sel] : null;
    if (!task || !log || !handle || !nextBody.trim()) return;

    try {
      const { time } = parseLogText(log.text);
      const nextText = time ? `[${time}] ${nextBody.trim()}` : nextBody.trim();
      const latest = await readHandleText(handle);
      const updated = touchDateModified(updateCommentLog(latest, log.date, log.text, logOccurrence(task.logs, index), nextText));
      await writeFile(handle, updated);
      setTasks(prev => prev.map(t => t.id === sel ? parseTask(t.id, updated) : t));
      setToast('Updated task comment');
    } catch(e) {
      console.error('task comment edit failed', e);
      alert('Failed to edit task comment: ' + e.message);
    }
  };

  const deleteTaskComment = async (index) => {
    const task = tasks.find(t => t.id === sel);
    const log = task?.logs?.[index];
    const handle = sel ? taskHandles[sel] : null;
    if (!task || !log || !handle) return;
    if (!confirm('Delete this task comment?')) return;

    try {
      const latest = await readHandleText(handle);
      const updated = touchDateModified(deleteCommentLog(latest, log.date, log.text, logOccurrence(task.logs, index)));
      await writeFile(handle, updated);
      setTasks(prev => prev.map(t => t.id === sel ? parseTask(t.id, updated) : t));
      setToast('Deleted task comment');
    } catch(e) {
      console.error('task comment delete failed', e);
      alert('Failed to delete task comment: ' + e.message);
    }
  };

  // ── New task creation ──
  const createTask = async (form) => {
    if (!dirs.tasks || !form.title.trim()) return;
    const baseName = safeFilename(form.title);
    let filename = `${baseName}.md`;
    let suffix = 2;
    while (taskHandles[filename]) filename = `${baseName} ${suffix++}.md`;
    const content  = buildNewTaskMd(form);
    try {
      const fh = await dirs.tasks.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadFiles(dirs.tasks, dirs.done);
      setNewTaskOpen(false);
      setSel(filename);
      setToast(`✅ Created "${form.title.trim()}"`);
    } catch(e) {
      console.error('create task failed', e);
      alert('Failed to create task: ' + e.message);
    }
  };

  // ── Mark task done + archived ──
  const closeTask = async () => {
    if (!sel) return;
    const handle = taskHandles[sel];
    const task = tasks.find(t => t.id===sel);
    if (!handle || !task) return;
    const confirmText = task.recurrent
      ? `Archive the whole recurring series "${task.title}"? Use "Finish instance" if you only completed this run.`
      : `Mark "${task.title}" as done and archived?`;
    if (!confirm(confirmText)) return;
    try {
      if (timer?.taskId === sel) await stop();
      const latest = await readHandleText(handle);
      const updated = markTaskDone(latest);
      if (dirs.done && !sel.startsWith('__done__/')) {
        const filename = await uniqueFileNameInDir(dirs.done, sel.split('/').pop());
        const doneHandle = await dirs.done.getFileHandle(filename, { create:true });
        await writeFile(doneHandle, updated);
        await removeFileAtPath(dirs.tasks, sel);
        await loadFiles(dirs.tasks, dirs.done);
        setToast(`✅ "${task.title}" moved to Done / Archive`);
        return;
      }
      await writeFile(handle, updated);
      const updatedTask = parseTask(task.id, updated);
      const nextTasks = tasks.map(t => t.id===sel ? updatedTask : t);
      setTasks(nextTasks);
      const nextSelected = nextTasks.find(t => !t.archived && t.id !== sel)?.id || nextTasks.find(t => !t.archived)?.id || null;
      setSel(nextSelected);
      setToast(`✅ "${task.title}" marked done & archived`);
    } catch(e) {
      console.error('close task failed', e);
      alert('Failed to close task: ' + e.message);
    }
  };

  const finishRecurrentInstance = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    const handle = taskHandles[taskId];
    if (!task || !handle) return;
    try {
      if (timer?.taskId === taskId) await stop();
      const latestTask = parseTask(taskId, await readHandleText(handle));
      const instanceDate = latestTask.due || latestTask.scheduled || tod();
      const updated = finishRecurrentTaskInstance(latestTask.raw, latestTask.due, latestTask.scheduled);
      await writeTaskUpdate(taskId, updated, `Finished ${instanceDate}; next run scheduled`);
    } catch(e) {
      console.error('finish recurrent instance failed', e);
      alert('Failed to finish this instance: ' + e.message);
    }
  };

  const writeTaskUpdate = async (taskId, updated, toastMsg) => {
    const handle = taskHandles[taskId];
    if (!handle) return;
    await writeFile(handle, updated);
    const updatedTask = parseTask(taskId, updated);
    setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
    setToast(toastMsg);
  };

  const changeTaskDates = async (taskId, nextDates) => {
    const task = tasks.find(t => t.id === taskId);
    const handle = taskHandles[taskId];
    if (!task || !handle) return;
    try {
      const latestTask = parseTask(taskId, await readHandleText(handle));
      const updated = updateTaskDates(latestTask.raw, {
        due: nextDates.due ?? latestTask.due ?? '',
        scheduled: nextDates.scheduled ?? latestTask.scheduled ?? '',
      });
      await writeTaskUpdate(taskId, updated, 'Updated task dates');
    } catch(e) {
      console.error('task date update failed', e);
      alert('Failed to update task dates: ' + e.message);
    }
  };

  const saveThreadSubject = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    const handle = taskHandles[taskId];
    if (!task || !handle) return;
    const nextSubject = threadSubjectDraft.trim();
    if ((task.threadSubject || '') === nextSubject) return;
    try {
      const latestTask = parseTask(taskId, await readHandleText(handle));
      const updated = updateTaskThreadSubject(latestTask.raw, nextSubject);
      await writeTaskUpdate(taskId, updated, nextSubject ? 'Saved thread subject' : 'Cleared thread subject');
    } catch(e) {
      console.error('thread subject update failed', e);
      alert('Failed to update thread subject: ' + e.message);
    }
  };

  const postponeTaskByWeek = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    const handle = taskHandles[taskId];
    if (!task || !handle) return;
    try {
      const latestTask = parseTask(taskId, await readHandleText(handle));
      const updated = postponeTaskDates(latestTask.raw, latestTask.due, latestTask.scheduled, 7);
      await writeTaskUpdate(taskId, updated, 'Postponed task by 1 week');
    } catch(e) {
      console.error('task postpone failed', e);
      alert('Failed to postpone task: ' + e.message);
    }
  };

  const setTaskDatesToDate = async (taskId, dateStr, label = 'date') => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const nextDates = task.scheduled && !task.due
      ? { scheduled: dateStr }
      : task.scheduled
        ? { due: dateStr, scheduled: dateStr }
        : { due: dateStr };
    await changeTaskDates(taskId, nextDates);
    setToast(`Set task date to ${label}`);
  };

  const setTaskDatesToToday = async (taskId) => {
    await setTaskDatesToDate(taskId, tod(), 'today');
  };

  const setTaskDatesToTomorrow = async (taskId) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    await setTaskDatesToDate(taskId, tod(d), 'tomorrow');
  };

  const postponeTaskByMonth = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    const handle = taskHandles[taskId];
    if (!task || !handle) return;
    try {
      const latestTask = parseTask(taskId, await readHandleText(handle));
      const updated = postponeTaskDatesByMonths(latestTask.raw, latestTask.due, latestTask.scheduled, 1);
      await writeTaskUpdate(taskId, updated, 'Postponed task by 1 month');
    } catch(e) {
      console.error('task monthly postpone failed', e);
      alert('Failed to postpone task: ' + e.message);
    }
  };

  const addPropertyComment = async () => {
    if (!propertySel || !propertyComment.trim()) return;
    const handle = propertyHandles[propertySel];
    const property = properties.find(p => p.id === propertySel);
    if (!handle || !property) return;
    try {
      const latest = await readHandleText(handle);
      const updated = appendPropertyCommentToMd(latest, propertyComment.trim());
      await writeFile(handle, updated);
      const updatedProperty = parseProperty(property.id, updated);
      setProperties(prev => prev.map(p => p.id === propertySel ? updatedProperty : p));
      setPropertyComment('');
      setToast(`Saved property comment for "${property.title}"`);
    } catch(e) {
      console.error('property comment write failed', e);
      alert('Failed to add property comment: ' + e.message);
    }
  };

  const editPropertyComment = async (index, nextBody) => {
    const property = properties.find(p => p.id === propertySel);
    const log = property?.comments?.[index];
    const handle = propertySel ? propertyHandles[propertySel] : null;
    if (!property || !log || !handle || !nextBody.trim()) return;

    try {
      const { time } = parseLogText(log.text);
      const nextText = time ? `[${time}] ${nextBody.trim()}` : nextBody.trim();
      const latest = await readHandleText(handle);
      const updated = touchDateModified(updateCommentLog(latest, log.date, log.text, logOccurrence(property.comments, index), nextText));
      await writeFile(handle, updated);
      const updatedProperty = parseProperty(property.id, updated);
      setProperties(prev => prev.map(p => p.id === propertySel ? updatedProperty : p));
      setToast('Updated property comment');
    } catch(e) {
      console.error('property comment edit failed', e);
      alert('Failed to edit property comment: ' + e.message);
    }
  };

  const deletePropertyComment = async (index) => {
    const property = properties.find(p => p.id === propertySel);
    const log = property?.comments?.[index];
    const handle = propertySel ? propertyHandles[propertySel] : null;
    if (!property || !log || !handle) return;
    if (!confirm('Delete this property comment?')) return;

    try {
      const latest = await readHandleText(handle);
      const updated = touchDateModified(deleteCommentLog(latest, log.date, log.text, logOccurrence(property.comments, index)));
      await writeFile(handle, updated);
      const updatedProperty = parseProperty(property.id, updated);
      setProperties(prev => prev.map(p => p.id === propertySel ? updatedProperty : p));
      setToast('Deleted property comment');
    } catch(e) {
      console.error('property comment delete failed', e);
      alert('Failed to delete property comment: ' + e.message);
    }
  };

  const saveCoverFile = async (file, label) => {
    if (!dirs.attachments) throw new Error('Pick an Attachments folder first.');
    const ext = coverExtension(file);
    const preferred = `${kebabSlug(label, 'new-property')}-cover.${ext}`;
    const filename = await uniqueFileNameInDir(dirs.attachments, preferred);
    const fh = await dirs.attachments.getFileHandle(filename, { create:true });
    await writeFile(fh, file);
    return filename;
  };

  const createProperty = async (form) => {
    if (!dirs.properties || !form.title.trim()) return;
    if (form.coverFile && !dirs.attachments) {
      alert('Pick an Attachments folder before uploading a cover.');
      return;
    }

    try {
      const slug = kebabSlug(form.title, 'new-property');
      const filename = await uniqueFileNameInDir(dirs.properties, `${slug}.md`);
      let coverPath = '';
      if (form.coverFile) {
        const coverName = await saveCoverFile(form.coverFile, form.title);
        coverPath = `${dirs.attachments.name}/${coverName}`;
        await loadAttachmentImages(dirs.attachments);
      }

      const content = buildNewPropertyMd({ ...form, coverPath });
      const fh = await dirs.properties.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadProperties(dirs.properties);
      await loadRefs(dirs);
      setPropertySearch('');
      setPropertySel(filename);
      setNewPropertyOpen(false);
      setToast(`Created property "${form.title.trim()}"`);
    } catch(e) {
      console.error('create property failed', e);
      alert('Failed to create property: ' + e.message);
    }
  };

  const uploadPropertyCover = async (id, file) => {
    if (!file) return;
    if (!dirs.attachments) {
      alert('Pick an Attachments folder before uploading a cover.');
      return;
    }

    const handle = propertyHandles[id];
    const property = properties.find(p => p.id === id);
    if (!handle || !property) return;

    try {
      const coverName = await saveCoverFile(file, property.title);
      const coverPath = `${dirs.attachments.name}/${coverName}`;
      const latest = await readHandleText(handle);
      const updated = setPropertyCover(latest, coverPath);
      await writeFile(handle, updated);
      await loadAttachmentImages(dirs.attachments);
      const updatedProperty = parseProperty(property.id, updated);
      setProperties(prev => prev.map(p => p.id === id ? updatedProperty : p));
      setToast(`Updated cover for "${property.title}"`);
    } catch(e) {
      console.error('property cover upload failed', e);
      alert('Failed to upload cover: ' + e.message);
    }
  };

  const saveProperty = async () => {
    if (!propertySel) return;
    const handle = propertyHandles[propertySel];
    if (!handle) return;
    try {
      const updated = touchDateModified(propertyDraft);
      await writeFile(handle, updated);
      const updatedProperty = parseProperty(propertySel, updated);
      setProperties(prev => prev.map(p => p.id === propertySel ? updatedProperty : p).sort((a,b) => a.title.localeCompare(b.title)));
      setPropertyDraft(updated);
      await loadRefs(dirs);
      setToast(`Saved "${updatedProperty.title}"`);
    } catch(e) {
      console.error('save property failed', e);
      alert('Failed to save property: ' + e.message);
    }
  };

  const createProject = async (form) => {
    if (!dirs.projects || !form.title.trim()) return;
    try {
      const filename = await uniqueFileNameInDir(dirs.projects, projectFilename(form.title));
      const content = buildNewProjectMd(form);
      const fh = await dirs.projects.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadProjects(dirs.projects);
      await loadRefs(dirs);
      setProjectSearch('');
      setProjectSel(filename);
      setNewProjectOpen(false);
      setToast(`Created project "${form.title.trim()}"`);
    } catch(e) {
      console.error('create project failed', e);
      alert('Failed to create project: ' + e.message);
    }
  };

  const saveCurrentFilter = () => {
    const name = filterName.trim() || `${filt}${taskSearch.trim() ? `: ${taskSearch.trim()}` : ''}`;
    const next = [
      { name, filt, search:taskSearch.trim() },
      ...savedFilters.filter(item => item.name !== name),
    ].slice(0, 8);
    setSavedFilters(next);
    lsSet(SAVED_FILTERS_KEY, next);
    setFilterName('');
    setToast(`Saved filter "${name}"`);
  };

  const applySavedFilter = (filter) => {
    setFilt(filter.filt || 'all');
    setTaskSearch(filter.search || '');
    setView('tasks');
  };

  const deleteSavedFilter = (name) => {
    const next = savedFilters.filter(item => item.name !== name);
    setSavedFilters(next);
    lsSet(SAVED_FILTERS_KEY, next);
  };

  const createPerson = async (form) => {
    if (!dirs.people || !form.name.trim()) return;
    try {
      const filename = await uniqueFileNameInDir(dirs.people, `${kebabSlug(form.name, 'new-person')}.md`);
      const content = buildNewPersonMd(form);
      const fh = await dirs.people.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadPeople(dirs.people);
      await loadRefs({ ...dirs, people: dirs.people });
      setPersonSel(filename);
      setNewPersonOpen(false);
      setToast(`Created person "${form.name.trim()}"`);
    } catch(e) {
      console.error('create person failed', e);
      alert('Failed to create person: ' + e.message);
    }
  };

  const savePerson = async () => {
    if (!personSel) return;
    const handle = personHandles[personSel];
    if (!handle) return;
    try {
      const updated = touchDateModified(personDraft);
      await writeFile(handle, updated);
      const updatedPerson = parsePerson(personSel, updated);
      setPeople(prev => prev.map(p => p.id === personSel ? updatedPerson : p).sort((a,b) => a.title.localeCompare(b.title)));
      setPersonDraft(updated);
      await loadRefs(dirs);
      setToast(`Saved "${updatedPerson.title}"`);
    } catch(e) {
      console.error('save person failed', e);
      alert('Failed to save person: ' + e.message);
    }
  };

  const createOrganization = async (form) => {
    if (!dirs.organizations || !form.name.trim()) return;
    try {
      const filename = await uniqueFileNameInDir(dirs.organizations, `${kebabSlug(form.name, 'new-organization')}.md`);
      const content = buildNewOrganizationMd(form);
      const fh = await dirs.organizations.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadOrganizations(dirs.organizations);
      await loadRefs(dirs);
      setOrgSearch('');
      setOrgSel(filename);
      setNewOrgOpen(false);
      setToast(`Created organization "${form.name.trim()}"`);
    } catch(e) {
      console.error('create organization failed', e);
      alert('Failed to create organization: ' + e.message);
    }
  };

  const saveOrganization = async () => {
    if (!orgSel) return;
    const handle = orgHandles[orgSel];
    if (!handle) return;
    try {
      const updated = touchDateModified(orgDraft);
      await writeFile(handle, updated);
      const updatedOrg = parseOrganization(orgSel, updated);
      setOrganizations(prev => prev.map(o => o.id === orgSel ? updatedOrg : o).sort((a,b) => a.title.localeCompare(b.title)));
      setOrgDraft(updated);
      await loadRefs(dirs);
      setToast(`Saved "${updatedOrg.title}"`);
    } catch(e) {
      console.error('save organization failed', e);
      alert('Failed to save organization: ' + e.message);
    }
  };

  const saveProject = async () => {
    if (!projectSel) return;
    const handle = projectHandles[projectSel];
    if (!handle) return;
    try {
      const updated = touchDateModified(projectDraft);
      await writeFile(handle, updated);
      const updatedProject = parseProject(projectSel, updated);
      setProjects(prev => prev.map(p => p.id === projectSel ? updatedProject : p));
      setProjectDraft(updated);
      setToast(`Saved "${updatedProject.title}"`);
    } catch(e) {
      console.error('save project failed', e);
      alert('Failed to save project: ' + e.message);
    }
  };

  const findWritableHandleForBackup = (backup) => {
    const filename = backup?.filename;
    if (!filename) return null;
    const maps = [taskHandles, projectHandles, propertyHandles, personHandles, orgHandles];
    for (const map of maps) {
      const exact = map[filename];
      if (exact) return exact;
      const byName = Object.values(map).find(handle => handle?.name === filename);
      if (byName) return byName;
    }
    if (dailyHandle?.name === filename) return dailyHandle;
    if (trackerHandle?.name === filename) return trackerHandle;
    return null;
  };

  const restoreBackup = async (backup) => {
    const handle = findWritableHandleForBackup(backup);
    if (!handle) {
      setToast(`Reconnect or open "${backup.filename}" before restoring this backup.`);
      return;
    }
    if (!confirm(`Restore the saved previous version of "${backup.filename}"?`)) return;
    try {
      await writeFile(handle, backup.content);
      await loadAll(dirs);
      setToast(`Restored "${backup.filename}" from local backup`);
    } catch(e) {
      console.error('backup restore failed', e);
      alert('Failed to restore backup: ' + e.message);
    }
  };

  const addDailyEntry = async (section) => {
    const text = dailyInputs[section]?.trim();
    if (!text) return;
    if (!dirs.daily || !dailyHandle || !dailyNote) {
      alert('Pick a Daily Notes folder first.');
      return;
    }

    try {
      const latest = await readHandleText(dailyHandle);
      const updated = appendDailySectionEntry(latest, section, text);
      await writeFile(dailyHandle, updated);
      setDailyNote(parseDailyNote(`${tod()}.md`, updated));
      setDailyInputs(prev => ({ ...prev, [section]: '' }));
      setToast('Saved to today\'s daily note');
    } catch(e) {
      console.error('daily note write failed', e);
      alert('Failed to update daily note: ' + e.message);
    }
  };

  const upsertTimeNote = (note) => {
    setTimeNotes(prev => [...prev.filter(item => item.id !== note.id), note]
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')));
  };

  const addTimeClockEvent = async (event, dateStr = tod()) => {
    if (!dirs.daily) {
      alert('Pick a Daily Notes folder first.');
      return;
    }

    try {
      const result = await readDailyNoteForDate(dirs.daily, dateStr, true);
      if (!result) return;
      const latest = await readHandleText(result.handle);
      const updated = appendDailyTimeClockEvent(latest, event);
      await saveWorkNote(dateStr, result.handle, updated, `${event} saved to ${dateStr}`);
    } catch(e) {
      console.error('time clock write failed', e);
      alert('Failed to update time clock: ' + e.message);
    }
  };

  const saveWorkNote = async (dateStr, handle, updated, message) => {
    await writeFile(handle, updated);
    const parsed = parseDailyNote(`${dateStr}.md`, updated);
    setWorkNotes(prev => ({ ...prev, [dateStr]: parsed }));
    setWorkHandles(prev => ({ ...prev, [dateStr]: handle }));
    upsertTimeNote(parsed);
    if (dateStr === tod()) {
      setDailyNote(parsed);
      setDailyHandle(handle);
    }
    if (message) setToast(message);
  };

  const saveTimeClockRows = async (dateStr, rows) => {
    if (!dirs.daily) {
      alert('Pick a Daily Notes folder first.');
      return;
    }
    const result = await readDailyNoteForDate(dirs.daily, dateStr, true);
    if (!result) return;
    const updated = replaceDailyTimeClockRows(result.note.raw, normalizedTimeRows(rows));
    await saveWorkNote(dateStr, result.handle, updated, `Updated hours for ${dateStr}`);
  };

  const updateWorkStatus = async (dateStr, status) => {
    if (!dirs.daily) {
      alert('Pick a Daily Notes folder first.');
      return;
    }
    const result = await readDailyNoteForDate(dirs.daily, dateStr, true);
    if (!result) return;
    const updated = setDailyWorkStatus(result.note.raw, status);
    await saveWorkNote(dateStr, result.handle, updated, `${WORK_STATUS_LABELS[status] || 'Status'} saved for ${dateStr}`);
  };

  const task      = tasks.find(t => t.id===sel);
  const property  = properties.find(p => p.id===propertySel);
  const project   = projects.find(p => p.id===projectSel);
  const savedMeeting = meetings.find(m => m.id === meetingSel);
  const selTime   = sel ? getTime(sel) : 0;
  const live      = timer?.taskId===sel;
  const taskDaysOpen = task ? daysOpenSince(task.dateCreated) : null;
  const taskAge = taskAgeTone(taskDaysOpen);

  useEffect(() => {
    setThreadSubjectDraft(task?.threadSubject || '');
  }, [task?.id, task?.threadSubject]);

  const totalToday = [...tasks.map(t=>t.id),'__email__','__meeting__','__adhoc__'].reduce((a,id)=>a+getTime(id),0);
  const dueColor  = due => isOver(due)?'#c2533f':isToday(due)?'#a9791f':TEXT_SECONDARY;
  const isClosedTask = t => t.archived || t.status === 'done';
  const isOpenTask = t => !isClosedTask(t);
  const isOverdueTask = t => isOpenTask(t) && isOver(t.due);
  const syncLabel = lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}` : 'Not synced';
  const taskTitleCounts = tasks.reduce((acc, t) => {
    const key = (t.title || '').trim().toLowerCase();
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const filterTaskList = list => list
    .filter(t => filt === 'done' ? isClosedTask(t) : isOpenTask(t))
    .filter(t => filt==='today'?isToday(t.due):filt==='overdue'?isOverdueTask(t):true)
    .filter(t => {
      const q = taskSearch.trim().toLowerCase();
      if (!q) return true;
      return [t.title, t.filename, t.id, t.client, t.building, t.priority, t.status, t.due, t.scheduled, ...(t.projects || []), ...(t.contexts || []), ...(t.tags || [])]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q));
    });
  const visibleTaskPool = tasks.filter(t => !hasHiddenTaskTag(t));
  const filtered = filterTaskList(visibleTaskPool);
  const filteredBd = filterTaskList(tasks.filter(isBrainDumpTask));
  const visibleTasks = view === 'bd' ? filteredBd : filtered;
  const openTasks = visibleTaskPool.filter(isOpenTask);
  const openBdTasks = tasks.filter(isBrainDumpTask).filter(isOpenTask);

  useEffect(() => {
    if (view !== 'bd') return;
    if (sel && filteredBd.some(t => t.id === sel)) return;
    const nextId = filteredBd[0]?.id || null;
    if (sel !== nextId) setSel(nextId);
  }, [view, sel, filteredBd]);

  const byOldestCreated = (a, b) => (a.dateCreated || '9999').localeCompare(b.dateCreated || '9999') || a.title.localeCompare(b.title);
  const missionToday = openTasks.filter(t => !t.recurrent && (isToday(t.due) || isToday(t.scheduled))).sort(byOldestCreated);
  const missionOverdue = openTasks.filter(isOverdueTask).sort(byOldestCreated);
  const missionRecurrent = openTasks.filter(t => t.recurrent && !isOver(t.due) && (isToday(t.due) || isToday(t.scheduled))).sort(byOldestCreated);
  const filteredProperties = properties.filter(p => {
    const q = propertySearch.trim().toLowerCase();
    if (!q) return true;
    return [p.title, p.filename, p.client, p.summary].filter(Boolean).some(v => v.toLowerCase().includes(q));
  });
  const filteredProjects = projects.filter(p => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return true;
    return [p.title, p.filename, p.client, p.summary, p.status].filter(Boolean).some(v => v.toLowerCase().includes(q));
  });
  const filteredPeople = people.filter(p => {
    const q = peopleSearch.trim().toLowerCase();
    if (!q) return true;
    return [p.title, p.filename, p.company, p.role, p.email].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  });
  const meetingTaskOptions = [...new Set(tasks.filter(isOpenTask).map(t => t.filename || t.title).filter(Boolean))].sort();
  const person = people.find(p => p.id === personSel);
  const filteredOrgs = organizations.filter(o => {
    const q = orgSearch.trim().toLowerCase();
    if (!q) return true;
    return [o.title, o.filename, o.industry, o.website, o.email].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  });
  const organization = organizations.find(o => o.id === orgSel);
  const selectedWorkNote = workNotes[workDate];
  const selectedWorkStats = workStats(selectedWorkNote);
  const selectedWeekDates = weekDates(workDate);
  const selectedWeekTotal = selectedWeekDates.reduce((sum, dateStr) => sum + workStats(workNotes[dateStr]).totalMinutes, 0);
  const todayWorkStats = workStats(workNotes[tod()] || dailyNote);
  const trailingWeekStats = dashboardStats(timeNotes, addDays(tod(), -6), tod());
  const timeNoteDates = timeNotes
    .map(note => note.date)
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || ''))
    .sort();
  const historicalTimeStats = dashboardStats(timeNotes, timeNoteDates[0] || tod(), timeNoteDates[timeNoteDates.length - 1] || tod());
  const personSummary = personMetrics(person, tasks, meetings, isClosedTask);
  const projectSummary = projectMetrics(project, tasks, isClosedTask);
  const organizationSummary = organizationMetrics(organization, tasks, meetings, isClosedTask);
  const tomorrow = addDays(tod(), 1);
  const currentWeekDates = weekDates(tod());
  const completedThisWeek = visibleTaskPool.filter(t => currentWeekDates.includes((t.completedDate || '').slice(0, 10)));
  const tomorrowTasks = openTasks.filter(t => t.due === tomorrow || t.scheduled === tomorrow).sort(byOldestCreated);
  const taskFallsBetween = (task, start, end) => [task.due, task.scheduled]
    .filter(Boolean)
    .some(date => date >= start && date <= end);
  const nextWeekTasks = openTasks.filter(t => taskFallsBetween(t, tomorrow, addDays(tod(), 7)));
  const nextMonthTasks = openTasks.filter(t => taskFallsBetween(t, tomorrow, addDays(tod(), 30)));
  const vaultTotals = {
    tasks: visibleTaskPool.length,
    tasksOpen: openTasks.length,
    tasksFinished: visibleTaskPool.filter(isClosedTask).length,
    projects: projects.length,
    properties: properties.length,
    clients: refs.clients.length,
    people: people.length,
  };
  const mentionOptions = useMemo(() => [
    ...(refs.people || []).map(label => ({ label, type:'person' })),
    ...(refs.projects || []).map(label => ({ label, type:'project' })),
    ...(refs.clients || []).map(label => ({ label, type:'client' })),
    ...(refs.properties || []).map(label => ({ label, type:'property' })),
    ...(refs.organizations || []).map(label => ({ label, type:'organization' })),
  ], [refs]);
  const diagnostics = buildDiagnostics({ tasks, projects, properties, refs, dirs, folderStats, folderIssues, backups:writeBackups });
  const healthErrors = diagnostics.issues.filter(i => i.level === 'error').length;
  const healthWarnings = diagnostics.issues.filter(i => i.level === 'warning').length;
  const healthBadges = healthErrors + healthWarnings;
  const headerLabel = view === 'mission' ? 'MISSION CONTROL' : view === 'tasks' ? "TODAY'S TOTAL" : view === 'bd' ? 'BD TASKS' : view === 'hours' ? 'HOURS' : view === 'time' ? 'TIME DASHBOARD' : view === 'meetings' ? 'MEETINGS' : view === 'projects' ? 'PROJECT LIBRARY' : view === 'properties' ? 'PROPERTY LIBRARY' : view === 'people' ? 'PEOPLE' : view === 'organizations' ? 'ORGANIZATIONS' : 'VAULT HEALTH';
  const headerMetric = view === 'mission' ? missionToday.length + missionOverdue.length + missionRecurrent.length : view === 'tasks' ? fmt(totalToday) : view === 'bd' ? openBdTasks.length : view === 'hours' ? formatHoursMinutes(selectedWorkStats.totalMinutes) : view === 'time' ? formatHoursMinutes(trailingWeekStats.summary.totalMinutes) : view === 'meetings' ? (meetingOpen ? fmt(getTime('__meeting__')) : meetings.length) : view === 'projects' ? projects.length : view === 'properties' ? properties.length : view === 'people' ? people.length : view === 'organizations' ? organizations.length : diagnostics.issues.length;
  const headerDetail = view === 'mission'
    ? `${missionToday.length} today · ${missionOverdue.length} overdue · ${missionRecurrent.length} recurrent · ${dirs.daily ? 'daily on' : 'daily off'}`
    : view === 'tasks'
      ? `${openTasks.length} open tasks · ${Object.values(refs).reduce((a,r)=>a+r.length,0)} refs`
      : view === 'bd'
        ? `${openBdTasks.length} open BD tasks · ${filteredBd.length} shown`
      : view === 'hours'
        ? `${workDate} · ${selectedWorkStats.label} · ${formatHoursMinutes(selectedWeekTotal)} this week`
      : view === 'time'
        ? `${formatHoursMinutes(trailingWeekStats.summary.totalMinutes)} in the last 7 days · ${trailingWeekStats.summary.goalMet} goal-hit days`
        : view === 'meetings'
          ? `${dirs.meetings ? dirs.meetings.name : 'No folder'} · ${meetingOpen ? 'meeting note open' : `${meetings.length} saved`}`
          : view === 'projects'
            ? `${dirs.projects ? dirs.projects.name : 'No folder'} · editable`
            : view === 'properties'
              ? `${dirs.properties ? dirs.properties.name : 'No folder'} · ${dirs.attachments ? 'covers on' : 'covers off'}`
              : view === 'people'
                ? `${dirs.people ? dirs.people.name : 'No folder'} · ${personSummary.waitingFor} waiting-for · ${personSummary.meetings} meetings`
                : view === 'organizations'
                  ? `${dirs.organizations ? dirs.organizations.name : 'No folder'} · ${organizations.length} saved · editable`
                  : `${healthErrors} errors · ${healthWarnings} warnings · ${writeBackups.length} backups`;

  const btnPrimary = { padding:'13px 34px', borderRadius:12, border:'none', cursor:'pointer', fontWeight:700, fontSize:14, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW };

  const QuickItem = ({ id, label, onStart, onStop }) => {
    const running = timer?.taskId===id, time = getTime(id);
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', marginBottom:4, borderRadius:9, transition:'all 0.2s',
        background:running?'rgba(20,120,72,0.08)':'rgba(255,255,255,0.50)',
        border:`1px solid ${running?'rgba(20,120,72,0.25)':'rgba(255,255,255,0.58)'}`,
        boxShadow:running?'0 0 12px rgba(20,120,72,0.15)':'none' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <span style={{ fontSize:12, fontWeight:600, color:running?'#13733f':'#222a25' }}>{label}</span>
          {time>0 && <span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:'tabular-nums', color:running?'#13733f':'#5b57b0' }}>{fmt(time)}</span>}
          {running && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:20, background:'rgba(20,120,72,0.12)', color:'#13733f', fontWeight:700 }}>● LIVE</span>}
        </div>
        <button onClick={running?onStop:onStart} style={{ padding:'4px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit',
          background:running?'rgba(225,91,79,0.1)':BRAND_GRADIENT,
          color:running?'#c2533f':'#fff', outline:running?'1px solid rgba(225,91,79,0.25)':'none' }}>
          {running?'⏹ Stop':'▶ Start'}
        </button>
      </div>
    );
  };

  // ── Setup screen / folder manager ──
  const showSetup = bootDone && (folderSetupOpen || (!dirs.tasks && !folderIssues.tasks));
  const allSavedReady = bootDone && Object.keys(savedDirs).length > 0;

  if (showSetup) return (
    <div style={{ position:'relative', height:'100vh', overflowY:'auto', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start', padding:'36px 20px 28px', gap:18, color:'#222a25', background:'radial-gradient(ellipse at 50% -5%,rgba(20,120,72,0.24) 0%,#e1e7e3 65%)' }}>
      <div style={{ fontSize:52, filter:'drop-shadow(0 0 20px rgba(20,120,72,0.55))' }}>⚡</div>
      <div style={{ textAlign:'center' }}>
        <h1 style={{ margin:'0 0 8px', fontSize:32, fontWeight:800, background:'linear-gradient(135deg,#f0f7f2,#23a564)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>TaskDash</h1>
        <p style={{ margin:0, color:'#5a615b', fontSize:14 }}>Connect your Obsidian vault folders — one time per device</p>
      </div>

      {allSavedReady && (
        <button onClick={resumeAll} disabled={setupBusy} style={btnPrimary}>
          {setupBusy ? 'Loading…' : `▶  Resume — reconnect ${Object.keys(savedDirs).length} folder${Object.keys(savedDirs).length>1?'s':''}`}
        </button>
      )}

      <div style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:8 }}>
        {FOLDER_DEFS.map(def => {
          const live = dirs[def.key];
          const saved = savedDirs[def.key];
          const status = live ? 'connected' : saved ? 'saved' : 'empty';
          return (
            <div key={def.key} style={{ padding:'12px 14px', borderRadius:11, background:'rgba(255,255,255,0.55)', border:`1px solid ${live?'rgba(20,120,72,0.3)':saved?'rgba(208,150,52,0.3)':'rgba(255,255,255,0.60)'}`, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                  <span style={{ fontWeight:700, fontSize:13 }}>{def.label}</span>
                  {def.required && <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10, background:'rgba(225,91,79,0.15)', color:'#c2533f', fontWeight:700 }}>REQUIRED</span>}
                  {status==='connected' && <span style={{ fontSize:10, color:'#13733f', fontWeight:600 }}>● {live.name}</span>}
                  {status==='saved' && <span style={{ fontSize:10, color:'#a9791f', fontWeight:600 }}>● needs permission · {saved.name}</span>}
                </div>
                <div style={{ fontSize:11, color:'#5a615b' }}>{def.desc}</div>
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                {status==='saved' && (
                  <button onClick={()=>resumeFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'rgba(208,150,52,0.15)', color:'#a9791f' }}>Resume</button>
                )}
                <button onClick={()=>pickFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:status==='connected'?'rgba(255,255,255,0.58)':BRAND_GRADIENT, color:status==='connected'?'#5a615b':'#fff' }}>
                  {status==='connected' ? 'Change' : status==='saved' ? 'Re-pick' : 'Pick folder'}
                </button>
                {status==='connected' && (
                  <button onClick={()=>clearFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 9px', borderRadius:8, border:'none', cursor:'pointer', fontSize:11, fontFamily:'inherit', background:'rgba(225,91,79,0.08)', color:'#c2533f' }}>✕</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ color:'#5a615b', fontSize:11, marginTop:8 }}>Chrome only · files stay on your device · pick once, remembered forever</p>
      {dirs.tasks && (
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button onClick={finishFolderSetup} disabled={setupBusy} style={btnPrimary}>Done</button>
          <button onClick={resetAll} disabled={setupBusy} style={{ padding:'10px 16px', borderRadius:10, border:'1px solid rgba(225,91,79,0.22)', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'rgba(225,91,79,0.08)', color:'#c2533f' }}>
            Forget all folders
          </button>
        </div>
      )}
      <ScreenLogo />
    </div>
  );

  if (!bootDone) return <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#e1e7e3', color:'#5a615b' }}>Loading…</div>;

  // ── Main UI ──
  return (
    <MentionProvider options={mentionOptions}>
      <div className="wallpaper" aria-hidden="true"><div className="blob"/></div>
      <div className="shell">
        {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

        <IconRail
          view={view}
          setView={(v) => { setView(v); setNewTaskOpen(false); setNewPropertyOpen(false); setNewProjectOpen(false); setNewPersonOpen(false); setNewOrgOpen(false); }}
          vaultName={dirs.tasks?.name}
          healthOk={!healthBadges}
          onHealth={() => setView('health')}
          onSettings={() => setFolderSetupOpen(true)}
        />

      {/* ─── Sidebar ─── */}
      <div className="pane glass-strong" style={{ flexShrink:0, display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'18px 14px 12px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <span style={{ fontSize:15 }}>⚡</span>
              <span style={{ fontWeight:700, fontSize:13, maxWidth:155, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{dirs.tasks?.name}</span>
            </div>
            <button onClick={forceSyncAll} disabled={syncBusy} title="Force rescan all configured folders" style={{ padding:'4px 10px', borderRadius:7, border:'none', cursor:syncBusy?'wait':'pointer', fontSize:11, fontWeight:600, fontFamily:'inherit',
              background:needsRefresh?'rgba(208,150,52,0.2)':BRAND_SURFACE_STRONG,
              color:needsRefresh?'#a9791f':BRAND_TEXT, boxShadow:needsRefresh?'0 0 10px rgba(208,150,52,0.3)':'none', transition:'all 0.3s', opacity:syncBusy?0.6:1 }}>
              ↺ {syncBusy?'Syncing':needsRefresh?'Stale':'Force Sync'}
            </button>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:10 }}>
            <div style={{ width:6, height:6, borderRadius:3, background:'#13733f', boxShadow:'0 0 6px rgba(20,120,72,0.6)' }}/>
            <span style={{ fontSize:10, color:'#13733f' }}>{syncLabel} · auto while open every 5 min</span>
          </div>
          {view !== 'mission' && (
            <div style={{ padding:'11px 13px', borderRadius:10, background:BRAND_SURFACE, border:`1px solid ${BRAND_BORDER}` }}>
              <div style={{ fontSize:9, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.1em', marginBottom:3 }}>{headerLabel}</div>
              <div style={{ fontWeight:800, fontSize:23, letterSpacing:0, fontVariantNumeric:'tabular-nums' }}>{headerMetric}</div>
              <div style={{ fontSize:10, color:'#5a615b', marginTop:2 }}>{headerDetail}</div>
            </div>
          )}
        </div>

        {(view === 'tasks' || view === 'bd') ? (
          <>
            <div style={{ padding:'8px 10px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <div style={{ fontSize:9, color:'#5a615b', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6 }}>Quick Track</div>
              <QuickItem id="__email__"   label="📧 Email"   onStart={()=>start('__email__')} onStop={stop}/>

              {timer?.taskId==='__adhoc__' ? (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', borderRadius:9, background:'rgba(20,120,72,0.08)', border:'1px solid rgba(20,120,72,0.25)', boxShadow:'0 0 12px rgba(20,120,72,0.15)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:'#13733f', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>🎯 {adHocName||'Ad-hoc'}</span>
                    <span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:'tabular-nums', color:'#13733f' }}>{fmt(getTime('__adhoc__'))}</span>
                    <span style={{ fontSize:9, padding:'1px 5px', borderRadius:20, background:'rgba(20,120,72,0.12)', color:'#13733f', fontWeight:700 }}>● LIVE</span>
                  </div>
                  <button onClick={stop} style={{ padding:'4px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'rgba(225,91,79,0.1)', color:'#c2533f', outline:'1px solid rgba(225,91,79,0.25)' }}>⏹ Stop</button>
                </div>
              ) : showAdHoc ? (
                <div style={{ padding:'8px 10px', borderRadius:9, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)' }}>
                  <div style={{ fontSize:11, color:'#5a615b', marginBottom:6 }}>🎯 What are you working on?</div>
                  <div style={{ display:'flex', gap:6 }}>
                    <input value={adHocInput} onChange={e=>setAdHocInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&startAdHoc()} autoFocus placeholder="e.g. Proposal draft…"
                      style={{ flex:1, padding:'6px 10px', borderRadius:7, background:'rgba(255,255,255,0.58)', border:'1px solid rgba(255,255,255,0.68)', color:'#222a25', fontSize:12, outline:'none', fontFamily:'inherit' }}/>
                    <button onClick={startAdHoc} disabled={!adHocInput.trim()} style={{ padding:'6px 10px', borderRadius:7, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', opacity:adHocInput.trim()?1:0.4 }}>▶</button>
                    <button onClick={()=>{setShowAdHoc(false);setAdHocInput('');}} style={{ padding:'6px 8px', borderRadius:7, border:'none', cursor:'pointer', background:'rgba(255,255,255,0.58)', color:'#5a615b', fontSize:12 }}>✕</button>
                  </div>
                </div>
              ) : (
                <button onClick={()=>setShowAdHoc(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:9, border:'1px dashed rgba(255,255,255,0.68)', background:'transparent', color:'#5a615b', fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                  🎯 + Ad-hoc task…
                </button>
              )}
            </div>

            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>{ setNewPersonOpen(false); setNewTaskOpen(true); }} disabled={!dirs.tasks} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:dirs.tasks?'pointer':'not-allowed', fontWeight:700, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW, opacity:dirs.tasks?1:0.35 }}>
                +  New Task
              </button>
              <button onClick={()=>{ setNewTaskOpen(false); setNewPersonOpen(true); }} title={dirs.people ? 'Add a person note' : 'Configure the People folder first'} style={{ padding:'8px 10px', borderRadius:9, border:'1px solid rgba(255,255,255,0.62)', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'rgba(255,255,255,0.55)', color:BRAND_TEXT, opacity:dirs.people?1:0.65 }}>
                + Person
              </button>
            </div>


            <div style={{ padding:'6px 10px 8px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <input value={taskSearch} onChange={e=>setTaskSearch(e.target.value)} placeholder={view === 'bd' ? 'Search BD tasks...' : 'Search tasks...'} style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>

            <div style={{ display:'flex', gap:3, padding:'4px 10px 8px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              {['all','today','overdue','done'].map(f => (
                <button key={f} onClick={()=>setFilt(f)} style={{ flex:1, padding:'5px 0', borderRadius:7, border:'none', cursor:'pointer', fontSize:10, fontWeight:600, textTransform:'capitalize', fontFamily:'inherit', background:filt===f?BRAND_SURFACE:'transparent', color:filt===f?BRAND_TEXT:'#5a615b' }}>{f}</button>
              ))}
            </div>
            <div style={{ padding:'7px 10px 8px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <div style={{ display:'flex', gap:5, marginBottom:savedFilters.length?6:0 }}>
                <input value={filterName} onChange={e=>setFilterName(e.target.value)} placeholder="Filter name" style={{ flex:1, minWidth:0, padding:'6px 8px', borderRadius:7, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)', color:'#222a25', fontSize:11, outline:'none', fontFamily:'inherit' }}/>
                <button onClick={saveCurrentFilter} style={{ padding:'6px 8px', borderRadius:7, border:'none', cursor:'pointer', fontWeight:800, fontSize:10, fontFamily:'inherit', background:BRAND_SURFACE_STRONG, color:BRAND_TEXT }}>Save</button>
              </div>
              {savedFilters.map(sf => (
                <div key={sf.name} style={{ display:'flex', gap:5, alignItems:'center', marginTop:4 }}>
                  <button onClick={()=>applySavedFilter(sf)} style={{ flex:1, minWidth:0, textAlign:'left', padding:'5px 7px', borderRadius:7, border:'1px solid rgba(255,255,255,0.58)', background:'rgba(255,255,255,0.50)', color:'#5a615b', cursor:'pointer', fontSize:10, fontFamily:'inherit', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sf.name}</button>
                  <button onClick={()=>deleteSavedFilter(sf.name)} style={{ width:22, height:22, borderRadius:7, border:'none', background:'rgba(225,91,79,0.08)', color:'#c2533f', cursor:'pointer', fontSize:11 }}>x</button>
                </div>
              ))}
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!visibleTasks.length && <div style={{ color:'#5a615b', textAlign:'center', paddingTop:40, fontSize:12 }}>{view === 'bd' ? 'No BD tasks' : 'No tasks'}</div>}
              {visibleTasks.map(t => {
                const running=timer?.taskId===t.id, active=sel===t.id, time=getTime(t.id);
                const duplicateTitle = taskTitleCounts[(t.title || '').trim().toLowerCase()] > 1;
                return (
                  <div key={t.id} onClick={()=>setSel(t.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?BRAND_SURFACE:'rgba(255,255,255,0.50)', border:`1px solid ${active?BRAND_BORDER:'rgba(255,255,255,0.55)'}`, boxShadow:running?'0 0 14px rgba(20,120,72,0.18)':'none', transition:'all 0.15s' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:6, marginBottom:5 }}>
                      <span style={{ fontSize:12, fontWeight:500, lineHeight:1.35, flex:1 }}>{t.title}</span>
                      {running && <span style={{ fontSize:9, padding:'2px 6px', borderRadius:20, background:'rgba(20,120,72,0.12)', color:'#13733f', fontWeight:700, flexShrink:0 }}>● LIVE</span>}
                    </div>
                    {duplicateTitle && (
                      <div title={t.id} style={{ fontSize:10, color:'#5b57b0', marginBottom:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {t.id.replace(/\.md$/i, '')}
                      </div>
                    )}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:4 }}>
                      <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                        <PBadge p={t.priority}/><SBadge s={t.status}/>
                        {t.due && <span style={{ fontSize:10, fontWeight:500, color:dueColor(t.due) }}>{isToday(t.due)?'Today':isOver(t.due)?'Overdue':t.due}</span>}
                      </div>
                      {time>0 && <span style={{ fontSize:11, color:'#5b57b0', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{fmt(time)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : view === 'meetings' ? (
          <>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <button onClick={meetingOpen ? stopMeeting : startMeeting} disabled={!dirs.meetings && !meetingOpen} style={{ width:'100%', padding:'9px 12px', borderRadius:9, border:'none', cursor:dirs.meetings || meetingOpen ? 'pointer' : 'not-allowed', fontWeight:800, fontSize:12, fontFamily:'inherit', background:meetingOpen ? 'rgba(225,91,79,0.1)' : BRAND_GRADIENT, color:meetingOpen ? '#c2533f' : '#fff', opacity:dirs.meetings || meetingOpen ? 1 : 0.4 }}>
                {meetingOpen ? 'Save & Stop Meeting' : '+ Start Meeting'}
              </button>
            </div>
            <div style={{ padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <div style={{ fontSize:9, color:'#5a615b', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>Meeting folder</div>
              <div style={{ fontSize:12, color:dirs.meetings ? '#5a615b' : '#a9791f', lineHeight:1.45 }}>{dirs.meetings ? dirs.meetings.name : 'Pick a Meetings folder before saving notes.'}</div>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'8px' }}>
              <div style={{ padding:'4px 6px 8px', color:'#5a615b', fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em' }}>Saved meetings</div>
              {!dirs.meetings && <div style={{ padding:'10px 8px', color:'#5a615b', fontSize:12, lineHeight:1.5 }}>Configure the Meetings folder to read saved meeting notes.</div>}
              {dirs.meetings && !meetings.length && <div style={{ padding:'10px 8px', color:'#5a615b', fontSize:12, lineHeight:1.5 }}>Saved meeting notes will appear here after the folder is synced.</div>}
              {meetings.map(m => {
                const active = meetingSel === m.id && !meetingOpen;
                return (
                  <div key={m.id} onClick={()=>setMeetingSel(m.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?BRAND_SURFACE:'rgba(255,255,255,0.50)', border:`1px solid ${active?BRAND_BORDER:'rgba(255,255,255,0.55)'}` }}>
                    <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#222a25' }}>{m.title}</div>
                    <div style={{ fontSize:10, color:'#5a615b', marginTop:3 }}>{m.date || m.filename}</div>
                  </div>
                );
              })}
            </div>
          </>
        ) : view === 'projects' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewProjectOpen(true)} disabled={!dirs.projects} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:dirs.projects?'pointer':'not-allowed', fontWeight:700, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW, opacity:dirs.projects?1:0.35 }}>
                +  New Project
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <input value={projectSearch} onChange={e=>setProjectSearch(e.target.value)} placeholder="Search projects..." style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.projects && <div style={{ color:'#5a615b', textAlign:'center', paddingTop:40, fontSize:12 }}>Pick your Projects folder in Configure folders</div>}
              {filteredProjects.map(p => {
                const active = projectSel === p.id;
                return (
                  <div key={p.id} onClick={()=>setProjectSel(p.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?BRAND_SURFACE:'rgba(255,255,255,0.50)', border:`1px solid ${active?BRAND_BORDER:'rgba(255,255,255,0.55)'}` }}>
                    <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#222a25' }}>{p.title}</div>
                    <div style={{ fontSize:10, color:'#5a615b', marginTop:3 }}>{p.status || p.filename}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.55)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', color:'#5a615b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                Configure project folders
              </button>
            </div>
          </>
        ) : view === 'properties' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewPropertyOpen(true)} disabled={!dirs.properties} style={{ flex:1, padding:'9px 11px', borderRadius:9, border:'none', cursor:dirs.properties?'pointer':'not-allowed', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW, opacity:dirs.properties?1:0.35 }}>
                +  New Property
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <input value={propertySearch} onChange={e=>setPropertySearch(e.target.value)} placeholder="Search properties…" style={{ ...inputBase, padding:'9px 11px', fontSize:14 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.properties && <div style={{ color:'#5a615b', textAlign:'center', paddingTop:40, fontSize:13, fontWeight:700 }}>Pick your Properties folder in Configure folders</div>}
              {filteredProperties.map(p => {
                const active = propertySel === p.id;
                return (
                  <div key={p.id} onClick={()=>setPropertySel(p.id)} style={{ padding:'11px', marginBottom:5, borderRadius:10, cursor:'pointer', background:active?'rgba(255,255,255,0.60)':'rgba(255,255,255,0.55)', border:`1px solid ${active?'rgba(13,138,91,0.4)':'rgba(255,255,255,0.60)'}` }}>
                    <div style={{ fontSize:14, fontWeight:800, lineHeight:1.35, color:'#5a615b' }}>{p.title}</div>
                    <div style={{ fontSize:12, color:'#5a615b', marginTop:4 }}>{p.client || p.filename}</div>
                    {p.comments.length > 0 && <div style={{ fontSize:12, color:'#5a615b', marginTop:5, fontWeight:700 }}>{p.comments.length} comment{p.comments.length===1?'':'s'}</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.55)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.55)', color:'#5a615b', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                Configure property folders
              </button>
            </div>
          </>
        ) : view === 'people' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewPersonOpen(true)} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW }}>
                + New Person
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <input value={peopleSearch} onChange={e=>setPeopleSearch(e.target.value)} placeholder="Search people..." style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.people && <div style={{ color:'#5a615b', textAlign:'center', paddingTop:40, fontSize:12 }}>Pick your People folder in Configure folders</div>}
              {filteredPeople.map(p => (
                <div key={p.id} onClick={()=>setPersonSel(p.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:personSel===p.id?BRAND_SURFACE:'rgba(255,255,255,0.50)', border:`1px solid ${personSel===p.id?BRAND_BORDER:'rgba(255,255,255,0.55)'}` }}>
                  <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#222a25' }}>{p.title}</div>
                  <div style={{ fontSize:10, color:'#5a615b', marginTop:3 }}>{p.company || p.role || p.filename}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.55)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', color:'#5a615b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                Configure people folder
              </button>
            </div>
          </>
        ) : view === 'organizations' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewOrgOpen(true)} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW }}>
                + New Organization
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.60)' }}>
              <input value={orgSearch} onChange={e=>setOrgSearch(e.target.value)} placeholder="Search organizations..." style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.organizations && <div style={{ color:'#5a615b', textAlign:'center', paddingTop:40, fontSize:12 }}>Pick your Organizations folder in Configure folders</div>}
              {filteredOrgs.map(o => (
                <div key={o.id} onClick={()=>setOrgSel(o.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:orgSel===o.id?BRAND_SURFACE:'rgba(255,255,255,0.50)', border:`1px solid ${orgSel===o.id?BRAND_BORDER:'rgba(255,255,255,0.55)'}` }}>
                  <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#222a25' }}>{o.title}</div>
                  <div style={{ fontSize:10, color:'#5a615b', marginTop:3 }}>{o.industry || o.website || o.filename}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.55)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', color:'#5a615b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                Configure organizations folder
              </button>
            </div>
          </>
        ) : view === 'hours' ? (
          <div style={{ flex:1, overflowY:'auto', padding:'14px 12px' }}>
            <div style={{ fontSize:9, color:'#5a615b', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:9 }}>Time clock</div>
            {[
              { label:'Today', value:formatHoursMinutes(todayWorkStats.totalMinutes), detail:todayWorkStats.label },
              { label:'This week', value:formatHoursMinutes(selectedWeekTotal), detail:`${selectedWeekDates.length} working days in view` },
              { label:workDate === tod() ? 'Selected day' : workDate, value:formatHoursMinutes(selectedWorkStats.totalMinutes), detail:selectedWorkStats.creditedDay ? 'credited day' : selectedWorkStats.complete ? 'clock complete' : 'needs times' },
            ].map(card => (
              <div key={card.label} style={{ padding:'12px', borderRadius:14, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.60)', marginBottom:9 }}>
                <div style={{ fontSize:9, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6 }}>{card.label}</div>
                <div style={{ fontSize:24, fontWeight:850, color:'#13733f', fontVariantNumeric:'tabular-nums' }}>{card.value}</div>
                <div style={{ fontSize:11, color:'#5a615b', marginTop:4 }}>{card.detail}</div>
              </div>
            ))}
            <div style={{ padding:'12px', borderRadius:14, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.60)', color:'#5a615b', fontSize:12, lineHeight:1.55 }}>
              Use this tab to punch in/out for today, correct past entries, and review the month from the calendar.
            </div>
          </div>
        ) : view === 'time' ? (
          <div style={{ flex:1, overflowY:'auto', padding:'14px 12px' }}>
            <div style={{ fontSize:9, color:'#5a615b', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:9 }}>Time dashboard</div>
            {[
              { label:'Today', value:formatHoursMinutes(todayWorkStats.totalMinutes), detail:todayWorkStats.totalMinutes ? 'clocked so far' : 'no time logged yet' },
              { label:'This week', value:formatHoursMinutes(trailingWeekStats.summary.totalMinutes), detail:`last 7 days · ${trailingWeekStats.summary.totalDays} counted days` },
              { label:'Goal-hit days', value:`${trailingWeekStats.summary.goalMet}/${Math.max(trailingWeekStats.summary.totalDays, 1)}`, detail:'within the target band' },
            ].map(card => (
              <div key={card.label} style={{ padding:'12px', borderRadius:14, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.60)', marginBottom:9 }}>
                <div style={{ fontSize:9, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6 }}>{card.label}</div>
                <div style={{ fontSize:24, fontWeight:850, color:'#13733f', fontVariantNumeric:'tabular-nums' }}>{card.value}</div>
                <div style={{ fontSize:11, color:'#5a615b', marginTop:4 }}>{card.detail}</div>
              </div>
            ))}
            <div style={{ padding:'12px', borderRadius:14, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.60)' }}>
              <div style={{ fontSize:9, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8 }}>Weekday averages</div>
              <div style={{ display:'grid', gap:5 }}>
                {historicalTimeStats.weekdays.map(day => {
                  const tone = workBandTone(day.averageMinutes);
                  return (
                    <div key={day.label} style={{ display:'grid', gridTemplateColumns:'28px 1fr 34px', alignItems:'center', gap:7, fontSize:10 }}>
                      <span style={{ color:'rgba(90,97,91,0.70)', fontWeight:800 }}>{day.label}</span>
                      <div style={{ height:5, borderRadius:999, background:'rgba(255,255,255,0.58)', overflow:'hidden' }}>
                        <div style={{ width:`${Math.min(100, (day.averageMinutes / WORK_CHART_MAX_MINUTES) * 100)}%`, height:'100%', borderRadius:999, background:day.averageMinutes ? tone.fill : 'transparent' }} />
                      </div>
                      <span style={{ color:day.averageMinutes ? tone.text : 'rgba(90,97,91,0.40)', fontWeight:850, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{day.averageMinutes ? formatHoursMinutes(day.averageMinutes).replace('h ', ':').replace('m', '') : '-'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex:1, overflowY:'auto', padding:'10px' }}>
            <div style={{ fontSize:9, color:'#5a615b', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8 }}>Mission queues</div>
            {[
              ['Overdue', missionOverdue, '#c2533f'],
              ['Today', missionToday, '#a9791f'],
              ['Recurrent', missionRecurrent, '#5b57b0'],
            ].map(([label, list, color]) => (
              <div key={label} style={{ marginBottom:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                  <span style={{ fontSize:11, color, fontWeight:800 }}>{label}</span>
                  <span style={{ fontSize:10, color:'#5a615b', fontWeight:700 }}>{list.length}</span>
                </div>
                {list.slice(0, 4).map(t => (
                  <div key={t.id} onClick={()=>{ setView('tasks'); setSel(t.id); }} style={{ padding:'8px 9px', marginBottom:4, borderRadius:9, cursor:'pointer', background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.55)' }}>
                    <div style={{ fontSize:12, fontWeight:650, lineHeight:1.3 }}>{t.title}</div>
                    <div style={{ fontSize:10, color:'#5a615b', marginTop:3 }}>{t.dateCreated ? `created ${t.dateCreated.slice(0,10)}` : 'created date unknown'}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {(view === 'tasks' || view === 'bd' || view === 'mission' || view === 'hours' || view === 'time' || view === 'meetings' || view === 'people' || view === 'health') && (
          <div style={{ padding:'6px 10px 9px', borderTop:'1px solid rgba(255,255,255,0.55)' }}>
            <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'5px 10px', background:'transparent', border:'none', color:'#5a615b', fontSize:10, cursor:'pointer', fontFamily:'inherit', textAlign:'center' }}>
              ⚙  Configure folders
            </button>
          </div>
        )}
      </div>

      {/* ─── Main panel ─── */}
      <div className="pane glass-strong" style={{ position:'relative', display:'flex', flexDirection:'column', minHeight:0, overflow:'hidden' }}>
      {view === 'mission' ? (
        <MissionControlPanel
          today={missionToday}
          overdue={missionOverdue}
          recurrent={missionRecurrent}
          selectedId={sel}
          liveId={timer?.taskId}
          getTime={getTime}
          onSelectTask={(id)=>{ setSel(id); setView('tasks'); }}
          onStart={start}
          onStop={stop}
          onNewTask={()=>{ setView('tasks'); setNewPersonOpen(false); setNewTaskOpen(true); }}
          dailyNote={dailyNote}
          dailyInputs={dailyInputs}
          setDailyInputs={setDailyInputs}
          onAddDailyEntry={addDailyEntry}
          onTimeClockEvent={addTimeClockEvent}
          workDate={workDate}
          workMonth={workMonth}
          workNotes={workNotes}
          onSelectWorkDate={(dateStr)=>{ setWorkDate(dateStr); setWorkMonth(dateStr.slice(0, 7)); }}
          onWorkMonthChange={setWorkMonth}
          onSaveTimeClockRows={saveTimeClockRows}
          onWorkStatusChange={updateWorkStatus}
          hasDailyFolder={!!dirs.daily}
          onConfigure={()=>setFolderSetupOpen(true)}
          completedThisWeek={completedThisWeek}
          tomorrowTasks={tomorrowTasks}
          nextWeekTasks={nextWeekTasks}
          nextMonthTasks={nextMonthTasks}
          weekDates={currentWeekDates}
          vaultTotals={vaultTotals}
        />
      ) : view === 'hours' ? (
        <HoursPanel
          selectedDate={workDate}
          selectedNote={selectedWorkNote}
          notes={workNotes}
          month={workMonth}
          onSelectDate={(dateStr)=>{ setWorkDate(dateStr); setWorkMonth(dateStr.slice(0, 7)); }}
          onMonthChange={setWorkMonth}
          onTimeClockEvent={addTimeClockEvent}
          onSaveRows={saveTimeClockRows}
          onStatusChange={updateWorkStatus}
          hasDailyFolder={!!dirs.daily}
          onConfigure={()=>setFolderSetupOpen(true)}
        />
      ) : view === 'time' ? (
        <TimeDashboardPanel notes={timeNotes} trackerRows={trackerRows} tasks={tasks} hasDailyFolder={!!dirs.daily} onConfigure={()=>setFolderSetupOpen(true)}/>
      ) : view === 'projects' ? (
        newProjectOpen ? (
          <NewProjectPanel onCancel={()=>setNewProjectOpen(false)} onCreate={createProject} refs={refs}/>
        ) : (
          <ProjectPanel
            selected={project}
            draft={projectDraft}
            setDraft={setProjectDraft}
            onSave={saveProject}
            summary={projectSummary}
            onNewProject={()=>setNewProjectOpen(true)}
            hasProjectsFolder={!!dirs.projects}
            onConfigure={()=>setFolderSetupOpen(true)}
          />
        )
      ) : view === 'properties' ? (
        newPropertyOpen ? (
          <NewPropertyPanel
            onCancel={()=>setNewPropertyOpen(false)}
            onCreate={createProperty}
            refs={refs}
            hasAttachmentsFolder={!!dirs.attachments}
            onConfigure={()=>setFolderSetupOpen(true)}
          />
        ) : (
        <PropertyPanel
          properties={filteredProperties}
          selected={property}
          selectedId={propertySel}
          draft={propertyDraft}
          setDraft={setPropertyDraft}
          images={propertyImages}
          loadError={propertyLoadError}
          onSelect={setPropertySel}
          comment={propertyComment}
          setComment={setPropertyComment}
          onSave={saveProperty}
          onAddComment={addPropertyComment}
          onEditComment={editPropertyComment}
          onDeleteComment={deletePropertyComment}
          onNewProperty={()=>setNewPropertyOpen(true)}
          onUploadCover={uploadPropertyCover}
          hasPropertiesFolder={!!dirs.properties}
          hasAttachmentsFolder={!!dirs.attachments}
          onConfigure={()=>setFolderSetupOpen(true)}
        />
        )
      ) : view === 'people' ? (
        newPersonOpen ? (
          <NewPersonPanel onCancel={()=>setNewPersonOpen(false)} onCreate={createPerson} refs={refs} hasPeopleFolder={!!dirs.people} onConfigure={()=>setFolderSetupOpen(true)}/>
        ) : (
          <PeoplePanel
            selected={person}
            draft={personDraft}
            setDraft={setPersonDraft}
            onSave={savePerson}
            summary={personSummary}
            hasPeopleFolder={!!dirs.people}
            onNewPerson={()=>setNewPersonOpen(true)}
            onConfigure={()=>setFolderSetupOpen(true)}
            onOpenMeetings={()=>setView('meetings')}
          />
        )
      ) : view === 'organizations' ? (
        newOrgOpen ? (
          <NewOrganizationPanel onCancel={()=>setNewOrgOpen(false)} onCreate={createOrganization} hasOrganizationsFolder={!!dirs.organizations} onConfigure={()=>setFolderSetupOpen(true)}/>
        ) : (
          <OrganizationPanel
            selected={organization}
            draft={orgDraft}
            setDraft={setOrgDraft}
            onSave={saveOrganization}
            summary={organizationSummary}
            hasOrganizationsFolder={!!dirs.organizations}
            onNewOrganization={()=>setNewOrgOpen(true)}
            onConfigure={()=>setFolderSetupOpen(true)}
          />
        )
      ) : view === 'health' ? (
        <HealthPanel diagnostics={diagnostics} dirs={dirs} backups={writeBackups} lastSync={lastSync} needsRefresh={needsRefresh} onForceSync={forceSyncAll} syncBusy={syncBusy} onConfigure={()=>setFolderSetupOpen(true)} onRestoreBackup={restoreBackup}/>
      ) : (view === 'tasks' || view === 'bd') && !dirs.tasks ? (
        <TasksFolderRecoveryPanel issue={folderIssues.tasks} onConfigure={()=>setFolderSetupOpen(true)}/>
      ) : newPersonOpen ? (
        <NewPersonPanel onCancel={()=>setNewPersonOpen(false)} onCreate={createPerson} refs={refs} hasPeopleFolder={!!dirs.people} onConfigure={()=>setFolderSetupOpen(true)}/>
      ) : newTaskOpen ? (
        <NewTaskPanel onCancel={()=>setNewTaskOpen(false)} onCreate={createTask} refs={refs}/>
      ) : view === 'meetings' ? (
        <MeetingPanel
          meetingOpen={meetingOpen}
          meetingTitle={meetingTitle}
          meetingNotes={meetingNotes}
          meetingLinks={meetingLinks}
          setMeetingTitle={value => { setMeetingTitle(value); meetingTitleRef.current = value; }}
          setMeetingNotes={value => { setMeetingNotes(value); meetingNotesRef.current = value; }}
          setMeetingLinks={setMeetingLinks}
          elapsed={getTime('__meeting__')}
          onStart={startMeeting}
          onStop={stopMeeting}
          hasMeetingsFolder={!!dirs.meetings}
          onConfigure={()=>setFolderSetupOpen(true)}
          meetingStart={meetingStartRef.current}
          refs={refs}
          taskOptions={meetingTaskOptions}
          savedMeeting={savedMeeting}
        />

      ) : !task ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a615b', fontSize:13 }}>← Select a task</div>

      ) : (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'22px 30px 18px', borderBottom:'1px solid rgba(255,255,255,0.60)', flexShrink:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', gap:7, alignItems:'center', marginBottom:9, flexWrap:'wrap' }}>
                  <PBadge p={task.priority}/><SBadge s={task.status}/>
                  {task.due && <span style={{ fontSize:12, color:dueColor(task.due) }}>📅 {isToday(task.due)?'Due Today':isOver(task.due)?`Overdue · ${task.due}`:task.due}</span>}
                  {task.scheduled && <span style={{ fontSize:12, color:'#5b57b0' }}>Scheduled {task.scheduled}</span>}
                  {task.client && <span style={{ fontSize:12, color:'#5a615b' }}>· 👤 {task.client}</span>}
                  {task.building && <span style={{ fontSize:12, color:'#5a615b' }}>· 🏢 {task.building}</span>}
                </div>
                <h2 style={{ margin:0, fontSize:19, fontWeight:700, lineHeight:1.35, color:'#1d2421' }}>{task.title}</h2>
                <div style={{ marginTop:9, display:'flex', alignItems:'end', gap:8, width:'min(100%, 620px)' }}>
                  <label style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:4 }}>
                    <span style={{ fontSize:9, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Thread subject</span>
                    <input
                      value={threadSubjectDraft}
                      onChange={e=>setThreadSubjectDraft(e.target.value)}
                      onBlur={()=>saveThreadSubject(task.id)}
                      onKeyDown={e=>{ if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                      placeholder="Optional topic to reuse for AI/chat threads..."
                      style={{ ...inputBase, padding:'8px 10px', fontSize:13 }}
                    />
                  </label>
                  {threadSubjectDraft.trim() !== (task.threadSubject || '') && (
                    <button onMouseDown={e=>e.preventDefault()} onClick={()=>saveThreadSubject(task.id)}
                      style={{ padding:'8px 12px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW }}>
                      Save
                    </button>
                  )}
                </div>
                <div style={{ marginTop:11, display:'inline-flex', alignItems:'center', gap:8, padding:'7px 11px', borderRadius:9, border:`1px solid ${taskAge.border}`, background:taskAge.bg, color:taskAge.color, fontSize:12, fontWeight:850 }}>
                  {taskDaysOpen === null ? 'Open age unknown - no dateCreated' : `Open for ${taskDaysOpen} day${taskDaysOpen === 1 ? '' : 's'}`}
                </div>
                <div style={{ display:'flex', gap:9, alignItems:'end', flexWrap:'wrap', marginTop:13 }}>
                  <label style={{ display:'flex', flexDirection:'column', gap:4, minWidth:145 }}>
                    <span style={{ fontSize:9, color:'#5a615b', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Due</span>
                    <input type="date" value={task.due || ''} onChange={e=>changeTaskDates(task.id, { due:e.target.value })} style={{ ...inputBase, padding:'7px 9px', fontSize:12 }}/>
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', gap:4, minWidth:145 }}>
                    <span style={{ fontSize:9, color:'#5a615b', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Scheduled</span>
                    <input type="date" value={task.scheduled || ''} onChange={e=>changeTaskDates(task.id, { scheduled:e.target.value })} style={{ ...inputBase, padding:'7px 9px', fontSize:12 }}/>
                  </label>
                  <button onClick={()=>setTaskDatesToToday(task.id)} title="Set active task date fields to today" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(20,120,72,0.32)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(20,120,72,0.14)', color:'#13733f' }}>
                    Today
                  </button>
                  <button onClick={()=>setTaskDatesToTomorrow(task.id)} title="Set active task date fields to tomorrow" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(91,141,239,0.32)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(91,141,239,0.12)', color:'#3f6fd0' }}>
                    Tomorrow
                  </button>
                  <button onClick={()=>postponeTaskByWeek(task.id)} title="Move due and scheduled dates forward by 7 days" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(208,150,52,0.28)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(208,150,52,0.08)', color:'#a9791f' }}>
                    Postpone 1w
                  </button>
                  <button onClick={()=>postponeTaskByMonth(task.id)} title="Move due and scheduled dates forward by 1 calendar month" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(225,91,79,0.32)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(225,91,79,0.14)', color:'#c2533f' }}>
                    1 month
                  </button>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, flexShrink:0 }}>
                <div style={{ fontSize:31, fontWeight:800, letterSpacing:0, fontVariantNumeric:'tabular-nums', color:live?'#13733f':'#222a25', textShadow:live?'0 0 28px rgba(20,120,72,0.55)':'none', transition:'color 0.3s,text-shadow 0.3s' }}>{fmt(selTime)}</div>
                <div style={{ display:'flex', gap:7 }}>
                  <button onClick={live?stop:()=>start(task.id)} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:live?'rgba(225,91,79,0.1)':BRAND_GRADIENT, color:live?'#c2533f':'#fff', boxShadow:live?'inset 0 0 0 1px rgba(225,91,79,0.3)':BRAND_SHADOW, transition:'all 0.2s' }}>{live?'⏹  Stop':'▶  Start'}</button>
                  {!task.archived && (
                    task.recurrent ? (
                      <>
                        <button onClick={()=>finishRecurrentInstance(task.id)} title="Complete this recurrence only and move to the next run"
                          style={{ padding:'9px 14px', borderRadius:10, border:'1px solid rgba(20,120,72,0.3)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'rgba(20,120,72,0.08)', color:'#13733f' }}>
                          Finish instance
                        </button>
                        <button onClick={closeTask} title="Archive the whole recurring series"
                          style={{ padding:'9px 12px', borderRadius:10, border:'1px solid rgba(225,91,79,0.26)', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'rgba(225,91,79,0.08)', color:'#c2533f' }}>
                          Archive series
                        </button>
                      </>
                    ) : (
                    <button onClick={closeTask} title="Mark done & archived"
                      style={{ padding:'9px 14px', borderRadius:10, border:'1px solid rgba(20,120,72,0.3)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'rgba(20,120,72,0.08)', color:'#13733f' }}>
                      {task.status==='done' ? '✓  Archive' : '✓  Close'}
                    </button>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(420px, 0.58fr) minmax(360px, 0.42fr)', gap:0, overflow:'hidden' }}>
            <div style={{ minWidth:0, overflowY:'auto', padding:'18px 24px 18px 30px', borderRight:'1px solid rgba(255,255,255,0.60)' }}>
              <div style={{ display:'flex', gap:8, marginBottom:18, alignItems:'stretch' }}>
                <MentionTextarea value={note} onChange={e=>setNote(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); addNote(); }}}
                  placeholder="Add a note... @ to link a person/project, Enter to save, Shift+Enter for a new line"
                  rows={3}
                  style={{ flex:1, minHeight:76, fieldSizing:'content', padding:'10px 14px', borderRadius:10, resize:'vertical', background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.66)', color:'#222a25', fontSize:13, lineHeight:1.5, outline:'none', fontFamily:'inherit' }}/>
                <button onClick={addNote} disabled={!note.trim()} style={{ padding:'10px 20px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:600, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', opacity:note.trim()?1:0.35 }}>Add</button>
              </div>
              {!task.logs.length && (
                <div style={{ color:'#5a615b', textAlign:'center', padding:'60px 0', fontSize:13 }}>
                  <div style={{ fontSize:28, marginBottom:10 }}>📝</div>Notes you add here write directly to your .md file
                </div>
              )}
              {task.logs.map((l, i) => (
                <CommentCard key={`${l.date}-${i}-${l.text}`} log={l} index={i} onSave={editTaskComment} onDelete={deleteTaskComment} />
              ))}
            </div>
            <aside style={{ minWidth:0, overflowY:'auto', padding:'18px 30px 18px 24px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:12 }}>
                <h3 style={{ margin:0, fontSize:14, color:'#1d2421' }}>Task Description</h3>
                <span style={{ fontSize:10, color:'#5a615b', fontWeight:800 }}>{task.filename}</span>
              </div>
              <div style={{ borderRadius:10, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', padding:'14px 16px', minHeight:220 }}>
                <MarkdownBody emptyText="No task description body yet.">{taskDescriptionText(task.raw)}</MarkdownBody>
              </div>
            </aside>
          </div>
        </div>
      )}
      <ScreenLogo />
      </div>
      </div>
    </MentionProvider>
  );
}

function PeoplePanel({ selected, draft, setDraft, onSave, summary, hasPeopleFolder, onNewPerson, onConfigure, onOpenMeetings }) {
  const [editingMetadata, setEditingMetadata] = useState(false);

  if (!hasPeopleFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a615b', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>Configure People folder</button>
      </div>
    );
  }

  if (!selected) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:30 }}>
        <div style={{ width:'min(520px,100%)', borderRadius:18, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.55)', padding:24, textAlign:'center' }}>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:10 }}>People</div>
          <h2 style={{ margin:'0 0 12px', fontSize:24, color:'#1d2421' }}>Select a person</h2>
          <div style={{ color:'rgba(90,97,91,0.78)', fontSize:13, lineHeight:1.6, marginBottom:18 }}>
            Pick someone from the sidebar or create a new person note to start tracking meetings, waiting-for items, and context.
          </div>
          <button onClick={onNewPerson} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>+ New Person</button>
        </div>
      </div>
    );
  }

  const noteParts = splitNoteDocument(draft);
  const metadataLine = [selected.role, selected.company].filter(Boolean).join(' · ') || selected.email || 'No role or company captured yet.';
  const lastTouched = selected.dateModified || selected.dateCreated;
  const detailChips = [selected.email, selected.phone].filter(Boolean);
  const stats = [
    { label:'Waiting-for', value:summary?.waitingFor ?? 0 },
    { label:'Meetings', value:summary?.meetings ?? 0 },
    { label:'Tasks linked', value:summary?.tasksLinked ?? 0 },
  ];

  return (
    <DetailPatternPanel
      eyebrow="Person"
      title={selected.title}
      subtitle={metadataLine}
      action={(
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
          <button onClick={()=>setEditingMetadata(value => !value)} style={{ padding:'9px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:BRAND_TEXT, cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>
            {editingMetadata ? 'Done editing' : 'Edit metadata'}
          </button>
          <button onClick={onSave} style={{ padding:'9px 18px', borderRadius:999, border:'none', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW }}>
            Save
          </button>
        </div>
      )}
    >
      {editingMetadata ? (
        <DetailRawMarkdownEditorCard
          meta={`${selected.filename}${lastTouched ? ` · touched ${String(lastTouched).slice(0, 10)}` : ''}`}
          value={draft}
          onChange={e=>setDraft(e.target.value)}
          placeholder="Edit person metadata and notes..."
        />
      ) : (
        <>
          <DetailIdentityCard
            avatarText={initials(selected.title)}
            title={selected.title}
            subtitle={metadataLine}
            chips={detailChips}
            action={(
              <button onClick={onOpenMeetings} style={{ padding:'8px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                New meeting...
              </button>
            )}
          />
          <DetailMetricStrip metrics={stats} />
          <DetailMarkdownEditorCard
            meta={`${selected.filename}${lastTouched ? ` · touched ${String(lastTouched).slice(0, 10)}` : ''}`}
            value={noteParts.body}
            onChange={e=>setDraft(replaceNoteBody(draft, e.target.value))}
            emptyText="No person notes yet."
          />
        </>
      )}
    </DetailPatternPanel>
  );
}

function OrganizationPanel({ selected, draft, setDraft, onSave, summary, hasOrganizationsFolder, onNewOrganization, onConfigure }) {
  const [editingMetadata, setEditingMetadata] = useState(false);

  if (!hasOrganizationsFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a615b', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>Configure Organizations folder</button>
      </div>
    );
  }

  if (!selected) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:30 }}>
        <div style={{ width:'min(520px,100%)', borderRadius:18, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.55)', padding:24, textAlign:'center' }}>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:10 }}>Organizations</div>
          <h2 style={{ margin:'0 0 12px', fontSize:24, color:'#1d2421' }}>Select an organization</h2>
          <div style={{ color:'rgba(90,97,91,0.78)', fontSize:13, lineHeight:1.6, marginBottom:18 }}>
            Pick an organization from the sidebar or create a new note to start tracking relationships and context.
          </div>
          <button onClick={onNewOrganization} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>+ New Organization</button>
        </div>
      </div>
    );
  }

  const noteParts = splitNoteDocument(draft);
  const metadataLine = [selected.industry, selected.website].filter(Boolean).join(' · ') || selected.email || 'No industry or website captured yet.';
  const lastTouched = selected.dateModified || selected.dateCreated;
  const detailChips = [selected.website, selected.email, selected.phone].filter(Boolean);
  const stats = [
    { label:'Details', value:summary?.details ?? detailChips.length },
    { label:'Meetings', value:summary?.meetings ?? 0 },
    { label:'Tasks linked', value:summary?.tasksLinked ?? 0 },
  ];

  return (
    <DetailPatternPanel
      eyebrow="Organization"
      title={selected.title}
      subtitle={metadataLine}
      action={(
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
          <button onClick={()=>setEditingMetadata(value => !value)} style={{ padding:'9px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:BRAND_TEXT, cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>
            {editingMetadata ? 'Done editing' : 'Edit metadata'}
          </button>
          <button onClick={onSave} style={{ padding:'9px 18px', borderRadius:999, border:'none', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW }}>
            Save
          </button>
        </div>
      )}
    >
      {editingMetadata ? (
        <DetailRawMarkdownEditorCard
          meta={`${selected.filename}${lastTouched ? ` · touched ${String(lastTouched).slice(0, 10)}` : ''}`}
          value={draft}
          onChange={e=>setDraft(e.target.value)}
          placeholder="Edit organization metadata and notes..."
        />
      ) : (
        <>
          <DetailIdentityCard
            avatarText={initials(selected.title)}
            avatarRadius={14}
            title={selected.title}
            subtitle={metadataLine}
            chips={detailChips}
            action={(
              <button onClick={onNewOrganization} style={{ padding:'8px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                New organization...
              </button>
            )}
          />
          <DetailMetricStrip metrics={stats} />
          <DetailMarkdownEditorCard
            meta={`${selected.filename}${lastTouched ? ` · touched ${String(lastTouched).slice(0, 10)}` : ''}`}
            value={noteParts.body}
            onChange={e=>setDraft(replaceNoteBody(draft, e.target.value))}
            emptyText="No organization notes yet."
          />
        </>
      )}
    </DetailPatternPanel>
  );
}

function TasksFolderRecoveryPanel({ issue, onConfigure }) {
  return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:30 }}>
      <div style={{ width:'min(560px,100%)', borderRadius:10, border:'1px solid rgba(225,91,79,0.22)', background:'rgba(225,91,79,0.06)', padding:24 }}>
        <div style={{ fontSize:10, color:'#c2533f', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:10 }}>Tasks folder needs attention</div>
        <h2 style={{ margin:'0 0 10px', fontSize:22, color:'#1d2421' }}>Reconnect your Tasks folder</h2>
        <p style={{ margin:'0 0 16px', color:'#5a615b', fontSize:13, lineHeight:1.6 }}>
          {issue?.name ? `"${issue.name}" is not available at its saved location.` : 'The Tasks folder is not connected on this device.'} Pick the folder again and TaskDash will rescan it.
        </p>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>Configure folders</button>
      </div>
    </div>
  );
}

function MeetingPanel({ meetingOpen, meetingTitle, meetingNotes, meetingLinks, setMeetingTitle, setMeetingNotes, setMeetingLinks, elapsed, onStart, onStop, hasMeetingsFolder, onConfigure, meetingStart, refs, taskOptions, savedMeeting }) {
  const timeLabel = new Date(meetingStart || Date.now()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false }).replace(':','');
  const filename = `Meeting - ${tod()} - ${meetingTitle.trim() || timeLabel}.md`;
  const setLinks = (key, value) => setMeetingLinks(prev => ({ ...prev, [key]: value }));
  const meetingLinkCount = Object.values(meetingLinks || {}).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  const noteLineCount = String(meetingNotes || '').split('\n').filter(line => line.trim()).length;

  if (!hasMeetingsFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a615b', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>Configure Meetings folder</button>
      </div>
    );
  }

  if (!meetingOpen) {
    if (savedMeeting) {
      const meetingView = parseMeetingView(savedMeeting.raw);
      const linkedCount = meetingView.linkedContext.reduce((sum, group) => sum + group.values.length, 0);
      const stats = [
        { label:'Date', value:meetingView.date || savedMeeting.date || 'Unknown' },
        { label:'Duration', value:meetingView.duration || '--', tone:BRAND_TEXT },
        { label:'Links', value:linkedCount },
      ];
      const detailChips = [
        meetingView.start ? `Start ${meetingView.start}` : '',
        meetingView.end ? `End ${meetingView.end}` : '',
        savedMeeting.filename,
      ].filter(Boolean);
      return (
        <DetailPatternPanel
          eyebrow="Saved meeting"
          title={savedMeeting.title}
          subtitle={savedMeeting.date || savedMeeting.filename}
          action={(
            <button onClick={onStart} style={{ padding:'9px 18px', borderRadius:999, border:'none', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW }}>
              + Start Meeting
            </button>
          )}
        >
          <DetailIdentityCard
            avatarText={(meetingView.date || savedMeeting.date || 'M').slice(-2)}
            avatarRadius={14}
            title={savedMeeting.title}
            subtitle={savedMeeting.date || savedMeeting.filename}
            chips={detailChips}
          />
          <DetailMetricStrip metrics={stats} />
          {!!meetingView.linkedContext.length && (
            <section className="glass-thin" style={{ borderRadius:18, padding:'16px', marginBottom:12 }}>
              <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:10 }}>Linked context</div>
              <div style={{ display:'grid', gap:10 }}>
                {meetingView.linkedContext.map(group => (
                  <div key={group.label}>
                    <div style={{ fontSize:11, color:TEXT_PRIMARY, fontWeight:800, marginBottom:6 }}>{group.label}</div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {group.values.map(value => (
                        <span key={`${group.label}-${value}`} style={{ padding:'5px 9px', borderRadius:999, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)', color:'#5a615b', fontSize:10, fontWeight:700 }}>
                          {value}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <DetailMarkdownCard label="Notes">
            {meetingView.notes.length ? (
              <ul style={{ margin:0, paddingLeft:18, display:'grid', gap:10, color:'#222a25', lineHeight:1.6 }}>
                {meetingView.notes.map((item, index) => (
                  <li key={`${savedMeeting.id}-note-${index}`} style={{ paddingLeft:4 }}>
                    <MarkdownBody compact>{item}</MarkdownBody>
                  </li>
                ))}
              </ul>
            ) : (
              <MarkdownBody>{noteBodyText(savedMeeting.raw)}</MarkdownBody>
            )}
          </DetailMarkdownCard>
        </DetailPatternPanel>
      );
    }

    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:30 }}>
        <div style={{ width:'min(520px,100%)', borderRadius:10, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', padding:24, textAlign:'center' }}>
          <div style={{ fontSize:10, color:'#13733f', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:10 }}>Meetings</div>
          <h2 style={{ margin:'0 0 16px', fontSize:22, color:'#1d2421' }}>Meeting notes</h2>
          <button onClick={onStart} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>+ Start Meeting</button>
        </div>
      </div>
    );
  }

  const activeTitle = meetingTitle.trim() || 'Untitled meeting';
  const activeStarted = new Date(meetingStart || Date.now()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const activeStats = [
    { label:'Elapsed', value:fmt(elapsed), tone:BRAND_TEXT },
    { label:'Links', value:meetingLinkCount },
    { label:'Note lines', value:noteLineCount },
  ];

  return (
    <DetailPatternPanel
      eyebrow="Meeting in Progress"
      title={activeTitle}
      subtitle={`Started ${activeStarted} · ${filename}`}
      action={(
        <button onClick={onStop} style={{ padding:'9px 18px', borderRadius:999, border:'1px solid rgba(225,91,79,0.3)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(225,91,79,0.1)', color:'#c2533f' }}>
          Save & Stop
        </button>
      )}
    >
      <DetailIdentityCard
        avatarText="M"
        avatarRadius={14}
        title={(
          <input value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)}
            placeholder="Meeting title..."
            style={{ width:'min(520px, 100%)', padding:'4px 0', background:'transparent', border:'none', borderBottom:'2px solid rgba(255,255,255,0.68)', color:TEXT_PRIMARY, fontSize:20, fontWeight:800, outline:'none', fontFamily:'inherit' }}/>
        )}
        subtitle={`Live note · ${fmt(elapsed)} elapsed`}
        action={<div style={{ fontSize:22, fontWeight:850, fontVariantNumeric:'tabular-nums', color:BRAND_TEXT }}>{fmt(elapsed)}</div>}
      />
      <DetailMetricStrip metrics={activeStats} />
      <section className="glass-thin" style={{ borderRadius:18, padding:'16px', marginBottom:12 }}>
        <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:12 }}>Linked context</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(220px,1fr))', gap:10 }}>
          <Field label="Clients" compact>
            <ChipMulti value={meetingLinks.clients || []} onChange={value=>setLinks('clients', value)} options={refs.clients || []} placeholder="Add clients..." />
          </Field>
          <Field label="Properties" compact>
            <ChipMulti value={meetingLinks.properties || []} onChange={value=>setLinks('properties', value)} options={refs.properties || []} placeholder="Add properties..." />
          </Field>
          <Field label="Tasks" compact>
            <ChipMulti value={meetingLinks.tasks || []} onChange={value=>setLinks('tasks', value)} options={taskOptions || []} placeholder="Add tasks..." />
          </Field>
          <Field label="People" compact>
            <ChipMulti value={meetingLinks.people || []} onChange={value=>setLinks('people', value)} options={refs.people || []} placeholder="Add people..." />
          </Field>
        </div>
      </section>
      <DetailNotesEditor
        meta={`Will save as: ${filename}`}
        value={meetingNotes}
        onChange={e => setMeetingNotes(e.target.value)}
        placeholder="Type your meeting notes here... markdown supported, @ to link people and projects"
        minHeight={300}
      />
    </DetailPatternPanel>
  );
}

function HealthPanel({ diagnostics, dirs, backups, lastSync, needsRefresh, onForceSync, syncBusy, onConfigure, onRestoreBackup }) {
  const [selectedBackup, setSelectedBackup] = useState(null);
  const issueColor = issue => issue.level === 'error' ? '#c2533f' : issue.level === 'warning' ? '#a9791f' : '#5b57b0';
  const connectedFolders = Object.entries(dirs || {});
  const scanRows = Object.entries(diagnostics.folderStats || {})
    .flatMap(([key, value]) => {
      if (value && typeof value === 'object') {
        return Object.entries(value).map(([childKey, childValue]) => [`${key}.${childKey}`, childValue]);
      }
      return [[key, value]];
    })
    .filter(([, value]) => value !== undefined && value !== null);
  const syncText = lastSync ? new Date(lastSync).toLocaleString() : 'Not synced yet';
  const copyBackup = async (backup) => {
    try {
      await navigator.clipboard.writeText(backup.content || '');
    } catch(e) {
      console.warn('backup copy failed', e);
    }
  };
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.60)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center', gap:18 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Vault Health</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#1d2421' }}>Sync and file checks</h2>
          <div style={{ fontSize:12, color:'#5a615b', marginTop:5 }}>Automatic sync runs only while this app is open and folder permission is active.</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onConfigure} style={{ padding:'9px 13px', borderRadius:10, border:'1px solid rgba(255,255,255,0.62)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(255,255,255,0.55)', color:'#5a615b' }}>Folders</button>
          <button onClick={onForceSync} disabled={syncBusy} style={{ padding:'9px 16px', borderRadius:10, border:'none', cursor:syncBusy?'wait':'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>{syncBusy ? 'Syncing...' : 'Force Sync'}</button>
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <section style={{ borderRadius:8, border:`1px solid ${needsRefresh ? 'rgba(208,150,52,0.24)' : 'rgba(20,120,72,0.18)'}`, background:needsRefresh?'rgba(208,150,52,0.055)':'rgba(20,120,72,0.045)', padding:'14px', marginBottom:14, display:'flex', justifyContent:'space-between', gap:18, alignItems:'flex-start', flexWrap:'wrap' }}>
          <div>
            <h3 style={{ margin:'0 0 6px', fontSize:14, color:'#1d2421' }}>Sync Status</h3>
            <div style={{ fontSize:12, color:needsRefresh?'#a9791f':'#13733f', fontWeight:800 }}>{needsRefresh ? 'Refresh recommended' : 'Current'}</div>
            <div style={{ fontSize:11, color:'#5a615b', marginTop:4 }}>Last full sync: {syncText}</div>
          </div>
          <div style={{ display:'flex', gap:7, flexWrap:'wrap', justifyContent:'flex-end' }}>
            {connectedFolders.length ? connectedFolders.map(([key, handle]) => (
              <span key={key} style={{ fontSize:11, color:'#222a25', padding:'5px 8px', borderRadius:14, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)' }}>
                {key}: {handle.name}
              </span>
            )) : (
              <span style={{ fontSize:12, color:'#5a615b' }}>No folders connected</span>
            )}
          </div>
        </section>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:16 }}>
          {Object.entries(diagnostics.counts).map(([key, value]) => (
            <div key={key} style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', padding:'12px' }}>
              <div style={{ fontSize:10, color:'#5a615b', textTransform:'uppercase', fontWeight:800 }}>{key.replace(/([A-Z])/g, ' $1')}</div>
              <div style={{ fontSize:24, fontWeight:850, color:'#1d2421', marginTop:4 }}>{value}</div>
            </div>
          ))}
        </div>
        {!!scanRows.length && (
          <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', padding:'14px', marginBottom:14 }}>
            <h3 style={{ margin:'0 0 10px', fontSize:14, color:'#1d2421' }}>Last Scan Counts</h3>
            <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
              {scanRows.map(([key, value]) => (
                <span key={key} style={{ fontSize:11, color:'#222a25', padding:'5px 8px', borderRadius:14, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)' }}>
                  {key}: {value}
                </span>
              ))}
            </div>
          </section>
        )}
        <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', padding:'14px', marginBottom:14 }}>
          <h3 style={{ margin:'0 0 10px', fontSize:14, color:'#1d2421' }}>Issues</h3>
          {!diagnostics.issues.length && <div style={{ color:'#13733f', fontSize:13 }}>No obvious issues found.</div>}
          {diagnostics.issues.map((issue, i) => {
            const folderIssue = /folder|connected/i.test(issue.text);
            return (
              <div key={i} style={{ padding:'10px 11px', marginBottom:7, borderRadius:8, background:'rgba(255,255,255,0.50)', border:`1px solid ${issueColor(issue)}33`, display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, color:issueColor(issue), fontWeight:850, textTransform:'uppercase' }}>{issue.level}</div>
                  <div style={{ fontSize:13, color:'#222a25', marginTop:4 }}>{issue.text}</div>
                  {issue.detail && <div style={{ fontSize:11, color:'#5a615b', marginTop:4, overflowWrap:'anywhere' }}>{issue.detail}</div>}
                </div>
                <button onClick={folderIssue ? onConfigure : onForceSync} style={{ padding:'6px 9px', borderRadius:8, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:folderIssue?BRAND_TEXT:'#5a615b', cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit', flexShrink:0 }}>
                  {folderIssue ? 'Fix' : 'Recheck'}
                </button>
              </div>
            );
          })}
        </section>
        <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.50)', padding:'14px' }}>
          <h3 style={{ margin:'0 0 10px', fontSize:14, color:'#1d2421' }}>Recent Local Backups</h3>
          {!backups.length && <div style={{ color:'#5a615b', fontSize:13 }}>No backups captured yet. The next text write keeps the previous version locally in this browser.</div>}
          {backups.slice(0, 8).map((backup, i) => (
            <div key={`${backup.at}-${i}`} style={{ padding:'10px 11px', marginBottom:7, borderRadius:8, background:'rgba(255,255,255,0.50)', border:'1px solid rgba(255,255,255,0.58)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, color:'#222a25', fontWeight:800 }}>{backup.filename}</div>
                  <div style={{ fontSize:10, color:'#5a615b', marginTop:3 }}>{new Date(backup.at).toLocaleString()} · {backup.size || backup.content?.length || 0} chars</div>
                  {backup.preview && <div style={{ fontSize:11, color:'#5a615b', marginTop:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{backup.preview}</div>}
                </div>
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  <button onClick={()=>setSelectedBackup(backup)} style={{ padding:'6px 9px', borderRadius:8, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:BRAND_TEXT, cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit' }}>Inspect</button>
                  <button onClick={()=>onRestoreBackup?.(backup)} style={{ padding:'6px 9px', borderRadius:8, border:'1px solid rgba(20,120,72,0.2)', background:'rgba(20,120,72,0.08)', color:'#13733f', cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit' }}>Restore</button>
                </div>
              </div>
            </div>
          ))}
        </section>
      </div>
      {selectedBackup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.62)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ width:'min(900px, 96vw)', maxHeight:'86vh', display:'flex', flexDirection:'column', borderRadius:10, border:'1px solid rgba(255,255,255,0.74)', background:'#f7faf8', boxShadow:'0 18px 70px rgba(0,0,0,0.5)', overflow:'hidden' }}>
            <div style={{ padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.62)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:14 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, color:'#1d2421', fontWeight:850 }}>{selectedBackup.filename}</div>
                <div style={{ fontSize:11, color:'#5a615b', marginTop:3 }}>{new Date(selectedBackup.at).toLocaleString()}</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={()=>copyBackup(selectedBackup)} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>Copy</button>
                <button onClick={()=>onRestoreBackup?.(selectedBackup)} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid rgba(20,120,72,0.2)', background:'rgba(20,120,72,0.08)', color:'#13733f', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>Restore</button>
                <button onClick={()=>setSelectedBackup(null)} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#c2533f', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>Close</button>
              </div>
            </div>
            <pre style={{ margin:0, padding:16, overflow:'auto', color:'#5a615b', background:'rgba(255,255,255,0.50)', fontSize:12, lineHeight:1.55, whiteSpace:'pre-wrap', overflowWrap:'anywhere', fontFamily:"'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace" }}>{selectedBackup.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function HoursPanel({ selectedDate, selectedNote, notes, month, onSelectDate, onMonthChange, onTimeClockEvent, onSaveRows, onStatusChange, hasDailyFolder, onConfigure }) {
  const selectedEvents = selectedNote?.timeClock || [];
  const [timeRowsDraft, setTimeRowsDraft] = useState(selectedEvents);
  const normalizedDraftRows = normalizedTimeRows(timeRowsDraft);
  const draftStats = workStats({ ...selectedNote, timeClock:normalizedDraftRows });
  const selectedTone = workBandTone(draftStats.totalMinutes);
  const canSaveSelected = hasDailyFolder && !draftStats.creditedDay && normalizedDraftRows.length > 0;

  useEffect(() => {
    setTimeRowsDraft(selectedNote?.timeClock || []);
  }, [selectedDate, selectedNote]);

  const setDraftRowTime = (index, time) => {
    setTimeRowsDraft(rows => rows.map((row, i) => i === index ? { ...row, time } : row));
  };

  if (!hasDailyFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a615b', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>Configure Daily Notes folder</button>
      </div>
    );
  }

  return (
    <div style={{ flex:1, minHeight:0, overflowY:'auto', padding:'18px 24px 20px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:18, marginBottom:14, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:6 }}>Hours</div>
          <h2 style={{ margin:0, fontSize:30, color:'#1d2421', letterSpacing:0 }}>Time clock</h2>
          <div style={{ fontSize:13, color:TEXT_SECONDARY, marginTop:6 }}>
            Pick a day on the calendar, then punch or edit that day&apos;s time clock.
          </div>
        </div>
        <button onClick={onConfigure} style={{ padding:'9px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
          Daily notes folder
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:14, marginBottom:14, alignItems:'stretch' }}>
        <section className="glass-thin" style={{ borderRadius:18, padding:'14px', height:'100%', boxSizing:'border-box' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:11, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:5 }}>Punch selected day</div>
              <div style={{ fontSize:14, color:'#1d2421', fontWeight:700 }}>{selectedDate}</div>
            </div>
            <div style={{ fontSize:22, fontWeight:850, color:selectedTone.text, fontVariantNumeric:'tabular-nums' }}>{formatHoursMinutes(draftStats.totalMinutes)}</div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:8, marginBottom:10 }}>
            {WORK_EVENT_ORDER.map(event => (
              <button
                key={event}
                onClick={()=>onTimeClockEvent(event, selectedDate)}
                style={{ padding:'10px 11px', borderRadius:12, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', fontSize:12, fontWeight:800, cursor:'pointer', fontFamily:'inherit', textAlign:'left' }}
              >
                {event}
              </button>
            ))}
          </div>
          <div style={{ fontSize:11, color:'rgba(90,97,91,0.66)', marginBottom:8 }}>Quick actions stamp the current time into the selected daily note.</div>
          <div style={{ display:'grid', gap:7 }}>
            {timeRowsDraft.length ? timeRowsDraft.map((row, index) => (
              <div key={`${row.event}-${row.time}-${index}`} style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'8px 10px', borderRadius:12, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)' }}>
                <span style={{ fontSize:12, color:'#1d2421', fontWeight:700 }}>{row.event}</span>
                <span style={{ fontSize:12, color:'rgba(90,97,91,0.78)', fontVariantNumeric:'tabular-nums' }}>{row.time}</span>
              </div>
            )) : (
              <div style={{ padding:'10px 12px', borderRadius:12, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)', color:'rgba(90,97,91,0.68)', fontSize:12 }}>
                No punches logged for this date yet.
              </div>
            )}
          </div>
        </section>

        <section className="glass-thin" style={{ borderRadius:18, padding:'14px', height:'100%', boxSizing:'border-box' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:10 }}>
            <div>
              <div style={{ fontSize:11, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:5 }}>Selected day</div>
              <div style={{ fontSize:14, color:'#1d2421', fontWeight:700 }}>{selectedDate}</div>
            </div>
            <div style={{ fontSize:12, color:'rgba(90,97,91,0.78)' }}>{draftStats.label}</div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:10, marginBottom:10 }}>
            <div style={{ padding:'12px', borderRadius:14, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)' }}>
              <div style={{ fontSize:9, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:5 }}>Worked</div>
              <div style={{ fontSize:22, fontWeight:850, color:selectedTone.text, fontVariantNumeric:'tabular-nums' }}>{formatHoursMinutes(draftStats.totalMinutes)}</div>
            </div>
            <div style={{ padding:'12px', borderRadius:14, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)' }}>
              <div style={{ fontSize:9, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:5 }}>Breaks</div>
              <div style={{ fontSize:22, fontWeight:850, color:'#1d2421', fontVariantNumeric:'tabular-nums' }}>{formatMinutes(draftStats.breakMinutes)}</div>
            </div>
          </div>
          <div style={{ display:'grid', gap:7 }}>
            {timeRowsDraft.length ? timeRowsDraft.map((row, index) => (
              <div key={`${selectedDate}-${row.event}-${index}`} style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'8px 10px', borderRadius:12, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)' }}>
                <span style={{ fontSize:12, color:'#1d2421', fontWeight:700 }}>{row.event}</span>
                <input type="time" value={row.time || ''} onChange={e=>setDraftRowTime(index, e.target.value)} disabled={draftStats.creditedDay}
                  style={{ width:86, padding:'4px 6px', borderRadius:8, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)', color:'#222a25', fontSize:12, fontFamily:'inherit', outline:'none', opacity:draftStats.creditedDay?0.45:1 }} />
              </div>
            )) : (
              <div style={{ padding:'10px 12px', borderRadius:12, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)', color:'rgba(90,97,91,0.68)', fontSize:12 }}>
                This date has no saved clock events yet. Use the fields below to add or edit times manually.
              </div>
            )}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:10 }}>
            <button onClick={()=>onSaveRows(selectedDate, timeRowsDraft)} disabled={!canSaveSelected}
              style={{ padding:'9px 13px', borderRadius:10, border:'none', cursor:canSaveSelected?'pointer':'not-allowed', fontWeight:800, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW, opacity:canSaveSelected?1:0.4 }}>
              Save hours
            </button>
            <span style={{ fontSize:11, color:'rgba(90,97,91,0.72)' }}>Saves edits for {selectedDate}</span>
          </div>
        </section>

        <WorkCalendar
          month={month}
          selectedDate={selectedDate}
          notes={notes}
          onMonthChange={onMonthChange}
          onSelectDate={onSelectDate}
          selectedNote={selectedNote}
          draftRows={timeRowsDraft}
          onSaveRows={onSaveRows}
          onStatusChange={onStatusChange}
          hasDailyFolder={hasDailyFolder}
        />
      </div>

      <WorkHoursPanel
        selectedDate={selectedDate}
        selectedNote={selectedNote}
        notes={notes}
        draftRows={timeRowsDraft}
        hasDailyFolder={hasDailyFolder}
      />
    </div>
  );
}

function TimeHeatmap({ rows, start, end, title = 'Work heatmap', detail, minHeight = 0 }) {
  const maxMinutes = Math.max(HEATMAP_SLOT_MINUTES, ...rows.flatMap(row => row.average));
  const cellColor = minutes => {
    if (!minutes) return 'rgba(255,255,255,0.38)';
    const pct = Math.min(1, minutes / maxMinutes);
    const alpha = 0.10 + pct * 0.48;
    return `rgba(19,115,63,${alpha.toFixed(2)})`;
  };

  return (
    <section className="glass-thin" style={{ borderRadius:18, padding:'14px', minHeight, flex:minHeight ? '0 0 auto' : '1 1 0', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14, marginBottom:10, flexWrap:'wrap', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:11, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:4 }}>{title}</div>
          <div style={{ fontSize:12, color:TEXT_SECONDARY }}>{detail || `${start} to ${end} · weekdays x 30 min intervals`}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', fontSize:10, color:TEXT_SECONDARY, fontWeight:800 }}>
          <span>0m</span>
          <span style={{ width:68, height:8, borderRadius:999, background:'linear-gradient(90deg,rgba(255,255,255,0.38),rgba(19,115,63,0.58))', border:'1px solid rgba(255,255,255,0.60)' }} />
          <span>30m</span>
        </div>
      </div>
      <div style={{ flex:1, minHeight:0, overflow:'hidden', borderRadius:14, background:'rgba(255,255,255,0.42)', border:'1px solid rgba(255,255,255,0.60)', padding:'10px 10px 12px' }}>
        <div style={{ height:'100%', display:'grid', gridTemplateColumns:'48px repeat(48,minmax(6px,1fr))', gridTemplateRows:'18px repeat(7,minmax(20px,1fr))', gap:3, alignItems:'stretch' }}>
          <div />
          {HEATMAP_SLOTS.map(minutes => (
            <div key={`slot-${minutes}`} title={formatSlotLabel(minutes)} style={{ fontSize:8, color:minutes % 120 === 0 ? TEXT_SECONDARY : 'transparent', fontWeight:800, textAlign:'center', alignSelf:'end', fontFamily:"'JetBrains Mono', monospace" }}>
              {minutes % 120 === 0 ? formatSlotLabel(minutes).slice(0, 2) : ''}
            </div>
          ))}
          {rows.map(row => (
            <Fragment key={row.label}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:6, fontSize:10, color:TEXT_PRIMARY, fontWeight:850, fontFamily:"'JetBrains Mono', monospace" }}>
                {row.label}
              </div>
              {row.average.map((minutes, index) => {
                const slot = HEATMAP_SLOTS[index];
                return (
                  <div
                    key={`${row.label}-${slot}`}
                    title={`${row.label} ${formatSlotLabel(slot)}-${formatSlotLabel(slot + HEATMAP_SLOT_MINUTES)} · avg ${minutes}m across ${row.days} day${row.days === 1 ? '' : 's'}`}
                    style={{ borderRadius:4, background:cellColor(minutes), border:'1px solid rgba(255,255,255,0.42)' }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function TimeDashboardPanel({ notes, hasDailyFolder, onConfigure }) {
  const [period, setPeriod] = useState('week');
  const [customStart, setCustomStart] = useState(addDays(tod(), -6));
  const [customEnd, setCustomEnd] = useState(tod());
  const datedNotes = notes
    .filter(note => /^\d{4}-\d{2}-\d{2}$/.test(note.date || ''))
    .sort((a, b) => a.date.localeCompare(b.date));
  const noteMap = Object.fromEntries(datedNotes.map(note => [note.date, note]));
  const firstDate = datedNotes[0]?.date || tod();
  const lastDate = datedNotes[datedNotes.length - 1]?.date || tod();
  const anchorDate = lastDate > tod() ? lastDate : tod();
  const monthStart = `${anchorDate.slice(0, 7)}-01`;
  const normalizedStart = customStart && customEnd && customStart > customEnd ? customEnd : customStart;
  const normalizedEnd = customStart && customEnd && customStart > customEnd ? customStart : customEnd;
  const range = period === 'month'
    ? { start:monthStart, end:anchorDate, label:monthLabel(anchorDate.slice(0, 7)), metric:'this month' }
    : period === 'all'
      ? { start:firstDate, end:lastDate, label:'All time', metric:'all time' }
      : period === 'custom'
        ? { start:normalizedStart || addDays(anchorDate, -6), end:normalizedEnd || anchorDate, label:'Custom range', metric:'selected range' }
        : { start:addDays(anchorDate, -6), end:anchorDate, label:'Last 7 days', metric:'this week' };
  const stats = dashboardStats(datedNotes, range.start, range.end);
  const trackedDays = stats.days.filter(day => day.totalMinutes > 0);
  const weekTotals = trackedDays.reduce((weeks, day) => {
    const start = addDays(day.date, -((dateFromStr(day.date).getDay() + 6) % 7));
    weeks[start] = (weeks[start] || 0) + day.totalMinutes;
    return weeks;
  }, {});
  const activeWeeks = Object.values(weekTotals);
  const averageWeekMinutes = activeWeeks.length
    ? Math.round(activeWeeks.reduce((sum, minutes) => sum + minutes, 0) / activeWeeks.length)
    : 0;
  const weekdayAverages = stats.weekdays.filter(day => day.count > 0);
  const highestWeekday = weekdayAverages.reduce((best, day) => (!best || day.averageMinutes > best.averageMinutes ? day : best), null);
  const lowestWeekday = weekdayAverages.reduce((best, day) => (!best || day.averageMinutes < best.averageMinutes ? day : best), null);
  const weekendsWorked = trackedDays.filter(day => [0, 6].includes(dateFromStr(day.date).getDay())).length;
  const streak = dateSpan(range.start, range.end).reduce((state, date) => {
    const nextRun = workStats(noteMap[date]).totalMinutes > 0 ? state.current + 1 : 0;
    return { current:nextRun, longest:Math.max(state.longest, nextRun) };
  }, { current:0, longest:0 });
  const mostRecent = trackedDays[trackedDays.length - 1];
  const goalText = `${formatHoursMinutes(TARGET_WORK_MINUTES - TARGET_WORK_TOLERANCE)}-${formatHoursMinutes(TARGET_WORK_MINUTES + TARGET_WORK_TOLERANCE)}`;
  const countLabel = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
  const kpiCards = [
    { label:'Total days tracked', value:String(stats.summary.totalDays), detail:countLabel(stats.summary.totalDays, 'counted day'), color:'#13733f' },
    { label:'Total hours', value:formatHoursMinutes(stats.summary.totalMinutes), detail:range.label, color:'#13733f' },
    { label:'Average hours', value:formatHoursMinutes(stats.summary.averageMinutes), detail:'per tracked day', color:workBandTone(stats.summary.averageMinutes).text },
    { label:'Average week', value:formatHoursMinutes(averageWeekMinutes), detail:`${countLabel(activeWeeks.length, 'active week')}`, color:'#13733f' },
    { label:'Days under goal', value:String(stats.summary.underGoal), detail:`below ${goalText}`, color:'#a9791f' },
    { label:'Days over goal', value:String(stats.summary.overGoal), detail:`above ${goalText}`, color:'#c2533f' },
    { label:'Highest average day', value:highestWeekday?.label || '--', detail:highestWeekday ? `${formatHoursMinutes(highestWeekday.averageMinutes)} avg` : 'no tracked days', color:'#13733f' },
    { label:'Lowest average day', value:lowestWeekday?.label || '--', detail:lowestWeekday ? `${formatHoursMinutes(lowestWeekday.averageMinutes)} avg` : 'no tracked days', color:'#a9791f' },
    { label:'Weekends worked', value:String(weekendsWorked), detail:'Sat or Sun tracked', color:'#13733f' },
    { label:'Goal-hit days', value:String(stats.summary.goalMet), detail:`within ${formatMinutes(TARGET_WORK_TOLERANCE)} of target`, color:'#13733f' },
    { label:'Longest streak', value:String(streak.longest), detail:countLabel(streak.longest, 'tracked day'), color:'#13733f' },
    { label:'Most recent tracked', value:mostRecent ? mostRecent.date.slice(5).replace('-', '/') : '--', detail:mostRecent ? formatHoursMinutes(mostRecent.totalMinutes) : 'no tracked days', color:'#13733f' },
  ];
  const setPreset = key => {
    setPeriod(key);
    if (key === 'week') {
      setCustomStart(addDays(anchorDate, -6));
      setCustomEnd(anchorDate);
    } else if (key === 'month') {
      setCustomStart(monthStart);
      setCustomEnd(anchorDate);
    } else if (key === 'all') {
      setCustomStart(firstDate);
      setCustomEnd(lastDate);
    }
  };

  if (!hasDailyFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a615b', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>Configure Daily Notes folder</button>
      </div>
    );
  }

  return (
    <div style={{ flex:1, minHeight:0, overflow:'hidden', padding:'14px 20px 18px', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14, marginBottom:10, flexWrap:'wrap', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:6 }}>Time dashboard · {range.label.toLowerCase()}</div>
          <h2 style={{ margin:0, fontSize:26, color:'#1d2421', letterSpacing:0 }}>Time</h2>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
          <div style={{ display:'inline-flex', gap:6, padding:4, borderRadius:999, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)' }}>
            {[
              ['week', 'Week'],
              ['month', 'Month'],
              ['all', 'All time'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={()=>setPreset(key)}
                style={{ padding:'7px 11px', borderRadius:999, border:'none', cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit', background:period === key ? BRAND_GRADIENT : 'transparent', color:period === key ? '#fff' : TEXT_SECONDARY, boxShadow:period === key ? BRAND_SHADOW : 'none' }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', padding:4, borderRadius:12, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)' }}>
            <input
              type="date"
              value={customStart}
              min={firstDate}
              max={lastDate}
              onChange={e=>{ setCustomStart(e.target.value); setPeriod('custom'); }}
              style={{ colorScheme:'light', width:126, padding:'6px 8px', borderRadius:9, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#1d2421', fontSize:11, fontWeight:750, fontFamily:'inherit', outline:'none' }}
            />
            <span style={{ color:'rgba(90,97,91,0.48)', fontSize:11, fontWeight:800 }}>to</span>
            <input
              type="date"
              value={customEnd}
              min={firstDate}
              max={lastDate}
              onChange={e=>{ setCustomEnd(e.target.value); setPeriod('custom'); }}
              style={{ colorScheme:'light', width:126, padding:'6px 8px', borderRadius:9, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#1d2421', fontSize:11, fontWeight:750, fontFamily:'inherit', outline:'none' }}
            />
          </div>
        </div>
      </div>

      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gridTemplateRows:'repeat(4,minmax(0,1fr))', gap:10 }}>
        {kpiCards.map(card => (
          <section key={card.label} className="glass-thin" style={{ borderRadius:14, padding:'12px 14px', minWidth:0, minHeight:0, display:'flex', flexDirection:'column', justifyContent:'center', overflow:'hidden' }}>
            <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{card.label}</div>
            <div style={{ fontSize:String(card.value).length > 8 ? 25 : 30, fontWeight:850, color:card.color, lineHeight:1.02, fontVariantNumeric:'tabular-nums', overflowWrap:'anywhere' }}>{card.value}</div>
            <div style={{ fontSize:11, color:'rgba(90,97,91,0.78)', marginTop:7, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{card.detail}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

function MissionControlPanel({ today, overdue, recurrent, onNewTask, dailyNote, dailyInputs, setDailyInputs, onAddDailyEntry, workNotes, hasDailyFolder, onConfigure, completedThisWeek = [], tomorrowTasks = [], nextWeekTasks = [], nextMonthTasks = [], weekDates: currentWeekDates = [], vaultTotals = {}, onSelectTask }) {
  const [noteSection, setNoteSection] = useState('notes');
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 18 ? 'Good afternoon' : 'Good evening';
  let streakDays = 0;
  for (const dateStr of [...currentWeekDates].reverse()) {
    if (goalBand(workStats(workNotes[dateStr]).totalMinutes) === 'target') streakDays += 1;
    else if (streakDays) break;
  }

  const noteSections = [
    { key:'notes', label:'Notes', items:dailyNote?.notes || [], placeholder:'Capture a work note…', helper:'Appends under ## Notes' },
    { key:'reflections', label:'Reflections', items:dailyNote?.reflections || [], placeholder:'Capture a reflection…', helper:'Appends under ## Reflections' },
    { key:'brainDump', label:'Brain dump', items:dailyNote?.brainDump || [], placeholder:'Capture a loose thought or issue…', helper:'Appends under ## Brain dump' },
  ];
  const activeNote = noteSections.find(section => section.key === noteSection) || noteSections[0];
  const activeItems = activeNote.items.slice(-6).reverse();
  const missionTotal = today.length + overdue.length + recurrent.length;
  const horizonItems = [
    ['Tomorrow', tomorrowTasks.length],
    ['Next week', nextWeekTasks.length],
    ['Next month', nextMonthTasks.length],
  ];
  const vaultCountItems = [
    ['Tasks', vaultTotals.tasks ?? 0],
    ['Properties', vaultTotals.properties ?? 0],
    ['Clients', vaultTotals.clients ?? 0],
    ['People', vaultTotals.people ?? 0],
  ];
  const taskDateDetail = task => {
    if (task.due) return isOver(task.due) ? `due ${task.due}` : isToday(task.due) ? 'due today' : `due ${task.due}`;
    if (task.scheduled) return isToday(task.scheduled) ? 'scheduled today' : `scheduled ${task.scheduled}`;
    return task.dateCreated ? `created ${task.dateCreated.slice(0, 10)}` : 'date unknown';
  };

  const TopRailCard = ({ label, value, detail, children }) => (
    <section className="glass" style={{ minWidth:0, height:'100%', borderRadius:16, padding:'12px 13px', boxSizing:'border-box', display:'flex', flexDirection:'column', justifyContent:'center' }}>
      <div style={{ fontSize:9, color:BRAND_LABEL, fontWeight:850, letterSpacing:'0.13em', textTransform:'uppercase', marginBottom:5 }}>{label}</div>
      {children || (
        <>
          <div style={{ fontSize:26, fontWeight:850, color:'#1d2421', lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{value}</div>
          <div style={{ fontSize:10, color:'rgba(90,97,91,0.72)', marginTop:6, lineHeight:1.35 }}>{detail}</div>
        </>
      )}
    </section>
  );

  const MiniMetricGrid = ({ items }) => (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:6 }}>
      {items.map(([label, value]) => (
        <div key={label} style={{ minWidth:0, display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', padding:'6px 7px', borderRadius:9, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)' }}>
          <span style={{ minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:10, color:TEXT_SECONDARY, fontWeight:750 }}>{label}</span>
          <span style={{ fontSize:13, color:'#1d2421', fontWeight:850, fontVariantNumeric:'tabular-nums' }}>{value}</span>
        </div>
      ))}
    </div>
  );

  const TaskQueuePanel = ({ title, subtitle, tasks, tone, empty }) => (
    <section className="glass-thin" style={{ minHeight:0, borderRadius:18, padding:'14px', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:11, color:tone, fontWeight:850, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:5 }}>{title}</div>
          <div style={{ fontSize:13, color:'rgba(90,97,91,0.78)' }}>{subtitle}</div>
        </div>
        <span style={{ padding:'5px 9px', borderRadius:999, fontSize:11, fontWeight:850, color:tone, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)', fontVariantNumeric:'tabular-nums' }}>{tasks.length}</span>
      </div>
      <div style={{ flex:1, minHeight:0, overflowY:'auto', display:'grid', gap:8, alignContent:'start' }}>
        {tasks.length ? tasks.map(task => (
          <button
            key={task.id}
            onClick={()=>onSelectTask?.(task.id)}
            style={{
              width:'100%',
              textAlign:'left',
              padding:'11px 12px',
              borderRadius:14,
              border:'1px solid rgba(255,255,255,0.60)',
              background:'rgba(255,255,255,0.55)',
              color:'#5a615b',
              cursor:'pointer',
              fontFamily:'inherit',
            }}
          >
            <div style={{ fontSize:13, fontWeight:800, lineHeight:1.35, color:'#1d2421' }}>{task.title}</div>
            <div style={{ fontSize:11, color:'rgba(90,97,91,0.70)', marginTop:4 }}>{taskDateDetail(task)}</div>
          </button>
        )) : (
          <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', textAlign:'center', color:'rgba(90,97,91,0.66)', fontSize:13, padding:'24px 12px' }}>
            {empty}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'12px 18px 13px', borderBottom:'1px solid rgba(255,255,255,0.60)', flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:10 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:10, color:'rgba(90,97,91,0.66)', fontWeight:750, letterSpacing:'0.16em', textTransform:'uppercase', marginBottom:3 }}>
              {longDate(new Date())}
            </div>
            <h2 style={{ margin:0, fontSize:24, fontWeight:850, letterSpacing:0, color:'#1d2421' }}>{greeting}.</h2>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, alignItems:'stretch' }}>
          <TopRailCard
            label="Finished this week"
            value={completedThisWeek.length}
            detail={`${streakDays ? `${streakDays}-day time streak · ` : ''}work tasks completed`}
          />

          <TopRailCard
            label="Mission control"
            value={missionTotal}
            detail={`${today.length} today · ${overdue.length} overdue · ${recurrent.length} recurrent`}
          />

          <TopRailCard label="Task horizon">
            <MiniMetricGrid items={horizonItems} />
          </TopRailCard>

          <TopRailCard label="Vault counts">
            <MiniMetricGrid items={vaultCountItems} />
          </TopRailCard>

          <section className="glass" style={{ minWidth:0, height:'100%', borderRadius:16, padding:'12px', boxSizing:'border-box', display:'grid', gap:8, alignContent:'center' }}>
            <button onClick={onConfigure} style={{ width:'100%', padding:'8px 10px', borderRadius:10, border:'1px solid rgba(255,255,255,0.62)', cursor:'pointer', fontWeight:850, fontSize:11, fontFamily:'inherit', background:'rgba(255,255,255,0.55)', color:'#5a615b' }}>
              {hasDailyFolder ? 'Open in vault' : 'Set daily folder'}
            </button>
            <button onClick={onNewTask} style={{ width:'100%', padding:'8px 10px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:850, fontSize:11, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW }}>
              + New task
            </button>
          </section>
        </div>
      </div>

      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(430px,1.08fr) minmax(280px,0.72fr)', gap:14, padding:'14px 18px 18px', overflow:'hidden' }}>
        <section className="glass-thin" style={{ minWidth:0, minHeight:0, borderRadius:18, display:'flex', flexDirection:'column', padding:'14px 14px 16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:11, color:BRAND_LABEL, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:5 }}>Daily note</div>
              <div style={{ fontSize:14, color:'#1d2421', fontWeight:700 }}>{dailyNote ? dailyNote.filename : hasDailyFolder ? 'Creating today daily note...' : 'Daily notes folder not configured'}</div>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
              <span style={{ padding:'5px 9px', borderRadius:999, fontSize:10, fontWeight:800, color:'#1d2421', background:'rgba(255,255,255,0.58)', border:'1px solid rgba(255,255,255,0.62)' }}>
                {today.length} today
              </span>
              <span style={{ padding:'5px 9px', borderRadius:999, fontSize:10, fontWeight:800, color:'#a9791f', background:'rgba(208,150,52,0.08)', border:'1px solid rgba(208,150,52,0.14)' }}>
                {tomorrowTasks.length} tomorrow
              </span>
              <span style={{ padding:'5px 9px', borderRadius:999, fontSize:10, fontWeight:800, color:'#c2533f', background:'rgba(225,91,79,0.08)', border:'1px solid rgba(225,91,79,0.14)' }}>
                {overdue.length} overdue
              </span>
            </div>
          </div>

          <div style={{ display:'inline-flex', gap:6, padding:4, borderRadius:12, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)', alignSelf:'flex-start', marginBottom:14 }}>
            {noteSections.map(section => (
              <button
                key={section.key}
                onClick={()=>setNoteSection(section.key)}
                style={{
                  padding:'7px 12px',
                  borderRadius:10,
                  border:'none',
                  cursor:'pointer',
                  fontWeight:800,
                  fontSize:11,
                  fontFamily:'inherit',
                  background:noteSection === section.key ? BRAND_GRADIENT : 'transparent',
                  color:noteSection === section.key ? '#fff' : TEXT_SECONDARY,
                  boxShadow:noteSection === section.key ? BRAND_SHADOW : 'none',
                }}
              >
                {section.label}
              </button>
            ))}
          </div>

          <div style={{ flex:1, minHeight:0, borderRadius:16, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', padding:'14px 14px 12px', display:'flex', flexDirection:'column' }}>
            <div style={{ flex:'0 0 auto', minHeight:120, paddingRight:4 }}>
              <div style={{ fontSize:10, color:'rgba(90,97,91,0.64)', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>
                Recent {activeNote.label.toLowerCase()}
              </div>
              {activeItems.length ? (
                <ul style={{ margin:0, paddingLeft:18, display:'grid', gap:8, color:'#222a25' }}>
                  {activeItems.map((item, index) => (
                    <li key={`${activeNote.key}-${index}`} style={{ paddingLeft:4 }}>
                      <MarkdownBody compact>{item}</MarkdownBody>
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ color:'rgba(90,97,91,0.66)', fontSize:12 }}>
                  {hasDailyFolder ? `No ${activeNote.label.toLowerCase()} bullet points yet.` : 'Set the Daily Notes folder to start capturing here.'}
                </div>
              )}
            </div>

            <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.62)' }}>
              <MentionTextarea
                value={dailyInputs[activeNote.key] || ''}
                onChange={e=>setDailyInputs(prev => ({ ...prev, [activeNote.key]: e.target.value }))}
                onKeyDown={e=>{ if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onAddDailyEntry(activeNote.key); }}
                disabled={!hasDailyFolder}
                placeholder={hasDailyFolder ? activeNote.placeholder : 'Set daily folder first'}
                rows={7}
                style={{
                  width:'100%',
                  minHeight:150,
                  padding:'12px 14px',
                  borderRadius:14,
                  resize:'vertical',
                  background:GLASS_INNER,
                  border:'1px solid rgba(255,255,255,0.62)',
                  color:'#222a25',
                  fontSize:13,
                  lineHeight:1.55,
                  outline:'none',
                  fontFamily:'inherit',
                  opacity:hasDailyFolder ? 1 : 0.45,
                }}
              />
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginTop:10 }}>
                <div style={{ fontSize:11, color:'rgba(90,97,91,0.62)' }}>{activeNote.helper}</div>
                <button
                  onClick={()=>onAddDailyEntry(activeNote.key)}
                  disabled={!hasDailyFolder || !dailyInputs[activeNote.key]?.trim()}
                  style={{
                    padding:'9px 14px',
                    borderRadius:10,
                    border:'none',
                    cursor:hasDailyFolder ? 'pointer' : 'not-allowed',
                    fontWeight:800,
                    fontSize:12,
                    fontFamily:'inherit',
                    background:BRAND_GRADIENT,
                    color:'#fff',
                    boxShadow:BRAND_SHADOW,
                    opacity:hasDailyFolder && dailyInputs[activeNote.key]?.trim() ? 1 : 0.35,
                  }}
                >
                  Append
                </button>
              </div>
            </div>
          </div>
        </section>

        <div style={{ minWidth:0, minHeight:0, display:'grid', gridTemplateRows:'repeat(2,minmax(0,1fr))', gap:14 }}>
          <TaskQueuePanel
            title="Overdue tasks"
            subtitle="Items that need recovery first."
            tasks={overdue}
            tone="#c2533f"
            empty="No overdue tasks right now."
          />
          <TaskQueuePanel
            title="Today tasks"
            subtitle="Tasks due or scheduled today."
            tasks={today}
            tone="#a9791f"
            empty="No today tasks are queued."
          />
        </div>
      </div>
    </div>
  );
}

function WorkCalendar({ month, selectedDate, notes, onMonthChange, onSelectDate, selectedNote, draftRows, onSaveRows, onStatusChange, hasDailyFolder }) {
  const days = monthDates(month);
  const firstPad = (dateFromStr(days[0]).getDay() + 6) % 7;
  const cells = [...Array(firstPad).fill(null), ...days];
  const selectedStats = workStats({ ...selectedNote, timeClock:normalizedTimeRows(draftRows) });
  const canSave = hasDailyFolder && !selectedStats.creditedDay && normalizedTimeRows(draftRows).length > 0;

  return (
    <section className="glass-thin" style={{ borderRadius:18, padding:'14px', minHeight:0, height:'100%', boxSizing:'border-box' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:11 }}>
        <button onClick={()=>onMonthChange(prevMonth(month))} disabled={!hasDailyFolder} style={{ width:32, height:32, borderRadius:10, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', cursor:hasDailyFolder?'pointer':'not-allowed', fontWeight:900 }}>‹</button>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:11, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:5 }}>Calendar</div>
          <h3 style={{ margin:0, fontSize:18, color:'#1d2421' }}>{monthLabel(month)}</h3>
        </div>
        <button onClick={()=>onMonthChange(nextMonth(month))} disabled={!hasDailyFolder} style={{ width:32, height:32, borderRadius:10, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', cursor:hasDailyFolder?'pointer':'not-allowed', fontWeight:900 }}>›</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:6, marginBottom:6 }}>
        {['M','T','W','T','F','S','S'].map((d, i) => <div key={`${d}-${i}`} style={{ fontSize:9, color:'rgba(90,97,91,0.68)', textAlign:'center', fontWeight:800 }}>{d}</div>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:6 }}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`blank-${i}`} />;
          const stats = workStats(notes[dateStr]);
          const status = notes[dateStr]?.workStatus;
          const selected = selectedDate === dateStr;
          const tone = workBandTone(stats.totalMinutes);
          const accent = status === 'holiday' ? '#3f6fd0' : status === 'bank-holiday' ? '#a9791f' : status === 'sick-leave' ? '#c2533f' : tone.fill;
          return (
            <button key={dateStr} onClick={()=>onSelectDate(dateStr)} disabled={!hasDailyFolder}
              title={`${dateStr} · ${formatMinutes(stats.totalMinutes)} · ${stats.label}`}
              style={{ minHeight:42, borderRadius:12, border:`1px solid ${selected ? BRAND_BORDER_STRONG : 'rgba(255,255,255,0.60)'}`, background:selected?'rgba(20,120,72,0.14)':'rgba(255,255,255,0.50)', color:'#222a25', cursor:hasDailyFolder?'pointer':'not-allowed', fontFamily:'inherit', padding:'4px 2px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3, boxShadow:selected ? '0 0 24px rgba(20,120,72,0.12)' : 'none' }}>
              <span style={{ fontSize:12, fontWeight:800 }}>{Number(dateStr.slice(-2))}</span>
              <span style={{ width:6, height:6, borderRadius:6, background:accent, opacity:status || stats.totalMinutes ? 1 : 0.35 }} />
            </button>
          );
        })}
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12, color:'rgba(90,97,91,0.68)', fontSize:10 }}>
        <span>Green in band</span>
        <span>Yellow below</span>
        <span>Red above</span>
        <span>Blue holiday</span>
        <span>Yellow bank holiday</span>
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:12, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.60)' }}>
        <select value={selectedNote?.workStatus || 'workday'} onChange={e=>onStatusChange(selectedDate, e.target.value)} disabled={!hasDailyFolder}
          style={{ padding:'9px 11px', borderRadius:10, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.62)', color:'#222a25', fontSize:12, fontFamily:'inherit', outline:'none', opacity:hasDailyFolder?1:0.45 }}>
          {Object.entries(WORK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button onClick={()=>onSaveRows(selectedDate, draftRows)} disabled={!canSave}
          style={{ padding:'9px 13px', borderRadius:10, border:'none', cursor:canSave?'pointer':'not-allowed', fontWeight:800, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW, opacity:canSave?1:0.4 }}>
          Save hours
        </button>
        <div style={{ fontSize:11, color:'#5a615b' }}>{selectedStats.creditedDay ? 'Leave days credit 435 minutes automatically.' : 'Breaks subtract from the day total.'}</div>
      </div>
    </section>
  );
}

function WorkHoursPanel({ selectedDate, selectedNote, notes, draftRows, hasDailyFolder }) {
  const week = weekDates(selectedDate);
  const weekStats = week.map(dateStr => ({ date:dateStr, note:notes[dateStr], ...workStats(notes[dateStr]) }));
  const weekTotalMinutes = weekStats.reduce((sum, day) => sum + day.totalMinutes, 0);
  const heatmapRows = timeHeatmapDays(weekStats);
  const selectedDraftStats = workStats({ ...selectedNote, timeClock:normalizedTimeRows(draftRows) });

  return (
    <TimeHeatmap
      rows={heatmapRows}
      start={week[0]}
      end={week[week.length - 1]}
      title="Daily hours"
      detail={`${formatHoursMinutes(weekTotalMinutes)} this week · selected ${selectedDate} ${formatHoursMinutes(selectedDraftStats.totalMinutes)}`}
      minHeight={280}
    />
  );
}

function ProjectPanel({ selected, draft, setDraft, onSave, summary, onNewProject, hasProjectsFolder, onConfigure }) {
  const [editingMetadata, setEditingMetadata] = useState(false);

  if (!hasProjectsFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a615b', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>Configure Projects folder</button>
      </div>
    );
  }

  if (!selected) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:30 }}>
        <div style={{ width:'min(520px,100%)', borderRadius:18, border:'1px solid rgba(255,255,255,0.60)', background:'rgba(255,255,255,0.55)', padding:24, textAlign:'center' }}>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:10 }}>Projects</div>
          <h2 style={{ margin:'0 0 12px', fontSize:24, color:TEXT_PRIMARY }}>Select a project</h2>
          <div style={{ color:'rgba(90,97,91,0.78)', fontSize:13, lineHeight:1.6, marginBottom:18 }}>
            Pick a project from the sidebar or create a new project note to start tracking scope, status, and context.
          </div>
          <button onClick={onNewProject} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>+ New Project</button>
        </div>
      </div>
    );
  }

  const noteParts = splitNoteDocument(draft);
  const metadataLine = [selected.client, selected.status].filter(Boolean).join(' · ') || selected.filename;
  const lastTouched = selected.dateModified || selected.dateCreated;
  const detailChips = [selected.client, selected.status, ...(selected.tags || [])].filter(Boolean).slice(0, 4);
  const stats = [
    { label:'Status', value:summary?.status || selected.status || 'active', tone:BRAND_TEXT },
    { label:'Open tasks', value:summary?.openTasks ?? 0 },
    { label:'Tasks linked', value:summary?.tasksLinked ?? 0 },
  ];

  return (
    <DetailPatternPanel
      eyebrow="Projects"
      title={selected.title}
      subtitle={metadataLine}
      action={(
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
          <button onClick={()=>setEditingMetadata(value => !value)} style={{ padding:'9px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:BRAND_TEXT, cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>
            {editingMetadata ? 'Done editing' : 'Edit client/meta'}
          </button>
          <button onClick={onSave} style={{ padding:'9px 18px', borderRadius:999, border:'none', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', boxShadow:BRAND_SHADOW }}>
            Save
          </button>
        </div>
      )}
    >
      {editingMetadata ? (
        <DetailRawMarkdownEditorCard
          meta={`${selected.filename}${lastTouched ? ` · touched ${String(lastTouched).slice(0, 10)}` : ''}`}
          value={draft}
          onChange={e=>setDraft(e.target.value)}
          placeholder="Edit project client metadata and notes..."
        />
      ) : (
        <>
          <DetailIdentityCard
            avatarText={initials(selected.title)}
            avatarRadius={14}
            title={selected.title}
            subtitle={metadataLine}
            chips={detailChips}
            action={(
              <button onClick={onNewProject} style={{ padding:'8px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.62)', background:'rgba(255,255,255,0.55)', color:'#5a615b', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                New project...
              </button>
            )}
          />
          <DetailMetricStrip metrics={stats} />
          <DetailMarkdownEditorCard
            meta={`${selected.filename}${lastTouched ? ` · touched ${String(lastTouched).slice(0, 10)}` : ''}`}
            value={noteParts.body}
            onChange={e=>setDraft(replaceNoteBody(draft, e.target.value))}
            emptyText="No project notes yet."
          />
        </>
      )}
    </DetailPatternPanel>
  );
}

function PropertyPanel({ properties, selected, selectedId, draft, setDraft, images, loadError, onSelect, comment, setComment, onSave, onAddComment, onEditComment, onDeleteComment, onNewProperty, onUploadCover, hasPropertiesFolder, hasAttachmentsFolder, onConfigure }) {
  const coverInputRef = useRef(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const imageFor = p => p?.coverName ? images[p.coverName.toLowerCase()] : null;
  const photoPlaceholder = label => (
    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:9.5, color:'#6f7f75', background:'rgba(255,255,255,0.78)', padding:'3px 7px', borderRadius:6 }}>
      {label}
    </span>
  );
  const placeholderBg = 'repeating-linear-gradient(135deg,rgba(20,120,72,0.05) 0 9px,rgba(20,120,72,0.10) 9px 18px)';
  if (!hasPropertiesFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a615b', fontSize:13 }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:10 }}>🏢</div>
          <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff' }}>Configure Properties folder</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 18px', borderBottom:'1px solid rgba(255,255,255,0.62)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center', gap:18 }}>
        <div>
          <div style={{ fontSize:12, color:'#5a615b', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>Properties</div>
          <h2 style={{ margin:0, fontSize:22, fontWeight:800, color:TEXT_PRIMARY }}>Property management</h2>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={onNewProperty} style={{ padding:'9px 14px', borderRadius:9, border:'none', background:BRAND_GRADIENT, color:'#fff', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', boxShadow:BRAND_SHADOW }}>
            + New Property
          </button>
          <button onClick={onConfigure} style={{ padding:'9px 14px', borderRadius:9, border:'1px solid rgba(255,255,255,0.68)', background:'rgba(255,255,255,0.58)', color:'#5a615b', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit' }}>
            {hasAttachmentsFolder ? 'Folders configured' : 'Add Attachments folder'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(260px, 0.38fr) minmax(0, 1fr)', gap:0, overflow:'hidden' }}>
        <div style={{ minWidth:0, overflowY:'auto', padding:'20px 22px', borderRight:'1px solid rgba(255,255,255,0.62)' }}>
          {loadError && <div style={{ marginBottom:12, padding:'10px 11px', borderRadius:10, background:'rgba(208,150,52,0.12)', border:'1px solid rgba(208,150,52,0.28)', color:'#a9791f', fontSize:13, fontWeight:750, lineHeight:1.45, whiteSpace:'pre-wrap' }}>{loadError}</div>}
          {!properties.length && !loadError && <div style={{ color:'#5a615b', textAlign:'center', paddingTop:50, fontSize:15, fontWeight:750 }}>No properties found in this folder.</div>}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(165px,1fr))', gap:14 }}>
            {properties.map(p => {
              const img = imageFor(p);
              const active = selectedId === p.id;
              return (
                <button key={p.id} onClick={()=>onSelect(p.id)}
                  style={{ textAlign:'left', borderRadius:10, overflow:'hidden', border:`1px solid ${active?'rgba(20,120,72,0.45)':'rgba(255,255,255,0.60)'}`, background:active?BRAND_SURFACE:GLASS_INNER, cursor:'pointer', padding:0, fontFamily:'inherit', color:TEXT_PRIMARY }}>
                  <div style={{ aspectRatio:'1 / 0.9', background:img ? GLASS_INNER : placeholderBg, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                    {img ? <img src={img} alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }}/> : photoPlaceholder('property photo')}
                  </div>
                  <div style={{ padding:'11px 12px 12px' }}>
                    <div style={{ fontSize:14, fontWeight:850, lineHeight:1.3, color:TEXT_PRIMARY }}>{p.title}</div>
                    <div style={{ fontSize:12, color:'#5a615b', marginTop:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.client || p.filename}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ minWidth:0, overflowY:'auto', padding:'22px 30px' }}>
          {!selected ? (
            <div style={{ color:'#5a615b', textAlign:'center', paddingTop:90, fontSize:15, fontWeight:700 }}>Select a property</div>
          ) : (
            <div>
              <div style={{ height:210, borderRadius:10, overflow:'hidden', marginBottom:18, background:imageFor(selected) ? GLASS_INNER : placeholderBg, border:'1px solid rgba(255,255,255,0.62)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {imageFor(selected)
                  ? <img src={imageFor(selected)} alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }}/>
                  : photoPlaceholder('property cover')}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:16 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, color:'#5a615b', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:7, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selected.filename}</div>
                  <h2 style={{ margin:0, fontSize:26, lineHeight:1.22, color:TEXT_PRIMARY }}>{selected.title}</h2>
                  {selected.client && <div style={{ fontSize:14, color:'#5a615b', marginTop:8 }}>Client: {selected.client}</div>}
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, flexShrink:0 }}>
                  <span style={{ fontSize:12, fontWeight:800, padding:'5px 9px', borderRadius:20, background:'rgba(255,255,255,0.60)', color:'#5a615b', border:'1px solid rgba(255,255,255,0.62)' }}>{selected.comments.length} notes</span>
                  <button onClick={()=>setEditingMetadata(value => !value)} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid rgba(255,255,255,0.68)', background:'rgba(255,255,255,0.58)', color:BRAND_TEXT, cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>
                    {editingMetadata ? 'Done editing' : 'Edit metadata'}
                  </button>
                  {editingMetadata && (
                    <button onClick={onSave} style={{ padding:'8px 11px', borderRadius:8, border:'none', background:BRAND_GRADIENT, color:'#fff', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', boxShadow:BRAND_SHADOW }}>
                      Save
                    </button>
                  )}
                  <button onClick={()=>hasAttachmentsFolder ? coverInputRef.current?.click() : onConfigure()} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid rgba(255,255,255,0.68)', background:'rgba(255,255,255,0.58)', color:'#5a615b', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>
                    Upload cover
                  </button>
                  <input ref={coverInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>{ const file = e.target.files?.[0]; if (file) onUploadCover(selected.id, file); e.target.value = ''; }}/>
                </div>
              </div>

              {editingMetadata ? (
                <div style={{ minHeight:420, display:'flex' }}>
                  <DetailRawMarkdownEditorCard
                    meta={selected.filename}
                    value={draft}
                    onChange={e=>setDraft(e.target.value)}
                    placeholder="Edit property metadata and notes..."
                  />
                </div>
              ) : (
                <>
                  {selected.summary && <p style={{ margin:'0 0 20px', color:'#5a615b', fontSize:15, lineHeight:1.6 }}>{selected.summary}</p>}

                  <div style={{ display:'flex', gap:8, marginBottom:18 }}>
                    <MentionTextarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add a property comment… @ to link a person/project" rows={6}
                      onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); onAddComment(); }}}
                      style={{ flex:1, minHeight:160, fieldSizing:'content', padding:'12px 14px', borderRadius:10, resize:'vertical', background:GLASS_INNER, border:'1px solid rgba(255,255,255,0.68)', color:TEXT_PRIMARY, fontSize:15, lineHeight:1.55, outline:'none', fontFamily:'inherit' }}/>
                    <button onClick={onAddComment} disabled={!comment.trim()} style={{ alignSelf:'stretch', padding:'0 20px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:14, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', opacity:comment.trim()?1:0.35, boxShadow:comment.trim()?BRAND_SHADOW:'none' }}>Add</button>
                  </div>

                  {!selected.comments.length && <div style={{ color:'#5a615b', textAlign:'center', padding:'40px 0', fontSize:15, fontWeight:700 }}>No property comments yet</div>}
                  {selected.comments.map((l, i) => (
                    <CommentCard key={`${l.date}-${i}-${l.text}`} log={l} index={i} onSave={onEditComment} onDelete={onDeleteComment} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── New Property Panel ───────────────────────────────────
function NewProjectPanel({ onCancel, onCreate, refs }) {
  const [form, setForm] = useState({
    title:'',
    status:'active',
    client:'',
    summary:'',
    tags:'project',
    body:'',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const dlClients = `dl_project_clients_${Math.random().toString(36).slice(2,8)}`;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.title.trim()) return;
    setBusy(true);
    await onCreate(form);
    setBusy(false);
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.60)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Project</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#1d2421' }}>Create a project note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.68)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#5a615b' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !form.title.trim()} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', opacity:(busy||!form.title.trim())?0.4:1 }}>
            {busy ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Project name">
            <input autoFocus value={form.title} onChange={e=>set('title', e.target.value)} placeholder="e.g. Union Module 4" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#5a615b', marginTop:4 }}>Filename will be <code style={{ color:'#5a615b' }}>{form.title.trim() ? projectFilename(form.title) : 'Project - <title>.md'}</code></div>
          </Field>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Status">
              <select value={form.status} onChange={e=>set('status', e.target.value)} style={inputBase}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="done">Done</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label={`Client${refs.clients.length?` · ${refs.clients.length} available`:''}`}>
              <input list={dlClients} value={form.client} onChange={e=>set('client', e.target.value)} placeholder="Pick or type..." style={inputBase}/>
              <datalist id={dlClients}>
                {refs.clients.map(c => <option key={c} value={c}/>)}
              </datalist>
            </Field>
          </div>
          <Field label="Summary">
            <textarea value={form.summary} onChange={e=>set('summary', e.target.value)} placeholder="Short project summary" rows={3} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
          <Field label="Tags (comma-separated)">
            <input value={form.tags} onChange={e=>set('tags', e.target.value)} placeholder="project, union" style={inputBase}/>
          </Field>
          <Field label="Initial notes">
            <MentionTextarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Project notes, scope, next actions..." rows={8} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}

function NewPropertyPanel({ onCancel, onCreate, refs, hasAttachmentsFolder, onConfigure }) {
  const [form, setForm] = useState({
    title:'',
    client:'',
    summary:'',
    tags:'properties',
    body:'',
    coverFile:null,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const dlClients = `dl_property_clients_${Math.random().toString(36).slice(2,8)}`;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.title.trim()) return;
    setBusy(true);
    await onCreate(form);
    setBusy(false);
  };

  const slug = form.title.trim() ? kebabSlug(form.title, 'new-property') : '<property-name>';

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.60)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Property</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#1d2421' }}>Create a property note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.68)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#5a615b' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !form.title.trim()} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', opacity:(busy||!form.title.trim())?0.4:1, boxShadow:BRAND_SHADOW }}>
            {busy ? 'Creating...' : 'Create Property'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Property name">
            <input autoFocus value={form.title} onChange={e=>set('title', e.target.value)} placeholder="e.g. 20 Kildare Street" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#5a615b', marginTop:4 }}>Filename will be <code style={{ color:'#5a615b' }}>{slug}.md</code></div>
          </Field>

          <Field label={`Client${refs.clients.length?` · ${refs.clients.length} available`:''}`}>
            <input list={dlClients} value={form.client} onChange={e=>set('client', e.target.value)} placeholder="Pick or type..." style={inputBase}/>
            <datalist id={dlClients}>
              {refs.clients.map(c => <option key={c} value={c}/>)}
            </datalist>
          </Field>

          <Field label="Summary">
            <textarea value={form.summary} onChange={e=>set('summary', e.target.value)} placeholder="Short property summary for the card/library view" rows={3} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>

          <Field label="Tags (comma-separated)">
            <input value={form.tags} onChange={e=>set('tags', e.target.value)} placeholder="properties, dublin" style={inputBase}/>
          </Field>

          <Field label="Cover image">
            {hasAttachmentsFolder ? (
              <label style={{ ...inputBase, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, cursor:'pointer' }}>
                <span style={{ color:form.coverFile?'#222a25':'#5a615b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {form.coverFile ? form.coverFile.name : 'Choose an image...'}
                </span>
                <span style={{ color:BRAND_TEXT, fontWeight:800, fontSize:11, flexShrink:0 }}>Browse</span>
                <input type="file" accept="image/*" onChange={e=>set('coverFile', e.target.files?.[0] || null)} style={{ display:'none' }}/>
              </label>
            ) : (
              <button type="button" onClick={onConfigure} style={{ ...inputBase, cursor:'pointer', textAlign:'left', color:BRAND_TEXT, fontWeight:700 }}>
                Add Attachments folder to upload covers
              </button>
            )}
          </Field>

          <Field label="Initial notes (optional)">
            <MentionTextarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Optional property details..." rows={7} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}

// ─── New Person Panel ─────────────────────────────────────
function NewPersonPanel({ onCancel, onCreate, refs, hasPeopleFolder, onConfigure }) {
  const [form, setForm] = useState({
    name:'',
    company:'',
    role:'',
    email:'',
    phone:'',
    tags:'people',
    body:'',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const dlClients = `dl_person_clients_${Math.random().toString(36).slice(2,8)}`;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim() || !hasPeopleFolder) return;
    setBusy(true);
    await onCreate(form);
    setBusy(false);
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.60)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Person</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#1d2421' }}>Create a person note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.68)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#5a615b' }}>Cancel</button>
          <button onClick={hasPeopleFolder ? submit : onConfigure} disabled={busy || (hasPeopleFolder && !form.name.trim())} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', opacity:(busy || (hasPeopleFolder && !form.name.trim()))?0.4:1 }}>
            {hasPeopleFolder ? (busy ? 'Creating...' : 'Create Person') : 'Configure People Folder'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Person name">
            <input autoFocus value={form.name} onChange={e=>set('name', e.target.value)} placeholder="e.g. Jane Smith" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#5a615b', marginTop:4 }}>Filename will be <code style={{ color:'#5a615b' }}>{form.name.trim() ? `${kebabSlug(form.name, 'new-person')}.md` : '<person-name>.md'}</code></div>
          </Field>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label={`Company / client${refs.clients.length?` · ${refs.clients.length} available`:''}`}>
              <input list={dlClients} value={form.company} onChange={e=>set('company', e.target.value)} placeholder="Pick or type..." style={inputBase}/>
              <datalist id={dlClients}>
                {refs.clients.map(c => <option key={c} value={c}/>)}
              </datalist>
            </Field>
            <Field label="Role">
              <input value={form.role} onChange={e=>set('role', e.target.value)} placeholder="e.g. Asset manager" style={inputBase}/>
            </Field>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Email">
              <input type="email" value={form.email} onChange={e=>set('email', e.target.value)} placeholder="name@example.com" style={inputBase}/>
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={e=>set('phone', e.target.value)} placeholder="+353..." style={inputBase}/>
            </Field>
          </div>

          <Field label="Tags (comma-separated)">
            <input value={form.tags} onChange={e=>set('tags', e.target.value)} placeholder="people, client" style={inputBase}/>
          </Field>

          <Field label="Initial notes">
            <MentionTextarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Relationship notes, preferences, context..." rows={8} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}

// ─── New Organization Panel ───────────────────────────────
function NewOrganizationPanel({ onCancel, onCreate, hasOrganizationsFolder, onConfigure }) {
  const [form, setForm] = useState({
    name:'',
    industry:'',
    website:'',
    email:'',
    phone:'',
    tags:'organizations',
    body:'',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim() || !hasOrganizationsFolder) return;
    setBusy(true);
    await onCreate(form);
    setBusy(false);
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.60)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Organization</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#1d2421' }}>Create an organization note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.68)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#5a615b' }}>Cancel</button>
          <button onClick={hasOrganizationsFolder ? submit : onConfigure} disabled={busy || (hasOrganizationsFolder && !form.name.trim())} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', opacity:(busy || (hasOrganizationsFolder && !form.name.trim()))?0.4:1 }}>
            {hasOrganizationsFolder ? (busy ? 'Creating...' : 'Create Organization') : 'Configure Organizations Folder'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Organization name">
            <input autoFocus value={form.name} onChange={e=>set('name', e.target.value)} placeholder="e.g. Acme Corp" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#5a615b', marginTop:4 }}>Filename will be <code style={{ color:'#5a615b' }}>{form.name.trim() ? `${kebabSlug(form.name, 'new-organization')}.md` : '<organization-name>.md'}</code></div>
          </Field>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Industry">
              <input value={form.industry} onChange={e=>set('industry', e.target.value)} placeholder="e.g. Property management" style={inputBase}/>
            </Field>
            <Field label="Website">
              <input value={form.website} onChange={e=>set('website', e.target.value)} placeholder="https://..." style={inputBase}/>
            </Field>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Email">
              <input type="email" value={form.email} onChange={e=>set('email', e.target.value)} placeholder="info@example.com" style={inputBase}/>
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={e=>set('phone', e.target.value)} placeholder="+353..." style={inputBase}/>
            </Field>
          </div>

          <Field label="Tags (comma-separated)">
            <input value={form.tags} onChange={e=>set('tags', e.target.value)} placeholder="organizations, client" style={inputBase}/>
          </Field>

          <Field label="Initial notes">
            <MentionTextarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Relationship notes, key contacts, context..." rows={8} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}

// ─── New Task Panel ───────────────────────────────────────
function NewTaskPanel({ onCancel, onCreate, refs }) {
  const [form, setForm] = useState({
    title:'', priority:'normal', status:'none',
    due:'', scheduled:'', contexts:'work',
    client:'', building:'', waitingfor:'',
    projects:[], extraTags:'', body:'',
    timeEstimate:'', recurrent:false,
  });
  const [titleParts, setTitleParts] = useState({ type:'Prop', link:'', name:'' });
  const [quickText, setQuickText] = useState('');
  const [quickPreview, setQuickPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const setTitlePart = (k, v) => setTitleParts(prev => ({ ...prev, [k]: v }));
  const titleLinkOptions = titleParts.type === 'Prop'
    ? refs.properties
    : titleParts.type === 'Client'
      ? refs.clients
      : [...new Set([...refs.properties, ...refs.clients])].sort();

  useEffect(() => {
    const nextTitle = [titleParts.type, titleParts.link, titleParts.name].map(s => s.trim()).filter(Boolean).join(' - ');
    setForm(prev => ({
      ...prev,
      title: nextTitle,
      building: titleParts.type === 'Prop' ? titleParts.link : prev.building,
      client: titleParts.type === 'Client' ? titleParts.link : prev.client,
    }));
  }, [titleParts]);
  const canCreate = form.title.trim().length > 0 && !quickPreview?.dueInvalid;

  const applyQuickCapture = (text) => {
    setQuickText(text);
    const parsed = parseQuickCaptureText(text);
    setQuickPreview(parsed.title || parsed.due || parsed.extraTags || parsed.dueInvalid ? parsed : null);
    if (!text.trim()) return;
    setForm(prev => ({
      ...prev,
      ...parsed,
      title: parsed.title || prev.title,
      due: parsed.due || '',
      extraTags: parsed.extraTags,
    }));
    if (parsed.title) setTitleParts({ type:'Other', link:'', name:parsed.title });
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canCreate) return;
    setBusy(true);
    await onCreate(form);
    setBusy(false);
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.60)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:BRAND_LABEL, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Task</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#1d2421' }}>Create a task in your Tasks folder</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.68)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#5a615b' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !canCreate} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:BRAND_GRADIENT, color:'#fff', opacity:(busy||!canCreate)?0.4:1, boxShadow:BRAND_SHADOW }}>
            {busy ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Quick capture">
            <input value={quickText} onChange={e=>applyQuickCapture(e.target.value)}
              placeholder="e.g. Review lease renewal today #legal !high"
              style={{ ...inputBase, fontSize:14, padding:'10px 14px', border:quickPreview?.dueInvalid?'1px solid rgba(225,91,79,0.45)':inputBase.border }}/>
            {quickPreview && (
              <div style={{ marginTop:7, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                {quickPreview.title && <span style={{ fontSize:10, color:'#5a615b', padding:'3px 7px', borderRadius:14, background:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.60)' }}>title: {quickPreview.title}</span>}
                {quickPreview.due && <span style={{ fontSize:10, color:'#a9791f', padding:'3px 7px', borderRadius:14, background:'rgba(208,150,52,0.08)', border:'1px solid rgba(208,150,52,0.16)' }}>due: {quickPreview.due}</span>}
                <span style={{ fontSize:10, color:'#5b57b0', padding:'3px 7px', borderRadius:14, background:'rgba(129,140,248,0.08)', border:'1px solid rgba(129,140,248,0.16)' }}>priority: {quickPreview.priority}</span>
                {quickPreview.extraTags && <span style={{ fontSize:10, color:BRAND_TEXT, padding:'3px 7px', borderRadius:14, background:BRAND_SURFACE, border:`1px solid ${BRAND_BORDER}` }}>tags: {quickPreview.extraTags}</span>}
                {quickPreview.dueInvalid && <span style={{ fontSize:10, color:'#c2533f', padding:'3px 7px', borderRadius:14, background:'rgba(225,91,79,0.08)', border:'1px solid rgba(225,91,79,0.18)' }}>invalid due date: {quickPreview.dueInvalid}</span>}
              </div>
            )}
          </Field>
          <Field label="Task name builder">
            <div style={{ display:'grid', gridTemplateColumns:'110px minmax(180px,1fr) minmax(220px,1.2fr)', gap:8 }}>
              <select autoFocus value={titleParts.type} onChange={e=>setTitleParts({ type:e.target.value, link:'', name:titleParts.name })} style={inputBase}>
                {['Prop','Client','Admin','Other','Research'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <ComboInput value={titleParts.link} onChange={v=>setTitlePart('link', v)} options={titleLinkOptions} placeholder="Optional property/client..." />
              <input value={titleParts.name} onChange={e=>setTitlePart('name', e.target.value)} placeholder="Task name..." style={inputBase}/>
            </div>
            <div style={{ fontSize:10, color:'#5a615b', marginTop:4 }}>Filename will be <code style={{ color:'#5a615b' }}>{form.title.trim() ? safeFilename(form.title) : '<title>'}.md</code></div>
          </Field>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Priority">
              <select value={form.priority} onChange={e=>set('priority', e.target.value)} style={inputBase}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={e=>set('status', e.target.value)} style={inputBase}>
                <option value="none">None</option>
                <option value="done">Done</option>
              </select>
            </Field>
            <Field label="Due">
              <input type="date" value={form.due} onChange={e=>set('due', e.target.value)} style={inputBase}/>
            </Field>
            <Field label="Scheduled">
              <input type="date" value={form.scheduled} onChange={e=>set('scheduled', e.target.value)} style={inputBase}/>
            </Field>
          </div>

          <Field label="Contexts (comma-separated)">
            <input value={form.contexts} onChange={e=>set('contexts', e.target.value)} placeholder="work" style={inputBase}/>
          </Field>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Time estimate (minutes)">
              <input type="number" min="0" value={form.timeEstimate} onChange={e=>set('timeEstimate', e.target.value)} placeholder="0" style={inputBase}/>
            </Field>
            <Field label="Recurrent">
              <label style={{ ...inputBase, display:'flex', alignItems:'center', gap:9, cursor:'pointer', minHeight:34 }}>
                <input type="checkbox" checked={form.recurrent} onChange={e=>set('recurrent', e.target.checked)} style={{ accentColor:BRAND_LABEL }}/>
                <span style={{ color:'#5a615b', fontSize:13 }}>Mark as recurrent</span>
              </label>
            </Field>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label={`Client${refs.clients.length?` · ${refs.clients.length} available`:''}`}>
              <ComboInput value={form.client} onChange={v=>set('client', v)} options={refs.clients} placeholder="Pick or type..." />
            </Field>
            <Field label={`Building${refs.properties.length?` · ${refs.properties.length} available`:''}`}>
              <ComboInput value={form.building} onChange={v=>set('building', v)} options={refs.properties} placeholder="Pick or type..." />
            </Field>
          </div>

          <Field label={`Projects${refs.projects.length?` · ${refs.projects.length} available`:''}`}>
            <ChipMulti value={form.projects} onChange={v=>set('projects', v)} options={refs.projects} placeholder="Type project name + Enter…"/>
          </Field>

          <Field label={`Waiting for${refs.people.length?` · ${refs.people.length} available`:''}`}>
            <ComboInput value={form.waitingfor} onChange={v=>set('waitingfor', v)} options={refs.people} placeholder="Pick or type..." />
          </Field>

          <Field label="Extra tags (comma-separated)">
            <input value={form.extraTags} onChange={e=>set('extraTags', e.target.value)} placeholder="admin, urgent…" style={inputBase}/>
            <div style={{ fontSize:10, color:'#5a615b', marginTop:4 }}>The tag <code style={{ color:'#5a615b' }}>task</code> is added automatically.</div>
          </Field>

          <Field label="Details / initial log (optional)">
            <MentionTextarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Initial task details…" rows={6} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}
