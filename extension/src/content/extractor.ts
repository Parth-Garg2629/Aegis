import type { BoundingBox, SanitizedElement, SanitizedForm, SanitizedSchema } from '@aegis/protocol';
import { slog } from '@aegis/shared';
import { idRegistry } from './id-registry';
import './executor';
import type { ExtractDomRequestMessage, ExtractDomResponseMessage } from '../background/bus';
import { analyzeDomElement, detectPii } from '@aegis/core';
import type { NormalizedSignal } from '@aegis/core';

const INTERACTIVE_SELECTORS = [
  'input',
  'button',
  'select',
  'textarea',
  'a[href]',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
  'iframe' // Added iframe for iframe policy
].join(', ');

function isElementVisible(el: Element, rect: DOMRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return true;
}

function resolveLabel(el: Element): string | null {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const labelEl = document.getElementById(ariaLabelledBy);
    if (labelEl && labelEl.textContent?.trim()) {
      return labelEl.textContent.trim();
    }
  }

  if (el.id) {
    const labelFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelFor && labelFor.textContent?.trim()) {
      return labelFor.textContent.trim();
    }
  }

  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel.textContent?.trim()) {
    return parentLabel.textContent.trim();
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return placeholder.trim();

  const title = el.getAttribute('title');
  if (title && title.trim()) return title.trim();

  if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el.getAttribute('role') === 'button') {
    const text = el.textContent?.trim();
    if (text) return text.slice(0, 100);
  }

  return null;
}

export function extractDom(): { schema: SanitizedSchema; domSignals: NormalizedSignal[]; piiSignals: NormalizedSignal[] } {
  const rawElements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS));
  const elements: SanitizedElement[] = [];
  const formsMap = new Map<string, { action?: string | null; method?: 'GET' | 'POST'; elementIds: string[] }>();
  
  const domSignals: NormalizedSignal[] = [];
  const piiSignals: NormalizedSignal[] = [];

  for (const el of rawElements) {
    const rect = el.getBoundingClientRect();
    if (!isElementVisible(el, rect)) {
      continue;
    }

    const stableId = idRegistry.getOrCreateId(el);
    const tagName = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    const role = el.getAttribute('role');
    const label = resolveLabel(el);
    const parentForm = el.closest('form');
    let parentFormId: string | null = null;

    if (parentForm) {
      parentFormId = idRegistry.getOrCreateId(parentForm);
      if (!formsMap.has(parentFormId)) {
        formsMap.set(parentFormId, {
          action: parentForm.action || null,
          method: parentForm.method?.toUpperCase() === 'POST' ? 'POST' : 'GET',
          elementIds: [],
        });
      }
      formsMap.get(parentFormId)!.elementIds.push(stableId);
    }

    const boundingBox: BoundingBox = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    const textContent = el.textContent?.trim() || null;
    let value: string | null = null;
    
    // Create an object conforming to what analyzeDomElement expects
    const analysisTarget = {
      id: stableId,
      tagName,
      type,
      name: el.getAttribute('name'),
      autocomplete: el.getAttribute('autocomplete'),
      'aria-label': el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      boundingBox: { x: boundingBox.x, y: boundingBox.y, w: boundingBox.width, h: boundingBox.height }
    };
    
    const signals = analyzeDomElement(analysisTarget);
    domSignals.push(...signals);

    // If it's a password, redact immediately at source
    if (signals.some(s => s.category === 'PASSWORD')) {
       value = '[REDACTED_PASSWORD]';
    } else {
       if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
         value = el.value ? el.value.slice(0, 200) : null;
       } else if (el instanceof HTMLSelectElement) {
         value = el.value || null;
       }
    }

    // Run heuristics on visible text
    if (textContent) {
      const pii = detectPii(textContent);
      for (const p of pii) {
        piiSignals.push({
          signalId: `pii-${stableId}-${Math.random().toString(36).slice(2)}`,
          source: 'HEURISTIC_PII',
          elementId: stableId,
          boundingBox: { x: boundingBox.x, y: boundingBox.y, w: boundingBox.width, h: boundingBox.height },
          category: p.category,
          confidence: p.confidence,
          evidence: p.evidence
        });
      }
    }

    const isInteractive = true;
    const isDisabled = el.hasAttribute('disabled');
    const isReadOnly = el.hasAttribute('readonly');
    
    // Read all attributes for schema
    const attributes: Record<string, string | null> = {};
    for (const attr of el.attributes) {
       attributes[attr.name] = attr.value;
    }

    elements.push({
      id: stableId,
      tagName,
      type: type || null,
      role: role || null,
      label,
      text: textContent?.slice(0, 100) || null,
      value,
      boundingBox,
      isVisible: true,
      isDisabled,
      isReadOnly,
      isInteractive,
      parentFormId,
      attributes
    });
  }

  const forms: SanitizedForm[] = Array.from(formsMap.entries()).map(([id, info]) => ({
    id,
    action: info.action,
    method: info.method,
    elementIds: info.elementIds,
  }));

  const cleanUrl = `${window.location.origin}${window.location.pathname}`;

  return {
    schema: {
      url: cleanUrl,
      title: document.title || '',
      elements,
      forms,
    },
    domSignals,
    piiSignals
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: ExtractDomRequestMessage, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_DOM_REQUEST') {
      try {
        const { schema, domSignals, piiSignals } = extractDom();
        const response: ExtractDomResponseMessage = {
          type: 'EXTRACT_DOM_RESPONSE',
          schema,
          elementsCount: schema.elements.length,
          domSignals,
          piiSignals
        };
        sendResponse(response);
      } catch (err: unknown) {
        slog.error({
          module: 'CONTENT_SCRIPT',
          event: 'EXTRACTION_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
        sendResponse({
          type: 'EXTRACT_DOM_RESPONSE',
          schema: { url: window.location.href, title: document.title, elements: [] },
          elementsCount: 0,
          domSignals: [],
          piiSignals: []
        });
      }
      return true;
    }
    return false;
  });
}
