import type { BoundingBox, SanitizedElement, SanitizedForm, SanitizedSchema } from '@aegis/protocol';
import { slog } from '@aegis/shared';
import { idRegistry } from './id-registry';
import './executor';
import type { ExtractDomRequestMessage, ExtractDomResponseMessage } from '../background/bus';

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

function isSensitiveField(inputEl: HTMLInputElement | HTMLTextAreaElement): boolean {
  const type = (inputEl.getAttribute('type') || '').toLowerCase();
  if (type === 'password') return true;

  const autocomplete = (inputEl.getAttribute('autocomplete') || '').toLowerCase();
  const sensitiveTokens = ['password', 'current-password', 'new-password', 'cc-number', 'cc-csc', 'cc-exp'];
  if (sensitiveTokens.some((token) => autocomplete.includes(token))) {
    return true;
  }

  const name = (inputEl.getAttribute('name') || '').toLowerCase();
  if (['password', 'passwd', 'pin', 'cvv', 'ssn', 'aadhaar'].some((t) => name.includes(t))) {
    return true;
  }

  return false;
}

export function extractDom(): SanitizedSchema {
  const rawElements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS));
  const elements: SanitizedElement[] = [];
  const formsMap = new Map<string, { action?: string | null; method?: 'GET' | 'POST'; elementIds: string[] }>();

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

    let value: string | null = null;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (isSensitiveField(el)) {
        value = '[REDACTED_PASSWORD]';
      } else {
        value = el.value ? el.value.slice(0, 200) : null;
      }
    } else if (el instanceof HTMLSelectElement) {
      value = el.value || null;
    }

    const boundingBox: BoundingBox = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    const isInteractive = true;
    const isDisabled = el.hasAttribute('disabled');
    const isReadOnly = el.hasAttribute('readonly');

    elements.push({
      id: stableId,
      tagName,
      type: type || null,
      role: role || null,
      label,
      text: el.textContent?.trim()?.slice(0, 100) || null,
      value,
      boundingBox,
      isVisible: true,
      isDisabled,
      isReadOnly,
      isInteractive,
      parentFormId,
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
    url: cleanUrl,
    title: document.title || '',
    elements,
    forms,
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: ExtractDomRequestMessage, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_DOM_REQUEST') {
      try {
        const schema = extractDom();
        const response: ExtractDomResponseMessage = {
          type: 'EXTRACT_DOM_RESPONSE',
          schema,
          elementsCount: schema.elements.length,
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
        });
      }
      return true;
    }
    return false;
  });
}
