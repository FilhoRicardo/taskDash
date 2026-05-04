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
const basename = name => name.replace(/\.md$/i, '');
const ignoredName = name => {
  const base = basename(name).trim().toLowerCase();
  return base === 'index' || base.startsWith('_');
};
const isProjectName = name => /^project\b/i.test(basename(name).trim());

export function parseTask(name, txt) {
  const fm = parseFrontmatter(txt), title = fm.title || name.replace(/\.md$/, '');
  const cl = [...txt.matchAll(/- \[([ x])\] (.+)/g)].map(m => ({done:m[1]==='x',text:m[2]}));

  const logs = [];
  const sRx = /### \[\[(\d{4}-\d{2}-\d{2})\]\]\n((?:Log: [^\n]*\n?)*)/g;
  let sm;
  while ((sm = sRx.exec(txt)) !== null) {
    [...sm[2].matchAll(/Log: ([^\n]+)/g)].forEach(lm => {
      const text = lm[1].trim();
      if (text) logs.push({ date: sm[1], text });
    });
  }

  const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];

  return {
    id:name, title, filename:name.replace(/\.md$/,''),
    priority:fm.priority||'normal', status:fm.status||'none', due:fm.due||null,
    contexts:Array.isArray(fm.contexts)?fm.contexts:fm.contexts?[fm.contexts]:[],
    client:wl(fm.client), building:wl(fm.building),
    projects:Array.isArray(fm.projects)?fm.projects.map(wl):fm.projects?[wl(fm.projects)]:[],
    waitingfor:wl(fm.waitingfor),
    tags, archived: tags.includes('archived'),
    completedDate: fm.completedDate || null,
    checklist:cl, checklistDone:cl.filter(c=>c.done).length, checklistTotal:cl.length,
    logs, raw:txt,
  };
}

export async function readMdFiles(dir, acc = []) {
  for await (const [name, h] of dir.entries()) {
    if (ignoredName(name)) continue;
    if (h.kind==='file' && name.endsWith('.md') && name !== 'timetracker.md')
      acc.push({ name, handle:h, text: await (await h.getFile()).text() });
    else if (h.kind==='directory' && !name.startsWith('.'))
      await readMdFiles(h, acc);
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
