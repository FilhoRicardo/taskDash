// Obsidian UI helpers for choosing vault folders. Kept separate from the
// adapter so obsidian.ts stays free of runtime 'obsidian' imports.

import { AbstractInputSuggest, App, FuzzySuggestModal, TFolder } from 'obsidian';

function allFolders(app: App): TFolder[] {
  return app.vault
    .getAllLoadedFiles()
    .filter((f): f is TFolder => f instanceof TFolder && f.path !== '/')
    .sort((a, b) => a.path.localeCompare(b.path));
}

class FolderPickModal extends FuzzySuggestModal<TFolder> {
  private resolved = false;

  constructor(
    app: App,
    private title: string,
    private onPick: (path: string | null) => void
  ) {
    super(app);
    this.setPlaceholder(title);
  }

  getItems(): TFolder[] {
    return allFolders(this.app);
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.resolved = true;
    this.onPick(folder.path);
  }

  onClose(): void {
    super.onClose();
    // Give onChooseItem (which fires after close) a tick to win.
    window.setTimeout(() => {
      if (!this.resolved) {
        this.resolved = true;
        this.onPick(null);
      }
    }, 0);
  }
}

export function pickVaultFolder(app: App, title = 'Choose a vault folder'): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    new FolderPickModal(app, title, path => {
      if (settled) return;
      settled = true;
      resolve(path);
    }).open();
  });
}

/** Autocomplete for folder paths in the settings tab text inputs. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement,
    private onPick: (path: string) => void
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return allFolders(this.app).filter(f => f.path.toLowerCase().includes(q));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.inputEl.value = folder.path;
    this.onPick(folder.path);
    this.close();
  }
}
