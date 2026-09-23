import * as ort from 'onnxruntime-web';
import { slog } from '@aegis/shared';

export type InferenceBackend = 'webgpu' | 'wasm';
export type ModelStatus = 'unloaded' | 'loading' | 'ready' | 'degraded';

export interface ModelManagerOptions {
  modelUrl: string;
  wasmPaths: string;
  inputName: string;
  inputShape: readonly [number, number, number, number];
  warmupTimeoutMs?: number;
  inferenceTimeoutMs?: number;
}

interface MinimalGpu {
  requestAdapter: () => Promise<unknown>;
}

export async function selectBackend(): Promise<InferenceBackend> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: MinimalGpu }) : undefined;
  if (nav?.gpu) {
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch {
    }
  }
  return 'wasm';
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms timeout`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const DEFAULT_WARMUP_TIMEOUT_MS = 10000;
const DEFAULT_INFERENCE_TIMEOUT_MS = 3000;

export class VisualModelManager {
  private session: ort.InferenceSession | null = null;
  private backend: InferenceBackend | null = null;
  private status: ModelStatus = 'unloaded';
  private readonly options: ModelManagerOptions;

  constructor(options: ModelManagerOptions) {
    this.options = options;
  }

  getStatus(): ModelStatus {
    return this.status;
  }

  getBackend(): InferenceBackend | null {
    return this.backend;
  }

  async load(): Promise<boolean> {
    this.status = 'loading';
    try {
      this.backend = await selectBackend();

      ort.env.wasm.wasmPaths = this.options.wasmPaths;
      ort.env.wasm.numThreads = 1;

      let session: ort.InferenceSession;
      try {
        session = await ort.InferenceSession.create(this.options.modelUrl, {
          executionProviders: [this.backend],
        });
      } catch (err) {
        if (this.backend === 'webgpu') {
          slog.warn({ module: 'MODEL_MANAGER', event: 'WEBGPU_INIT_FAILED_FALLBACK_WASM' });
          this.backend = 'wasm';
          session = await ort.InferenceSession.create(this.options.modelUrl, {
            executionProviders: ['wasm'],
          });
        } else {
          throw err;
        }
      }

      this.session = session;

      const [batch, channels, height, width] = this.options.inputShape;
      const dummy = new ort.Tensor(
        'float32',
        new Float32Array(batch * channels * height * width),
        [...this.options.inputShape],
      );
      await withTimeout(
        this.session.run({ [this.options.inputName]: dummy }),
        this.options.warmupTimeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS,
        'model warm-up',
      );

      this.status = 'ready';
      slog.info({ module: 'MODEL_MANAGER', event: 'MODEL_READY', model_name: this.options.modelUrl });
      return true;
    } catch (err) {
      this.status = 'degraded';
      slog.error({
        module: 'MODEL_MANAGER',
        event: 'MODEL_LOAD_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async runInference(tensorData: Float32Array): Promise<Float32Array | null> {
    if (this.status !== 'ready' || !this.session) return null;

    try {
      const tensor = new ort.Tensor('float32', tensorData, [...this.options.inputShape]);
      const results = await withTimeout(
        this.session.run({ [this.options.inputName]: tensor }),
        this.options.inferenceTimeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS,
        'inference',
      );
      const outputName = Object.keys(results)[0];
      return results[outputName].data as Float32Array;
    } catch (err) {
      slog.warn({
        module: 'MODEL_MANAGER',
        event: 'INFERENCE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async unload(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.status = 'unloaded';
  }
}
