import { describe, it, expect } from 'vitest';
import { selectBackend, withTimeout } from '../src/offscreen/model-manager';

describe('selectBackend (§7.2)', () => {
  it('falls back to wasm when navigator.gpu is unavailable', async () => {
    expect(await selectBackend()).toBe('wasm');
  });

  it('selects webgpu when an adapter is available', async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu: { requestAdapter: async () => ({}) } },
      configurable: true,
    });
    try {
      expect(await selectBackend()).toBe('webgpu');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  it('falls back to wasm when requestAdapter rejects', async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu: { requestAdapter: async () => { throw new Error('no adapter'); } } },
      configurable: true,
    });
    try {
      expect(await selectBackend()).toBe('wasm');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  it('falls back to wasm when requestAdapter resolves null', async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu: { requestAdapter: async () => null } },
      configurable: true,
    });
    try {
      expect(await selectBackend()).toBe('wasm');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });
});

describe('withTimeout (§5.7)', () => {
  it('resolves normally when the promise finishes before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'test')).resolves.toBe('ok');
  });

  it('rejects with a labeled error when the promise exceeds the timeout', async () => {
    const neverResolves = new Promise(() => {});
    await expect(withTimeout(neverResolves, 20, 'inference')).rejects.toThrow(/inference exceeded 20ms/);
  });

  it('propagates a rejection from the wrapped promise', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100, 'test')).rejects.toThrow('boom');
  });
});
