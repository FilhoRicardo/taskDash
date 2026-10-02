// Runtime stub for the types-only 'obsidian' npm package, wired via a vitest
// alias. Implements just enough surface for plugin integration tests.

export class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
  async loadData() {
    return this.app.__pluginData ?? null;
  }
  async saveData(data) {
    this.app.__pluginData = data;
  }
  registerView(type, factory) {
    this.app.__viewFactories[type] = factory;
  }
  addRibbonIcon(icon, title, cb) {
    this.app.__ribbon.push({ icon, title, cb });
    return document.createElement('div');
  }
  addCommand(cmd) {
    this.app.__commands.push(cmd);
  }
  addSettingTab(tab) {
    this.app.__settingTab = tab;
  }
  addStatusBarItem() {
    const el = document.createElement('div');
    el.setText = t => {
      el.textContent = t;
    };
    el.addClass = () => {};
    return el;
  }
  register() {}
  registerEvent() {}
}

export function setIcon(element, iconName) {
  element.dataset.icon = iconName;
}

const enhance = el => {
  el.empty = () => {
    el.innerHTML = '';
  };
  el.addClass = cls => el.classList.add(cls);
  el.createDiv = ({ cls } = {}) => {
    const child = document.createElement('div');
    if (cls) child.classList.add(cls);
    el.appendChild(child);
    return child;
  };
  return el;
};

export class ItemView {
  constructor(leaf) {
    this.leaf = leaf;
    this.contentEl = enhance(document.createElement('div'));
    document.body.appendChild(this.contentEl);
  }
}

export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = enhance(document.createElement('div'));
  }
}

export class Setting {
  constructor(containerEl) {
    this.containerEl = containerEl;
  }
  setName(name) { this.name = name; return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addText(build) {
    const setting = this;
    const text = {
      inputEl: document.createElement('input'),
      setPlaceholder() { return text; },
      setValue(value) { text.inputEl.value = value; return text; },
      onChange(callback) {
        setting.containerEl.__settingCallbacks ??= new Map();
        setting.containerEl.__settingCallbacks.set(setting.name, callback);
        return text;
      },
    };
    build(text);
    return this;
  }
  addToggle() { return this; }
}

export class FuzzySuggestModal {
  constructor(app) {
    this.app = app;
  }
  setPlaceholder() {}
  open() {}
  onClose() {}
}

export class AbstractInputSuggest {
  close() {}
}

export class TFolder {}
export class WorkspaceLeaf {}
