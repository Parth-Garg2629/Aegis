# AEGIS

AEGIS is a Chromium browser agent that helps you complete multi-step web tasks while reducing exposure of personal data.
It analyzes and sanitizes page context in the extension before sending it to a reasoning service, then validates proposed browser actions before execution.

## Features

- Capture the active tab and extract page structure for agent reasoning.
- Detect sensitive content with DOM rules, text pattern checks, visual signals, and face detection.
- Redact page context locally before transmitting it to the backend.
- Run the reasoning backend with a deterministic mock provider or a local Ollama vision-language model.
- Limit model output to a defined set of browser actions and apply client-side risk checks.
- Pause for user confirmation when an action needs approval.
- Inspect privacy-safe session metadata through read-only server endpoints.

## Tech stack

- TypeScript, pnpm workspaces, and Vite build the shared packages and Manifest V3 extension.
- Chrome Extension APIs provide tab capture, the background service worker, offscreen processing, and page interaction.
- ONNX Runtime Web and MediaPipe support local visual processing in the extension.
- Python 3.11+, FastAPI, Pydantic, and Uvicorn implement the WebSocket backend and HTTP status views.
- Ollama provides optional local vision-language inference. The mock provider supports development without a model.
- Vitest, pytest, and Playwright cover package, server, and browser flows.

## Architecture

```mermaid
flowchart LR
    Page[Active web page] --> Extension[Browser extension<br/>Capture, DOM analysis, local detection]
    Extension --> Sanitize[Local fusion and redaction]
    Sanitize -->|Sanitized screenshot and schema| WS[WebSocket /ws]
    WS --> Backend[FastAPI session and agent service]
    Backend --> Provider[Mock provider or local Ollama]
    Provider -->|One structured action| Backend
    Backend -->|Action proposal| Extension
    Extension --> Risk[Schema and risk checks]
    Risk -->|Safe or user approved| Page
```

The extension is the privacy boundary. The backend receives sanitized context and returns an action proposal. The extension checks that proposal and performs approved actions on the live page.

## Project structure

```text
extension/       Manifest V3 extension, popup, capture, sanitization, and execution
packages/core/   Detection, fusion, sanitization, and risk logic
packages/protocol/ Shared client/server message schemas
packages/shared/ Common constants and logging helpers
server/          FastAPI WebSocket service, sessions, providers, and audit views
eval/            Evaluation harness and wire-tap analysis tools
ml/              Model training, dataset generation, benchmarking, and ONNX export
scripts/         Verification and runtime check scripts
fixtures/        Test and demo page fixtures
scratch/         Experimental prompt optimization script
tests/           Browser end-to-end tests
docs/            Product, architecture, protocol, security, and evaluation specs
demo/            Local Ollama launch, preflight, and reset scripts
```

## Installation and setup

### Prerequisites

- Node.js 20 or newer and pnpm 9 or newer.
- Python 3.11 or newer.
- Chrome or Edge with Manifest V3 support.
- Optional: Ollama with a vision-language model such as `qwen3-vl:4b` pulled locally.

Install JavaScript dependencies from the repository root:

```powershell
corepack enable
pnpm install
pnpm build
```

The commands below use PowerShell. For Linux or macOS, use these backend setup commands instead:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
VLM_PROVIDER=mock python -m uvicorn aegis_server.main:app --app-dir server --host 127.0.0.1 --port 8765
```

Set up and start the Python service in a second terminal:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
$env:VLM_PROVIDER = "mock"
python -m uvicorn aegis_server.main:app --app-dir server --host 127.0.0.1 --port 8765
```

`pyproject.toml` defines the server package and development dependencies. The root `requirements.txt` is a pinned dependency snapshot, including additional ML runtime packages. Use the editable install above for server development.

The mock provider is the default and needs no model or API key. For local Ollama inference, start Ollama and set these variables before starting Uvicorn:

```powershell
$env:VLM_PROVIDER = "ollama"
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
$env:OLLAMA_MODEL = "qwen3-vl:4b"
```

`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and `OLLAMA_TIMEOUT_SECONDS` configure the Ollama provider. `AEGIS_AUTH_TOKEN` optionally enables token checking for WebSocket connections. Without it, the service skips authentication, so keep the service bound to localhost for development.

For OpenRouter inference, set these variables on the backend host. Keep the API key server-side and never add it to the extension or source control:

```text
VLM_PROVIDER=cloud
VLM_API_KEY=<your OpenRouter API key>
VLM_API_BASE_URL=https://openrouter.ai/api/v1
VLM_MODEL=openrouter/free
```

The free router can change the selected model and has provider-side quotas. It accepts images when a vision-capable free model is available. AEGIS sends the sanitized screenshot and sanitized page schema only.

`OLLAMA_NUM_CTX` sets Ollama's context window in tokens (default `8192`; minimum `4096`). The provider sends the structured ActionObject schema and only the sanitized screenshot when using a vision model.

Download the configured model once before starting the backend:

```sh
ollama pull qwen3-vl:4b
```

On Linux or macOS, set the provider variables with `export`, then start Uvicorn from the activated virtual environment:

```sh
export VLM_PROVIDER=ollama
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export OLLAMA_MODEL=qwen3-vl:4b
python -m uvicorn aegis_server.main:app --app-dir server --host 127.0.0.1 --port 8765
```

The built extension defaults to the deployed backend at `wss://aegis-api-2jgt.onrender.com/ws`. To point it at a local backend instead, change `DEFAULT_SERVER_ENDPOINT` in `packages/shared/src/constants.ts` to `ws://127.0.0.1:8765/ws` before building. Build with `pnpm build`, then load `extension/dist` as an unpacked extension from `chrome://extensions` or `edge://extensions`. If the build reports missing model assets, check the assets referenced in `extension/vite.config.ts`; the build copies them when present.

### Deploy the backend to Render

The current Render web service is configured from the repository root. Use these service settings:

| Render setting | Value |
| --- | --- |
| Root Directory | Leave blank (repository root) |
| Build Command | `pip install .` |
| Start Command | `uvicorn aegis_server.main:app --app-dir server --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` (optional) |

Set the model environment variables in the Render service's Environment settings. For the deployed OpenRouter provider, configure `VLM_PROVIDER=cloud`, `VLM_API_KEY`, `VLM_API_BASE_URL=https://openrouter.ai/api/v1`, and `VLM_MODEL=openrouter/free`. Keep the API key in Render's secret environment variables; never commit it.

After deployment, check that the deploy status is **Live** and that `https://<your-service>.onrender.com/health` returns HTTP 200 with `"status":"ok"`. A request to `/` returns 404 by design. Free Render instances can spin down while idle, so their next request may have a cold-start delay.

## Usage

1. Start the backend and confirm `http://127.0.0.1:8765/health` returns `{ "status": "ok", ... }`.
2. Load the unpacked extension and open a supported web page in the active tab.
3. Open the AEGIS popup, enter a task goal, and start the agent.
4. Review and approve any action that the risk checks flag for confirmation.
5. Stop or cancel the run from the extension popup.

The mock provider is intended for development and scripted flows. Use Ollama or OpenRouter for model-driven task reasoning.

## Troubleshooting

- The backend serves its health check at `http://127.0.0.1:8765/health`. A `404` at `/` is expected; there is no web page at the root URL.
- For Ollama-backed runs, keep the Ollama service running and confirm the model is installed with `ollama list`. Start or restart the AEGIS backend after setting `VLM_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and, if needed, `OLLAMA_NUM_CTX`.
- Ollama HTTP failures are reported with their status code. Context overflow diagnostics include only token counts and the server context limit; prompts, page content, screenshots, and raw model output are not logged.
- If a later Start click appears to do nothing, inspect the extension service worker console for `SESSION_START_REQUESTED`, `WEBSOCKET_OPEN`, and `NEXT_CYCLE_START`, and check the backend for `SESSION_INITIALIZED` and `CONTEXT_UPDATE_RECEIVED`. These event names help distinguish a popup/worker handoff issue from a provider request failure.
- After rebuilding the extension, click **Reload** for the unpacked extension in `chrome://extensions`, then refresh the target page so Chrome injects the rebuilt content script.

## Screenshots and demo

There are no screenshots or public demo URL in this repository yet. The `demo/` directory contains PowerShell scripts for an Ollama launch and preflight checks. `docs/DEMO_FLOW.md` describes the planned demonstration flow.

## API

The backend exposes a WebSocket protocol and read-only HTTP endpoints. Messages use JSON envelopes with `type`, `timestamp`, `protocol_version` (`1.0`), and `payload` fields. Full message schemas are in [`docs/API_SPEC.md`](docs/API_SPEC.md).

| Method and path | Purpose | Access |
| --- | --- | --- |
| `GET /health` | Returns service status and protocol version. | No authentication |
| `WS /ws?token=<token>` | Starts a session, exchanges sanitized page context, and returns action proposals. | Token checked when `AEGIS_AUTH_TOKEN` is set |
| `GET /view/sessions` | Lists current session summaries. | No authentication |
| `GET /view/sessions/{session_id}` | Returns privacy-safe session details and action history. | No authentication |
| `GET /view/sessions/{session_id}/latest-context` | Returns metadata for the latest sanitized context, without image data. | No authentication |

The WebSocket flow starts with `session_init` and then exchanges `context_update`, `action`, and result or session messages. Proposed action types are `click`, `type`, `scroll`, `select`, `hover`, `wait`, `done`, and `fail`. See [`docs/API_SPEC.md`](docs/API_SPEC.md) for payload fields and examples.

## Engineering decisions

- Keep capture, detection, and redaction in the extension so raw page context stays on the user device before transmission.
- Send both a sanitized screenshot and a sanitized structured page schema. The screenshot preserves visual layout; the schema exposes labels and interactive elements.
- Use a WebSocket for the repeated perception and action loop, while keeping health and session inspection as HTTP endpoints.
- Keep the reasoning provider replaceable. The mock provider simplifies development; Ollama enables local model inference.
- Keep OpenRouter credentials on the backend. The OpenRouter provider receives only the sanitized context produced by the extension.
- Validate actions and apply risk rules in the extension, where page actions execute.
- Treat this repository as a prototype. The optional token check and unauthenticated inspection routes do not constitute production access control.

## Testing

Run the JavaScript unit suite and browser flows from the repository root:

```powershell
pnpm test
pnpm test:e2e
pnpm typecheck
```

Run the Python server suite after installing the development extras:

```powershell
python -m pytest server/tests server/test_agent.py server/test_generate.py server/test_ollama.py
```

The explicit file paths include three server tests stored outside `server/tests/`. Pytest's configured default test path is `server/tests`, so those files are not included by that default. The repository also includes evaluation tooling under `eval/` and fixture-based end-to-end cases under `tests/e2e/`.

The ML scripts under `ml/` (training, benchmarking, dataset generation, ONNX export) are run independently and are not covered by the test suites above.

## Current implementation

- The MV3 extension captures the selected Chromium tab, extracts interactive DOM state, runs local perception and sanitization, and sends the sanitized context to the backend over WebSocket.
- Filled form controls are withheld from the backend: their DOM values and visible screenshot regions are redacted locally. Page element IDs are opaque, schema attributes are allowlisted, and goal text is PII-scanned before session initialization.
- The FastAPI backend supports a deterministic development mock and local Ollama inference. Ollama requests use structured ActionObject output and a configurable context window.
- The extension validates actions, applies its client risk checks, requests confirmation when required, and executes the predefined action types against the selected page.
- `fixtures/fp_01.html` and `fixtures/demo.html` are deterministic local pages for browser-flow work. They contain synthetic content only.

## Current limitations

- AEGIS currently targets Chromium browsers and the active tab. It does not handle multi-tab workflows.
- AEGIS cannot promise support for every internet site. Chrome restricts extension access on browser-owned pages, and sites with login gates, anti-automation checks, closed shadow roots, or custom controls may not expose usable targets.
- Detection is imperfect. Canvas-rendered text, unusual layouts, and pages designed to evade detection can defeat current checks.
- PII detection uses local heuristics, not complete OCR or semantic detection. Sensitive text in images, canvas, unusual page regions, or patterns the local detectors do not recognize can escape redaction; AEGIS cannot promise detection of every sensitive value on every site.
- DOM extraction cannot inspect the internals of cross-origin iframes; only the rendered screenshot is available for those regions. Screenshot capture covers the visible viewport.
- Because filled values are kept from the model, entering sensitive values already stored in a page or in the task text is not supported; a secure local value-entry mechanism is not implemented.
- The OpenRouter provider depends on external model availability, free-tier quotas, and network access. It does not guarantee uninterrupted inference.
- The mock provider does not provide general-purpose reasoning.
- Production deployment, hardened authentication, and broader threat testing remain future work.

## Future Roadmap

The following capabilities are planned and are not part of the current implementation:

- Hybrid local/cloud VLMs, additional configurable cloud providers, and automatic provider selection.
- Zero-setup mode and more lightweight local VLM options.
- Broader support for dynamic sites, cross-tab workflows, and iframes.
- Production authentication, deployment hardening, and enterprise policy management.
- Longer-horizon reasoning with carefully scoped persistent memory.

## Further reading

- [System architecture](docs/SYSTEM_ARCHITECTURE.md)
- [Technical specification](docs/TECHNICAL_SPEC.md)
- [Product requirements](docs/PRD.md)
- [Browser agent specification](docs/BROWSER_AGENT_SPEC.md)
- [API specification](docs/API_SPEC.md)
- [Security and privacy](docs/SECURITY_PRIVACY.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [AI/ML pipeline](docs/AI_ML_PIPELINE.md)
- [Evaluation plan](docs/EVALUATION_PLAN.md)
- [Demo flow](docs/DEMO_FLOW.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)

## Contributing

The repository does not include contribution guidelines yet. If you plan to contribute, open an issue or pull request with a clear description of the change and the checks you ran.

## License

This repository does not include a license file. No reuse or redistribution terms are specified.
