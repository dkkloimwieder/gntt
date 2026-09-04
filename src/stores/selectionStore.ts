/**
 * Selection store — tracks which tasks the user has selected via
 * shift-click, ctrl/cmd-click, or box-select. Bars read this set
 * reactively to apply a visual treatment, and the bar drag pipeline
 * uses it to move every selected bar together.
 *
 * Pure signal API; no DOM, no rendering. All mutations create a new
 * Set so subscribers see a stable identity change.
 */
import { createSignal, Accessor } from 'solid-js';

export interface SelectionStore {
    /** Current selection as a Set. Subscribers see new Set on mutation. */
    selectedIds: Accessor<Set<string>>;
    /**
     * Convenience: count of selected ids.
     *
     * COMMITTED-STATE READER — see `isSelected`. Reading it straight after
     * `add`/`toggle`/`replace`/`clear` in the same turn counts the selection
     * from BEFORE that mutation.
     */
    selectionCount: Accessor<number>;
    /**
     * True if the given id is currently selected.
     *
     * COMMITTED-STATE READER. It answers about the selection as committed,
     * which is not necessarily what a mutator called earlier in the same turn
     * staged. Never use it as a toggle-then-branch oracle —
     * `toggle(id); if (isSelected(id)) ...` reports the PREVIOUS state.
     * Compute the resulting selection yourself (see
     * `TaskLayer.handleTaskClickWithSelection`) and branch on that, or read
     * this one turn later from an effect on `selectedIds`.
     *
     * The mutators themselves are safe to chain: they are functional updaters
     * that compose against whatever is already staged.
     */
    isSelected: (id: string) => boolean;
    /** Replace the entire selection with the given ids. */
    replace: (ids: Iterable<string>) => void;
    /** Add a single id to the selection (no-op if already in). */
    add: (id: string) => void;
    /** Remove a single id from the selection (no-op if not present). */
    remove: (id: string) => void;
    /** Toggle membership of a single id. */
    toggle: (id: string) => void;
    /** Clear the selection. */
    clear: () => void;
}

export function createSelectionStore(): SelectionStore {
    const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());

    const isSelected = (id: string): boolean => selectedIds().has(id);

    const replace = (ids: Iterable<string>): void => {
        setSelectedIds(new Set(ids));
    };

    const add = (id: string): void => {
        setSelectedIds((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            return next;
        });
    };

    const remove = (id: string): void => {
        setSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const toggle = (id: string): void => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const clear = (): void => {
        setSelectedIds((prev) => (prev.size === 0 ? prev : new Set<string>()));
    };

    return {
        selectedIds,
        selectionCount: () => selectedIds().size,
        isSelected,
        replace,
        add,
        remove,
        toggle,
        clear,
    };
}
