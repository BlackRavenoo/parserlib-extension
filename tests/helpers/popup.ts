export class Element {
  value = "";
  textContent = "";
  title = "";
  disabled = false;
  hidden = false;
  checked = false;
  indeterminate = false;
  required = false;
  accept = "";
  files: File[] = [];
  children: Element[] = [];
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) };
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: { preventDefault(): void }) => unknown>();
  append(...children: Element[]): void {
    this.children.push(...children);
    if (this.children.length === children.length) this.value = children[0]!.value;
  }
  replaceChildren(): void { this.children = []; this.value = ""; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => unknown): void { this.listeners.set(type, listener); }
  async trigger(type: string): Promise<void> { await this.listeners.get(type)?.({ preventDefault() {} }); }
}

export function popupElements() {
  const elements = Object.fromEntries([
    "settings-form", "format", "branch", "volumes", "volumes-all", "volume-list", "start", "source", "status",
    "range-from", "range-to", "chapter-count", "append-option", "append-enabled", "append-file-row", "append-file",
    "settings-toggle", "preferences", "download-view", "show-metrics", "preferences-status",
  ].map((id) => [id, new Element()]));
  elements.preferences!.hidden = true;
  elements["show-metrics"]!.disabled = true;
  return elements;
}
