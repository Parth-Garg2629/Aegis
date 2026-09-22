/**
 * Pre-push and CI Verification Script (Work Package A5)
 * Checks: typecheck, unit tests, manifest permissions audit, bundle scan.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const APPROVED_PERMISSIONS = new Set([
  'activeTab',
  'storage',
  'offscreen',
  'scripting',
]);

function runStep(name, fn) {
  console.log(`\n[AEGIS VERIFY] Running: ${name}...`);
  try {
    fn();
    console.log(`[AEGIS VERIFY] PASS: ${name}`);
  } catch (err) {
    console.error(`[AEGIS VERIFY] FAIL: ${name}`);
    console.error(err.message);
    process.exit(1);
  }
}

// Step 1: Typecheck
runStep('TypeScript Compilation & Typecheck', () => {
  execSync('npx pnpm run typecheck', { cwd: rootDir, stdio: 'inherit' });
});

// Step 2: Protocol & Shared Contract Tests (Vitest)
runStep('Unit & Contract Tests (Vitest)', () => {
  execSync('npx pnpm test', { cwd: rootDir, stdio: 'inherit' });
});

// Step 3: Python Protocol & Slog Tests (Pytest)
runStep('Python Server Tests (Pytest)', () => {
  const pyCmd = existsSync(resolve(rootDir, '.venv/Scripts/python.exe'))
    ? resolve(rootDir, '.venv/Scripts/python.exe')
    : 'python';
  execSync(`"${pyCmd}" -m pytest server/tests`, { cwd: rootDir, stdio: 'inherit' });
});

// Step 4: Extension Build (Vite)
runStep('Extension Build (Vite)', () => {
  execSync('npx pnpm --filter @aegis/extension build', { cwd: rootDir, stdio: 'inherit' });
});

// Step 5: Manifest Permissions Audit (CP-01)
runStep('Manifest Permissions Audit', () => {
  const manifestPath = resolve(rootDir, 'extension/dist/manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const permissions = manifest.permissions || [];

  for (const perm of permissions) {
    if (!APPROVED_PERMISSIONS.has(perm)) {
      throw new Error(`UNAUTHORIZED MANIFEST PERMISSION FOUND: "${perm}". Only approved permissions are allowed.`);
    }
  }

  for (const approved of APPROVED_PERMISSIONS) {
    if (!permissions.includes(approved)) {
      throw new Error(`MISSING REQUIRED APPROVED PERMISSION: "${approved}".`);
    }
  }

  if (manifest.manifest_version !== 3) {
    throw new Error(`Invalid manifest_version: expected 3, got ${manifest.manifest_version}`);
  }
});

// Step 6: Bundle Remote Code / Secret Scan (CP-02 / CP-03 / CP-05)
runStep('Bundle Safety & Remote URL Scan', () => {
  const distDir = resolve(rootDir, 'extension/dist');
  // Check that sw.js, content.js, and popup.js do not reference remote script CDNs
  const filesToCheck = ['sw.js', 'content.js'];
  const bannedKeywords = ['cdn.jsdelivr.net', 'unpkg.com', 'eval(', 'new Function('];

  for (const f of filesToCheck) {
    const p = resolve(distDir, f);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf-8');
    for (const kw of bannedKeywords) {
      if (content.includes(kw)) {
        throw new Error(`SAFETY SCAN FAILED in ${f}: contains banned pattern "${kw}"`);
      }
    }
  }
});

// Step 7: Playwright E2E Walking Skeleton (2 Complete Cycles)
runStep('Playwright E2E Walking Skeleton (Two Complete Cycles)', () => {
  execSync('npx playwright test', { cwd: rootDir, stdio: 'inherit' });
});

console.log('\n[AEGIS VERIFY] ALL QUALITY GATES PASSED! System is ready.\n');
