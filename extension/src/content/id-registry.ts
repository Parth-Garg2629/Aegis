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

    // Page-authored IDs may embed emails, account numbers, or other user data.
    // Use opaque per-document capabilities instead of forwarding those IDs.
    let candidateId = `el-${this.counter++}`;
    while (this.idToElement.has(candidateId)) {
      candidateId = `el-${this.counter++}`;
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
