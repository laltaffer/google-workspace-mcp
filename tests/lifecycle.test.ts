import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { exitWhenUnused } from '../src/lifecycle.js';

describe('exitWhenUnused', () => {
  afterEach(() => vi.useRealTimers());

  it('exits when the client closes stdin', () => {
    const stdin = new EventEmitter();
    const exit = vi.fn();
    exitWhenUnused(stdin, undefined, exit);
    stdin.emit('end');
    expect(exit).toHaveBeenCalledOnce();
  });

  it('exits after the idle window with no requests, resetting on each request', () => {
    vi.useFakeTimers();
    const stdin = new EventEmitter();
    const exit = vi.fn();
    exitWhenUnused(stdin, 30, exit);
    vi.advanceTimersByTime(29 * 60_000);
    stdin.emit('data', Buffer.from('{}'));
    vi.advanceTimersByTime(29 * 60_000);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(exit).toHaveBeenCalledOnce();
  });

  it('never idles out when no window is set', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    exitWhenUnused(new EventEmitter(), undefined, exit);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(exit).not.toHaveBeenCalled();
  });
});
