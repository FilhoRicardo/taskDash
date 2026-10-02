import { describe, expect, it } from 'vitest';
import { stopTimerSession, writeFile } from '../App.jsx';

describe('writeFile', () => {
  it('can write a newly created file without reading stale disk state first', async () => {
    const writes = [];
    let closed = false;
    let readBeforeWrite = false;

    const handle = {
      getFile: async () => {
        readBeforeWrite = true;
        return { text: async () => '' };
      },
      createWritable: async (options) => {
        if (readBeforeWrite) {
          throw new Error('An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.');
        }
        if (options?.keepExistingData !== false) {
          throw new Error('Expected full-file replacement mode.');
        }
        return {
          write: async (content) => writes.push(content),
          close: async () => { closed = true; },
        };
      },
    };

    await writeFile(handle, '---\ntitle: New task\n---\n', { backup:false });

    expect(writes).toEqual(['---\ntitle: New task\n---\n']);
    expect(closed).toBe(true);
  });
});

describe('stopTimerSession', () => {
  it('keeps an external tracker row and the timer session when the tracker changes before commit', async () => {
    let content = 'tracker header\n';
    let reads = 0;
    let activeTimer = { taskId: '__adhoc__', start: Date.now() - 60_000 };
    const handle = {
      name: 'timetracker.md',
      getFile: async () => {
        reads += 1;
        if (reads === 2) content += 'EXTERNAL-CONCURRENT-ROW\n';
        return { text: async () => content };
      },
      createWritable: async ({ expectedContent }) => {
        let nextContent;
        return {
        write: async next => { nextContent = next; },
        close: async () => {
          if (expectedContent !== content) {
            const error = new Error('The note changed before TaskDash could save it');
            error.name = 'StaleWriteError';
            throw error;
          }
          content = nextContent;
        },
      };
      },
    };

    const stopped = await stopTimerSession({
      timer: activeTimer,
      trackerHandle: handle,
      setTimer: next => { activeTimer = next; },
      clearActiveTimer: () => { activeTimer = null; },
    });

    expect(stopped).toBe(false);
    expect(content).toContain('EXTERNAL-CONCURRENT-ROW');
    expect(activeTimer).not.toBeNull();
  });
});
