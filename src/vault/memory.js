// In-memory VaultAdapter: the reference implementation of the handle contract
// (see types.ts) used by the vitest suite. Mirrors FileSystem Access API
// semantics the app relies on, including errors named 'NotFoundError'.

class VaultOpError extends Error {
  constructor(message, name) {
    super(message);
    this.name = name;
  }
}

const notFound = name => new VaultOpError(`Entry not found: ${name}`, 'NotFoundError');
const alreadyExists = name => new VaultOpError(`Entry already exists: ${name}`, 'AlreadyExistsError');

class MemoryFileData {
  constructor(name, data, lastModified, type) {
    this.name = name;
    this.lastModified = lastModified;
    this.type = type || '';
    this._data = data;
    this.size = typeof data === 'string' ? data.length : data.byteLength;
  }
  async text() {
    if (typeof this._data === 'string') return this._data;
    return new TextDecoder().decode(this._data);
  }
  async arrayBuffer() {
    if (typeof this._data === 'string') return new TextEncoder().encode(this._data).buffer;
    return this._data;
  }
}

class MemoryFileHandle {
  constructor(dir, name) {
    this.kind = 'file';
    this.name = name;
    this._dir = dir;
  }
  async getFile() {
    const entry = this._dir._files.get(this.name);
    if (!entry) throw notFound(this.name);
    return new MemoryFileData(this.name, entry.data, entry.lastModified, entry.type);
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async chunk => {
        chunks.push(chunk);
      },
      close: async () => {
        const data = chunks.length === 1 && typeof chunks[0] !== 'string'
          ? await normalizeBinary(chunks[0])
          : chunks.map(c => (typeof c === 'string' ? c : '')).join('');
        this._dir._files.set(this.name, { data, lastModified: Date.now(), type: '' });
        this._dir._adapter?._notify();
      },
    };
  }
}

async function normalizeBinary(chunk) {
  if (chunk instanceof ArrayBuffer) return chunk;
  if (ArrayBuffer.isView(chunk)) return chunk.buffer;
  if (typeof Blob !== 'undefined' && chunk instanceof Blob) return await chunk.arrayBuffer();
  return chunk;
}

export class MemoryDirectoryHandle {
  constructor(name, adapter = null) {
    this.kind = 'directory';
    this.name = name;
    this._files = new Map();
    this._dirs = new Map();
    this._adapter = adapter;
  }
  async *entries() {
    for (const [name, dir] of this._dirs) yield [name, dir];
    for (const [name] of this._files) yield [name, new MemoryFileHandle(this, name)];
  }
  async getFileHandle(name, options = {}) {
    if (!this._files.has(name)) {
      if (!options.create) throw notFound(name);
      this._files.set(name, { data: '', lastModified: Date.now(), type: '' });
      this._adapter?._notify();
    }
    return new MemoryFileHandle(this, name);
  }
  async createFileHandle(name) {
    if (this._files.has(name) || this._dirs.has(name)) throw alreadyExists(name);
    this._files.set(name, { data: '', lastModified: Date.now(), type: '' });
    this._adapter?._notify();
    return new MemoryFileHandle(this, name);
  }
  async getDirectoryHandle(name, options = {}) {
    if (!this._dirs.has(name)) {
      if (!options.create) throw notFound(name);
      const dir = new MemoryDirectoryHandle(name, this._adapter);
      this._dirs.set(name, dir);
      this._adapter?._notify();
    }
    return this._dirs.get(name);
  }
  async removeEntry(name) {
    if (this._files.delete(name) || this._dirs.delete(name)) {
      this._adapter?._notify();
      return;
    }
    throw notFound(name);
  }
  async queryPermission() {
    return 'granted';
  }
  async requestPermission() {
    return 'granted';
  }

  // Test helpers.
  setFile(name, content) {
    this._files.set(name, { data: content, lastModified: Date.now(), type: '' });
    return this;
  }
  makeDir(name) {
    if (!this._dirs.has(name)) this._dirs.set(name, new MemoryDirectoryHandle(name, this._adapter));
    return this._dirs.get(name);
  }
}

export class MemoryVaultAdapter {
  constructor() {
    this._config = {};
    this._listeners = new Set();
  }
  createDirectory(key, name = key) {
    const dir = new MemoryDirectoryHandle(name, this);
    this._config[key] = dir;
    return dir;
  }
  async getDirectories() {
    return { ...this._config };
  }
  async pickDirectory(key) {
    return this._config[key] ?? this.createDirectory(key);
  }
  async clearDirectory(key) {
    delete this._config[key];
  }
  async clearAll() {
    this._config = {};
  }
  onExternalChange(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }
  _notify() {
    for (const cb of this._listeners) cb();
  }
}
