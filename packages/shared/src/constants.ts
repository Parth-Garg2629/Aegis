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

export const CONTROL_TOKENS = {
  NEEDS_LOCAL_INPUT: '[NEEDS_LOCAL_INPUT]',
} as const;

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

export const RISK_CATEGORIES = {
  HR_01: 'HR-01',
  HR_02: 'HR-02',
  HR_03: 'HR-03',
  HR_04: 'HR-04',
  HR_05: 'HR-05',
  HR_06: 'HR-06',
  HR_07: 'HR-07',
} as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[keyof typeof RISK_CATEGORIES];

export const ERROR_CODES = {
  E_GEN_01: 'E-GEN-01',
  E_GEN_02: 'E-GEN-02',
  E_GEN_03: 'E-GEN-03',
  E_GEN_04: 'E-GEN-04',
  E_GEN_05: 'E-GEN-05',

  E_DOM_01: 'E-DOM-01',
  E_DOM_02: 'E-DOM-02',
  E_DOM_03: 'E-DOM-03',

  E_SAN_01: 'E-SAN-01',
  E_SAN_02: 'E-SAN-02',
  E_SAN_03: 'E-SAN-03',
  E_SAN_04: 'E-SAN-04',
  E_SAN_05: 'E-SAN-05',

  E_VAL_01: 'E-VAL-01',
  E_VAL_02: 'E-VAL-02',
  E_VAL_03: 'E-VAL-03',

  E_EXEC_01: 'E-EXEC-01',
  E_EXEC_02: 'E-EXEC-02',
  E_EXEC_03: 'E-EXEC-03',
  E_EXEC_04: 'E-EXEC-04',
  E_EXEC_05: 'E-EXEC-05',

  E_SRV_01: 'E-SRV-01',
  E_SRV_02: 'E-SRV-02',
  E_SRV_03: 'E-SRV-03',
  E_SRV_04: 'E-SRV-04',
  E_SRV_05: 'E-SRV-05',
  E_SRV_06: 'E-SRV-06',
  E_SRV_07: 'E-SRV-07',
  E_SRV_08: 'E-SRV-08',

  E_RISK_01: 'E-RISK-01',
  E_RISK_02: 'E-RISK-02',
  E_RISK_03: 'E-RISK-03',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const PROTOCOL_VERSION = '1.0' as const;
export const DEFAULT_MAX_STEPS = 30;
export const DEFAULT_SERVER_ENDPOINT = 'ws://127.0.0.1:8000/ws';
