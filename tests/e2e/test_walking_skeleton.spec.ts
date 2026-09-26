import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server } from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildMinimalSanitizedContext } from '../../extension/src/background/context-builder';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import type {
  ActionMessage,
  ActionResultPayload,
  ClientMetadata,
  ContextUpdateMessage,
  PreviousActionResult,
  SanitizedSchema,
  SessionCreatedMessage,
  SessionInitMessage,
} from '@aegis/protocol';
import type { CaptureResult } from '../../extension/src/background/capture';

let serverProcess: ChildProcess | null = null;
let staticServer: Server | null = null;
const SERVER_PORT = 8765;
const FIXTURE_PORT = 8766;

test.beforeAll(async () => {
  await new Promise<void>((resolvePromise) => {
    staticServer = createServer((_req, res) => {
      const filePath = resolve(__dirname, '../../fixtures/fp_01.html');
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end('Fixture Not Found');
      }
    });
    staticServer.listen(FIXTURE_PORT, '127.0.0.1', () => {
      resolvePromise();
    });
  });

  const venvPy = resolve(__dirname, '../../.venv/Scripts/python.exe');
  const pyExe = existsSync(venvPy) ? venvPy : 'python';
  serverProcess = spawn(
    pyExe,
    ['-m', 'uvicorn', 'aegis_server.main:app', '--app-dir', 'server', '--host', '127.0.0.1', '--port', String(SERVER_PORT)],
    {
      cwd: resolve(__dirname, '../..'),
      stdio: 'inherit',
    },
  );

  let healthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!healthy) {
    throw new Error('Failed to start FastAPI server on port 8765');
  }
});

test.afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (staticServer) {
    await new Promise<void>((resolvePromise) => {
      staticServer!.close(() => resolvePromise());
    });
    staticServer = null;
  }
});

test('Walking Skeleton demonstrates TWO complete agent cycles on FP-01', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${FIXTURE_PORT}`);
  await expect(page.locator('h1')).toHaveText('FP-01: National Scholarship Search');

  const searchInput = page.locator('#search-input');
  const submitButton = page.locator('#submit-button');
  const statusMessage = page.locator('#status-message');

  await expect(searchInput).toBeVisible();
  await expect(submitButton).toBeVisible();
  await expect(searchInput).toHaveValue('');
  await expect(statusMessage).toHaveText('Ready to search.');

  const ws = new WebSocket(`ws://127.0.0.1:${SERVER_PORT}/ws`);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    ws.addEventListener('open', () => resolvePromise());
    ws.addEventListener('error', (err) => rejectPromise(err));
  });

  const receiveMessage = <T>(): Promise<T> => {
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const handler = (event: MessageEvent) => {
        ws.removeEventListener('message', handler);
        try {
          const parsed = JSON.parse(String(event.data));
          resolvePromise(parsed as T);
        } catch (e) {
          rejectPromise(e);
        }
      };
      ws.addEventListener('message', handler);
    });
  };

  const initMsg: SessionInitMessage = {
    type: 'session_init',
    session_id: null,
    timestamp: new Date().toISOString(),
    protocol_version: '1.0',
    payload: {
      goal: 'Search for STEM scholarships on FP-01',
      client_metadata: {
        extension_version: '1.0.0',
        browser: 'chrome',
        browser_version: '120.0',
        max_steps: 30,
      } as ClientMetadata,
    },
  };

  const sessionCreatedPromise = receiveMessage<SessionCreatedMessage>();
  ws.send(JSON.stringify(initMsg));
  const sessionCreated = await sessionCreatedPromise;

  expect(sessionCreated.type).toBe('session_created');
  const sessionId = sessionCreated.session_id;
  expect(sessionId).toBeTruthy();
  expect(sessionCreated.payload.server_max_steps).toBe(30);

  console.log('[E2E TEST] Starting Cycle 1...');

  const screenshot1 = await page.screenshot();
  const capture1: CaptureResult = {
    screenshotDataUrl: `data:image/webp;base64,${screenshot1.toString('base64')}`,
    format: 'webp',
    dpr: 1.0,
    width: 1280,
    height: 800,
  };

  const schema1: SanitizedSchema = {
    url: page.url(),
    title: await page.title(),
    elements: [
      {
        id: 'el-search-input',
        tagName: 'input',
        type: 'text',
        label: 'Search Query',
        value: await searchInput.inputValue(),
        boundingBox: { x: 10, y: 20, width: 200, height: 30 },
        isVisible: true,
        isDisabled: false,
        isReadOnly: false,
        isInteractive: true,
      },
      {
        id: 'el-submit-button',
        tagName: 'button',
        type: 'button',
        text: 'Search Scholarships',
        boundingBox: { x: 10, y: 60, width: 150, height: 30 },
        isVisible: true,
        isDisabled: false,
        isReadOnly: false,
        isInteractive: true,
      },
    ],
  };

  const sanitizedContext1 = buildMinimalSanitizedContext(1, schema1, capture1, null);
  expect(sanitizedContext1.step_number).toBe(1);
  expect(sanitizedContext1.sanitized_schema.url).toBe(`http://127.0.0.1:${FIXTURE_PORT}/`);

  const ctxUpdateMsg1: ContextUpdateMessage = {
    type: 'context_update',
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    protocol_version: '1.0',
    payload: sanitizedContext1,
  };

  const actionMsgPromise1 = receiveMessage<ActionMessage>();
  ws.send(JSON.stringify(ctxUpdateMsg1));
  const actionMsg1 = await actionMsgPromise1;

  expect(actionMsg1.type).toBe('action');
  expect(actionMsg1.payload.step_number).toBe(1);
  expect(actionMsg1.payload.action.action_type).toBe('type');
  expect(actionMsg1.payload.action.target).toBe('el-search-input');
  expect(actionMsg1.payload.action.value).toBe('Scholarship Portal');

  await searchInput.fill(actionMsg1.payload.action.value!);
  await expect(searchInput).toHaveValue('Scholarship Portal');

  const result1: ActionResultPayload = {
    step_number: 1,
    action_type: 'type',
    success: true,
  };
  ws.send(
    JSON.stringify({
      type: 'action_result',
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload: result1,
    }),
  );

  console.log('[E2E TEST] Cycle 1 COMPLETED successfully.');

  console.log('[E2E TEST] Starting Cycle 2...');

  const screenshot2 = await page.screenshot();
  const capture2: CaptureResult = {
    screenshotDataUrl: `data:image/webp;base64,${screenshot2.toString('base64')}`,
    format: 'webp',
    dpr: 1.0,
    width: 1280,
    height: 800,
  };

  const schema2: SanitizedSchema = {
    url: page.url(),
    title: await page.title(),
    elements: [
      {
        id: 'el-search-input',
        tagName: 'input',
        type: 'text',
        label: 'Search Query',
        value: await searchInput.inputValue(),
        boundingBox: { x: 10, y: 20, width: 200, height: 30 },
        isVisible: true,
        isDisabled: false,
        isReadOnly: false,
        isInteractive: true,
      },
      {
        id: 'el-submit-button',
        tagName: 'button',
        type: 'button',
        text: 'Search Scholarships',
        boundingBox: { x: 10, y: 60, width: 150, height: 30 },
        isVisible: true,
        isDisabled: false,
        isReadOnly: false,
        isInteractive: true,
      },
    ],
  };

  const prevResult1: PreviousActionResult = {
    action_type: 'type',
    target_element_id: 'el-search-input',
    success: true,
  };

  const sanitizedContext2 = buildMinimalSanitizedContext(2, schema2, capture2, prevResult1);
  expect(sanitizedContext2.step_number).toBe(2);
  expect(sanitizedContext2.previous_action_result?.success).toBe(true);

  const ctxUpdateMsg2: ContextUpdateMessage = {
    type: 'context_update',
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    protocol_version: '1.0',
    payload: sanitizedContext2,
  };

  const actionMsgPromise2 = receiveMessage<ActionMessage>();
  ws.send(JSON.stringify(ctxUpdateMsg2));
  const actionMsg2 = await actionMsgPromise2;

  expect(actionMsg2.type).toBe('action');
  expect(actionMsg2.payload.step_number).toBe(2);
  expect(actionMsg2.payload.action.action_type).toBe('click');
  expect(actionMsg2.payload.action.target).toBe('el-submit-button');

  await submitButton.click();

  const resultsContainer = page.locator('#results-container');
  await expect(resultsContainer).toHaveAttribute('data-status', 'searched');
  await expect(page.locator('#query-echo')).toHaveText('Scholarship Portal');
  await expect(page.locator('#result-card-1')).toBeVisible();

  const result2: ActionResultPayload = {
    step_number: 2,
    action_type: 'click',
    success: true,
  };
  ws.send(
    JSON.stringify({
      type: 'action_result',
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload: result2,
    }),
  );

  console.log('[E2E TEST] Cycle 2 COMPLETED successfully.');

  const sanitizedContext3 = buildMinimalSanitizedContext(3, schema2, capture2, {
    action_type: 'click',
    target_element_id: 'el-submit-button',
    success: true,
  });

  const ctxUpdateMsg3: ContextUpdateMessage = {
    type: 'context_update',
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    protocol_version: '1.0',
    payload: sanitizedContext3,
  };

  const actionMsgPromise3 = receiveMessage<ActionMessage>();
  ws.send(JSON.stringify(ctxUpdateMsg3));
  const actionMsg3 = await actionMsgPromise3;

  expect(actionMsg3.type).toBe('action');
  expect(actionMsg3.payload.step_number).toBe(3);
  expect(actionMsg3.payload.action.action_type).toBe('done');

  ws.send(
    JSON.stringify({
      type: 'session_end',
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload: {
        reason: 'goal_achieved',
        final_step: 3,
      },
    }),
  );

  ws.close();
  console.log('[E2E TEST] Full Walking Skeleton E2E Flow Finished with 2+ complete cycles.');
});
