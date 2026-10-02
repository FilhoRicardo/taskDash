import { describe, expect, it } from 'vitest';
import { buildBatchReschedulePreview, buildBrainDumpPromotion, buildWorkflowQueues } from '../taskWorkflow.js';

const task = (id, overrides = {}) => ({
  id,
  filename: id,
  title: id.replace(/\.md$/, ''),
  status: 'none',
  archived: false,
  recurrent: false,
  tags: ['task'],
  ...overrides,
});

describe('buildWorkflowQueues', () => {
  it('keeps Brain Dump tasks out of every work queue', () => {
    const work = task('Client - Follow up.md', { waitingfor: 'Alex' });
    const brainDump = task('BD - Explore an idea.md', { waitingfor: 'Alex' });
    const recurrent = task('Admin - Weekly review.md', { recurrent: true });
    const completed = task('Prop - Finished.md', { status: 'done' });

    const queues = buildWorkflowQueues([work, brainDump, recurrent, completed]);

    expect(queues.work.map(item => item.id)).toEqual([
      'Client - Follow up.md',
      'Admin - Weekly review.md',
      'Prop - Finished.md',
    ]);
    expect(queues.brainDump.map(item => item.id)).toEqual(['BD - Explore an idea.md']);
    expect(queues.review.map(item => item.id)).toEqual(['Client - Follow up.md']);
    expect(queues.waitingFor.map(item => item.id)).toEqual(['Client - Follow up.md']);
  });
});

describe('buildBatchReschedulePreview', () => {
  it('previews only selected, open work tasks for a valid date', () => {
    const work = task('Client - Follow up.md');
    const brainDump = task('BD - Explore an idea.md');
    const completed = task('Admin - Finished.md', { status: 'done' });

    const preview = buildBatchReschedulePreview(
      [work, brainDump, completed],
      [work.id, brainDump.id, completed.id],
      '2026-09-05',
    );

    expect(preview).toEqual({
      date: '2026-09-05',
      tasks: [{ id: work.id, title: work.title, previousDue: '' }],
    });
    expect(() => buildBatchReschedulePreview([work], [work.id], '05/09/2026')).toThrow('valid date');
  });
});

describe('buildBrainDumpPromotion', () => {
  it('removes the BD identity while preserving the Markdown body', () => {
    const brainDump = task('BD - Explore an idea.md', {
      title:'BD - Explore an idea',
      raw:'---\nstatus: none\ntitle: BD - Explore an idea\n---\n### Task description\nKeep this source context.\n',
    });

    expect(buildBrainDumpPromotion(brainDump)).toEqual({
      title:'Explore an idea',
      filename:'Explore an idea.md',
      content:'---\nstatus: none\ntitle: "Explore an idea"\n---\n### Task description\nKeep this source context.\n',
    });
  });
});
