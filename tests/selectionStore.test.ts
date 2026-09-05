import { describe, it, expect } from 'vitest';
import { createRoot, createMemo } from 'solid-js';
import { createSelectionStore } from '../src/stores/selectionStore';
import { settle } from './helpers/settle';

describe('createSelectionStore — direct API', () => {
    it('starts empty', () => {
        const s = createSelectionStore();
        expect(s.selectionCount()).toBe(0);
        expect(s.selectedIds().size).toBe(0);
        expect(s.isSelected('anything')).toBe(false);
    });

    it('replace sets the selection from any iterable', () => {
        const s = createSelectionStore();
        s.replace(['a', 'b', 'c']);
        settle();
        expect(s.selectionCount()).toBe(3);
        expect(s.isSelected('b')).toBe(true);
        s.replace(new Set(['x']));
        settle();
        expect(s.selectionCount()).toBe(1);
        expect(s.isSelected('x')).toBe(true);
        expect(s.isSelected('a')).toBe(false);
    });

    it('add inserts and is idempotent on duplicates', () => {
        const s = createSelectionStore();
        s.add('a');
        settle();
        const ref1 = s.selectedIds();
        s.add('a');
        settle();
        // Identity stays the same — no allocation on no-op
        expect(s.selectedIds()).toBe(ref1);
        expect(s.selectionCount()).toBe(1);
    });

    it('remove removes; idempotent on missing', () => {
        const s = createSelectionStore();
        s.replace(['a', 'b']);
        settle();
        s.remove('a');
        settle();
        expect(s.isSelected('a')).toBe(false);
        const ref = s.selectedIds();
        s.remove('not-there');
        settle();
        expect(s.selectedIds()).toBe(ref);
    });

    it('toggle adds when missing, removes when present', () => {
        const s = createSelectionStore();
        s.toggle('a');
        settle();
        expect(s.isSelected('a')).toBe(true);
        s.toggle('a');
        settle();
        expect(s.isSelected('a')).toBe(false);
    });

    it('clear empties the set; keeps identity stable when already empty', () => {
        const s = createSelectionStore();
        const empty = s.selectedIds();
        s.clear();
        settle();
        expect(s.selectedIds()).toBe(empty);
        s.replace(['a']);
        settle();
        s.clear();
        settle();
        expect(s.selectionCount()).toBe(0);
    });
});

// `selectedIds` is a plain signal (selectionStore.ts:32). SolidJS 2.0 throws
// REACTIVE_WRITE_IN_OWNED_SCOPE for a signal write inside a createRoot body
// — store setters are exempt there, signal setters are not — so the store is
// built and driven from the test scope and the root body holds nothing but
// the memo. `settle()` is `flush` from solid-js.
describe('createSelectionStore — reactivity', () => {
    it('memo subscribers re-compute when selection changes', () => {
        let observedSize = -1;
        const s = createSelectionStore();
        let size!: () => number;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            size = createMemo(() => {
                observedSize = s.selectedIds().size;
                return observedSize;
            });
        });
        size(); // prime
        expect(observedSize).toBe(0);
        s.add('a');
        settle();
        size();
        expect(observedSize).toBe(1);
        s.toggle('b');
        settle();
        size();
        expect(observedSize).toBe(2);
        s.clear();
        settle();
        size();
        expect(observedSize).toBe(0);
        dispose();
    });

    it('add no-op does not invalidate downstream memo', () => {
        let runs = 0;
        const s = createSelectionStore();
        s.add('a');
        settle();
        let memo!: () => number;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            memo = createMemo(() => {
                runs++;
                return s.selectedIds().size;
            });
        });
        memo();
        expect(runs).toBe(1);
        // Re-add same id: identity stable → memo should not re-run when read.
        s.add('a');
        settle();
        memo();
        expect(runs).toBe(1);
        dispose();
    });
});
