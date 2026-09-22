/**
 * AEGIS Stable ID Registry (Work Package B2)
 * Provides deterministic, stable element identifiers using WeakMap and reverse Map
 * without mutating the DOM or attaching invasive custom attributes.
 */
export declare class StableIdRegistry {
    private elementToId;
    private idToElement;
    private counter;
    /**
     * Resets the reverse lookup registry (e.g., between page navigations).
     */
    reset(): void;
    /**
     * Returns an existing stable ID or generates a new one for the element.
     * If the element has a native id (e.g., "search-input"), assigns "el-search-input".
     * Otherwise assigns "el-{counter}".
     */
    getOrCreateId(element: Element): string;
    /**
     * Looks up an element by its stable ID.
     */
    getElementById(id: string): Element | null;
}
export declare const idRegistry: StableIdRegistry;
//# sourceMappingURL=id-registry.d.ts.map