/**
 * Selection state shared by the canvas and the semantic overlay.
 *
 * Framework-free and synchronous. Both input surfaces dispatch the same actions
 * against the same store, which is what keeps a raycast hit and a keyboard
 * focus from disagreeing about what is currently pulled off the shelf.
 */

export interface ShelfState {
  /** Item under the pointer, or focused via keyboard. Pulls forward slightly. */
  hovered: string | null;
  /** Item spun out toward the camera with its card open. At most one. */
  active: string | null;
}

export type ShelfAction =
  | { type: 'hover'; id: string | null }
  | { type: 'activate'; id: string }
  | { type: 'dismiss' };

export const initialShelfState: ShelfState = Object.freeze({ hovered: null, active: null });

/**
 * Pure transition. Returns the *same object* when nothing changed so callers can
 * skip redundant renders and announcements with a reference check.
 */
export function reduceShelf(state: ShelfState, action: ShelfAction): ShelfState {
  switch (action.type) {
    case 'hover': {
      if (state.hovered === action.id) return state;
      return { ...state, hovered: action.id };
    }
    case 'activate': {
      // Activating the open item closes it, so click and Enter both toggle.
      const active = state.active === action.id ? null : action.id;
      if (state.active === active && state.hovered === action.id) return state;
      return { hovered: action.id, active };
    }
    case 'dismiss': {
      if (state.active === null) return state;
      return { ...state, active: null };
    }
    default:
      return state;
  }
}

export type ShelfListener = (state: ShelfState, previous: ShelfState) => void;

export class ShelfStore {
  #state: ShelfState = initialShelfState;
  #listeners = new Set<ShelfListener>();

  get state(): ShelfState {
    return this.#state;
  }

  subscribe(listener: ShelfListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Returns true when the action actually changed something. */
  dispatch(action: ShelfAction): boolean {
    const previous = this.#state;
    const next = reduceShelf(previous, action);
    if (next === previous) return false;
    this.#state = next;
    for (const listener of this.#listeners) listener(next, previous);
    return true;
  }

  reset(): void {
    this.dispatch({ type: 'hover', id: null });
    this.dispatch({ type: 'dismiss' });
  }
}
