import { describe, expect, it, vi } from 'vitest';
import { ShelfStore, initialShelfState, reduceShelf } from './scene-state';

describe('reduceShelf', () => {
  it('starts with nothing hovered or active', () => {
    expect(initialShelfState).toEqual({ hovered: null, active: null });
  });

  it('returns the same object when nothing changes', () => {
    const state = { hovered: 'book-a', active: null };
    expect(reduceShelf(state, { type: 'hover', id: 'book-a' })).toBe(state);
    expect(reduceShelf(state, { type: 'dismiss' })).toBe(state);
  });

  it('keeps at most one item active', () => {
    let state = reduceShelf(initialShelfState, { type: 'activate', id: 'book-a' });
    expect(state.active).toBe('book-a');
    state = reduceShelf(state, { type: 'activate', id: 'book-b' });
    expect(state.active).toBe('book-b');
  });

  it('toggles the open item closed when activated again', () => {
    let state = reduceShelf(initialShelfState, { type: 'activate', id: 'book-a' });
    state = reduceShelf(state, { type: 'activate', id: 'book-a' });
    expect(state.active).toBeNull();
  });

  it('dismisses the active item without clearing hover', () => {
    let state = reduceShelf(initialShelfState, { type: 'activate', id: 'album-x' });
    state = reduceShelf(state, { type: 'dismiss' });
    expect(state).toEqual({ hovered: 'album-x', active: null });
  });

  it('leaves the active item alone while hover moves around it', () => {
    let state = reduceShelf(initialShelfState, { type: 'activate', id: 'book-a' });
    state = reduceShelf(state, { type: 'hover', id: 'book-b' });
    state = reduceShelf(state, { type: 'hover', id: null });
    expect(state.active).toBe('book-a');
    expect(state.hovered).toBeNull();
  });

  it('activating also moves hover onto that item', () => {
    const state = reduceShelf({ hovered: 'book-a', active: null }, { type: 'activate', id: 'book-b' });
    expect(state.hovered).toBe('book-b');
  });
});

describe('ShelfStore', () => {
  it('notifies subscribers only on real changes', () => {
    const store = new ShelfStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.dispatch({ type: 'hover', id: 'book-a' })).toBe(true);
    expect(store.dispatch({ type: 'hover', id: 'book-a' })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      { hovered: 'book-a', active: null },
      { hovered: null, active: null },
    );
  });

  it('stops notifying after unsubscribe', () => {
    const store = new ShelfStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    store.dispatch({ type: 'activate', id: 'book-a' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('reset clears both hover and active', () => {
    const store = new ShelfStore();
    store.dispatch({ type: 'activate', id: 'book-a' });
    store.reset();
    expect(store.state).toEqual({ hovered: null, active: null });
  });
});
