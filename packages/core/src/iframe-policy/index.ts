import type { NormalizedSignal } from '../types';

export type IframePolicy = 'pass' | 'blur';

// Note: SanitizedElement type is in @aegis/protocol, but here we just need something with boundingBox and tagName
export interface MinimalElement {
  id: string;
  tagName: string;
  boundingBox: { x: number; y: number; w: number; h: number };
}

export function getIframeSensitivityRegions(
  elements: MinimalElement[], 
  policy: IframePolicy = 'blur'
): NormalizedSignal[] {
  const signals: NormalizedSignal[] = [];
  
  if (policy === 'pass') {
    return signals;
  }

  for (const el of elements) {
    if (el.tagName && el.tagName.toLowerCase() === 'iframe') {
      if (el.boundingBox && el.boundingBox.w > 0 && el.boundingBox.h > 0) {
        signals.push({
          signalId: `iframe-${el.id || Math.random().toString(36).slice(2)}`,
          source: 'DOM_ANALYSIS', // We treat it as DOM sourced for fusion
          elementId: el.id,
          boundingBox: el.boundingBox,
          category: 'GENERIC_PII',
          confidence: 1.0,
          evidence: 'cross-origin iframe policy: blur'
        });
      }
    }
  }

  return signals;
}
