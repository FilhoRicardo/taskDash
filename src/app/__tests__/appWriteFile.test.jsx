import { describe, expect, it } from 'vitest';
import { writeFile } from '../App.jsx';

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
