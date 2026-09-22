/**
 * AEGIS DOM Extractor (Work Package B2)
 * Source of Truth: docs/TECHNICAL_SPEC.md §7.2, §7.3, docs/IMPLEMENTATION_PLAN.md B2
 * Extracts interactive elements, computes bounding boxes, resolves accessible labels,
 * and maintains the compile-time privacy boundary at extraction time.
 */
import { slog } from '@aegis/shared';
import { idRegistry } from './id-registry';
import './executor';
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
function isElementVisible(el, rect) {
    if (rect.width <= 0 || rect.height <= 0)
        return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }
    return true;
}
function resolveLabel(el) {
    // 1. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim())
        return ariaLabel.trim();
    // 2. aria-labelledby
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy);
        if (labelEl && labelEl.textContent?.trim()) {
            return labelEl.textContent.trim();
        }
    }
    // 3. Associated <label for="id">
    if (el.id) {
        const labelFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (labelFor && labelFor.textContent?.trim()) {
            return labelFor.textContent.trim();
        }
    }
    // 4. Enclosing <label>
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.textContent?.trim()) {
        return parentLabel.textContent.trim();
    }
    // 5. Placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim())
        return placeholder.trim();
    // 6. Title
    const title = el.getAttribute('title');
    if (title && title.trim())
        return title.trim();
    // 7. Text content for buttons/links
    if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el.getAttribute('role') === 'button') {
        const text = el.textContent?.trim();
        if (text)
            return text.slice(0, 100);
    }
    return null;
}
function isSensitiveField(inputEl) {
    const type = (inputEl.getAttribute('type') || '').toLowerCase();
    if (type === 'password')
        return true;
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
export function extractDom() {
    const rawElements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS));
    const elements = [];
    const formsMap = new Map();
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
        let parentFormId = null;
        if (parentForm) {
            parentFormId = idRegistry.getOrCreateId(parentForm);
            if (!formsMap.has(parentFormId)) {
                formsMap.set(parentFormId, {
                    action: parentForm.action || null,
                    method: parentForm.method?.toUpperCase() === 'POST' ? 'POST' : 'GET',
                    elementIds: [],
                });
            }
            formsMap.get(parentFormId).elementIds.push(stableId);
        }
        let value = null;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            if (isSensitiveField(el)) {
                // Privacy boundary: raw sensitive values must never be extracted or sent to the server
                value = '[REDACTED_PASSWORD]';
            }
            else {
                value = el.value ? el.value.slice(0, 200) : null;
            }
        }
        else if (el instanceof HTMLSelectElement) {
            value = el.value || null;
        }
        const boundingBox = {
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
    const forms = Array.from(formsMap.entries()).map(([id, info]) => ({
        id,
        action: info.action,
        method: info.method,
        elementIds: info.elementIds,
    }));
    // SD-05: Schema URL must be origin + pathname only (strip query params / fragments)
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    return {
        url: cleanUrl,
        title: document.title || '',
        elements,
        forms,
    };
}
// Internal listener for Service Worker extraction requests
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'EXTRACT_DOM_REQUEST') {
            try {
                const schema = extractDom();
                const response = {
                    type: 'EXTRACT_DOM_RESPONSE',
                    schema,
                    elementsCount: schema.elements.length,
                };
                sendResponse(response);
            }
            catch (err) {
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
//# sourceMappingURL=extractor.js.map