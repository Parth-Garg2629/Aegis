/**
 * AEGIS Shared Constants
 * Source of Truth: docs/API_SPEC.md §4.3, docs/TECHNICAL_SPEC.md §27, docs/BROWSER_AGENT_SPEC.md §7
 */

// Sensitivity Placeholder Vocabulary (API_SPEC §4.3)
export const PLACEHOLDERS = {
  PASSWORD: '[REDACTED_PASSWORD]',
  OTP: '[REDACTED_OTP]',
  AADHAAR: '[REDACTED_AADHAAR]',
  PAN: '[REDACTED_PAN]',
  CARD: '[REDACTED_CARD]',
  EMAIL: '[REDACTED_EMAIL]',
  PHONE: '[REDACTED_PHONE]',
  FACE_REGION: '[REDACTED_FACE_REGION]',
  GENERIC: '[REDACTED]',
  SANITIZATION_ERROR: '[SANITIZATION_ERROR]',
} as const;

export type SensitivityPlaceholder = (typeof PLACEHOLDERS)[keyof typeof PLACEHOLDERS];

// Control Token (BROWSER_AGENT_SPEC §6.3, API_SPEC §4.3)
// NEVER transmitted client-to-server; resolved locally on device.
export const CONTROL_TOKENS = {
  NEEDS_LOCAL_INPUT: '[NEEDS_LOCAL_INPUT]',
} as const;

// Closed Action Vocabulary (TECHNICAL_SPEC §17.2, API_SPEC §8.2)
export const ACTION_TYPES = [
  'click',
  'type',
  'scroll',
  'select',
  'hover',
  'wait',
  'done',
  'fail',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

// High-Risk Categories (BROWSER_AGENT_SPEC §7.3)
export const RISK_CATEGORIES = {
  HR_01: 'HR-01', // Financial transaction / Payment confirmation
  HR_02: 'HR-02', // Irreversible account action (delete/deactivate)
  HR_03: 'HR-03', // Credential / Password modification
  HR_04: 'HR-04', // Form submission with high-sensitivity PII
  HR_05: 'HR-05', // Navigation to unexpected/untrusted external domain
  HR_06: 'HR-06', // High-risk external file download or file upload
  HR_07: 'HR-07', // Repetitive stuck loop or high failure threshold
} as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[keyof typeof RISK_CATEGORIES];

// Error Codes (TECHNICAL_SPEC §27)
export const ERROR_CODES = {
  // General & Lifecycle
  E_GEN_01: 'E-GEN-01', // Unsupported page (chrome://, file://, etc.)
  E_GEN_02: 'E-GEN-02', // Tab closed or unavailable
  E_GEN_03: 'E-GEN-03', // User cancelled execution
  E_GEN_04: 'E-GEN-04', // Maximum steps exceeded (max_steps)
  E_GEN_05: 'E-GEN-05', // Extension context invalidated / updated

  // DOM Extraction
  E_DOM_01: 'E-DOM-01', // DOM extraction failure / parse error
  E_DOM_02: 'E-DOM-02', // Cross-origin iframe inaccessible
  E_DOM_03: 'E-DOM-03', // Bounding box calculation failure

  // Perception & Sanitization
  E_SAN_01: 'E-SAN-01', // Screenshot capture failure
  E_SAN_02: 'E-SAN-02', // Sanitization pipeline internal failure
  E_SAN_03: 'E-SAN-03', // Schema sanitization failure
  E_SAN_04: 'E-SAN-04', // Redaction verification failed (fail-closed)
  E_SAN_05: 'E-SAN-05', // Model inference timeout / offline

  // Action Validation
  E_VAL_01: 'E-VAL-01', // Invalid action schema or target not found
  E_VAL_02: 'E-VAL-02', // Stale action (step_number mismatch)
  E_VAL_03: 'E-VAL-03', // Action parameter out of bounds

  // Action Execution
  E_EXEC_01: 'E-EXEC-01', // Target element not found in live DOM
  E_EXEC_02: 'E-EXEC-02', // Target element disabled / read-only / hidden
  E_EXEC_03: 'E-EXEC-03', // Event dispatch failed
  E_EXEC_04: 'E-EXEC-04', // Scroll execution failed
  E_EXEC_05: 'E-EXEC-05', // Select option not found

  // Server & VLM
  E_SRV_01: 'E-SRV-01', // VLM inference timeout
  E_SRV_02: 'E-SRV-02', // VLM response parse failure
  E_SRV_03: 'E-SRV-03', // VLM model unavailable or crashed
  E_SRV_04: 'E-SRV-04', // Session not found / expired
  E_SRV_05: 'E-SRV-05', // WebSocket protocol error
  E_SRV_06: 'E-SRV-06', // Payload validation failure
  E_SRV_07: 'E-SRV-07', // Payload size exceeded limit
  E_SRV_08: 'E-SRV-08', // Authentication failure

  // Risk & Safety
  E_RISK_01: 'E-RISK-01', // Dangerous payload detected (XSS/eval)
  E_RISK_02: 'E-RISK-02', // High-risk action denied by user
  E_RISK_03: 'E-RISK-03', // High-risk action blocked by risk engine
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// Global Defaults
export const PROTOCOL_VERSION = '1.0' as const;
export const DEFAULT_MAX_STEPS = 30;
export const DEFAULT_SERVER_ENDPOINT = 'ws://127.0.0.1:8000/ws';
