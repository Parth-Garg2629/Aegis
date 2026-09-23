export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SensitivityCategory =
  | 'FACE'
  | 'PASSWORD'
  | 'OTP'
  | 'AADHAAR'
  | 'PAN'
  | 'CARD_NUMBER'
  | 'EMAIL'
  | 'PHONE'
  | 'GENERIC_PII'
  | 'UI_ELEMENT';

export type SignalSource = 'DOM_ANALYSIS' | 'VISUAL_ML' | 'FACE_DETECTION' | 'HEURISTIC_PII';

export type SanitizationAction =
  | 'BLUR_VISUAL'
  | 'MASK_VISUAL'
  | 'REPLACE_TEXT'
  | 'BLUR_AND_REPLACE';

export interface NormalizedSignal {
  signalId: string;
  source: SignalSource;
  elementId: string | null;
  boundingBox: Rect;
  category: SensitivityCategory;
  confidence: number;
  evidence: string;
}

export interface SensitivityRegion {
  regionId: string;
  boundingBox: Rect;
  elementId: string | null;
  category: SensitivityCategory;
  confidence: number;
  sources: SignalSource[];
  sanitizationAction: SanitizationAction;
  failSafe: boolean;
}

export interface SensitivityMap {
  captureTimestamp: number;
  screenshotDims: { w: number; h: number };
  regions: SensitivityRegion[];
}

export interface DomElementRef {
  elementId: string;
  boundingBox: Rect;
}

export type UIElementClass =
  | 'button'
  | 'input_field'
  | 'text_region'
  | 'link'
  | 'image'
  | 'icon'
  | 'dropdown'
  | 'checkbox'
  | 'radio'
  | 'other_interactive';

export interface VisualSignal {
  boundingBox: Rect;
  label: UIElementClass;
  confidence: number;
  sourceModel: string;
}

export interface FaceSignal {
  boundingBox: Rect;
  confidence: number;
}
