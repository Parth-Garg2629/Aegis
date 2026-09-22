/**
 * AEGIS MV3 Manifest Definition
 * Source of Truth: docs/TECHNICAL_SPEC.md §3, docs/IMPLEMENTATION_PLAN.md SD-07
 */
export declare const APPROVED_PERMISSIONS: readonly ["activeTab", "storage", "offscreen", "scripting"];
export declare function generateManifest(): {
    manifest_version: number;
    name: string;
    version: string;
    description: string;
    permissions: ("activeTab" | "storage" | "offscreen" | "scripting")[];
    background: {
        service_worker: string;
        type: string;
    };
    action: {
        default_popup: string;
        default_title: string;
    };
    content_scripts: {
        matches: string[];
        js: string[];
        run_at: string;
    }[];
    content_security_policy: {
        extension_pages: string;
    };
    web_accessible_resources: {
        resources: string[];
        matches: string[];
    }[];
};
//# sourceMappingURL=manifest.d.ts.map