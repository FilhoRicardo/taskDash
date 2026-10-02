const HIDDEN_TASK_TAG = 'lifeos';

export function isBrainDumpTask(task) {
  return [task?.title, task?.filename, task?.id]
    .filter(Boolean)
    .some(value => /^BD(?:\s|-)/i.test(String(value).trim()));
}

function isHiddenTask(task) {
  return (task?.tags || []).some(tag => {
    const normalized = String(tag).trim().replace(/^#/, '').toLowerCase().replace(/[\s_-]/g, '');
    return normalized === HIDDEN_TASK_TAG || normalized.startsWith(`${HIDDEN_TASK_TAG}/`);
  });
}

function isOpenTask(task) {
  return !task?.archived && task?.status !== 'done';
}

export function buildWorkflowQueues(tasks) {
  const source = Array.isArray(tasks) ? tasks : [];
  const brainDump = source.filter(isBrainDumpTask);
  const work = source.filter(task => !isBrainDumpTask(task) && !isHiddenTask(task));
  const openWork = work.filter(isOpenTask);

  return {
    work,
    brainDump,
    review: openWork.filter(task => !task.recurrent),
    waitingFor: openWork.filter(task => String(task.waitingfor || '').trim()),
  };
}

export function buildBatchReschedulePreview(tasks, selectedIds, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new Error('Choose a valid date before previewing changes.');
  }

  const selected = new Set(selectedIds || []);
  const { review } = buildWorkflowQueues(tasks);
  return {
    date,
    tasks: review
      .filter(task => selected.has(task.id))
      .map(task => ({ id:task.id, title:task.title, previousDue:task.due || '' })),
  };
}

export function buildBrainDumpPromotion(task) {
  if (!isBrainDumpTask(task)) throw new Error('Only Brain Dump tasks can be promoted.');
  const title = String(task.title || task.filename || task.id || '')
    .replace(/^BD(?:\s*-\s*|\s+)/i, '')
    .trim();
  if (!title) throw new Error('The Brain Dump task needs a title before it can be promoted.');

  const safeName = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 180) || 'Untitled task';
  const raw = String(task.raw || '');
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) throw new Error('The Brain Dump task is missing YAML frontmatter.');

  const nextFrontmatter = /^title:[ \t]*.*$/m.test(frontmatter[1])
    ? frontmatter[1].replace(/^title:[ \t]*.*$/m, `title: ${JSON.stringify(title)}`)
    : `${frontmatter[1]}\ntitle: ${JSON.stringify(title)}`;

  return {
    title,
    filename:`${safeName}.md`,
    content:raw.replace(frontmatter[0], `---\n${nextFrontmatter}\n---`),
  };
}
