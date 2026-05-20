export function parseFrontmatter(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const res = {}; let key = null;
  for (const line of m[1].split('\n')) {
    if (/^  - /.test(line)) {
      const v = line.replace(/^  - /, '').trim().replace(/^["']|["']$/g, '');
      if (key && Array.isArray(res[key])) res[key].push(v);
    } else {
      const kv = line.match(/^(\w+):\s*(.*)/);
      if (!kv) continue;
      key = kv[1]; const raw = kv[2].trim();
      if (!raw) res[key] = [];
      else if (raw[0] === '[') res[key] = raw.slice(1,-1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      else res[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
  return res;
}

const wl = s => s ? s.replace(/^\[\[|\]\]$/g, '') : null;
const fileBase = name => name.replace(/\\/g, '/').split('/').pop();
const basename = name => fileBase(name).replace(/\.md$/i, '');
const ignoredName = name => {
  const base = basename(name).trim().toLowerCase();
  return base === 'index' || base.startsWith('_');
};
const isProjectName = name => /^project\b/i.test(basename(name).trim());
const titleFromName = name => basename(name)
  .split('-')
  .filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');
const attachmentName = path => path ? path.replace(/\\/g, '/').split('/').pop() : null;
const normalizeLogDate = rawDate => {
  const iso = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return rawDate;
  const slash = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slash) return null;
  const [, d, m, y] = slash;
  return `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
};

function parseDatedLogs(txt) {
  const logs = [];
  const hRx = /(^|\n)### (?:\[\[)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})(?:\]\])?[ \t]*(?=\n|$)/g;
  const headers = [...txt.matchAll(hRx)].map(m => ({
    date: normalizeLogDate(m[2]),
    start: m.index + m[1].length,
    end: m.index + m[0].length,
  })).filter(h => h.date);
  headers.forEach((h, i) => {
    const section = txt.slice(h.end, headers[i + 1]?.start ?? txt.length);
    const entries = [...section.matchAll(/^Log:\s*/gm)];
    entries.forEach((lm, index) => {
      const next = entries[index + 1]?.index ?? section.length;
      const text = stripTrailingSeparator(section.slice(lm.index + lm[0].length, next)).trim();
      if (text) logs.push({ date: h.date, text, order: logs.length });
    });
  });
  logs.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  logs.forEach(l => { delete l.order; });
  return logs;
}

function stripTrailingSeparator(text) {
  const match = text.match(/\n[ \t]*---[ \t]*(?=\n|$)(?![\s\S]*\n[ \t]*---[ \t]*(?=\n|$))/);
  return match ? text.slice(0, match.index) : text;
}

export function parseTask(name, txt) {
  const fm = parseFrontmatter(txt), title = fm.title || basename(name);
  const cl = [...txt.matchAll(/- \[([ x])\] (.+)/g)].map(m => ({done:m[1]==='x',text:m[2]}));
  const logs = parseDatedLogs(txt);

  const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];

  return {
    id:name, title, filename:basename(name),
    priority:fm.priority||'normal', status:fm.status||'none', due:fm.due||null, scheduled:fm.scheduled||null,
    dateCreated:fm.dateCreated||null, dateModified:fm.dateModified||null,
    contexts:Array.isArray(fm.contexts)?fm.contexts:fm.contexts?[fm.contexts]:[],
    client:wl(fm.client), building:wl(fm.building),
    projects:Array.isArray(fm.projects)?fm.projects.map(wl):fm.projects?[wl(fm.projects)]:[],
    waitingfor:wl(fm.waitingfor),
    tags, archived: tags.includes('archived'),
    recurrent: fm.recurrent === 'true' || fm.Recurrent === 'true' || tags.includes('recurrent') || tags.includes('recurring'),
    recurrence: fm.recurrence || null,
    completeInstances: Array.isArray(fm.complete_instances) ? fm.complete_instances : [],
    skippedInstances: Array.isArray(fm.skipped_instances) ? fm.skipped_instances : [],
    completedDate: fm.completedDate || null,
    checklist:cl, checklistDone:cl.filter(c=>c.done).length, checklistTotal:cl.length,
    logs, raw:txt,
  };
}

export function parseProject(name, txt) {
  const fm = parseFrontmatter(txt);
  const h1 = txt.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
  return {
    id: name,
    filename: basename(name),
    title: fm.title || h1 || titleFromName(name),
    status: fm.status || fm.projectStatus || 'active',
    client: wl(fm.client),
    summary: fm.summary || '',
    tags,
    dateCreated: fm.dateCreated || null,
    dateModified: fm.dateModified || null,
    raw: txt,
  };
}

function sectionBody(txt, headingRx) {
  const match = headingRx.exec(txt);
  if (!match) return '';
  const start = match.index + match[0].length;
  const next = txt.slice(start).search(/\n##\s+/);
  return txt.slice(start, next === -1 ? txt.length : start + next).trim();
}

function bulletLines(txt) {
  return txt
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^-\s+.+/.test(line))
    .map(line => line.replace(/^-\s+/, '').trim());
}

function tableRows(txt) {
  return txt
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\|.*\|$/.test(line))
    .map(line => line.slice(1, -1).split('|').map(cell => cell.trim()))
    .filter(cells => cells.length >= 2 && !/^:?-+:?$/.test(cells[0]) && cells[0].toLowerCase() !== 'time')
    .map(cells => ({ time: cells[0], event: cells[1] }));
}

export function parseDailyNote(name, txt) {
  const fm = parseFrontmatter(txt);
  const h1 = txt.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const timeClock = sectionBody(txt, /(^|\n)##\s+.*Time Clock[ \t]*(?=\n|$)/i);
  const notes = sectionBody(txt, /(^|\n)##\s+.*Notes[ \t]*(?=\n|$)/i);
  const reflections = sectionBody(txt, /(^|\n)##\s+.*Reflections[ \t]*(?=\n|$)/i);
  const brainDump = sectionBody(txt, /(^|\n)##\s+.*Brain dump.*[ \t]*(?=\n|$)/i);
  return {
    id: name,
    filename: basename(name),
    date: fm.date || basename(name),
    workStatus: fm.workStatus || 'workday',
    title: h1 || basename(name),
    timeClock: tableRows(timeClock),
    notes: bulletLines(notes),
    reflections: bulletLines(reflections),
    brainDump: bulletLines(brainDump),
    raw: txt,
  };
}

export function parseProperty(name, txt) {
  const fm = parseFrontmatter(txt);
  const h1 = txt.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const commentsStart = txt.search(/(^|\n)## Property Comments[ \t]*(?=\n|$)/i);
  const commentText = commentsStart === -1 ? '' : txt.slice(commentsStart);
  const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
  const cover = fm.cover || fm.image || null;
  return {
    id: name,
    filename: basename(name),
    title: fm.building || fm.title || h1 || titleFromName(name),
    client: wl(fm.client),
    summary: fm.summary || '',
    cover,
    coverName: attachmentName(cover),
    tags,
    comments: parseDatedLogs(commentText),
    raw: txt,
  };
}

export function parsePerson(name, txt) {
  const fm = parseFrontmatter(txt);
  const h1 = txt.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
  return {
    id: name,
    filename: basename(name),
    title: fm.person || fm.name || fm.title || h1 || titleFromName(name),
    company: wl(fm.company || fm.client),
    role: fm.role || '',
    email: fm.email || '',
    phone: fm.phone || '',
    tags,
    dateCreated: fm.dateCreated || null,
    dateModified: fm.dateModified || null,
    raw: txt,
  };
}

export async function readMdFiles(dir, acc = [], prefix = '') {
  for await (const [name, h] of dir.entries()) {
    try {
      if (ignoredName(name)) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (h.kind==='file' && name.endsWith('.md') && name !== 'timetracker.md')
        acc.push({ name: rel, handle:h, text: await (await h.getFile()).text() });
      else if (h.kind==='directory' && !name.startsWith('.'))
        await readMdFiles(h, acc, rel);
    } catch(e) {
      console.warn(`Skipped unreadable markdown entry: ${name}`, e);
    }
  }
  return acc;
}

// Returns just filenames (without .md extension) for autocomplete sources.
export async function readDirNames(dir, options = {}, acc = []) {
  for await (const [name, h] of dir.entries()) {
    if (ignoredName(name)) continue;
    if (h.kind === 'file' && name.endsWith('.md')) {
      if (!options.projectOnly || isProjectName(name)) acc.push(basename(name));
    }
    else if (h.kind === 'directory' && !name.startsWith('.'))
      await readDirNames(h, options, acc);
  }
  return acc;
}

const IMAGE_RX = /\.(png|jpe?g|gif|webp|avif)$/i;

export async function readImageFiles(dir, acc = []) {
  for await (const [name, h] of dir.entries()) {
    if (ignoredName(name)) continue;
    if (h.kind === 'file' && IMAGE_RX.test(name))
      acc.push({ name, handle: h });
    else if (h.kind === 'directory' && !name.startsWith('.'))
      await readImageFiles(h, acc);
  }
  return acc;
}
