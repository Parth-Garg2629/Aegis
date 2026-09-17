---
Status: Draft
Project: SIH 2026 — PS 26171
Document: Product Requirements Document
Version: 1.0
Last Updated: 2026-09-17
---

# AEGIS — Product Requirements Document

## 1. Executive Summary

**Product Name:** AEGIS (Agentic Engine for Guarded Intelligent Surfing)

**One-Line Description:** A privacy-preserving browser agent that uses on-device visual perception to understand web pages, sanitize sensitive information locally, and delegate reasoning to a remote VLM — ensuring raw user data never leaves the device.

**Problem Being Solved:** Current AI-powered browser agents require sending raw screenshots or full page content to remote servers for processing. This exposes sensitive user data — passwords, financial details, personal identifiers, faces — to third-party infrastructure. Users who need AI assistance with complex web workflows are forced to choose between utility and privacy.

**Proposed Solution:** A Manifest V3 browser extension that runs a lightweight vision model directly in the browser (via WebGPU/WASM) to perceive and understand the current screen state. Before any data leaves the device, the extension detects and redacts sensitive visual and textual information. Only a sanitized, structured representation of the screen is transmitted to a server-side Vision-Language Model, which reasons about the task and returns actionable browser commands. The extension then executes those commands locally, creating a continuous perception-reasoning-action loop.

**Core Value Proposition:** Users get the full power of a VLM-driven browser agent without ever exposing their raw screen content, PII, or sensitive data to any remote system. Privacy is enforced architecturally, not by policy.

---

## 2. Problem Definition

### 2.1 The Problem Addressed by PS 26171

The problem statement identifies a gap between two realities:

1. **AI browser agents are increasingly capable** — they can automate complex multi-step web workflows such as form filling, navigation, data extraction, and task completion.
2. **These agents require visual context** — understanding what is on screen (layout, elements, text, images) is essential for deciding what action to take next.

The tension arises because obtaining this visual context typically means capturing the user's screen and sending it to a remote server for processing. This creates a direct privacy conflict: the very data the agent needs to be useful often contains the information the user most needs to protect.

### 2.2 Current Limitations of Lightweight Browser Agents

- **No visual understanding:** Most browser extensions operate on DOM text alone and cannot interpret the visual layout, spatial relationships, or rendered appearance of a page the way a human user does.
- **Server-dependent perception:** Agents that do use visual perception (screenshot-based) send raw images to cloud APIs, creating privacy exposure.
- **All-or-nothing data sharing:** There is no intermediate layer that selectively sanitizes what the server sees. Either the server gets everything or nothing.
- **Resource constraints:** Running large vision models in the browser was previously impractical. Recent advances in WebGPU, WASM, and model compression have changed this, but few products exploit these capabilities.

### 2.3 Why Visual Perception Is Important

DOM-only approaches fail in several common scenarios:

- Canvas-rendered content, iframes, and shadow DOM elements are invisible to DOM parsing.
- Visual layout and spatial relationships (e.g., which label belongs to which input field) are lost in raw DOM text.
- Dynamic, JavaScript-heavy pages may not expose meaningful semantic information through DOM alone.
- A visual model can understand a page the way a user sees it, enabling more accurate and robust agent decisions.

### 2.4 Why Privacy Is a Core Requirement

- Web pages routinely display PII: names, addresses, Aadhaar numbers, PAN numbers, phone numbers, email addresses, financial data, and biometric-adjacent information (face photos).
- Password fields, OTP inputs, and authentication tokens are visible on screen during login flows.
- Users interacting with banking, government, healthcare, or enterprise portals have the highest need for AI assistance and the highest sensitivity of displayed data.
- Regulatory frameworks (India's DPDP Act 2023, GDPR) impose strict requirements on how personal data is collected, transmitted, and processed.

### 2.5 Why Existing Approaches Are Insufficient

- **OCR + PII regex:** Detects only text-based PII and misses visual sensitive content (faces, ID card images, QR codes). Regex patterns are brittle and locale-specific.
- **Screenshot-to-cloud-LLM:** Sends raw screenshots to a remote API. Privacy is violated by design regardless of what the LLM does with the data.
- **Basic browser extensions:** Operate on DOM text, cannot perceive visual layout, and offer no privacy-preserving pipeline.
- **Generic PII blurring tools:** Apply blanket redaction without understanding the semantic context of the page, often over-redacting (destroying useful context) or under-redacting (missing novel PII patterns).

---

## 3. Target Users

### 3.1 General Web Users
Users who want AI assistance with routine but tedious web tasks — filling long forms, navigating government portals, comparing products across tabs — without manually sharing their screen with a remote service.

### 3.2 Privacy-Conscious Users
Users who are aware of data privacy risks and actively avoid cloud-based AI tools because of the data exposure involved. They need an agent that provides strong, architecturally-enforced privacy guarantees rather than policy-based promises.

### 3.3 Enterprise and Institutional Users
Organizations (banks, hospitals, government departments) that need browser automation but cannot allow employee screen data to be transmitted to third-party servers due to compliance, regulatory, or internal security policies.

### 3.4 Users on Resource-Constrained Devices
Users with standard laptops or desktops (no dedicated GPU server) who still want AI-powered browser assistance. The on-device perception model must be lightweight enough to run without degrading the browsing experience.

### 3.5 Developers and Researchers
Developers building browser-agent pipelines who need a reference implementation of privacy-preserving visual perception, or researchers studying the trade-offs between on-device inference accuracy and resource consumption.

---

## 4. User Problems & Pain Points

| # | Problem | Impact |
|---|---------|--------|
| P1 | Existing browser agents require sending raw screenshots to remote servers, exposing sensitive information. | Users avoid using AI assistance on sensitive pages (banking, healthcare, government). |
| P2 | Users cannot selectively control what information an AI agent can see. | All-or-nothing data sharing forces users to either trust fully or not use the tool at all. |
| P3 | Complex multi-step web workflows (tax filing, insurance claims, government forms) are tedious and error-prone without assistance. | Users spend excessive time on tasks that an agent could handle in seconds. |
| P4 | Current PII detection is limited to text regex and misses visual sensitive content. | Faces in profile pictures, scanned ID documents, and QR codes are transmitted unredacted. |
| P5 | Browser agents that rely solely on DOM parsing fail on visually complex or dynamically rendered pages. | The agent cannot understand canvas elements, complex CSS layouts, or iframe content, leading to incorrect actions. |
| P6 | Users have no visibility into what data an AI agent is sending to the server. | Lack of transparency erodes trust. |
| P7 | Heavy AI models cannot run on typical user hardware. | Users without powerful GPUs are excluded from on-device AI processing. |

---

## 5. Product Goals

| # | Goal | Measurable Indicator |
|---|------|---------------------|
| G1 | Accurately perceive the visual state of a web page using an on-device model. | Visual context accuracy ≥ threshold defined by evaluation metric (25% weight in SIH scoring). |
| G2 | Detect sensitive/PII content in the visual context with high recall and precision. | Recall and precision for PII detection meet evaluation metric (20% weight). |
| G3 | Redact detected PII before any data leaves the device. | Redaction precision meets evaluation metric (20% weight). Zero raw PII transmitted in test scenarios. |
| G4 | Maintain acceptable client-side resource utilization. | CPU/GPU/memory usage within evaluation metric (20% weight). Browser remains responsive during agent operation. |
| G5 | Achieve practical end-to-end latency for a complete perception-reasoning-action cycle. | Total loop latency meets evaluation metric (15% weight). |
| G6 | Complete a demonstrable end-to-end user task through the agent pipeline. | At least one multi-step task (e.g., form filling) completed autonomously during the SIH demo. |

---

## 6. Non-Goals

The following are explicitly out of scope for the SIH prototype:

| # | Non-Goal | Rationale |
|---|----------|-----------|
| NG1 | Supporting browsers other than Chromium-based (Chrome/Edge). | MV3 is the required extension framework. Firefox MV3 compatibility can be explored post-SIH. |
| NG2 | Replacing the server-side VLM with a fully on-device reasoning model. | Current on-device models lack the reasoning capability needed for complex multi-step task planning. The architecture intentionally splits perception (local) from reasoning (remote). |
| NG3 | Handling non-browser applications (desktop apps, mobile apps). | The problem statement specifically targets browser-based visual perception. |
| NG4 | Providing a production-grade, enterprise-ready deployment. | The SIH submission is a working prototype, not a production system. |
| NG5 | Training custom ML models from scratch. | The prototype will use existing pre-trained or fine-tuned open-weight models. |
| NG6 | Guaranteeing 100% PII detection or zero false positives. | No PII detection system achieves perfection. The goal is to maximize recall and precision within practical constraints. |
| NG7 | Implementing cryptographic capability tokens for action validation. | Documented as a v2 roadmap item. The SIH prototype uses a rule-based, closed-vocabulary safety check. |
| NG8 | Supporting multi-tab or multi-window agent workflows. | The agent operates on the active tab only. |

---

## 7. Product Vision

Beyond the SIH prototype, AEGIS aims to become a general-purpose, privacy-preserving browser-agent framework where:

- Any web task a human can perform visually can be delegated to the agent with confidence that sensitive data stays local.
- The on-device perception layer evolves to support richer understanding — full OCR, document layout analysis, visual question answering — without increasing the data sent to remote systems.
- The action-validation layer graduates from a static rule-based check to a cryptographically-enforced capability-token system, making it tamper-resistant.
- The architecture is model-agnostic: users or organizations can swap the server-side VLM without modifying the client, and improved local models can progressively reduce dependency on remote reasoning.
- An ecosystem of task-specific agent profiles (form-filler, data extractor, accessibility assistant) can be built on top of the core perception-sanitization-reasoning pipeline.

This vision guides architectural decisions in the prototype but does not create requirements for the SIH submission.

---

## 8. Core Product Concept

AEGIS operates as a continuous loop of six stages:

```
User states a goal
       ↓
[1] CAPTURE — The extension observes the active tab. When a meaningful change
    occurs (page load, form render, navigation), it captures the visual state
    (screenshot) and the structural state (DOM snapshot).
       ↓
[2] PERCEIVE & DETECT — A lightweight on-device vision model analyzes the
    captured state. It identifies UI elements, text regions, and — critically —
    sensitive content: faces, password fields, PII patterns (Aadhaar, PAN,
    card numbers), personal photos, QR codes.
       ↓
[3] SANITIZE & TRANSMIT — Detected sensitive regions are redacted locally
    (blurred, masked, or semantically generalized). A structured, sanitized
    representation of the page — containing layout, element types, non-sensitive
    text, and redaction markers — is sent to the server. No raw screenshot or
    raw PII crosses the network boundary.
       ↓
[4] REASON — The server-side VLM receives the sanitized context along with the
    user's goal. It reasons about the current state and determines the single
    next action required (e.g., "click the Submit button", "type 'Delhi' in the
    destination field").
       ↓
[5] VALIDATE — Back on the device, the proposed action is checked against a
    safety schema. Routine actions (scroll, click navigation links) proceed
    automatically. High-risk actions (submitting a payment, deleting data) pause
    and require explicit user confirmation.
       ↓
[6] EXECUTE — The extension performs the validated action on the real,
    unredacted page. The page state changes, the MutationObserver detects the
    change, and the loop returns to Step 1.
```

This loop repeats until the task is complete, the user cancels, or the agent determines it cannot proceed.

---

## 9. Core Features

### 9.1 MVP / SIH Demonstration Scope

| ID | Feature | Description |
|----|---------|-------------|
| F1 | **Screen State Capture** | Capture the visual screenshot and DOM structure of the active tab when meaningful changes occur. |
| F2 | **On-Device Visual Perception** | Run a lightweight vision model (ViT/YOLO-class) in the browser via WebGPU/WASM to understand UI elements and screen layout. |
| F3 | **Sensitive Information Detection** | Detect faces, password fields, and common PII patterns (Aadhaar, PAN, credit card numbers, email addresses, phone numbers) in the captured state. |
| F4 | **Local Redaction/Sanitization** | Blur, mask, or generalize detected sensitive regions before any data leaves the device. Generate a sanitized structured representation. |
| F5 | **Sanitized Context Transmission** | Send only the sanitized page representation to the server via WebSocket. |
| F6 | **Server-Side VLM Reasoning** | The server-side VLM interprets the sanitized context and the user's goal, then returns a structured action command. |
| F7 | **Action Safety Validation** | Validate the VLM's proposed action against a closed-vocabulary action schema. Flag high-risk actions for user confirmation. |
| F8 | **Browser Action Execution** | Execute validated actions (click, type, scroll, select) on the real page via content script DOM APIs. |
| F9 | **Goal Input UI** | A simple extension popup where the user types their goal and monitors agent progress. |
| F10 | **Perception-Action Loop** | Continuously cycle through capture → perceive → sanitize → reason → validate → execute until the task completes. |

### 9.2 Future Scope (Post-SIH)

| ID | Feature | Description |
|----|---------|-------------|
| F11 | Cryptographic capability tokens for action validation. |
| F12 | Full OCR and document layout analysis on-device. |
| F13 | Multi-tab awareness and cross-tab workflows. |
| F14 | Configurable privacy policies (user-defined redaction rules). |
| F15 | Agent action audit log with visual replay. |
| F16 | Firefox and Safari extension support. |
| F17 | Adaptive model selection based on device capability. |

---

## 10. Key User Flows

### Flow A: Normal Browser-Agent Interaction

1. User opens a web page and activates the AEGIS extension.
2. User types a goal into the popup (e.g., "Fill out this application form with my saved details").
3. The extension captures the current screen state.
4. The on-device model perceives the page layout and UI elements.
5. No sensitive information is detected on this particular page.
6. The full structured context is sent to the server.
7. The server VLM determines the next action: "Click the 'Start Application' button."
8. The action passes the safety check (low-risk click).
9. The extension clicks the button. The page navigates.
10. The loop restarts on the new page.

### Flow B: Page Containing Sensitive Information

1. The agent navigates to a page displaying the user's Aadhaar number, a profile photo, and a bank account field.
2. The on-device model detects: face region, Aadhaar number pattern, bank account number pattern.
3. The extension blurs the face, replaces the Aadhaar number with `[REDACTED_ID]`, and masks the bank account number.
4. The sanitized context is sent to the server. The VLM sees `[REDACTED_ID]` where the Aadhaar was and a blurred region where the face was.
5. The VLM can still reason about the page structure (e.g., "The Aadhaar field is pre-filled, proceed to the next section") without seeing the actual data.
6. The agent continues.

### Flow C: Agent Requiring Visual Understanding

1. The agent reaches a page with a CAPTCHA, a complex CSS-rendered chart, or a canvas-based UI element that is invisible in the DOM.
2. The on-device vision model perceives the visual layout and identifies the interactive elements.
3. The sanitized visual context (with sensitive parts redacted) is sent to the server.
4. The VLM interprets the visual context and decides the next action.
5. If the VLM cannot determine the action with sufficient confidence, it returns an uncertainty signal rather than a guess.

### Flow D: User Approval Required

1. The VLM returns an action: "Click the 'Confirm Payment' button."
2. The action validator flags this as a high-risk action (matches the "payment/submit" risk category).
3. The extension pauses and shows a confirmation dialog to the user: "The agent wants to confirm a payment. Allow?"
4. The user reviews and either approves (action executes) or denies (agent stops or re-plans).

### Flow E: Failure or Uncertainty

1. The VLM returns an action referencing a UI element that does not exist on the current page (hallucination).
2. The content script fails to locate the target element.
3. The extension reports the failure back to the server with an updated screen capture.
4. The VLM re-evaluates and either proposes a corrected action or signals that it cannot proceed.
5. After a configurable number of consecutive failures, the agent pauses and informs the user.

---

## 11. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | The extension SHALL capture the visible area of the active tab as a screenshot when a meaningful DOM change is detected. | MVP |
| FR-02 | The extension SHALL extract a structured DOM representation of the active tab including element types, positions, text content, and interactive state. | MVP |
| FR-03 | DOM change detection SHALL be debounced to avoid excessive captures (target: ~200ms debounce interval). | MVP |
| FR-04 | The extension SHALL run a lightweight vision model on-device using WebGPU (with WASM fallback) to analyze the captured screenshot. | MVP |
| FR-05 | The on-device model SHALL detect and localize UI elements (buttons, input fields, links, images, text regions) in the screenshot. | MVP |
| FR-06 | The on-device model SHALL detect faces in the screenshot. | MVP |
| FR-07 | The extension SHALL detect common PII patterns in text content: Aadhaar numbers, PAN numbers, credit/debit card numbers, email addresses, phone numbers. | MVP |
| FR-08 | The extension SHALL detect password and OTP input fields regardless of their rendered visual style. | MVP |
| FR-09 | The extension SHALL redact detected sensitive regions by applying visual obfuscation (blur, black-box) to the screenshot before transmission. | MVP |
| FR-10 | The extension SHALL replace detected PII text with typed placeholders (e.g., `[REDACTED_AADHAAR]`, `[REDACTED_EMAIL]`) in the structured DOM representation. | MVP |
| FR-11 | The extension SHALL transmit only the sanitized screenshot and sanitized DOM representation to the server. | MVP |
| FR-12 | Communication between the extension and server SHALL use a persistent bidirectional WebSocket connection. | MVP |
| FR-13 | The server SHALL receive the sanitized context and the user's stated goal, and pass them to a VLM for reasoning. | MVP |
| FR-14 | The VLM SHALL return a structured action command specifying: action type, target element identifier, and any required input value. | MVP |
| FR-15 | The action command format SHALL conform to a closed-vocabulary schema (allowed actions: click, type, scroll, select, hover, wait, done, fail). | MVP |
| FR-16 | The extension SHALL validate received action commands against the closed-vocabulary schema before execution. | MVP |
| FR-17 | Actions classified as high-risk (payment submission, account deletion, form submission containing financial data) SHALL require explicit user confirmation before execution. | MVP |
| FR-18 | The extension SHALL execute validated actions on the real, unredacted page using content script DOM APIs. | MVP |
| FR-19 | After action execution, the extension SHALL re-enter the capture-perceive-sanitize-reason-validate-execute loop. | MVP |
| FR-20 | The extension SHALL provide a popup UI where the user can input a goal, view agent status, and cancel the agent. | MVP |
| FR-21 | The agent loop SHALL terminate when the VLM returns a "done" signal, the user cancels, or a maximum step count is reached. | MVP |
| FR-22 | The extension SHALL handle action execution failures (element not found, element not interactable) by reporting the failure to the server for re-evaluation. | MVP |
| FR-23 | The server SHALL support both local model inference (via Ollama or equivalent) and cloud-hosted API inference for the VLM, selectable via configuration. | MVP |

---

## 12. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-01 | **Privacy** | Raw screenshots SHALL NOT be transmitted off-device under any circumstance. |
| NFR-02 | **Privacy** | All PII detection and redaction SHALL occur on-device before network transmission. |
| NFR-03 | **Security** | The WebSocket connection between client and server SHALL use WSS (WebSocket Secure) in any non-localhost deployment. |
| NFR-04 | **Security** | The extension SHALL follow Manifest V3 security constraints including the prohibition of remote code execution and adherence to Content Security Policy. |
| NFR-05 | **Latency** | The full perception-reasoning-action loop SHOULD complete within a timeframe that enables practical task completion (proposed target: < 5 seconds per step for the SIH demo). |
| NFR-06 | **Resource Usage** | On-device ML inference SHALL NOT cause the browser tab to become unresponsive or crash on a machine with 8GB RAM and no dedicated GPU. |
| NFR-07 | **Resource Usage** | The extension's idle memory footprint (no active task) SHOULD remain under 100MB. |
| NFR-08 | **Reliability** | The agent SHALL degrade gracefully when the server is unreachable (inform the user, do not crash). |
| NFR-09 | **Reliability** | The agent SHALL not enter an infinite loop. A maximum step count SHALL be enforced. |
| NFR-10 | **Compatibility** | The extension SHALL function on Chrome 116+ and Edge 116+ (WebGPU support baseline). |
| NFR-11 | **Maintainability** | Client and server components SHALL be independently deployable and versioned. |
| NFR-12 | **Transparency** | The extension SHOULD display to the user what data is being sent to the server (e.g., a preview of the sanitized context). |
| NFR-13 | **Scalability** | The server architecture SHALL support swapping the VLM model without modifying the client extension. |

---

## 13. Privacy Requirements

| ID | Requirement |
|----|-------------|
| PV-01 | Raw screenshots captured by `chrome.tabs.captureVisibleTab` SHALL remain in the extension's local memory and SHALL NOT be transmitted, stored persistently, or made accessible to web page scripts. |
| PV-02 | Detected PII (text patterns, face regions, sensitive form field values) SHALL be redacted on-device before the sanitized representation is constructed. |
| PV-03 | The sanitized representation sent to the server SHALL contain only: redacted/blurred visual regions, structural layout information, non-sensitive text, element type/position data, and typed redaction placeholders. |
| PV-04 | The server SHALL NOT request, and the client SHALL NOT provide, raw unredacted data at any point in the protocol. |
| PV-05 | The user SHALL be able to view what sanitized data is being sent to the server before transmission begins (transparency requirement). |
| PV-06 | No user data (raw or sanitized) SHALL be persisted on the server beyond the duration of the active WebSocket session, unless explicitly configured otherwise. |
| PV-07 | The extension SHALL NOT collect or transmit browsing history, cookies, authentication tokens, or any data beyond the sanitized representation of the currently active tab. |
| PV-08 | If the on-device model's confidence in PII detection is below a configurable threshold for a given region, the system SHOULD err on the side of redacting that region (fail-safe). |

---

## 14. Security Requirements

| ID | Requirement |
|----|-------------|
| SE-01 | The extension SHALL adhere to Manifest V3 security requirements, including minimal permissions, no `eval()`, and strict Content Security Policy. |
| SE-02 | The extension SHALL request only the permissions necessary for its operation: `activeTab`, `scripting`, `storage`, `tabs`. |
| SE-03 | The content script SHALL be isolated from the web page's JavaScript context to prevent page scripts from accessing captured data or influencing agent actions. |
| SE-04 | The WebSocket connection SHALL authenticate the client to the server to prevent unauthorized agents from sending commands. (Implementation details deferred to SECURITY_PRIVACY.md.) |
| SE-05 | Action commands received from the server SHALL be validated against the closed-vocabulary schema before execution. Malformed or out-of-schema commands SHALL be rejected. |
| SE-06 | The extension SHALL NOT execute any action that navigates to a URL not already present in the user's current browsing context, unless the user explicitly approves. |
| SE-07 | API keys or authentication credentials for cloud-hosted VLM services SHALL NOT be embedded in the extension's client-side code. They SHALL reside on the server only. |

---

## 15. Performance Requirements

> [!NOTE]
> Where exact numerical targets cannot be derived from the problem statement, values are marked as **proposed engineering targets** to be validated during development.

| ID | Metric | Target | Basis |
|----|--------|--------|-------|
| PF-01 | On-device perception latency (capture + model inference + redaction) | < 2 seconds (proposed) | Derived from the need to keep total loop latency practical. |
| PF-02 | Server VLM reasoning latency (receive sanitized context → return action) | < 3 seconds (proposed) | Dependent on VLM model size and hosting. Cloud-hosted API should meet this. |
| PF-03 | Total end-to-end loop latency (one complete cycle) | < 5 seconds (proposed) | 15% of SIH evaluation is on overall latency. |
| PF-04 | Extension active memory usage (during inference) | < 500MB (proposed) | Must remain usable on 8GB RAM machines alongside normal browsing. |
| PF-05 | Extension idle memory usage | < 100MB (proposed) | Should not noticeably impact browser performance when not actively running a task. |
| PF-06 | CPU usage during inference | Should not freeze or significantly stutter the browser UI. | Qualitative target — quantify during testing. |
| PF-07 | Network payload per cycle | Minimize. Sanitized schema + compressed redacted image. | Smaller payloads improve latency and reduce bandwidth. |
| PF-08 | MutationObserver debounce interval | ~200ms | Balances responsiveness with resource efficiency. |

---

## 16. AI/ML Product Requirements

### 16.1 Visual Understanding
- The on-device model SHALL identify the visual layout of the page: distinct regions, element boundaries, spatial relationships.
- The model SHALL distinguish between interactive elements (buttons, links, inputs, dropdowns) and static content (text blocks, images, decorative elements).

### 16.2 UI Element Detection
- The model SHALL detect and classify common web UI elements: buttons, text inputs, password fields, checkboxes, radio buttons, dropdowns, links, images, and text blocks.
- Detection SHALL include bounding box coordinates for each identified element.

### 16.3 Text and Semantic Understanding
- The model SHALL be capable of recognizing text rendered in the screenshot (OCR-level capability for PII detection purposes).
- The model SHOULD understand the semantic role of detected text (e.g., distinguishing a label from a value, a heading from body text).

### 16.4 Sensitive Information Detection
- The model (in combination with heuristic rules) SHALL detect:
  - Human faces
  - Password and OTP input fields
  - Indian identity numbers (Aadhaar: 12-digit pattern, PAN: alphanumeric pattern)
  - Credit/debit card numbers (13–19 digit patterns with Luhn validation)
  - Email addresses
  - Phone numbers (Indian and common international formats)
- Detection recall is critical: missing a sensitive element is worse than a false positive (which merely over-redacts).

### 16.5 Context Extraction
- The perception pipeline SHALL produce a structured output (JSON schema) containing: element types, positions, non-sensitive text content, redaction markers, and spatial layout information.
- This schema SHALL be interpretable by the server-side VLM without access to the raw screenshot.

### 16.6 Confidence and Uncertainty
- The model SHOULD provide a confidence score for PII detections.
- Regions with low confidence but potential sensitivity SHOULD be redacted by default (fail-safe principle per PV-08).

### 16.7 Local Inference Constraints
- The model(s) SHALL run within the browser environment via WebGPU or WASM.
- Model size SHALL be small enough to load and initialize within a reasonable time (proposed: < 10 seconds cold start, < 2 seconds warm inference).
- The model format SHALL be compatible with Transformers.js, ONNX Runtime Web, or MediaPipe.

---

## 17. Browser-Agent Requirements

| ID | Requirement |
|----|-------------|
| BA-01 | The agent SHALL perceive the current state of the active browser tab through both visual (screenshot) and structural (DOM) channels. |
| BA-02 | The agent SHALL be capable of executing the following browser actions: click, type text, scroll (up/down), select dropdown option, hover. |
| BA-03 | The agent SHALL operate on one action per loop cycle — it does not batch multiple actions. |
| BA-04 | The agent SHALL handle navigation events (page loads, redirects) by re-entering the perception loop on the new page. |
| BA-05 | The agent SHALL NOT interact with browser-level UI (address bar, bookmarks, settings, other tabs) — only with in-page elements. |
| BA-06 | The agent SHALL NOT inject or execute arbitrary JavaScript on the page beyond the predefined action set. |
| BA-07 | The agent SHALL track its progress toward the stated goal and signal completion when the goal appears achieved. |
| BA-08 | The agent SHALL detect when it is stuck (repeated identical states, repeated failures) and either re-plan or inform the user. |

---

## 18. Human-in-the-Loop Requirements

| ID | Requirement |
|----|-------------|
| HL-01 | The user SHALL initiate the agent by stating a goal. The agent SHALL NOT act without a user-provided goal. |
| HL-02 | The user SHALL be able to cancel the agent at any time, immediately stopping the current action loop. |
| HL-03 | High-risk actions (as defined by the action safety schema) SHALL pause and present a confirmation dialog to the user before execution. |
| HL-04 | The user SHOULD be able to view a summary of each action the agent is about to take (transparency). |
| HL-05 | If the agent encounters an unrecoverable error or exceeds the maximum step count, it SHALL inform the user and stop. |
| HL-06 | The user SHOULD be able to provide corrective feedback if the agent takes a wrong action (e.g., "go back" or "try the other button"). |

---

## 19. Error & Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| **Poor visual quality** (very small text, unusual fonts, extreme zoom) | The perception model may produce lower-confidence detections. Low-confidence PII detections are still redacted (fail-safe). The VLM is informed of low-confidence regions. |
| **Unsupported page type** (PDF viewer, browser-internal pages like `chrome://settings`) | The extension detects that the page is not a standard web page and informs the user that the agent cannot operate on this page. |
| **Highly dynamic page** (real-time feeds, animations, auto-refreshing content) | The debounced MutationObserver prevents excessive captures. If the page state is unstable, the agent may wait for stability before acting. |
| **Hidden or overlapping elements** | The visual perception model sees the page as rendered. If an element is visually obscured, it may not be detected. The agent reports failure if it cannot interact with the target element. |
| **Low-confidence perception** | The sanitization layer errs on the side of redaction. The VLM receives explicit markers indicating low-confidence regions. |
| **False positive PII detection** (non-sensitive content redacted) | Over-redaction reduces the context available to the VLM but does not compromise privacy. The VLM works with the available context or asks for clarification. |
| **False negative PII detection** (sensitive content not redacted) | This is the primary risk. Mitigation: combine ML detection with rule-based heuristics and DOM-tag analysis for defense in depth. |
| **Network unavailable** | The extension informs the user that it cannot reach the server. On-device perception and redaction still function; only reasoning is unavailable. |
| **VLM unavailable or returns an error** | The extension informs the user that the AI reasoning service is temporarily unavailable. The agent pauses. |
| **VLM hallucination** (references a non-existent element) | The content script fails to find the target element, reports the failure, and the VLM receives an updated screen state for re-evaluation. |
| **Agent attempts an unsafe action** | The action safety validator blocks it. If it matches a high-risk category, the user is asked. If it is out-of-schema, it is rejected silently. |
| **Infinite loop** (agent keeps repeating the same action) | Repeated-state detection triggers after N consecutive identical states. The agent pauses and informs the user. |

---

## 20. MVP Definition

The Minimum Viable Product is the smallest complete system that demonstrates the core value proposition of PS 26171:

1. A Manifest V3 browser extension that captures the active tab's visual and DOM state.
2. An on-device vision model that detects at least: faces, password fields, and one category of Indian PII (Aadhaar or PAN patterns).
3. Local redaction that blurs/masks detected sensitive regions before transmission.
4. A WebSocket connection that sends only the sanitized representation to a server.
5. A server-side VLM (local via Ollama or cloud-hosted API) that interprets the sanitized context and returns a structured action command.
6. Client-side execution of the returned action on the real page.
7. The loop completes at least 3 consecutive cycles, demonstrating the agent navigating a multi-step task.

---

## 21. SIH Demo Scope

The SIH demonstration should present a compelling, end-to-end workflow that directly addresses all five evaluation criteria:

**Proposed Demo Scenario:** The agent assists the user in completing a multi-step form on a mock web page (e.g., a simulated government service portal or banking application form) that contains pre-filled sensitive information (a profile photo/face, an Aadhaar number, a PAN number, and a phone number).

**Demo Flow:**
1. Show the page with visible PII.
2. Activate the agent with a goal (e.g., "Complete this application form").
3. Show the on-device perception detecting PII (highlight bounding boxes).
4. Show the redacted/sanitized version that is sent to the server (blurred face, masked numbers).
5. Show the VLM receiving the sanitized context and deciding the next action.
6. Show the action being executed on the real page.
7. Show the loop continuing for multiple steps until the form is submitted.
8. Show the user-confirmation dialog triggering on the final "Submit" action.

**What the demo must prove to judges:**
- Visual context is accurately captured (25%).
- PII is detected with high recall and precision (20%).
- Redaction is precise — sensitive data is hidden, non-sensitive data is preserved (20%).
- The browser remains responsive throughout — no crashes, no excessive CPU/memory (20%).
- The full loop runs at practical speed (15%).

---

## 22. Future Scope

| Item | Description |
|------|-------------|
| Cryptographic capability tokens | Replace the rule-based action safety check with cryptographically signed, tamper-proof permission tokens. |
| Expanded PII categories | Support for international ID formats, vehicle registration numbers, medical record numbers, biometric data beyond faces. |
| Full on-device OCR | Deeper text extraction and understanding without any server dependency. |
| Multi-tab and cross-tab workflows | Agent can coordinate actions across multiple open tabs. |
| Custom privacy policies | Users or organizations define what constitutes "sensitive" for their specific context. |
| Action audit trail | A detailed, reviewable log of every action the agent took, with visual snapshots of the sanitized state at each step. |
| Federated model updates | Improve PII detection models using federated learning without collecting raw user data. |
| Accessibility integration | Use visual perception to assist users with disabilities in navigating complex web interfaces. |
| Firefox and Safari support | Extend MV3 compatibility to other major browsers. |

---

## 23. Success Criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| SC-01 | The agent correctly captures and represents the visual state of test pages. | Evaluated against SIH metric 1 (25%): accuracy of visual context from screen. |
| SC-02 | The PII detection system achieves high recall (few missed PII instances) and high precision (few false alarms) on test pages containing known PII. | Evaluated against SIH metric 2 (20%): recall and precision for PII detection. |
| SC-03 | Redacted outputs contain no recoverable PII in the sensitive regions. Non-sensitive context is preserved. | Evaluated against SIH metric 3 (20%): precision of redaction. |
| SC-04 | The extension runs without crashing the browser, without freezing the UI, and within reasonable memory bounds on a standard laptop. | Evaluated against SIH metric 4 (20%): client-side resource utilization. |
| SC-05 | The end-to-end loop (capture → perceive → sanitize → reason → validate → execute) completes each cycle within a practical timeframe. | Evaluated against SIH metric 5 (15%): overall end-to-end latency. |
| SC-06 | The agent successfully completes at least one multi-step task during the live demonstration. | Qualitative evaluation by SIH judges. |

---

## 24. Differentiation

| Approach | Limitation | How AEGIS Differs |
|----------|-----------|-------------------|
| **OCR-only systems** | Detect only text-based PII. Miss faces, images, QR codes, and visually-rendered content. Cannot understand page layout. | AEGIS uses a vision model that understands visual layout, element types, and non-textual sensitive content (faces) alongside text detection. |
| **Screenshot-to-cloud-LLM** | Raw screenshots are sent to a remote server. Privacy is violated by design. | AEGIS ensures raw screenshots never leave the device. The server only receives a sanitized, redacted representation. |
| **Basic browser extensions** | Operate on DOM text only. Cannot perceive visual layout, canvas content, or iframe content. No AI-driven reasoning. | AEGIS combines DOM analysis with visual perception from an on-device model, enabling understanding of pages that DOM parsing alone cannot handle. |
| **Generic PII blurring tools** | Apply static, context-unaware redaction. Often over-redact (destroying useful context for downstream tasks) or under-redact. Not integrated with an agent workflow. | AEGIS performs context-aware, selective redaction that preserves as much non-sensitive information as possible for the VLM to reason about, while still protecting PII. |
| **Cloud-only browser agents** | Require all data to be sent to the cloud. Cannot operate in privacy-restricted environments. | AEGIS splits the pipeline: perception and privacy enforcement are local; only reasoning is remote. This enables use in environments where cloud data exposure is unacceptable. |

---

## 25. Assumptions & Constraints

### SIH Prototype Constraints
- The submission is a working prototype, not a production-ready product.
- Development timeline is approximately one week.
- The demo will run on the team's own hardware during the presentation.
- Cloud-hosted versions of open-weight models are permitted for the VLM during the hackathon.

### Hardware / Resource Constraints
- The extension must function on a standard laptop (8GB RAM, integrated GPU or entry-level discrete GPU).
- WebGPU is the preferred inference backend, but WASM fallback must exist for machines without WebGPU support.
- The server (if run locally) requires sufficient resources to host the VLM. If insufficient, the cloud API fallback is used.

### Browser Constraints
- Target browsers: Chrome 116+ and Edge 116+ (WebGPU support).
- Manifest V3 is mandatory. MV2-only APIs are not available.
- `chrome.tabs.captureVisibleTab` captures only the visible viewport, not the full scrollable page.

### Network Assumptions
- A network connection between the browser and the server is required for the reasoning step.
- The connection may be localhost (server on the same machine) or remote.
- Latency between client and server is assumed to be low for the demo (localhost or LAN).

### Model Availability Assumptions
- Pre-trained open-weight models suitable for on-device UI/PII detection exist and can be adapted (e.g., via Transformers.js or ONNX export).
- Open-weight VLMs (Qwen-VL, PaliGemma, LLaVA) are available for server-side deployment via Ollama or cloud API.

### Privacy Constraints
- The system cannot guarantee 100% PII detection. The design mitigates this through fail-safe over-redaction and defense-in-depth (ML + heuristics + DOM analysis).
- The server is assumed to be operated by the same team/organization. Third-party server trust is out of scope for the prototype.

---

## 26. Open Questions

| # | Question | Impact |
|---|----------|--------|
| OQ-01 | **Which specific on-device model(s) should be used for UI element detection and PII detection?** Candidates include small ViT variants, YOLOv8-nano, and MobileNet-based detectors. Selection depends on accuracy-vs-latency trade-offs that need benchmarking. | Affects F2, F3, PF-01, and the 45% of evaluation tied to perception and PII detection. |
| OQ-02 | **Which server-side VLM will be used for the demo?** Options: Ollama with Qwen-VL locally, or a cloud API (Together AI, Groq, HuggingFace Inference). | Affects PF-02, cost, and demo reliability. |
| OQ-03 | **What specific demo task should be used for the SIH presentation?** A mock banking form, a government portal, a travel booking page? | Affects how we tune PII detection and what PII categories to prioritize. |
| OQ-04 | **How should the "high-risk action" categories be defined for the safety validator?** Which actions require user confirmation vs. which proceed automatically? | Affects F7, HL-03, and the user experience of the demo. |
| OQ-05 | **Should the sanitized context include a redacted image, a text-only schema, or both?** Sending a redacted image provides richer context for the VLM but increases payload size and latency. | Affects PF-07, NFR-05, and VLM reasoning accuracy. |
| OQ-06 | **What is the maximum number of agent steps before automatic termination?** Too low and the agent cannot complete complex tasks. Too high and a stuck agent wastes resources. | Affects NFR-09 and BA-08. |
| OQ-07 | **How will the team handle the cold-start latency of loading ML models in the browser?** Options: pre-load on extension install, lazy-load on first use, or progressive loading. | Affects user experience on first activation. |

---

## 27. Product Requirement Traceability

| Problem | Product Goal | Core Feature | Key Requirements | Success Metric |
|---------|-------------|-------------|-----------------|----------------|
| Browser agents need visual context to assist users. | G1: Accurately perceive visual state. | F1: Screen Capture, F2: On-Device Visual Perception. | FR-01, FR-02, FR-04, FR-05. | SC-01: Accuracy of visual context (25%). |
| Visual context contains sensitive PII. | G2: Detect PII with high recall and precision. | F3: Sensitive Information Detection. | FR-06, FR-07, FR-08. | SC-02: PII recall and precision (20%). |
| PII must not leave the device. | G3: Redact PII before transmission. | F4: Local Redaction/Sanitization, F5: Sanitized Transmission. | FR-09, FR-10, FR-11, PV-01 through PV-08. | SC-03: Redaction precision (20%). |
| On-device processing must be lightweight. | G4: Maintain acceptable resource usage. | F2: On-Device Perception (lightweight model). | NFR-06, NFR-07, PF-04, PF-05. | SC-04: Client-side resource utilization (20%). |
| Agent must respond in practical time. | G5: Achieve practical latency. | F10: Perception-Action Loop, F12: WebSocket communication. | NFR-05, PF-01, PF-02, PF-03. | SC-05: End-to-end latency (15%). |
| Users need actual task completion. | G6: Complete a demo task end-to-end. | F6: VLM Reasoning, F7: Safety Validation, F8: Action Execution. | FR-13 through FR-21. | SC-06: Successful multi-step demo. |
