export class StableIdRegistry {
  private elementToId = new WeakMap<Element, string>();
  private idToElement = new Map<string, Element>();
  private counter = 0;

  public reset(): void {
    this.idToElement.clear();
    this.counter = 0;
  }

  public getOrCreateId(element: Element): string {
    const existing = this.elementToId.get(element);
    if (existing) {
      this.idToElement.set(existing, element);
      return existing;
    }

    let candidateId: string;
    const nativeId = element.id ? element.id.trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '';
    if (nativeId && !this.idToElement.has(`el-${nativeId}`)) {
      candidateId = `el-${nativeId}`;
    } else {
      candidateId = `el-${this.counter++}`;
      while (this.idToElement.has(candidateId)) {
        candidateId = `el-${this.counter++}`;
      }
    }

    this.elementToId.set(element, candidateId);
    this.idToElement.set(candidateId, element);
    return candidateId;
  }

  public getElementById(id: string): Element | null {
    const el = this.idToElement.get(id);
    if (el && el.isConnected) {
      return el;
    }
    if (el && !el.isConnected) {
      this.idToElement.delete(id);
    }
    return null;
  }
}

export const idRegistry = new StableIdRegistry();
