// The VaultAdapter seam between the React app and whatever stores the files.
//
// The handle shapes deliberately mirror the subset of the FileSystem Access
// API the app was originally written against (entries/getFileHandle/getFile/
// createWritable/removeEntry, errors named 'NotFoundError'), so the app code
// and its parsers run unchanged on any adapter. The app never touches
// browser file APIs or Obsidian APIs directly — only these interfaces.

export interface VaultFileData {
  readonly name: string;
  readonly size: number;
  readonly lastModified?: number;
  readonly type?: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface VaultWritable {
  write(content: string | ArrayBuffer | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface VaultFileHandle {
  readonly kind: 'file';
  readonly name: string;
  /** Full path within the backing store, when the adapter can expose one. */
  readonly path?: string;
  getFile(): Promise<VaultFileData>;
  createWritable(options?: { keepExistingData?: boolean; expectedContent?: string }): Promise<VaultWritable>;
}

export interface VaultDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  /** Full path within the backing store, when the adapter can expose one. */
  readonly path?: string;
  entries(): AsyncIterableIterator<[string, VaultFileHandle | VaultDirectoryHandle]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<VaultFileHandle>;
  /** Atomically claim a new file; reject if the name already exists. */
  createFileHandle(name: string): Promise<VaultFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<VaultDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission(options?: unknown): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(options?: unknown): Promise<'granted' | 'denied' | 'prompt'>;
}

export type VaultHandle = VaultFileHandle | VaultDirectoryHandle;

export interface VaultAdapter {
  /** Configured folders keyed like the app's FOLDER_DEFS ('tasks', 'done', …). */
  getDirectories(): Promise<Record<string, VaultDirectoryHandle>>;
  /** Open a folder-picking UI for the key, persist the choice, return the handle (null if cancelled). */
  pickDirectory(key: string): Promise<VaultDirectoryHandle | null>;
  /** Forget the configured folder for the key. */
  clearDirectory(key: string): Promise<void>;
  /** Forget all configured folders. */
  clearAll(): Promise<void>;
  /** Subscribe to external file changes under configured folders. Returns unsubscribe. */
  onExternalChange(callback: () => void): () => void;
  /**
   * Optional: move a file (relative to sourceDir) into targetDir under
   * targetName, preserving links when the backing store supports it.
   * Adapters without a native move fall back to the app's copy+delete path.
   */
  moveFile?(
    sourceDir: VaultDirectoryHandle,
    relativePath: string,
    targetDir: VaultDirectoryHandle,
    targetName: string
  ): Promise<void>;
  /** Open a file in the host editor when the backing store supports it. */
  openFile?(file: VaultFileHandle): Promise<void>;
}
