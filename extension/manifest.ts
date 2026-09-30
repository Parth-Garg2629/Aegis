export const APPROVED_PERMISSIONS = [
  'activeTab',
  'storage',
  'offscreen',
  'scripting',
  'tabs',
] as const;

export function generateManifest() {
  return {
    manifest_version: 3,
    name: 'AEGIS — Agentic Engine for Guarded Intelligent Surfing',
    version: '1.0.0',
    description: 'On-device visual perception and privacy sanitization for browser agents',
    permissions: [...APPROVED_PERMISSIONS],
    host_permissions: ['https://aegis-api-2jgt.onrender.com/*'],
    background: {
      service_worker: 'sw.js',
      type: 'module',
    },
    action: {
      default_popup: 'popup.html',
      default_title: 'AEGIS Agent',
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    web_accessible_resources: [
      {
        resources: ['assets/*'],
        matches: ['<all_urls>'],
      },
    ],
  };
}
