/**
 * AEGIS Stable ID Registry (Work Package B2)
 * Provides deterministic, stable element identifiers using WeakMap and reverse Map
 * without mutating the DOM or attaching invasive custom attributes.
 */
export class StableIdRegistry {
    elementToId = new WeakMap();
    idToElement = new Map();
    counter = 0;
    /**
     * Resets the reverse lookup registry (e.g., between page navigations).
     */
    reset() {
        this.idToElement.clear();
        this.counter = 0;
    }
    /**
     * Returns an existing stable ID or generates a new one for the element.
     * If the element has a native id (e.g., "search-input"), assigns "el-search-input".
     * Otherwise assigns "el-{counter}".
     */
    getOrCreateId(element) {
        const existing = this.elementToId.get(element);
        if (existing) {
            this.idToElement.set(existing, element);
            return existing;
        }
        let candidateId;
        const nativeId = element.id ? element.id.trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '';
        if (nativeId && !this.idToElement.has(`el-${nativeId}`)) {
            candidateId = `el-${nativeId}`;
        }
        else {
            candidateId = `el-${this.counter++}`;
            while (this.idToElement.has(candidateId)) {
                candidateId = `el-${this.counter++}`;
            }
        }
        this.elementToId.set(element, candidateId);
        this.idToElement.set(candidateId, element);
        return candidateId;
    }
    /**
     * Looks up an element by its stable ID.
     */
    getElementById(id) {
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
//# sourceMappingURL=id-registry.js.map