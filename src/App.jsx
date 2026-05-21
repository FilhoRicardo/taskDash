import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseTask, parseProperty, parseProject, parseDailyNote, parsePerson, readMdFiles, readDirNames, readImageFiles } from './utils/parser.js';
import { idbGet, idbSet, idbDel, lsGet, lsSet, lsDel } from './utils/storage.js';
import { fmt, tod, isToday, isOver, longDate, appendNoteToMd, appendPropertyCommentToMd, updateCommentLog, deleteCommentLog, appendDailySectionEntry, appendDailyTimeClockEvent, buildDailyNoteMd, buildTrackerRow, appendTrackerRow, buildMeetingMd, buildNewTaskMd, buildNewPropertyMd, buildNewProjectMd, buildNewPersonMd, finishRecurrentTaskInstance, markTaskDone, postponeTaskDates, postponeTaskDatesByMonths, replaceDailyTimeClockRows, setDailyWorkStatus, setPropertyCover, touchDateModified, updateTaskDates } from './utils/formatter.js';

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
  { key:'attachments', label:'Attachments', mode:'readwrite', required:false, desc:'For property cover images and uploads' },
  { key:'daily',      label:'Daily Notes', mode:'readwrite', required:false, desc:'Where TaskDash should auto-create YYYY-MM-DD daily notes' },
];
const REF_KEYS = ['projects','properties','clients','people'];
const FOLDER_SETUP_SEEN = 'folderSetupV2Seen';
const WRITE_BACKUPS_KEY = 'taskdashWriteBackups';
const SAVED_FILTERS_KEY = 'taskdashSavedFilters';
const FOLDER_LABELS = Object.fromEntries(FOLDER_DEFS.map(def => [def.key, def.label]));

const STATUS_COLORS = {
  done:          { bg:'rgba(16,185,129,0.12)',  color:'#10b981' },
  'in-progress': { bg:'rgba(99,102,241,0.12)',  color:'#818cf8' },
  todo:          { bg:'rgba(59,130,246,0.12)',  color:'#60a5fa' },
  none:          { bg:'rgba(100,116,139,0.12)', color:'#64748b' },
};

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

function Toast({ msg, onClose }) {
  return (
    <div style={{ position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', zIndex:999,
      padding:'12px 20px', borderRadius:10, background:'rgba(245,158,11,0.12)',
      border:'1px solid rgba(245,158,11,0.35)', color:'#fbbf24', fontSize:13, fontWeight:600,
      display:'flex', alignItems:'center', gap:12, boxShadow:'0 4px 24px rgba(0,0,0,0.4)',
      backdropFilter:'blur(12px)', maxWidth:440, fontFamily:'inherit' }}>
      <span>{msg}</span>
      <button onClick={onClose} style={{ background:'none', border:'none', color:'#fbbf24', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
    </div>
  );
}

function PBadge({ p }) {
  return <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, textTransform:'uppercase', letterSpacing:'0.05em',
    background:p==='high'?'rgba(239,68,68,0.13)':'rgba(99,102,241,0.13)', color:p==='high'?'#f87171':'#818cf8' }}>{p}</span>;
}

function SBadge({ s }) {
  const c = STATUS_COLORS[s] || STATUS_COLORS.none;
  return <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, textTransform:'uppercase', letterSpacing:'0.05em', background:c.bg, color:c.color }}>{s}</span>;
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

function noteBodyText(raw = '') {
  return raw
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/^#\s+.+\n?/, '')
    .trim();
}

function groupByInitial(items) {
  return items.reduce((groups, item) => {
    const first = (item.title || item.filename || '#').trim().charAt(0).toUpperCase();
    const key = /[A-Z]/.test(first) ? first : '#';
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});
}

function MarkdownBody({ children }) {
  const text = String(children || '').trim();
  if (!text) return <div style={{ color:'#64748b' }}>No task description body yet.</div>;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} className="markdown-body">
      {text}
    </ReactMarkdown>
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
    <div style={{ width:'100%', height:'auto', minHeight:'max-content', boxSizing:'border-box', marginBottom:10, padding:'14px 16px', borderRadius:10, background:'rgba(124,58,237,0.07)', border:'1px solid rgba(124,58,237,0.15)', overflow:'visible' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:8 }}>
        <div style={{ fontSize:10, color:'#7c3aed', fontWeight:700 }}>{log.date}{time?` · ${time}`:''}</div>
        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
          {editing ? (
            <>
              <button onClick={()=>{ setDraft(body); setEditing(false); }} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color:'#94a3b8', cursor:'pointer', fontSize:10, fontWeight:800, fontFamily:'inherit' }}>Cancel</button>
              <button onClick={()=>onSave(index, draft)} disabled={!draft.trim()} style={{ padding:'4px 8px', borderRadius:7, border:'none', background:'rgba(16,185,129,0.14)', color:'#10b981', cursor:draft.trim()?'pointer':'not-allowed', opacity:draft.trim()?1:0.4, fontSize:10, fontWeight:800, fontFamily:'inherit' }}>Save</button>
            </>
          ) : (
            <>
              <button onClick={()=>setEditing(true)} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color:'#c4b5fd', cursor:'pointer', fontSize:10, fontWeight:800, fontFamily:'inherit' }}>Edit</button>
              <button onClick={()=>onDelete(index)} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid rgba(239,68,68,0.2)', background:'rgba(239,68,68,0.08)', color:'#f87171', cursor:'pointer', fontSize:10, fontWeight:800, fontFamily:'inherit' }}>Delete</button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={editRows}
          style={{ width:'100%', minHeight:120, boxSizing:'border-box', fieldSizing:'content', padding:'11px 12px', borderRadius:8, resize:'vertical', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.09)', color:'#e2e8f0', fontSize:13, lineHeight:1.55, outline:'none', fontFamily:'inherit', whiteSpace:'pre-wrap', overflowWrap:'anywhere' }}/>
      ) : (
        <div style={{ height:'auto', minHeight:'max-content', fontSize:13, lineHeight:1.6, whiteSpace:'pre-wrap', overflowWrap:'anywhere', wordBreak:'break-word' }}>{body}</div>
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

function propertySlug(title) {
  return title.trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'new-property';
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
  width:'100%', padding:'8px 11px', borderRadius:8,
  background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)',
  color:'#e2e8f0', fontSize:13, outline:'none', fontFamily:'inherit', colorScheme:'dark',
};
const labelBase = { fontSize:10, color:'#64748b', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', display:'block', marginBottom:5 };

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:11 }}>
      <label style={labelBase}>{label}</label>
      {children}
    </div>
  );
}

const TARGET_WORK_MINUTES = 7.25 * 60;
const WEEK_TARGET_MINUTES = TARGET_WORK_MINUTES * 5;
const WORK_CHART_MAX_MINUTES = 600;
const WORK_EVENT_ORDER = ['Clock in', 'Break start', 'Break finish', 'Clock out'];
const WORK_STATUS_LABELS = {
  workday: 'Workday',
  'bank-holiday': 'Bank holiday',
  'sick-leave': 'Sick leave',
  holiday: 'Holiday',
};

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
  if (days === null) return { color:'#94a3b8', border:'rgba(148,163,184,0.18)', bg:'rgba(148,163,184,0.06)' };
  if (days <= 15) return { color:'#10b981', border:'rgba(16,185,129,0.28)', bg:'rgba(16,185,129,0.08)' };
  if (days <= 31) return { color:'#f59e0b', border:'rgba(245,158,11,0.3)', bg:'rgba(245,158,11,0.08)' };
  return { color:'#f87171', border:'rgba(248,113,113,0.3)', bg:'rgba(248,113,113,0.08)' };
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

function minutesFromTime(time) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
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

function timeDraftFromRows(rows = []) {
  const draft = { 'Clock in':'', 'Break start':'', 'Break finish':'', 'Clock out':'' };
  for (const row of rows) {
    if (draft[row.event] !== undefined && !draft[row.event]) draft[row.event] = row.time || '';
  }
  return draft;
}

function rowsFromTimeDraft(draft) {
  return WORK_EVENT_ORDER
    .map(event => ({ time: draft[event], event }))
    .filter(row => /^\d{2}:\d{2}$/.test(row.time || ''))
    .sort((a, b) => minutesFromTime(a.time) - minutesFromTime(b.time));
}

function workStats(note) {
  const rows = (note?.timeClock || [])
    .map(row => ({ ...row, minutes: minutesFromTime(row.time) }))
    .filter(row => row.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  const status = note?.workStatus || 'workday';
  const clockIn = rows.find(row => row.event === 'Clock in')?.minutes;
  const clockOut = [...rows].reverse().find(row => row.event === 'Clock out')?.minutes;
  let breakStart = null;
  let breakMinutes = 0;

  for (const row of rows) {
    if (row.event === 'Break start') breakStart = row.minutes;
    if (row.event === 'Break finish' && breakStart !== null && row.minutes > breakStart) {
      breakMinutes += row.minutes - breakStart;
      breakStart = null;
    }
  }

  const creditedDay = status !== 'workday';
  const totalMinutes = creditedDay ? TARGET_WORK_MINUTES : clockIn !== undefined && clockOut !== undefined && clockOut > clockIn
    ? Math.max(0, clockOut - clockIn - breakMinutes)
    : 0;

  return {
    totalMinutes,
    breakMinutes,
    status,
    label: WORK_STATUS_LABELS[status] || WORK_STATUS_LABELS.workday,
    complete: creditedDay || (clockIn !== undefined && clockOut !== undefined),
    creditedDay,
  };
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
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:40, maxHeight:190, overflowY:'auto', padding:4, borderRadius:9, background:'#101018', border:'1px solid rgba(255,255,255,0.1)', boxShadow:'0 12px 30px rgba(0,0,0,0.45)' }}>
          {filtered.map(option => (
            <button key={option} type="button" onMouseDown={e=>{ e.preventDefault(); setInput(option); onChange(option); setOpen(false); }}
              style={{ width:'100%', textAlign:'left', padding:'7px 9px', borderRadius:7, border:'none', background:'transparent', color:'#e2e8f0', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
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
        <span key={p} style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:14, background:'rgba(124,58,237,0.18)', color:'#c4b5fd', display:'inline-flex', alignItems:'center', gap:5 }}>
          {p}
          <button type="button" onClick={() => onChange(value.filter(x => x !== p))} style={{ background:'none', border:'none', color:'#c4b5fd', cursor:'pointer', fontSize:14, lineHeight:1, padding:0 }}>×</button>
        </span>
      ))}
      <input value={input} onFocus={()=>setOpen(true)} onChange={e=>{ setInput(e.target.value); setOpen(true); }}
        onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();add();} else if(e.key==='Backspace'&&!input&&value.length){onChange(value.slice(0,-1));}}}
        onBlur={()=>setTimeout(()=>{ setOpen(false); add(); }, 120)}
        placeholder={placeholder||'Type and press Enter'}
        style={{ flex:1, minWidth:120, background:'transparent', border:'none', color:'#e2e8f0', fontSize:13, outline:'none', fontFamily:'inherit', padding:'4px' }}/>
    </div>
    {open && filtered.length > 0 && (
      <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:40, maxHeight:190, overflowY:'auto', padding:4, borderRadius:9, background:'#101018', border:'1px solid rgba(255,255,255,0.1)', boxShadow:'0 12px 30px rgba(0,0,0,0.45)' }}>
        {filtered.map(option => (
          <button key={option} type="button" onMouseDown={e=>{ e.preventDefault(); addOption(option); }}
            style={{ width:'100%', textAlign:'left', padding:'7px 9px', borderRadius:7, border:'none', background:'transparent', color:'#e2e8f0', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
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

  // â”€â”€ Daily note state â”€â”€
  const [dailyNote,   setDailyNote]   = useState(null);
  const [dailyHandle, setDailyHandle] = useState(null);
  const [dailyInputs, setDailyInputs] = useState({ notes:'', reflections:'', brainDump:'' });
  const [workDate,    setWorkDate]    = useState(tod());
  const [workMonth,   setWorkMonth]   = useState(tod().slice(0, 7));
  const [workNotes,   setWorkNotes]   = useState({});
  const [workHandles, setWorkHandles] = useState({});

  // ── Tasks / timer / UI state ──
  const [tasks,         setTasks]         = useState([]);
  const [taskHandles,   setTaskHandles]   = useState({});
  const [trackerHandle, setTrackerHandle] = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [lastSync,      setLastSync]      = useState(null);
  const [needsRefresh,  setNeedsRefresh]  = useState(false);
  const [syncBusy,      setSyncBusy]      = useState(false);
  const [timer,         setTimer]         = useState(null);
  const [tick,          setTick]          = useState(0);
  const [sel,           setSel]           = useState(null);
  const [note,          setNote]          = useState('');
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
    const person = people.find(p => p.id === personSel);
    setPersonDraft(person?.raw || '');
  }, [personSel, people]);

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
      } catch {}
      setLastSync(Date.now());
      setNeedsRefresh(false);
      setSel(prev => {
        if (prev && parsed.some(t => t.id === prev)) return prev;
        return parsed.find(t => !t.archived)?.id || parsed[0]?.id || null;
      });
    } catch(e) {
      console.error(e);
      setToast(`Task sync failed: ${e.message}`);
    }
  }, []);

  const loadProperties = useCallback(async (dir) => {
    try {
      const raw = await readMdFiles(dir);
      const parsed = raw.map(f => parseProperty(f.name, f.text))
        .sort((a,b) => a.title.localeCompare(b.title));
      setProperties(parsed);
      setFolderStats(prev => ({ ...prev, properties: raw.length }));
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setPropertyHandles(handles);
      setPropertySel(prev => prev && parsed.some(p => p.id === prev) ? prev : (parsed[0]?.id || null));
    } catch(e) { console.error('properties load failed', e); }
  }, []);

  const loadProjects = useCallback(async (dir) => {
    try {
      const raw = (await readMdFiles(dir)).filter(f => /^project\b/i.test(f.name.replace(/\.md$/i, '').trim()));
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
      const raw = await readMdFiles(dir);
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
    const out = { projects:[], properties:[], clients:[], people:[] };
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
    if (keys.includes('tasks')) { setTasks([]); setTaskHandles({}); setTrackerHandle(null); setSel(null); }
    if (keys.includes('done')) setTasks(prev => prev.filter(t => !String(t.id).startsWith('__done__/')));
    if (keys.includes('projects')) { setProjects([]); setProjectHandles({}); setProjectSel(null); setProjectDraft(''); }
    if (keys.includes('properties')) { setProperties([]); setPropertyHandles({}); setPropertySel(null); }
    if (keys.includes('people')) { setPeople([]); setPersonHandles({}); setPersonSel(null); setPersonDraft(''); }
    if (keys.includes('meetings')) { setMeetingOpen(false); setMeetingTitle(''); setMeetingNotes(''); setMeetingLinks({ clients:[], properties:[], tasks:[], people:[] }); meetingTitleRef.current = ''; meetingNotesRef.current = ''; meetingStartRef.current = null; }
    if (keys.includes('daily')) { setDailyNote(null); setDailyHandle(null); setDailyInputs({ notes:'', reflections:'', brainDump:'' }); setWorkNotes({}); setWorkHandles({}); }
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
    if (available.attachments) await loadAttachmentImages(available.attachments);
    if (available.daily) await ensureDailyNote(available.daily);
  }, [loadFiles, loadRefs, loadProjects, loadProperties, loadPeople, loadAttachmentImages, ensureDailyNote, clearUnavailableFolderData]);

  useEffect(() => {
    if (!dirs.tasks && !dirs.done && !dirs.projects && !dirs.properties && !dirs.daily && !dirs.attachments) return;
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
        if (key === 'attachments') await loadAttachmentImages(dir);
        if (key === 'daily') await ensureDailyNote(dir);
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
          if (key === 'attachments') await loadAttachmentImages(h);
          if (key === 'daily') await ensureDailyNote(h);
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
    if (key === 'tasks') { setTasks([]); setTaskHandles({}); setTrackerHandle(null); }
    else if (key === 'done') await loadFiles(dirs.tasks, null);
    else if (key === 'projects') { setProjects([]); setProjectHandles({}); setProjectSel(null); setProjectDraft(''); }
    else if (key === 'properties') { setProperties([]); setPropertyHandles({}); setPropertySel(null); }
    else if (key === 'people') { setPeople([]); setPersonHandles({}); setPersonSel(null); setPersonDraft(''); }
    else if (key === 'meetings') { setMeetingOpen(false); setMeetingTitle(''); setMeetingNotes(''); setMeetingLinks({ clients:[], properties:[], tasks:[], people:[] }); meetingTitleRef.current = ''; meetingNotesRef.current = ''; meetingStartRef.current = null; }
    else if (key === 'daily') { setDailyNote(null); setDailyHandle(null); setDailyInputs({ notes:'', reflections:'', brainDump:'' }); setWorkNotes({}); setWorkHandles({}); }
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
    setTasks([]); setTaskHandles({}); setTrackerHandle(null);
    setProjects([]); setProjectHandles({}); setProjectSel(null); setProjectDraft('');
    setProperties([]); setPropertyHandles({}); setPropertySel(null);
    setMeetingOpen(false); setMeetingTitle(''); setMeetingNotes(''); setMeetingLinks({ clients:[], properties:[], tasks:[], people:[] }); meetingTitleRef.current = ''; meetingNotesRef.current = ''; meetingStartRef.current = null;
    setDailyNote(null); setDailyHandle(null); setDailyInputs({ notes:'', reflections:'', brainDump:'' }); setWorkNotes({}); setWorkHandles({});
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
        await writeFile(trackerHandle, appendTrackerRow(existing, buildTrackerRow(tod(), label, isLinked, dur)));
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
      setToast(`Saved meeting note "${filename.replace(/\.md$/i, '')}"`);
    } catch(e) { console.error('meeting save failed', e); }
  }, [dirs.meetings, meetingLinks]);

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
    const preferred = `${propertySlug(label)}-cover.${ext}`;
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
      const slug = propertySlug(form.title);
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
      const filename = await uniqueFileNameInDir(dirs.people, `${safeFilename(form.name)}.md`);
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
    const maps = [taskHandles, projectHandles, propertyHandles, personHandles];
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

  const addTimeClockEvent = async (event) => {
    if (!dirs.daily || !dailyHandle || !dailyNote) {
      alert('Pick a Daily Notes folder first.');
      return;
    }

    try {
      const latest = await readHandleText(dailyHandle);
      const updated = appendDailyTimeClockEvent(latest, event);
      await writeFile(dailyHandle, updated);
      const parsed = parseDailyNote(`${tod()}.md`, updated);
      setDailyNote(parsed);
      setWorkNotes(prev => ({ ...prev, [tod()]: parsed }));
      setWorkHandles(prev => ({ ...prev, [tod()]: dailyHandle }));
      setToast(`${event} saved to today's daily note`);
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
    const updated = replaceDailyTimeClockRows(result.note.raw, rowsFromTimeDraft(rows));
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
  const selTime   = sel ? getTime(sel) : 0;
  const live      = timer?.taskId===sel;
  const taskDaysOpen = task ? daysOpenSince(task.dateCreated) : null;
  const taskAge = taskAgeTone(taskDaysOpen);
  const totalToday = [...tasks.map(t=>t.id),'__email__','__meeting__','__adhoc__'].reduce((a,id)=>a+getTime(id),0);
  const dueColor  = due => isOver(due)?'#ef4444':isToday(due)?'#f59e0b':'#475569';
  const isClosedTask = t => t.archived || t.status === 'done';
  const isOpenTask = t => !isClosedTask(t);
  const isOverdueTask = t => isOpenTask(t) && isOver(t.due);
  const syncLabel = lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}` : 'Not synced';
  const taskTitleCounts = tasks.reduce((acc, t) => {
    const key = (t.title || '').trim().toLowerCase();
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const filtered  = tasks
    .filter(t => filt === 'done' ? isClosedTask(t) : isOpenTask(t))
    .filter(t => filt==='today'?isToday(t.due):filt==='overdue'?isOverdueTask(t):true)
    .filter(t => {
      const q = taskSearch.trim().toLowerCase();
      if (!q) return true;
      return [t.title, t.filename, t.id, t.client, t.building, t.priority, t.status, t.due, t.scheduled, ...(t.projects || []), ...(t.contexts || []), ...(t.tags || [])]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q));
    });
  const openTasks = tasks.filter(isOpenTask);
  const byOldestCreated = (a, b) => (a.dateCreated || '9999').localeCompare(b.dateCreated || '9999') || a.title.localeCompare(b.title);
  const missionToday = openTasks.filter(t => !t.recurrent && (isToday(t.due) || isToday(t.scheduled))).sort(byOldestCreated);
  const missionOverdue = tasks.filter(isOverdueTask).sort(byOldestCreated);
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
  const tomorrow = addDays(tod(), 1);
  const completedToday = tasks.filter(t => (t.completedDate || '').slice(0, 10) === tod());
  const tomorrowTasks = openTasks.filter(t => t.due === tomorrow || t.scheduled === tomorrow).sort(byOldestCreated);
  const vaultTotals = {
    tasksOpen: openTasks.length,
    tasksFinished: tasks.filter(isClosedTask).length,
    projects: projects.length,
    properties: properties.length,
    people: people.length,
  };
  const diagnostics = buildDiagnostics({ tasks, projects, properties, refs, dirs, folderStats, folderIssues, backups:writeBackups });
  const healthErrors = diagnostics.issues.filter(i => i.level === 'error').length;
  const healthWarnings = diagnostics.issues.filter(i => i.level === 'warning').length;
  const healthBadges = healthErrors + healthWarnings;
  const headerLabel = view === 'mission' ? 'MISSION CONTROL' : view === 'tasks' ? "TODAY'S TOTAL" : view === 'meetings' ? 'MEETINGS' : view === 'projects' ? 'PROJECT LIBRARY' : view === 'properties' ? 'PROPERTY LIBRARY' : view === 'people' ? 'PEOPLE' : 'VAULT HEALTH';
  const headerMetric = view === 'mission' ? missionToday.length + missionOverdue.length + missionRecurrent.length : view === 'tasks' ? fmt(totalToday) : view === 'meetings' ? (meetingOpen ? fmt(getTime('__meeting__')) : 'Ready') : view === 'projects' ? projects.length : view === 'properties' ? properties.length : view === 'people' ? people.length : diagnostics.issues.length;
  const headerDetail = view === 'mission'
    ? `${missionToday.length} today · ${missionOverdue.length} overdue · ${missionRecurrent.length} recurrent · ${dirs.daily ? 'daily on' : 'daily off'}`
    : view === 'tasks'
      ? `${openTasks.length} open tasks · ${Object.values(refs).reduce((a,r)=>a+r.length,0)} refs`
      : view === 'meetings'
        ? `${dirs.meetings ? dirs.meetings.name : 'No folder'} · ${meetingOpen ? 'meeting note open' : 'meeting notes'}`
        : view === 'projects'
          ? `${dirs.projects ? dirs.projects.name : 'No folder'} · editable`
          : view === 'properties'
            ? `${dirs.properties ? dirs.properties.name : 'No folder'} · ${dirs.attachments ? 'covers on' : 'covers off'}`
            : view === 'people'
              ? `${dirs.people ? dirs.people.name : 'No folder'} · waiting-for source`
              : `${healthErrors} errors · ${healthWarnings} warnings · ${writeBackups.length} backups`;

  const btnPrimary = { padding:'13px 34px', borderRadius:12, border:'none', cursor:'pointer', fontWeight:700, fontSize:14, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 4px 24px rgba(124,58,237,0.45)' };

  const QuickItem = ({ id, label, onStart, onStop }) => {
    const running = timer?.taskId===id, time = getTime(id);
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', marginBottom:4, borderRadius:9, transition:'all 0.2s',
        background:running?'rgba(16,185,129,0.08)':'rgba(255,255,255,0.02)',
        border:`1px solid ${running?'rgba(16,185,129,0.25)':'rgba(255,255,255,0.05)'}`,
        boxShadow:running?'0 0 12px rgba(16,185,129,0.15)':'none' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <span style={{ fontSize:12, fontWeight:600, color:running?'#10b981':'#e2e8f0' }}>{label}</span>
          {time>0 && <span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:'tabular-nums', color:running?'#10b981':'#6366f1' }}>{fmt(time)}</span>}
          {running && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700 }}>● LIVE</span>}
        </div>
        <button onClick={running?onStop:onStart} style={{ padding:'4px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit',
          background:running?'rgba(239,68,68,0.1)':'linear-gradient(135deg,#7c3aed,#3b82f6)',
          color:running?'#f87171':'#fff', outline:running?'1px solid rgba(239,68,68,0.25)':'none' }}>
          {running?'⏹ Stop':'▶ Start'}
        </button>
      </div>
    );
  };

  // ── Setup screen / folder manager ──
  const showSetup = bootDone && (!dirs.tasks || folderSetupOpen);
  const allSavedReady = bootDone && Object.keys(savedDirs).length > 0;

  if (showSetup) return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 20px', gap:18, color:'#e2e8f0', background:'radial-gradient(ellipse at 50% -5%,rgba(124,58,237,0.22) 0%,#09090e 65%)' }}>
      <div style={{ fontSize:52, filter:'drop-shadow(0 0 20px rgba(124,58,237,0.6))' }}>⚡</div>
      <div style={{ textAlign:'center' }}>
        <h1 style={{ margin:'0 0 8px', fontSize:32, fontWeight:800, background:'linear-gradient(135deg,#c4b5fd,#60a5fa)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>TaskDash</h1>
        <p style={{ margin:0, color:'#64748b', fontSize:14 }}>Connect your Obsidian vault folders — one time per device</p>
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
            <div key={def.key} style={{ padding:'12px 14px', borderRadius:11, background:'rgba(255,255,255,0.03)', border:`1px solid ${live?'rgba(16,185,129,0.3)':saved?'rgba(245,158,11,0.3)':'rgba(255,255,255,0.06)'}`, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                  <span style={{ fontWeight:700, fontSize:13 }}>{def.label}</span>
                  {def.required && <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10, background:'rgba(239,68,68,0.15)', color:'#f87171', fontWeight:700 }}>REQUIRED</span>}
                  {status==='connected' && <span style={{ fontSize:10, color:'#10b981', fontWeight:600 }}>● {live.name}</span>}
                  {status==='saved' && <span style={{ fontSize:10, color:'#fbbf24', fontWeight:600 }}>● needs permission · {saved.name}</span>}
                </div>
                <div style={{ fontSize:11, color:'#64748b' }}>{def.desc}</div>
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                {status==='saved' && (
                  <button onClick={()=>resumeFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'rgba(245,158,11,0.15)', color:'#fbbf24' }}>Resume</button>
                )}
                <button onClick={()=>pickFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:status==='connected'?'rgba(255,255,255,0.05)':'linear-gradient(135deg,#7c3aed,#3b82f6)', color:status==='connected'?'#94a3b8':'#fff' }}>
                  {status==='connected' ? 'Change' : status==='saved' ? 'Re-pick' : 'Pick folder'}
                </button>
                {status==='connected' && (
                  <button onClick={()=>clearFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 9px', borderRadius:8, border:'none', cursor:'pointer', fontSize:11, fontFamily:'inherit', background:'rgba(239,68,68,0.08)', color:'#f87171' }}>✕</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ color:'#334155', fontSize:11, marginTop:8 }}>Chrome only · files stay on your device · pick once, remembered forever</p>
      {dirs.tasks && (
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button onClick={finishFolderSetup} disabled={setupBusy} style={btnPrimary}>Done</button>
          <button onClick={resetAll} disabled={setupBusy} style={{ padding:'10px 16px', borderRadius:10, border:'1px solid rgba(239,68,68,0.22)', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'rgba(239,68,68,0.08)', color:'#f87171' }}>
            Forget all folders
          </button>
        </div>
      )}
    </div>
  );

  if (!bootDone) return <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#09090e', color:'#475569' }}>Loading…</div>;

  // ── Main UI ──
  return (
    <div style={{ display:'flex', height:'100vh', background:'#09090e', color:'#e2e8f0', overflow:'hidden' }}>
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* ─── Sidebar ─── */}
      <div style={{ width:360, flexShrink:0, borderRight:'1px solid rgba(255,255,255,0.06)', display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'18px 14px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <span style={{ fontSize:15 }}>⚡</span>
              <span style={{ fontWeight:700, fontSize:13, maxWidth:155, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{dirs.tasks?.name}</span>
              <button onClick={()=>setView('health')} title={healthBadges ? `${healthErrors} errors, ${healthWarnings} warnings` : 'Vault health looks okay'} style={{ width:25, height:25, borderRadius:8, border:`1px solid ${healthBadges ? 'rgba(248,113,113,0.35)' : 'rgba(16,185,129,0.25)'}`, cursor:'pointer', fontSize:12, fontWeight:900, fontFamily:'inherit', background:healthBadges?'rgba(248,113,113,0.1)':'rgba(16,185,129,0.08)', color:healthBadges?'#f87171':'#10b981' }}>
                {healthBadges ? '✕' : '✓'}
              </button>
            </div>
            <button onClick={forceSyncAll} disabled={syncBusy} title="Force rescan all configured folders" style={{ padding:'4px 10px', borderRadius:7, border:'none', cursor:syncBusy?'wait':'pointer', fontSize:11, fontWeight:600, fontFamily:'inherit',
              background:needsRefresh?'rgba(245,158,11,0.2)':'rgba(124,58,237,0.15)',
              color:needsRefresh?'#fbbf24':'#a78bfa', boxShadow:needsRefresh?'0 0 10px rgba(245,158,11,0.3)':'none', transition:'all 0.3s', opacity:syncBusy?0.6:1 }}>
              ↺ {syncBusy?'Syncing':needsRefresh?'Stale':'Force Sync'}
            </button>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:10 }}>
            <div style={{ width:6, height:6, borderRadius:3, background:'#10b981', boxShadow:'0 0 6px rgba(16,185,129,0.6)' }}/>
            <span style={{ fontSize:10, color:'#10b981' }}>{syncLabel} · auto while open every 5 min</span>
          </div>
          <div style={{ padding:'11px 13px', borderRadius:10, background:'rgba(124,58,237,0.08)', border:'1px solid rgba(124,58,237,0.18)' }}>
            <div style={{ fontSize:9, color:'#7c3aed', fontWeight:800, letterSpacing:'0.1em', marginBottom:3 }}>{headerLabel}</div>
            <div style={{ fontWeight:800, fontSize:23, letterSpacing:'-0.03em', fontVariantNumeric:'tabular-nums' }}>{headerMetric}</div>
            <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>{headerDetail}</div>
          </div>
          <div style={{ display:'flex', gap:4, marginTop:10, padding:3, borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
            {['mission','tasks','meetings','projects','properties','people'].map(v => (
              <button key={v} onClick={()=>{ setView(v); setNewTaskOpen(false); setNewPropertyOpen(false); setNewProjectOpen(false); setNewPersonOpen(false); }} style={{ flex:1, padding:'6px 5px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:10, fontFamily:'inherit', textTransform:'capitalize', background:view===v?'rgba(124,58,237,0.2)':'transparent', color:view===v?'#c4b5fd':'#64748b' }}>
                {v === 'mission' ? 'Today' : v === 'meetings' ? 'Meet' : v}
              </button>
            ))}
          </div>
        </div>

        {view === 'tasks' ? (
          <>
            <div style={{ padding:'8px 10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize:9, color:'#475569', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6 }}>Quick Track</div>
              <QuickItem id="__email__"   label="📧 Email"   onStart={()=>start('__email__')} onStop={stop}/>

              {timer?.taskId==='__adhoc__' ? (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', borderRadius:9, background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)', boxShadow:'0 0 12px rgba(16,185,129,0.15)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:'#10b981', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>🎯 {adHocName||'Ad-hoc'}</span>
                    <span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:'tabular-nums', color:'#10b981' }}>{fmt(getTime('__adhoc__'))}</span>
                    <span style={{ fontSize:9, padding:'1px 5px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700 }}>● LIVE</span>
                  </div>
                  <button onClick={stop} style={{ padding:'4px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'rgba(239,68,68,0.1)', color:'#f87171', outline:'1px solid rgba(239,68,68,0.25)' }}>⏹ Stop</button>
                </div>
              ) : showAdHoc ? (
                <div style={{ padding:'8px 10px', borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:6 }}>🎯 What are you working on?</div>
                  <div style={{ display:'flex', gap:6 }}>
                    <input value={adHocInput} onChange={e=>setAdHocInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&startAdHoc()} autoFocus placeholder="e.g. Proposal draft…"
                      style={{ flex:1, padding:'6px 10px', borderRadius:7, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'#e2e8f0', fontSize:12, outline:'none', fontFamily:'inherit' }}/>
                    <button onClick={startAdHoc} disabled={!adHocInput.trim()} style={{ padding:'6px 10px', borderRadius:7, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:adHocInput.trim()?1:0.4 }}>▶</button>
                    <button onClick={()=>{setShowAdHoc(false);setAdHocInput('');}} style={{ padding:'6px 8px', borderRadius:7, border:'none', cursor:'pointer', background:'rgba(255,255,255,0.05)', color:'#64748b', fontSize:12 }}>✕</button>
                  </div>
                </div>
              ) : (
                <button onClick={()=>setShowAdHoc(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:9, border:'1px dashed rgba(255,255,255,0.1)', background:'transparent', color:'#475569', fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                  🎯 + Ad-hoc task…
                </button>
              )}
            </div>

            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>{ setNewPersonOpen(false); setNewTaskOpen(true); }} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 2px 12px rgba(124,58,237,0.35)' }}>
                +  New Task
              </button>
              <button onClick={()=>{ setNewTaskOpen(false); setNewPersonOpen(true); }} title={dirs.people ? 'Add a person note' : 'Configure the People folder first'} style={{ padding:'8px 10px', borderRadius:9, border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'rgba(255,255,255,0.035)', color:'#c4b5fd', opacity:dirs.people?1:0.65 }}>
                + Person
              </button>
            </div>


            <div style={{ padding:'6px 10px 8px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <input value={taskSearch} onChange={e=>setTaskSearch(e.target.value)} placeholder="Search tasks..." style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>

            <div style={{ display:'flex', gap:3, padding:'4px 10px 8px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              {['all','today','overdue','done'].map(f => (
                <button key={f} onClick={()=>setFilt(f)} style={{ flex:1, padding:'5px 0', borderRadius:7, border:'none', cursor:'pointer', fontSize:10, fontWeight:600, textTransform:'capitalize', fontFamily:'inherit', background:filt===f?'rgba(124,58,237,0.15)':'transparent', color:filt===f?'#a78bfa':'#475569' }}>{f}</button>
              ))}
            </div>
            <div style={{ padding:'7px 10px 8px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display:'flex', gap:5, marginBottom:savedFilters.length?6:0 }}>
                <input value={filterName} onChange={e=>setFilterName(e.target.value)} placeholder="Filter name" style={{ flex:1, minWidth:0, padding:'6px 8px', borderRadius:7, background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.07)', color:'#e2e8f0', fontSize:11, outline:'none', fontFamily:'inherit' }}/>
                <button onClick={saveCurrentFilter} style={{ padding:'6px 8px', borderRadius:7, border:'none', cursor:'pointer', fontWeight:800, fontSize:10, fontFamily:'inherit', background:'rgba(124,58,237,0.18)', color:'#c4b5fd' }}>Save</button>
              </div>
              {savedFilters.map(sf => (
                <div key={sf.name} style={{ display:'flex', gap:5, alignItems:'center', marginTop:4 }}>
                  <button onClick={()=>applySavedFilter(sf)} style={{ flex:1, minWidth:0, textAlign:'left', padding:'5px 7px', borderRadius:7, border:'1px solid rgba(255,255,255,0.05)', background:'rgba(255,255,255,0.02)', color:'#94a3b8', cursor:'pointer', fontSize:10, fontFamily:'inherit', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sf.name}</button>
                  <button onClick={()=>deleteSavedFilter(sf.name)} style={{ width:22, height:22, borderRadius:7, border:'none', background:'rgba(239,68,68,0.08)', color:'#f87171', cursor:'pointer', fontSize:11 }}>x</button>
                </div>
              ))}
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!filtered.length && <div style={{ color:'#475569', textAlign:'center', paddingTop:40, fontSize:12 }}>No tasks</div>}
              {filtered.map(t => {
                const running=timer?.taskId===t.id, active=sel===t.id, time=getTime(t.id);
                const duplicateTitle = taskTitleCounts[(t.title || '').trim().toLowerCase()] > 1;
                return (
                  <div key={t.id} onClick={()=>setSel(t.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', border:`1px solid ${active?'rgba(124,58,237,0.28)':'rgba(255,255,255,0.04)'}`, boxShadow:running?'0 0 14px rgba(16,185,129,0.18)':'none', transition:'all 0.15s' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:6, marginBottom:5 }}>
                      <span style={{ fontSize:12, fontWeight:500, lineHeight:1.35, flex:1 }}>{t.title}</span>
                      {running && <span style={{ fontSize:9, padding:'2px 6px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700, flexShrink:0 }}>● LIVE</span>}
                    </div>
                    {duplicateTitle && (
                      <div title={t.id} style={{ fontSize:10, color:'#818cf8', marginBottom:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {t.id.replace(/\.md$/i, '')}
                      </div>
                    )}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:4 }}>
                      <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                        <PBadge p={t.priority}/><SBadge s={t.status}/>
                        {t.due && <span style={{ fontSize:10, fontWeight:500, color:dueColor(t.due) }}>{isToday(t.due)?'Today':isOver(t.due)?'Overdue':t.due}</span>}
                      </div>
                      {time>0 && <span style={{ fontSize:11, color:'#6366f1', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{fmt(time)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : view === 'meetings' ? (
          <>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={meetingOpen ? stopMeeting : startMeeting} disabled={!dirs.meetings && !meetingOpen} style={{ width:'100%', padding:'9px 12px', borderRadius:9, border:'none', cursor:dirs.meetings || meetingOpen ? 'pointer' : 'not-allowed', fontWeight:800, fontSize:12, fontFamily:'inherit', background:meetingOpen ? 'rgba(239,68,68,0.1)' : 'linear-gradient(135deg,#7c3aed,#3b82f6)', color:meetingOpen ? '#f87171' : '#fff', opacity:dirs.meetings || meetingOpen ? 1 : 0.4 }}>
                {meetingOpen ? 'Save & Stop Meeting' : '+ Start Meeting'}
              </button>
            </div>
            <div style={{ padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize:9, color:'#475569', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>Meeting folder</div>
              <div style={{ fontSize:12, color:dirs.meetings ? '#94a3b8' : '#fbbf24', lineHeight:1.45 }}>{dirs.meetings ? dirs.meetings.name : 'Pick a Meetings folder before saving notes.'}</div>
            </div>
            <div style={{ flex:1, padding:'18px 14px', color:'#475569', fontSize:12, lineHeight:1.55 }}>
              Meeting notes save as markdown files in the configured Meetings folder. You can switch to Tasks while a meeting note is open and come back here to continue writing.
            </div>
          </>
        ) : view === 'projects' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewProjectOpen(true)} disabled={!dirs.projects} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:dirs.projects?'pointer':'not-allowed', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 2px 12px rgba(124,58,237,0.35)', opacity:dirs.projects?1:0.35 }}>
                +  New Project
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <input value={projectSearch} onChange={e=>setProjectSearch(e.target.value)} placeholder="Search projects..." style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.projects && <div style={{ color:'#475569', textAlign:'center', paddingTop:40, fontSize:12 }}>Pick your Projects folder in Configure folders</div>}
              {filteredProjects.map(p => {
                const active = projectSel === p.id;
                return (
                  <div key={p.id} onClick={()=>setProjectSel(p.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', border:`1px solid ${active?'rgba(124,58,237,0.28)':'rgba(255,255,255,0.04)'}` }}>
                    <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#e2e8f0' }}>{p.title}</div>
                    <div style={{ fontSize:10, color:'#475569', marginTop:3 }}>{p.status || p.filename}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.02)', color:'#64748b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                Configure project folders
              </button>
            </div>
          </>
        ) : view === 'properties' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewPropertyOpen(true)} disabled={!dirs.properties} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:dirs.properties?'pointer':'not-allowed', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 2px 12px rgba(124,58,237,0.35)', opacity:dirs.properties?1:0.35 }}>
                +  New Property
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <input value={propertySearch} onChange={e=>setPropertySearch(e.target.value)} placeholder="Search properties…" style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.properties && <div style={{ color:'#475569', textAlign:'center', paddingTop:40, fontSize:12 }}>Pick your Properties folder in Configure folders</div>}
              {filteredProperties.map(p => {
                const active = propertySel === p.id;
                return (
                  <div key={p.id} onClick={()=>setPropertySel(p.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', border:`1px solid ${active?'rgba(124,58,237,0.28)':'rgba(255,255,255,0.04)'}` }}>
                    <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#e2e8f0' }}>{p.title}</div>
                    <div style={{ fontSize:10, color:'#475569', marginTop:3 }}>{p.client || p.filename}</div>
                    {p.comments.length > 0 && <div style={{ fontSize:10, color:'#818cf8', marginTop:4 }}>{p.comments.length} comment{p.comments.length===1?'':'s'}</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.02)', color:'#64748b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                Configure property folders
              </button>
            </div>
          </>
        ) : view === 'people' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewPersonOpen(true)} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 2px 12px rgba(124,58,237,0.35)' }}>
                + New Person
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <input value={peopleSearch} onChange={e=>setPeopleSearch(e.target.value)} placeholder="Search people..." style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.people && <div style={{ color:'#475569', textAlign:'center', paddingTop:40, fontSize:12 }}>Pick your People folder in Configure folders</div>}
              {filteredPeople.map(p => (
                <div key={p.id} onClick={()=>setPersonSel(p.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:personSel===p.id?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', border:`1px solid ${personSel===p.id?'rgba(124,58,237,0.28)':'rgba(255,255,255,0.04)'}` }}>
                  <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#e2e8f0' }}>{p.title}</div>
                  <div style={{ fontSize:10, color:'#475569', marginTop:3 }}>{p.company || p.role || p.filename}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.02)', color:'#64748b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                Configure people folder
              </button>
            </div>
          </>
        ) : (
          <div style={{ flex:1, overflowY:'auto', padding:'10px' }}>
            <div style={{ fontSize:9, color:'#475569', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8 }}>Mission queues</div>
            {[
              ['Overdue', missionOverdue, '#f87171'],
              ['Today', missionToday, '#fbbf24'],
              ['Recurrent', missionRecurrent, '#818cf8'],
            ].map(([label, list, color]) => (
              <div key={label} style={{ marginBottom:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                  <span style={{ fontSize:11, color, fontWeight:800 }}>{label}</span>
                  <span style={{ fontSize:10, color:'#475569', fontWeight:700 }}>{list.length}</span>
                </div>
                {list.slice(0, 4).map(t => (
                  <div key={t.id} onClick={()=>{ setView('tasks'); setSel(t.id); }} style={{ padding:'8px 9px', marginBottom:4, borderRadius:9, cursor:'pointer', background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize:12, fontWeight:650, lineHeight:1.3 }}>{t.title}</div>
                    <div style={{ fontSize:10, color:'#475569', marginTop:3 }}>{t.dateCreated ? `created ${t.dateCreated.slice(0,10)}` : 'created date unknown'}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {(view === 'tasks' || view === 'mission' || view === 'meetings' || view === 'people' || view === 'health') && (
          <div style={{ padding:'6px 10px 9px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
            <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'5px 10px', background:'transparent', border:'none', color:'#334155', fontSize:10, cursor:'pointer', fontFamily:'inherit', textAlign:'center' }}>
              ⚙  Configure folders
            </button>
          </div>
        )}
      </div>

      {/* ─── Main panel ─── */}
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
          completedToday={completedToday}
          tomorrowTasks={tomorrowTasks}
          weekDates={weekDates(tod())}
          vaultTotals={vaultTotals}
        />
      ) : view === 'projects' ? (
        newProjectOpen ? (
          <NewProjectPanel onCancel={()=>setNewProjectOpen(false)} onCreate={createProject} refs={refs}/>
        ) : (
          <ProjectPanel
            projects={filteredProjects}
            selected={project}
            selectedId={projectSel}
            draft={projectDraft}
            setDraft={setProjectDraft}
            onSelect={setProjectSel}
            onSave={saveProject}
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
          images={propertyImages}
          onSelect={setPropertySel}
          comment={propertyComment}
          setComment={setPropertyComment}
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
            people={filteredPeople}
            selected={person}
            selectedId={personSel}
            draft={personDraft}
            setDraft={setPersonDraft}
            onSelect={setPersonSel}
            onSave={savePerson}
            hasPeopleFolder={!!dirs.people}
            onNewPerson={()=>setNewPersonOpen(true)}
            onConfigure={()=>setFolderSetupOpen(true)}
          />
        )
      ) : view === 'health' ? (
        <HealthPanel diagnostics={diagnostics} dirs={dirs} backups={writeBackups} onForceSync={forceSyncAll} syncBusy={syncBusy} onConfigure={()=>setFolderSetupOpen(true)} onRestoreBackup={restoreBackup}/>
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
        />

      ) : !task ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#334155', fontSize:13 }}>← Select a task</div>

      ) : (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'22px 30px 18px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', gap:7, alignItems:'center', marginBottom:9, flexWrap:'wrap' }}>
                  <PBadge p={task.priority}/><SBadge s={task.status}/>
                  {task.due && <span style={{ fontSize:12, color:dueColor(task.due) }}>📅 {isToday(task.due)?'Due Today':isOver(task.due)?`Overdue · ${task.due}`:task.due}</span>}
                  {task.scheduled && <span style={{ fontSize:12, color:'#818cf8' }}>Scheduled {task.scheduled}</span>}
                  {task.client && <span style={{ fontSize:12, color:'#475569' }}>· 👤 {task.client}</span>}
                  {task.building && <span style={{ fontSize:12, color:'#475569' }}>· 🏢 {task.building}</span>}
                </div>
                <h2 style={{ margin:0, fontSize:19, fontWeight:700, lineHeight:1.35, color:'#f1f5f9' }}>{task.title}</h2>
                <div style={{ marginTop:11, display:'inline-flex', alignItems:'center', gap:8, padding:'7px 11px', borderRadius:9, border:`1px solid ${taskAge.border}`, background:taskAge.bg, color:taskAge.color, fontSize:12, fontWeight:850 }}>
                  {taskDaysOpen === null ? 'Open age unknown - no dateCreated' : `Open for ${taskDaysOpen} day${taskDaysOpen === 1 ? '' : 's'}`}
                </div>
                <div style={{ display:'flex', gap:9, alignItems:'end', flexWrap:'wrap', marginTop:13 }}>
                  <label style={{ display:'flex', flexDirection:'column', gap:4, minWidth:145 }}>
                    <span style={{ fontSize:9, color:'#64748b', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Due</span>
                    <input type="date" value={task.due || ''} onChange={e=>changeTaskDates(task.id, { due:e.target.value })} style={{ ...inputBase, padding:'7px 9px', fontSize:12 }}/>
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', gap:4, minWidth:145 }}>
                    <span style={{ fontSize:9, color:'#64748b', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Scheduled</span>
                    <input type="date" value={task.scheduled || ''} onChange={e=>changeTaskDates(task.id, { scheduled:e.target.value })} style={{ ...inputBase, padding:'7px 9px', fontSize:12 }}/>
                  </label>
                  <button onClick={()=>setTaskDatesToToday(task.id)} title="Set active task date fields to today" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(16,185,129,0.32)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(16,185,129,0.14)', color:'#10b981' }}>
                    Today
                  </button>
                  <button onClick={()=>setTaskDatesToTomorrow(task.id)} title="Set active task date fields to tomorrow" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(56,189,248,0.32)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(56,189,248,0.12)', color:'#38bdf8' }}>
                    Tomorrow
                  </button>
                  <button onClick={()=>postponeTaskByWeek(task.id)} title="Move due and scheduled dates forward by 7 days" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(245,158,11,0.28)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(245,158,11,0.08)', color:'#fbbf24' }}>
                    Postpone 1w
                  </button>
                  <button onClick={()=>postponeTaskByMonth(task.id)} title="Move due and scheduled dates forward by 1 calendar month" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(248,113,113,0.32)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(248,113,113,0.14)', color:'#f87171' }}>
                    1 month
                  </button>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, flexShrink:0 }}>
                <div style={{ fontSize:31, fontWeight:800, letterSpacing:'-0.03em', fontVariantNumeric:'tabular-nums', color:live?'#10b981':'#e2e8f0', textShadow:live?'0 0 28px rgba(16,185,129,0.55)':'none', transition:'color 0.3s,text-shadow 0.3s' }}>{fmt(selTime)}</div>
                <div style={{ display:'flex', gap:7 }}>
                  <button onClick={live?stop:()=>start(task.id)} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:live?'rgba(239,68,68,0.1)':'linear-gradient(135deg,#7c3aed,#3b82f6)', color:live?'#f87171':'#fff', boxShadow:live?'inset 0 0 0 1px rgba(239,68,68,0.3)':'0 4px 16px rgba(124,58,237,0.4)', transition:'all 0.2s' }}>{live?'⏹  Stop':'▶  Start'}</button>
                  {!task.archived && (
                    task.recurrent ? (
                      <>
                        <button onClick={()=>finishRecurrentInstance(task.id)} title="Complete this recurrence only and move to the next run"
                          style={{ padding:'9px 14px', borderRadius:10, border:'1px solid rgba(16,185,129,0.3)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'rgba(16,185,129,0.08)', color:'#10b981' }}>
                          Finish instance
                        </button>
                        <button onClick={closeTask} title="Archive the whole recurring series"
                          style={{ padding:'9px 12px', borderRadius:10, border:'1px solid rgba(239,68,68,0.26)', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'rgba(239,68,68,0.08)', color:'#f87171' }}>
                          Archive series
                        </button>
                      </>
                    ) : (
                    <button onClick={closeTask} title="Mark done & archived"
                      style={{ padding:'9px 14px', borderRadius:10, border:'1px solid rgba(16,185,129,0.3)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'rgba(16,185,129,0.08)', color:'#10b981' }}>
                      {task.status==='done' ? '✓  Archive' : '✓  Close'}
                    </button>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(420px, 0.58fr) minmax(360px, 0.42fr)', gap:0, overflow:'hidden' }}>
            <div style={{ minWidth:0, overflowY:'auto', padding:'18px 24px 18px 30px', borderRight:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display:'flex', gap:8, marginBottom:18, alignItems:'stretch' }}>
                <textarea value={note} onChange={e=>setNote(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); addNote(); }}}
                  placeholder="Add a note... Enter to save, Shift+Enter for a new line"
                  rows={3}
                  style={{ flex:1, minHeight:76, fieldSizing:'content', padding:'10px 14px', borderRadius:10, resize:'vertical', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.09)', color:'#e2e8f0', fontSize:13, lineHeight:1.5, outline:'none', fontFamily:'inherit' }}/>
                <button onClick={addNote} disabled={!note.trim()} style={{ padding:'10px 20px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:600, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:note.trim()?1:0.35 }}>Add</button>
              </div>
              {!task.logs.length && (
                <div style={{ color:'#334155', textAlign:'center', padding:'60px 0', fontSize:13 }}>
                  <div style={{ fontSize:28, marginBottom:10 }}>📝</div>Notes you add here write directly to your .md file
                </div>
              )}
              {task.logs.map((l, i) => (
                <CommentCard key={`${l.date}-${i}-${l.text}`} log={l} index={i} onSave={editTaskComment} onDelete={deleteTaskComment} />
              ))}
            </div>
            <aside style={{ minWidth:0, overflowY:'auto', padding:'18px 30px 18px 24px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:12 }}>
                <h3 style={{ margin:0, fontSize:14, color:'#f1f5f9' }}>Task Description</h3>
                <span style={{ fontSize:10, color:'#475569', fontWeight:800 }}>{task.filename}</span>
              </div>
              <div style={{ borderRadius:10, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'14px 16px', minHeight:220 }}>
                <MarkdownBody>{taskDescriptionText(task.raw)}</MarkdownBody>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}

function PeoplePanel({ people, selected, selectedId, draft, setDraft, onSelect, onSave, hasPeopleFolder, onNewPerson, onConfigure }) {
  if (!hasPeopleFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#475569', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>Configure People folder</button>
      </div>
    );
  }

  const groups = groupByInitial(people);
  const letters = Object.keys(groups).sort();

  return (
    <div style={{ flex:1, display:'grid', gridTemplateColumns:'minmax(230px, 0.28fr) minmax(560px, 1fr)', minHeight:0, overflow:'hidden' }}>
      <div style={{ borderRight:'1px solid rgba(255,255,255,0.06)', overflowY:'auto', padding:'14px 12px' }}>
        <button onClick={onNewPerson} style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', marginBottom:10 }}>+ New Person</button>
        {!people.length && <div style={{ color:'#475569', textAlign:'center', paddingTop:35, fontSize:12 }}>No people found</div>}
        {letters.map(letter => (
          <div key={letter} style={{ marginBottom:8 }}>
            <div style={{ position:'sticky', top:-14, zIndex:1, padding:'6px 2px 5px', background:'#09090e', borderBottom:'1px solid rgba(255,255,255,0.06)', fontSize:10, color:'#a78bfa', fontWeight:900, letterSpacing:'0.12em' }}>{letter}</div>
            {groups[letter].map(p => (
              <button key={p.id} onClick={()=>onSelect(p.id)} style={{ width:'100%', textAlign:'left', padding:'8px 10px', marginTop:4, borderRadius:8, border:`1px solid ${selectedId===p.id?'rgba(124,58,237,0.45)':'transparent'}`, background:selectedId===p.id?'rgba(124,58,237,0.12)':'transparent', color:'#e2e8f0', cursor:'pointer', fontFamily:'inherit' }}>
                <div style={{ fontSize:13, fontWeight:800, lineHeight:1.3 }}>{p.title}</div>
                {(p.company || p.role) && <div style={{ fontSize:10, color:'#64748b', marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.company || p.role}</div>}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div style={{ display:'flex', flexDirection:'column', minWidth:0, minHeight:0 }}>
        <div style={{ padding:'18px 28px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', gap:18, alignItems:'flex-start' }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>People</div>
            <h2 style={{ margin:0, fontSize:20, color:'#f1f5f9' }}>{selected ? selected.title : 'Select a person'}</h2>
            {selected && (
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:7, color:'#64748b', fontSize:11 }}>
                {selected.company && <span>{selected.company}</span>}
                {selected.role && <span>{selected.role}</span>}
                {selected.email && <span>{selected.email}</span>}
              </div>
            )}
          </div>
          <button onClick={onSave} disabled={!selected} style={{ padding:'9px 18px', borderRadius:10, border:'none', cursor:selected?'pointer':'not-allowed', fontWeight:800, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:selected?1:0.35 }}>Save</button>
        </div>
        {selected ? (
          <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'16px 28px 10px', flexShrink:0, display:'flex', justifyContent:'space-between', gap:12, alignItems:'baseline' }}>
              <h3 style={{ margin:0, fontSize:14, color:'#f1f5f9' }}>Notes</h3>
              <span style={{ fontSize:10, color:'#475569', fontWeight:800 }}>{selected.filename}</span>
            </div>
            <textarea value={draft} onChange={e=>setDraft(e.target.value)} spellCheck={false} style={{ flex:1, width:'100%', resize:'none', padding:'8px 28px 22px', background:'rgba(255,255,255,0.02)', border:'none', color:'#e2e8f0', outline:'none', fontFamily:'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize:13, lineHeight:1.65 }}/>
          </div>
        ) : (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#334155', fontSize:13 }}>Select or create a person</div>
        )}
      </div>
    </div>
  );
}

function MeetingPanel({ meetingOpen, meetingTitle, meetingNotes, meetingLinks, setMeetingTitle, setMeetingNotes, setMeetingLinks, elapsed, onStart, onStop, hasMeetingsFolder, onConfigure, meetingStart, refs, taskOptions }) {
  const timeLabel = new Date(meetingStart || Date.now()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false }).replace(':','');
  const filename = `Meeting - ${tod()} - ${meetingTitle.trim() || timeLabel}.md`;
  const setLinks = (key, value) => setMeetingLinks(prev => ({ ...prev, [key]: value }));

  if (!hasMeetingsFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#475569', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>Configure Meetings folder</button>
      </div>
    );
  }

  if (!meetingOpen) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:30 }}>
        <div style={{ width:'min(520px,100%)', borderRadius:10, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:24, textAlign:'center' }}>
          <div style={{ fontSize:10, color:'#10b981', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:10 }}>Meetings</div>
          <h2 style={{ margin:'0 0 16px', fontSize:22, color:'#f1f5f9' }}>Meeting notes</h2>
          <button onClick={onStart} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>+ Start Meeting</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 20px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:10, color:'#10b981', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Meeting in Progress</div>
            <input value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)}
              placeholder="Meeting title..."
              style={{ width:'100%', padding:'6px 0', background:'transparent', border:'none', borderBottom:'2px solid rgba(255,255,255,0.1)', color:'#f1f5f9', fontSize:20, fontWeight:700, outline:'none', fontFamily:'inherit' }}/>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, flexShrink:0 }}>
            <div style={{ fontSize:30, fontWeight:800, fontVariantNumeric:'tabular-nums', color:'#10b981', textShadow:'0 0 28px rgba(16,185,129,0.55)' }}>{fmt(elapsed)}</div>
            <button onClick={onStop} style={{ padding:'9px 20px', borderRadius:10, border:'1px solid rgba(239,68,68,0.3)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'rgba(239,68,68,0.1)', color:'#f87171' }}>Save & Stop</button>
          </div>
        </div>
      </div>
      <div style={{ flex:1, padding:'20px 30px', display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(220px,1fr))', gap:10, marginBottom:10 }}>
          <Field label="Clients">
            <ChipMulti value={meetingLinks.clients || []} onChange={value=>setLinks('clients', value)} options={refs.clients || []} placeholder="Add clients..." />
          </Field>
          <Field label="Properties">
            <ChipMulti value={meetingLinks.properties || []} onChange={value=>setLinks('properties', value)} options={refs.properties || []} placeholder="Add properties..." />
          </Field>
          <Field label="Tasks">
            <ChipMulti value={meetingLinks.tasks || []} onChange={value=>setLinks('tasks', value)} options={taskOptions || []} placeholder="Add tasks..." />
          </Field>
          <Field label="People">
            <ChipMulti value={meetingLinks.people || []} onChange={value=>setLinks('people', value)} options={refs.people || []} placeholder="Add people..." />
          </Field>
        </div>
        <div style={{ fontSize:10, color:'#475569', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em' }}>Notes</div>
        <textarea value={meetingNotes} onChange={e => setMeetingNotes(e.target.value)}
          placeholder="Type your meeting notes here... markdown supported"
          style={{ flex:1, padding:'14px', borderRadius:10, resize:'none', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', color:'#e2e8f0', fontSize:13, lineHeight:1.7, outline:'none', fontFamily:'inherit' }}/>
        <div style={{ fontSize:11, color:'#334155' }}>
          Will save as: {filename}
        </div>
      </div>
    </div>
  );
}

function HealthPanel({ diagnostics, dirs, backups, onForceSync, syncBusy, onConfigure, onRestoreBackup }) {
  const [selectedBackup, setSelectedBackup] = useState(null);
  const issueColor = issue => issue.level === 'error' ? '#f87171' : issue.level === 'warning' ? '#fbbf24' : '#818cf8';
  const copyBackup = async (backup) => {
    try {
      await navigator.clipboard.writeText(backup.content || '');
    } catch(e) {
      console.warn('backup copy failed', e);
    }
  };
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center', gap:18 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Vault Health</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Sync and file checks</h2>
          <div style={{ fontSize:12, color:'#64748b', marginTop:5 }}>Automatic sync runs only while this app is open and folder permission is active.</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onConfigure} style={{ padding:'9px 13px', borderRadius:10, border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(255,255,255,0.03)', color:'#94a3b8' }}>Folders</button>
          <button onClick={onForceSync} disabled={syncBusy} style={{ padding:'9px 16px', borderRadius:10, border:'none', cursor:syncBusy?'wait':'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>{syncBusy ? 'Syncing...' : 'Force Sync'}</button>
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:16 }}>
          {Object.entries(diagnostics.counts).map(([key, value]) => (
            <div key={key} style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'12px' }}>
              <div style={{ fontSize:10, color:'#64748b', textTransform:'uppercase', fontWeight:800 }}>{key.replace(/([A-Z])/g, ' $1')}</div>
              <div style={{ fontSize:24, fontWeight:850, color:'#f1f5f9', marginTop:4 }}>{value}</div>
            </div>
          ))}
        </div>
        <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'14px', marginBottom:14 }}>
          <h3 style={{ margin:'0 0 10px', fontSize:14, color:'#f1f5f9' }}>Issues</h3>
          {!diagnostics.issues.length && <div style={{ color:'#10b981', fontSize:13 }}>No obvious issues found.</div>}
          {diagnostics.issues.map((issue, i) => {
            const folderIssue = /folder|connected/i.test(issue.text);
            return (
              <div key={i} style={{ padding:'10px 11px', marginBottom:7, borderRadius:8, background:'rgba(255,255,255,0.025)', border:`1px solid ${issueColor(issue)}33`, display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, color:issueColor(issue), fontWeight:850, textTransform:'uppercase' }}>{issue.level}</div>
                  <div style={{ fontSize:13, color:'#e2e8f0', marginTop:4 }}>{issue.text}</div>
                  {issue.detail && <div style={{ fontSize:11, color:'#64748b', marginTop:4, overflowWrap:'anywhere' }}>{issue.detail}</div>}
                </div>
                <button onClick={folderIssue ? onConfigure : onForceSync} style={{ padding:'6px 9px', borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.035)', color:folderIssue?'#c4b5fd':'#94a3b8', cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit', flexShrink:0 }}>
                  {folderIssue ? 'Fix' : 'Recheck'}
                </button>
              </div>
            );
          })}
        </section>
        <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'14px' }}>
          <h3 style={{ margin:'0 0 10px', fontSize:14, color:'#f1f5f9' }}>Recent Local Backups</h3>
          {!backups.length && <div style={{ color:'#64748b', fontSize:13 }}>No backups captured yet. The next text write keeps the previous version locally in this browser.</div>}
          {backups.slice(0, 8).map((backup, i) => (
            <div key={`${backup.at}-${i}`} style={{ padding:'10px 11px', marginBottom:7, borderRadius:8, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, color:'#e2e8f0', fontWeight:800 }}>{backup.filename}</div>
                  <div style={{ fontSize:10, color:'#64748b', marginTop:3 }}>{new Date(backup.at).toLocaleString()} · {backup.size || backup.content?.length || 0} chars</div>
                  {backup.preview && <div style={{ fontSize:11, color:'#64748b', marginTop:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{backup.preview}</div>}
                </div>
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  <button onClick={()=>setSelectedBackup(backup)} style={{ padding:'6px 9px', borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.035)', color:'#c4b5fd', cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit' }}>Inspect</button>
                  <button onClick={()=>onRestoreBackup?.(backup)} style={{ padding:'6px 9px', borderRadius:8, border:'1px solid rgba(16,185,129,0.2)', background:'rgba(16,185,129,0.08)', color:'#10b981', cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit' }}>Restore</button>
                </div>
              </div>
            </div>
          ))}
        </section>
      </div>
      {selectedBackup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.62)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ width:'min(900px, 96vw)', maxHeight:'86vh', display:'flex', flexDirection:'column', borderRadius:10, border:'1px solid rgba(255,255,255,0.12)', background:'#0f1018', boxShadow:'0 18px 70px rgba(0,0,0,0.5)', overflow:'hidden' }}>
            <div style={{ padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.08)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:14 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, color:'#f1f5f9', fontWeight:850 }}>{selectedBackup.filename}</div>
                <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>{new Date(selectedBackup.at).toLocaleString()}</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={()=>copyBackup(selectedBackup)} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.035)', color:'#94a3b8', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>Copy</button>
                <button onClick={()=>onRestoreBackup?.(selectedBackup)} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid rgba(16,185,129,0.2)', background:'rgba(16,185,129,0.08)', color:'#10b981', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>Restore</button>
                <button onClick={()=>setSelectedBackup(null)} style={{ padding:'8px 11px', borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.035)', color:'#f87171', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit' }}>Close</button>
              </div>
            </div>
            <pre style={{ margin:0, padding:16, overflow:'auto', color:'#cbd5e1', background:'rgba(255,255,255,0.025)', fontSize:12, lineHeight:1.55, whiteSpace:'pre-wrap', overflowWrap:'anywhere', fontFamily:'ui-monospace, SFMono-Regular, Consolas, monospace' }}>{selectedBackup.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function MissionControlPanel({ today, overdue, recurrent, selectedId, liveId, getTime, onSelectTask, onStart, onStop, onNewTask, dailyNote, dailyInputs, setDailyInputs, onAddDailyEntry, onTimeClockEvent, workDate, workMonth, workNotes, onSelectWorkDate, onWorkMonthChange, onSaveTimeClockRows, onWorkStatusChange, hasDailyFolder, onConfigure, completedToday = [], tomorrowTasks = [], weekDates: currentWeekDates = [], vaultTotals = { tasksOpen:0, tasksFinished:0, projects:0, properties:0, people:0 } }) {
  const renderTask = t => {
    const running = liveId === t.id;
    return (
      <div key={t.id} style={{ padding:'12px 14px', borderRadius:8, background:running?'rgba(16,185,129,0.08)':'rgba(255,255,255,0.025)', border:`1px solid ${selectedId===t.id?'rgba(124,58,237,0.45)':running?'rgba(16,185,129,0.25)':'rgba(255,255,255,0.06)'}`, marginBottom:8 }}>
        <div onClick={()=>onSelectTask(t.id)} style={{ cursor:'pointer' }}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:7 }}>
            <div style={{ fontSize:13, fontWeight:750, lineHeight:1.35, color:'#f1f5f9' }}>{t.title}</div>
            {running && <span style={{ fontSize:10, fontWeight:800, color:'#10b981', flexShrink:0 }}>{fmt(getTime(t.id))}</span>}
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
            <PBadge p={t.priority}/><SBadge s={t.status}/>
            {t.due && <span style={{ fontSize:10, color:isOver(t.due)?'#f87171':isToday(t.due)?'#fbbf24':'#64748b', fontWeight:700 }}>due {t.due}</span>}
            {t.scheduled && <span style={{ fontSize:10, color:'#818cf8', fontWeight:700 }}>scheduled {t.scheduled}</span>}
            <span style={{ fontSize:10, color:'#475569' }}>{t.dateCreated ? `created ${t.dateCreated.slice(0,10)}` : 'created date unknown'}</span>
          </div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}>
          <button onClick={()=>running ? onStop() : onStart(t.id)} style={{ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit', background:running?'rgba(239,68,68,0.1)':'linear-gradient(135deg,#7c3aed,#3b82f6)', color:running?'#f87171':'#fff' }}>
            {running ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>
    );
  };

  const sections = [
    { title:'Overdue', subtitle:'Oldest created first', items:overdue, color:'#f87171' },
    { title:'Today', subtitle:'Due or scheduled today, oldest created first', items:today, color:'#fbbf24' },
    { title:'Recurrent', subtitle:'Due or scheduled today only', items:recurrent, color:'#818cf8' },
  ];

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:20 }}>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Today Mission Control</div>
          <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
            <h2 style={{ margin:0, fontSize:20, fontWeight:750, color:'#f1f5f9' }}>{longDate(new Date())}</h2>
            <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
              {[
                ['☑', 'Open', vaultTotals.tasksOpen, '#fbbf24'],
                ['✓', 'Finished', vaultTotals.tasksFinished, '#10b981'],
                ['◆', 'Projects', vaultTotals.projects, '#818cf8'],
                ['⌂', 'Properties', vaultTotals.properties, '#38bdf8'],
                ['👤', 'People', vaultTotals.people, '#14b8a6'],
              ].map(([icon, label, count, color]) => (
                <span key={label} title={`Total ${label.toLowerCase()}`} style={{ display:'inline-flex', alignItems:'center', gap:6, minHeight:26, padding:'4px 8px', borderRadius:8, border:`1px solid ${color}33`, background:`${color}12`, color:'#cbd5e1', fontSize:11, fontWeight:800, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>
                  <span style={{ color, fontSize:13, lineHeight:1 }}>{icon}</span>
                  <span style={{ color:'#f8fafc' }}>{count}</span>
                  <span style={{ color:'#64748b', fontWeight:700 }}>{label}</span>
                </span>
              ))}
            </div>
          </div>
          <div style={{ fontSize:12, color:'#64748b', marginTop:5 }}>{dailyNote ? dailyNote.filename : hasDailyFolder ? 'Creating today daily note...' : 'Daily notes folder not configured'}</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onConfigure} style={{ padding:'9px 13px', borderRadius:10, border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(255,255,255,0.03)', color:'#94a3b8' }}>{hasDailyFolder ? 'Daily folder set' : 'Set Daily folder'}</button>
        </div>
      </div>
      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(360px,0.42fr) minmax(520px,1fr)', overflow:'hidden' }}>
        <div style={{ minWidth:0, minHeight:0, overflowY:'auto', padding:'16px', borderRight:'1px solid rgba(255,255,255,0.06)' }}>
        <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'13px', marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:14, marginBottom:10 }}>
            <div>
              <h3 style={{ margin:0, fontSize:14, color:'#f1f5f9' }}>Time Clock</h3>
              <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>Stored in today's daily note</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:6, marginBottom:10 }}>
            {[
              ['Clock in', 'IN', '#10b981'],
              ['Clock out', 'OUT', '#f87171'],
              ['Break start', 'BR', '#fbbf24'],
              ['Break finish', 'GO', '#818cf8'],
            ].map(([event, icon, color]) => (
              <button key={event} onClick={()=>onTimeClockEvent(event)} disabled={!hasDailyFolder} title={event}
                style={{ minWidth:0, padding:'6px 5px', borderRadius:8, border:`1px solid ${hasDailyFolder ? color : 'rgba(255,255,255,0.08)'}`, cursor:hasDailyFolder?'pointer':'not-allowed', fontWeight:800, fontSize:10, fontFamily:'inherit', background:'rgba(255,255,255,0.025)', color:hasDailyFolder?color:'#475569', opacity:hasDailyFolder?1:0.45, whiteSpace:'nowrap' }}>
                <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:16, height:16, marginRight:4, borderRadius:5, background:hasDailyFolder?`${color}22`:'rgba(255,255,255,0.04)', border:`1px solid ${hasDailyFolder ? color : 'rgba(255,255,255,0.08)'}`, fontSize:7, fontWeight:900, verticalAlign:'middle' }}>{icon}</span>{event}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
            {(dailyNote?.timeClock || []).slice(-5).map((row, i) => (
              <span key={`${row.time}-${row.event}-${i}`} style={{ fontSize:11, color:'#94a3b8', padding:'4px 8px', borderRadius:14, background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.05)' }}>
                {row.time} · {row.event}
              </span>
            ))}
            {!dailyNote?.timeClock?.length && <span style={{ fontSize:12, color:'#334155' }}>No clock events yet today</span>}
          </div>
        </section>

        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:12, alignItems:'stretch', marginBottom:12 }}>
          <WorkHoursPanel
            selectedDate={workDate}
            selectedNote={workNotes[workDate]}
            notes={workNotes}
            onSaveRows={onSaveTimeClockRows}
            onStatusChange={onWorkStatusChange}
            hasDailyFolder={hasDailyFolder}
          />
          <WorkCalendar
            month={workMonth}
            selectedDate={workDate}
            notes={workNotes}
            onMonthChange={onWorkMonthChange}
            onSelectDate={onSelectWorkDate}
            hasDailyFolder={hasDailyFolder}
          />
        </div>

        </div>

        <div style={{ minWidth:0, minHeight:0, display:'flex', flexDirection:'column', padding:'16px 18px 16px 16px', overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(180px,1fr))', gap:10, marginBottom:14, flexShrink:0 }}>
            {[
              ['notes', 'Notes', dailyNote?.notes || []],
              ['reflections', 'Reflections', dailyNote?.reflections || []],
              ['brainDump', 'Brain dump - issues', dailyNote?.brainDump || []],
            ].map(([key, label, items]) => (
              <section key={key} style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'12px', minWidth:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
                  <h3 style={{ margin:0, fontSize:13, color:'#f1f5f9' }}>{label}</h3>
                  <span style={{ fontSize:10, color:'#64748b', fontWeight:800 }}>{items.length}</span>
                </div>
                <div style={{ minHeight:46, marginBottom:9 }}>
                  {items.length ? items.slice(-2).map((item, i) => (
                    <div key={i} style={{ fontSize:12, color:'#cbd5e1', lineHeight:1.4, marginBottom:5, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>- {item}</div>
                  )) : <div style={{ fontSize:12, color:'#334155', paddingTop:8 }}>Nothing written yet</div>}
                </div>
                <div style={{ display:'flex', gap:7 }}>
                  <input value={dailyInputs[key] || ''} onChange={e=>setDailyInputs(prev => ({ ...prev, [key]: e.target.value }))} onKeyDown={e=>{ if(e.key==='Enter') onAddDailyEntry(key); }} disabled={!hasDailyFolder}
                    placeholder={hasDailyFolder ? `Add ${label.toLowerCase()}...` : 'Set daily folder first'}
                    style={{ flex:1, minWidth:0, padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#e2e8f0', fontSize:12, outline:'none', fontFamily:'inherit', opacity:hasDailyFolder?1:0.45 }}/>
                  <button onClick={()=>onAddDailyEntry(key)} disabled={!hasDailyFolder || !dailyInputs[key]?.trim()} style={{ padding:'8px 10px', borderRadius:8, border:'none', cursor:hasDailyFolder?'pointer':'not-allowed', fontWeight:800, fontSize:11, fontFamily:'inherit', background:'rgba(124,58,237,0.18)', color:'#c4b5fd', opacity:hasDailyFolder && dailyInputs[key]?.trim()?1:0.4 }}>Add</button>
                </div>
              </section>
            ))}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:12, flexShrink:0 }}>
            <div>
              <h3 style={{ margin:0, fontSize:15, color:'#f1f5f9' }}>Task Queues</h3>
              <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>Today, overdue, and recurrent work stay visible beside your hours.</div>
            </div>
          </div>
          <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'12px', marginBottom:12, flexShrink:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:9 }}>
              <div>
                <h3 style={{ margin:0, fontSize:13, color:'#f1f5f9' }}>Daily Review</h3>
                <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>Quick end-of-day pulse</div>
              </div>
              <div style={{ textAlign:'right', fontSize:11, color:'#94a3b8', fontWeight:800 }}>
                {formatHoursMinutes(currentWeekDates.reduce((sum, dateStr) => sum + workStats(workNotes[dateStr]).totalMinutes, 0))} this week
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              <div style={{ padding:'8px 9px', borderRadius:8, background:'rgba(16,185,129,0.07)', border:'1px solid rgba(16,185,129,0.13)' }}>
                <div style={{ fontSize:18, fontWeight:850, color:'#10b981' }}>{completedToday.length}</div>
                <div style={{ fontSize:10, color:'#64748b' }}>closed today</div>
              </div>
              <div style={{ padding:'8px 9px', borderRadius:8, background:'rgba(251,191,36,0.07)', border:'1px solid rgba(251,191,36,0.13)' }}>
                <div style={{ fontSize:18, fontWeight:850, color:'#fbbf24' }}>{tomorrowTasks.length}</div>
                <div style={{ fontSize:10, color:'#64748b' }}>tomorrow</div>
              </div>
              <div style={{ padding:'8px 9px', borderRadius:8, background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.13)' }}>
                <div style={{ fontSize:18, fontWeight:850, color:'#f87171' }}>{overdue.length}</div>
                <div style={{ fontSize:10, color:'#64748b' }}>overdue</div>
              </div>
            </div>
          </section>
          <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'repeat(3,minmax(180px,1fr))', gap:12, alignItems:'stretch', overflow:'hidden' }}>
          {sections.map(s => (
            <section key={s.title} style={{ minWidth:0, minHeight:0, overflowY:'auto', paddingRight:4 }}>
              <div style={{ padding:'0 2px 10px', borderBottom:`2px solid ${s.color}`, marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'baseline' }}>
                  <h3 style={{ margin:0, fontSize:16, color:'#f1f5f9' }}>{s.title}</h3>
                  <span style={{ fontSize:20, fontWeight:850, color:s.color }}>{s.items.length}</span>
                </div>
                <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>{s.subtitle}</div>
              </div>
              {!s.items.length && <div style={{ color:'#334155', fontSize:13, padding:'32px 8px', textAlign:'center' }}>Clear</div>}
              {s.items.map(renderTask)}
            </section>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}

function WorkCalendar({ month, selectedDate, notes, onMonthChange, onSelectDate, hasDailyFolder }) {
  const days = monthDates(month);
  const firstPad = (dateFromStr(days[0]).getDay() + 6) % 7;
  const cells = [...Array(firstPad).fill(null), ...days];

  return (
    <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'13px', minHeight:285 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:11 }}>
        <button onClick={()=>onMonthChange(prevMonth(month))} disabled={!hasDailyFolder} style={{ width:28, height:28, borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color:'#94a3b8', cursor:hasDailyFolder?'pointer':'not-allowed', fontWeight:900 }}>‹</button>
        <div style={{ textAlign:'center' }}>
          <h3 style={{ margin:0, fontSize:14, color:'#f1f5f9' }}>Work Calendar</h3>
          <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>{monthLabel(month)}</div>
        </div>
        <button onClick={()=>onMonthChange(nextMonth(month))} disabled={!hasDailyFolder} style={{ width:28, height:28, borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color:'#94a3b8', cursor:hasDailyFolder?'pointer':'not-allowed', fontWeight:900 }}>›</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:5, marginBottom:5 }}>
        {['M','T','W','T','F','S','S'].map((d, i) => <div key={`${d}-${i}`} style={{ fontSize:9, color:'#475569', textAlign:'center', fontWeight:800 }}>{d}</div>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:5 }}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`blank-${i}`} />;
          const stats = workStats(notes[dateStr]);
          const status = notes[dateStr]?.workStatus;
          const selected = selectedDate === dateStr;
          const accent = status === 'holiday' ? '#38bdf8' : status === 'sick-leave' ? '#f87171' : status === 'bank-holiday' ? '#fbbf24' : stats.totalMinutes ? '#10b981' : '#334155';
          return (
            <button key={dateStr} onClick={()=>onSelectDate(dateStr)} disabled={!hasDailyFolder}
              title={`${dateStr} · ${formatMinutes(stats.totalMinutes)} · ${stats.label}`}
              style={{ minHeight:38, borderRadius:8, border:`1px solid ${selected ? '#a78bfa' : 'rgba(255,255,255,0.06)'}`, background:selected?'rgba(124,58,237,0.18)':'rgba(255,255,255,0.025)', color:'#e2e8f0', cursor:hasDailyFolder?'pointer':'not-allowed', fontFamily:'inherit', padding:'4px 2px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2 }}>
              <span style={{ fontSize:12, fontWeight:800 }}>{Number(dateStr.slice(-2))}</span>
              <span style={{ width:5, height:5, borderRadius:5, background:accent, opacity:status || stats.totalMinutes ? 1 : 0.35 }} />
            </button>
          );
        })}
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10, color:'#64748b', fontSize:10 }}>
        <span>Target 435 min</span>
        <span>Green worked</span>
        <span>Yellow bank holiday</span>
      </div>
    </section>
  );
}

function WorkHoursPanel({ selectedDate, selectedNote, notes, onSaveRows, onStatusChange, hasDailyFolder }) {
  const [draft, setDraft] = useState(timeDraftFromRows(selectedNote?.timeClock || []));
  const stats = workStats(selectedNote);
  const week = weekDates(selectedDate);
  const weekStats = week.map(dateStr => ({ dateStr, ...workStats(notes[dateStr]) }));
  const weekTotalMinutes = weekStats.reduce((sum, day) => sum + day.totalMinutes, 0);
  const chartMaxMinutes = Math.max(WORK_CHART_MAX_MINUTES, TARGET_WORK_MINUTES, ...weekStats.map(day => day.totalMinutes));
  const targetBottom = `${Math.min(100, (TARGET_WORK_MINUTES / chartMaxMinutes) * 100)}%`;

  useEffect(() => {
    setDraft(timeDraftFromRows(selectedNote?.timeClock || []));
  }, [selectedDate, selectedNote]);

  const setDraftTime = (event, value) => setDraft(prev => ({ ...prev, [event]: value }));
  const canEditTimes = hasDailyFolder && !stats.creditedDay;
  const canSave = canEditTimes && Object.values(draft).some(Boolean);

  return (
    <section style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'13px', minHeight:285 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14, marginBottom:12 }}>
        <div>
          <h3 style={{ margin:0, fontSize:14, color:'#f1f5f9' }}>Hours</h3>
          <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>{selectedDate} · {stats.label}</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:22, fontWeight:850, color:weekTotalMinutes >= WEEK_TARGET_MINUTES ? '#10b981' : '#fbbf24' }}>{formatHoursMinutes(weekTotalMinutes)}</div>
          <div style={{ fontSize:10, color:'#64748b' }}>week target {formatHoursMinutes(WEEK_TARGET_MINUTES)}</div>
        </div>
      </div>

      <div style={{ height:155, position:'relative', borderRadius:8, border:'1px solid rgba(255,255,255,0.05)', background:'rgba(15,23,42,0.55)', padding:'14px 12px 26px', marginBottom:12 }}>
        <div style={{ position:'relative', height:'100%' }}>
          <div style={{ position:'absolute', left:0, right:0, bottom:targetBottom, borderTop:'1px dashed rgba(251,191,36,0.9)', zIndex:2 }} />
          <div style={{ position:'absolute', right:0, bottom:targetBottom, transform:'translateY(50%)', fontSize:9, color:'#fbbf24', background:'#0f172a', padding:'1px 4px', zIndex:3 }}>435 min</div>
          <div style={{ height:'100%', display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, alignItems:'stretch' }}>
          {weekStats.map(day => {
            const pct = Math.min(100, (day.totalMinutes / chartMaxMinutes) * 100);
            const barHeight = day.totalMinutes > 0 ? Math.max(3, pct) : 0;
            const isSelected = day.dateStr === selectedDate;
            const isLeave = day.status && day.status !== 'workday';
            return (
              <div key={day.dateStr} style={{ minWidth:0, height:'100%', position:'relative' }}>
                <div style={{ position:'absolute', left:0, right:0, bottom:`calc(${barHeight}% + 5px)`, textAlign:'center', fontSize:9, color:isSelected?'#c4b5fd':'#64748b', fontWeight:800 }}>{formatMinutes(day.totalMinutes)}</div>
                <div style={{ position:'absolute', left:'15%', right:'15%', bottom:0, height:`${barHeight}%`, borderRadius:'7px 7px 3px 3px', background:isLeave?'rgba(56,189,248,0.38)':day.totalMinutes >= TARGET_WORK_MINUTES?'linear-gradient(180deg,#34d399,#10b981)':'linear-gradient(180deg,#fbbf24,#7c3aed)', border:isSelected?'1px solid rgba(196,181,253,0.85)':'1px solid rgba(255,255,255,0.08)' }} />
                <div style={{ position:'absolute', left:0, right:0, bottom:-21, textAlign:'center', fontSize:10, color:isSelected?'#f1f5f9':'#475569', fontWeight:800 }}>{dateFromStr(day.dateStr).toLocaleDateString('en-US', { weekday:'short' })}</div>
              </div>
            );
          })}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(95px,1fr))', gap:8, marginBottom:10 }}>
        {WORK_EVENT_ORDER.map(event => (
          <label key={event} style={{ minWidth:0 }}>
            <span style={{ display:'block', fontSize:9, color:'#64748b', fontWeight:800, textTransform:'uppercase', marginBottom:4 }}>{event}</span>
            <input type="time" value={draft[event] || ''} onChange={e=>setDraftTime(event, e.target.value)} disabled={!canEditTimes}
              style={{ width:'100%', boxSizing:'border-box', padding:'7px 8px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#e2e8f0', fontSize:12, outline:'none', fontFamily:'inherit', opacity:canEditTimes?1:0.45 }} />
          </label>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <select value={selectedNote?.workStatus || 'workday'} onChange={e=>onStatusChange(selectedDate, e.target.value)} disabled={!hasDailyFolder}
          style={{ padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#e2e8f0', fontSize:12, fontFamily:'inherit', outline:'none', opacity:hasDailyFolder?1:0.45 }}>
          {Object.entries(WORK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button onClick={()=>onSaveRows(selectedDate, draft)} disabled={!canSave}
          style={{ padding:'8px 12px', borderRadius:8, border:'none', cursor:canSave?'pointer':'not-allowed', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(124,58,237,0.2)', color:'#c4b5fd', opacity:canSave?1:0.4 }}>
          Save hours
        </button>
        <div style={{ fontSize:11, color:'#64748b' }}>{stats.creditedDay ? 'Leave days credit 435 minutes automatically.' : 'Breaks subtract from the day total.'}</div>
      </div>
    </section>
  );
}

function ProjectPanel({ projects, selected, selectedId, draft, setDraft, onSelect, onSave, onNewProject, hasProjectsFolder, onConfigure }) {
  if (!hasProjectsFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#475569', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>Configure Projects folder</button>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:'grid', gridTemplateColumns:'minmax(260px, 0.38fr) minmax(420px, 1fr)', minHeight:0, overflow:'hidden' }}>
      <div style={{ borderRight:'1px solid rgba(255,255,255,0.06)', overflowY:'auto', padding:'18px 16px' }}>
        <button onClick={onNewProject} style={{ width:'100%', padding:'9px 12px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', marginBottom:12 }}>+ New Project</button>
        {!projects.length && <div style={{ color:'#475569', textAlign:'center', paddingTop:35, fontSize:12 }}>No project files</div>}
        {projects.map(p => (
          <button key={p.id} onClick={()=>onSelect(p.id)} style={{ width:'100%', textAlign:'left', padding:'11px 12px', marginBottom:6, borderRadius:9, border:`1px solid ${selectedId===p.id?'rgba(124,58,237,0.45)':'rgba(255,255,255,0.05)'}`, background:selectedId===p.id?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', color:'#e2e8f0', cursor:'pointer', fontFamily:'inherit' }}>
            <div style={{ fontSize:13, fontWeight:800, lineHeight:1.3 }}>{p.title}</div>
            <div style={{ fontSize:10, color:'#64748b', marginTop:4 }}>{p.status || p.filename}</div>
          </button>
        ))}
      </div>
      <div style={{ display:'flex', flexDirection:'column', minWidth:0, minHeight:0 }}>
        <div style={{ padding:'20px 28px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', gap:18, alignItems:'flex-start' }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>Projects</div>
            <h2 style={{ margin:0, fontSize:20, color:'#f1f5f9' }}>{selected ? selected.title : 'Select a project'}</h2>
            {selected && <div style={{ fontSize:11, color:'#64748b', marginTop:5 }}>{selected.filename}</div>}
          </div>
          <button onClick={onSave} disabled={!selected} style={{ padding:'9px 18px', borderRadius:10, border:'none', cursor:selected?'pointer':'not-allowed', fontWeight:800, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:selected?1:0.35 }}>Save</button>
        </div>
        {selected ? (
          <textarea value={draft} onChange={e=>setDraft(e.target.value)} spellCheck={false} style={{ flex:1, width:'100%', resize:'none', padding:'18px 22px', background:'rgba(255,255,255,0.025)', border:'none', color:'#e2e8f0', outline:'none', fontFamily:'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize:13, lineHeight:1.65 }}/>
        ) : (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#334155', fontSize:13 }}>Select or create a project</div>
        )}
      </div>
    </div>
  );
}

function PropertyPanel({ properties, selected, selectedId, images, onSelect, comment, setComment, onAddComment, onEditComment, onDeleteComment, onNewProperty, onUploadCover, hasPropertiesFolder, hasAttachmentsFolder, onConfigure }) {
  const coverInputRef = useRef(null);
  const imageFor = p => p?.coverName ? images[p.coverName.toLowerCase()] : null;
  if (!hasPropertiesFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#475569', fontSize:13 }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:10 }}>🏢</div>
          <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>Configure Properties folder</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'20px 28px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center', gap:18 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>Properties</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Property management</h2>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={onNewProperty} style={{ padding:'8px 13px', borderRadius:9, border:'none', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit' }}>
            + New Property
          </button>
          <button onClick={onConfigure} style={{ padding:'8px 13px', borderRadius:9, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color:'#94a3b8', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit' }}>
            {hasAttachmentsFolder ? 'Folders configured' : 'Add Attachments folder'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(280px, 0.45fr) minmax(520px, 1fr)', gap:0 }}>
        <div style={{ overflowY:'auto', padding:'18px 20px', borderRight:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(145px,1fr))', gap:12 }}>
            {properties.map(p => {
              const img = imageFor(p);
              const active = selectedId === p.id;
              return (
                <button key={p.id} onClick={()=>onSelect(p.id)}
                  style={{ textAlign:'left', borderRadius:8, overflow:'hidden', border:`1px solid ${active?'rgba(124,58,237,0.55)':'rgba(255,255,255,0.07)'}`, background:active?'rgba(124,58,237,0.12)':'rgba(255,255,255,0.025)', cursor:'pointer', padding:0, fontFamily:'inherit', color:'#e2e8f0' }}>
                  <div style={{ aspectRatio:'1 / 0.9', background:'rgba(255,255,255,0.035)', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                    {img ? <img src={img} alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }}/> : <span style={{ fontSize:30, color:'#334155' }}>🏢</span>}
                  </div>
                  <div style={{ padding:'9px 10px 10px' }}>
                    <div style={{ fontSize:12, fontWeight:800, lineHeight:1.25, color:'#f1f5f9' }}>{p.title}</div>
                    <div style={{ fontSize:10, color:'#64748b', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.client || p.filename}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ overflowY:'auto', padding:'20px 26px' }}>
          {!selected ? (
            <div style={{ color:'#334155', textAlign:'center', paddingTop:90, fontSize:13 }}>Select a property</div>
          ) : (
            <div>
              <div style={{ height:190, borderRadius:8, overflow:'hidden', marginBottom:16, background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {imageFor(selected)
                  ? <img src={imageFor(selected)} alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }}/>
                  : <span style={{ fontSize:12, color:'#475569', fontWeight:700 }}>No cover</span>}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:10, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{selected.filename}</div>
                  <h2 style={{ margin:0, fontSize:22, lineHeight:1.25, color:'#f1f5f9' }}>{selected.title}</h2>
                  {selected.client && <div style={{ fontSize:12, color:'#94a3b8', marginTop:7 }}>Client: {selected.client}</div>}
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, flexShrink:0 }}>
                  <span style={{ fontSize:10, fontWeight:800, padding:'4px 8px', borderRadius:20, background:'rgba(99,102,241,0.13)', color:'#818cf8' }}>{selected.comments.length} notes</span>
                  <button onClick={()=>hasAttachmentsFolder ? coverInputRef.current?.click() : onConfigure()} style={{ padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color:'#c4b5fd', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit' }}>
                    Upload cover
                  </button>
                  <input ref={coverInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>{ const file = e.target.files?.[0]; if (file) onUploadCover(selected.id, file); e.target.value = ''; }}/>
                </div>
              </div>

              {selected.summary && <p style={{ margin:'0 0 18px', color:'#64748b', fontSize:13, lineHeight:1.55 }}>{selected.summary}</p>}

              <div style={{ display:'flex', gap:8, marginBottom:18 }}>
                <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add a property comment…" rows={6}
                  onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); onAddComment(); }}}
                  style={{ flex:1, minHeight:160, fieldSizing:'content', padding:'10px 12px', borderRadius:10, resize:'vertical', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.09)', color:'#e2e8f0', fontSize:13, lineHeight:1.5, outline:'none', fontFamily:'inherit' }}/>
                <button onClick={onAddComment} disabled={!comment.trim()} style={{ alignSelf:'stretch', padding:'0 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:comment.trim()?1:0.35 }}>Add</button>
              </div>

              {!selected.comments.length && <div style={{ color:'#334155', textAlign:'center', padding:'40px 0', fontSize:13 }}>No property comments yet</div>}
              {selected.comments.map((l, i) => (
                <CommentCard key={`${l.date}-${i}-${l.text}`} log={l} index={i} onSave={onEditComment} onDelete={onDeleteComment} />
              ))}
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
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Project</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Create a project note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#94a3b8' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !form.title.trim()} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:(busy||!form.title.trim())?0.4:1 }}>
            {busy ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Project name">
            <input autoFocus value={form.title} onChange={e=>set('title', e.target.value)} placeholder="e.g. Union Module 4" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>Filename will be <code style={{ color:'#94a3b8' }}>{form.title.trim() ? projectFilename(form.title) : 'Project - <title>.md'}</code></div>
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
            <textarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Project notes, scope, next actions..." rows={8} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
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

  const slug = form.title.trim() ? propertySlug(form.title) : '<property-name>';

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Property</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Create a property note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#94a3b8' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !form.title.trim()} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:(busy||!form.title.trim())?0.4:1, boxShadow:'0 4px 16px rgba(124,58,237,0.4)' }}>
            {busy ? 'Creating...' : 'Create Property'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Property name">
            <input autoFocus value={form.title} onChange={e=>set('title', e.target.value)} placeholder="e.g. 20 Kildare Street" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>Filename will be <code style={{ color:'#94a3b8' }}>{slug}.md</code></div>
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
                <span style={{ color:form.coverFile?'#e2e8f0':'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {form.coverFile ? form.coverFile.name : 'Choose an image...'}
                </span>
                <span style={{ color:'#c4b5fd', fontWeight:800, fontSize:11, flexShrink:0 }}>Browse</span>
                <input type="file" accept="image/*" onChange={e=>set('coverFile', e.target.files?.[0] || null)} style={{ display:'none' }}/>
              </label>
            ) : (
              <button type="button" onClick={onConfigure} style={{ ...inputBase, cursor:'pointer', textAlign:'left', color:'#c4b5fd', fontWeight:700 }}>
                Add Attachments folder to upload covers
              </button>
            )}
          </Field>

          <Field label="Initial notes (optional)">
            <textarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Optional property details..." rows={7} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
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
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Person</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Create a person note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#94a3b8' }}>Cancel</button>
          <button onClick={hasPeopleFolder ? submit : onConfigure} disabled={busy || (hasPeopleFolder && !form.name.trim())} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:(busy || (hasPeopleFolder && !form.name.trim()))?0.4:1 }}>
            {hasPeopleFolder ? (busy ? 'Creating...' : 'Create Person') : 'Configure People Folder'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Person name">
            <input autoFocus value={form.name} onChange={e=>set('name', e.target.value)} placeholder="e.g. Jane Smith" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>Filename will be <code style={{ color:'#94a3b8' }}>{form.name.trim() ? `${safeFilename(form.name)}.md` : '<person-name>.md'}</code></div>
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
            <textarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Relationship notes, preferences, context..." rows={8} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
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
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Task</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Create a task in your Tasks folder</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#94a3b8' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !canCreate} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:(busy||!canCreate)?0.4:1, boxShadow:'0 4px 16px rgba(124,58,237,0.4)' }}>
            {busy ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Quick capture">
            <input value={quickText} onChange={e=>applyQuickCapture(e.target.value)}
              placeholder="e.g. Review lease renewal today #legal !high"
              style={{ ...inputBase, fontSize:14, padding:'10px 14px', border:quickPreview?.dueInvalid?'1px solid rgba(248,113,113,0.45)':inputBase.border }}/>
            {quickPreview && (
              <div style={{ marginTop:7, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                {quickPreview.title && <span style={{ fontSize:10, color:'#94a3b8', padding:'3px 7px', borderRadius:14, background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>title: {quickPreview.title}</span>}
                {quickPreview.due && <span style={{ fontSize:10, color:'#fbbf24', padding:'3px 7px', borderRadius:14, background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.16)' }}>due: {quickPreview.due}</span>}
                <span style={{ fontSize:10, color:'#818cf8', padding:'3px 7px', borderRadius:14, background:'rgba(129,140,248,0.08)', border:'1px solid rgba(129,140,248,0.16)' }}>priority: {quickPreview.priority}</span>
                {quickPreview.extraTags && <span style={{ fontSize:10, color:'#c4b5fd', padding:'3px 7px', borderRadius:14, background:'rgba(124,58,237,0.1)', border:'1px solid rgba(124,58,237,0.18)' }}>tags: {quickPreview.extraTags}</span>}
                {quickPreview.dueInvalid && <span style={{ fontSize:10, color:'#f87171', padding:'3px 7px', borderRadius:14, background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.18)' }}>invalid due date: {quickPreview.dueInvalid}</span>}
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
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>Filename will be <code style={{ color:'#94a3b8' }}>{form.title.trim() ? safeFilename(form.title) : '<title>'}.md</code></div>
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
                <input type="checkbox" checked={form.recurrent} onChange={e=>set('recurrent', e.target.checked)} style={{ accentColor:'#7c3aed' }}/>
                <span style={{ color:'#94a3b8', fontSize:13 }}>Mark as recurrent</span>
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
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>The tag <code style={{ color:'#94a3b8' }}>task</code> is added automatically.</div>
          </Field>

          <Field label="Details / initial log (optional)">
            <textarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Initial task details…" rows={6} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}
