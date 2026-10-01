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
  '[role="menuitem"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
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

function addPiiSignal(
  piiSignals: NormalizedSignal[],
  elementId: string | null,
  boundingBox: { x: number; y: number; w: number; h: number },
  category: NormalizedSignal['category'],
  evidence: string,
): void {
  piiSignals.push({
    signalId: `pii-${Math.random().toString(36).slice(2)}`,
    source: 'HEURISTIC_PII',
    elementId,
    boundingBox,
    category,
    confidence: 1,
    evidence,
  });
}

function scanVisiblePageText(piiSignals: NormalizedSignal[]): void {
  if (!document.body) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let visited = 0;
  let node: Node | null;
  while ((node = walker.nextNode()) && visited < 5000 && piiSignals.length < 250) {
    visited++;
    const text = node.textContent ?? '';
    if (!text.trim() || text.length > 4000) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,template,input,textarea,select,[contenteditable="true"],[contenteditable=""]')) continue;
    const style = window.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    for (const pii of detectPii(text)) {
      try {
        const range = document.createRange();
        range.setStart(node, pii.span.start);
        range.setEnd(node, pii.span.end);
        const rect = range.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        addPiiSignal(piiSignals, null, {
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.ceil(rect.width), h: Math.ceil(rect.height),
        }, pii.category, pii.evidence);
      } catch {
        // Dynamic pages can invalidate a text range during measurement.
      }
    }
  }
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
          action: parentForm.action ? new URL(parentForm.action).origin : null,
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

    const isEditableValue = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
    let rawValue = '';
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      rawValue = el.value;
    } else if (el instanceof HTMLElement && el.isContentEditable) {
      rawValue = el.innerText;
    }

    // Do not send any filled form value. Mask its pixels in the outgoing image,
    // regardless of the site's field names or autocomplete metadata.
    if (isEditableValue && rawValue) {
      const sensitiveCategory = signals.find(s => s.category !== 'GENERIC_PII')?.category;
      value = sensitiveCategory ? `[REDACTED_${sensitiveCategory}]` : '[REDACTED_FORM_VALUE]';
      addPiiSignal(piiSignals, stableId, { x: boundingBox.x, y: boundingBox.y, w: boundingBox.width, h: boundingBox.height }, sensitiveCategory ?? 'GENERIC_PII', 'nonempty_form_value');
    } else if (signals.some(s => s.category === 'PASSWORD')) {
      value = '[REDACTED_PASSWORD]';
    }

    // Run heuristics on visible text
    if (textContent) {
      const pii = detectPii(textContent);
      for (const p of pii) {
        addPiiSignal(piiSignals, stableId, { x: boundingBox.x, y: boundingBox.y, w: boundingBox.width, h: boundingBox.height }, p.category, p.evidence);
      }
    }

    const isInteractive = true;
    const isDisabled = el.hasAttribute('disabled');
    const isReadOnly = el.hasAttribute('readonly');
    
    // Expose only attributes needed for action planning and risk checks.
    const attributes: Record<string, string | null> = {};
    const allowedAttributes = ['type', 'role', 'autocomplete', 'aria-label', 'placeholder', 'href', 'target', 'download', 'disabled', 'readonly', 'required', 'multiple'];
    for (const name of allowedAttributes) {
      if (!el.hasAttribute(name)) continue;
      if (name === 'href') {
        try { attributes.href = new URL(el.getAttribute('href') || '', window.location.href).origin; }
        catch { /* Omit malformed URLs. */ }
      } else if (name === 'download') {
        attributes.download = '';
      } else {
        attributes[name] = el.getAttribute(name);
      }
    }

    elements.push({
      id: stableId,
      tagName,
      type: type || null,
      role: role || null,
      label,
      text: isEditableValue && rawValue ? value : textContent?.slice(0, 100) || null,
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

  scanVisiblePageText(piiSignals);

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
          success: true,
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
          success: false,
          errorCode: 'DOM_EXTRACTION_FAILED',
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
