import { describe, it, expect } from 'vitest';
import { createRoot, createMemo } from 'solid-js';
import { createSelectionStore } from '../src/stores/selectionStore';

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
        expect(s.selectionCount()).toBe(3);
        expect(s.isSelected('b')).toBe(true);
        s.replace(new Set(['x']));
        expect(s.selectionCount()).toBe(1);
        expect(s.isSelected('x')).toBe(true);
        expect(s.isSelected('a')).toBe(false);
    });

    it('add inserts and is idempotent on duplicates', () => {
        const s = createSelectionStore();
        s.add('a');
        const ref1 = s.selectedIds();
        s.add('a');
        // Identity stays the same — no allocation on no-op
        expect(s.selectedIds()).toBe(ref1);
        expect(s.selectionCount()).toBe(1);
    });

    it('remove removes; idempotent on missing', () => {
        const s = createSelectionStore();
        s.replace(['a', 'b']);
        s.remove('a');
        expect(s.isSelected('a')).toBe(false);
        const ref = s.selectedIds();
        s.remove('not-there');
        expect(s.selectedIds()).toBe(ref);
    });

    it('toggle adds when missing, removes when present', () => {
        const s = createSelectionStore();
        s.toggle('a');
        expect(s.isSelected('a')).toBe(true);
        s.toggle('a');
        expect(s.isSelected('a')).toBe(false);
    });

    it('clear empties the set; keeps identity stable when already empty', () => {
        const s = createSelectionStore();
        const empty = s.selectedIds();
        s.clear();
        expect(s.selectedIds()).toBe(empty);
        s.replace(['a']);
        s.clear();
        expect(s.selectionCount()).toBe(0);
    });
});

describe('createSelectionStore — reactivity', () => {
    it('memo subscribers re-compute when selection changes', () => {
        let observedSize = -1;
        createRoot((dispose) => {
            const s = createSelectionStore();
            const size = createMemo(() => {
                observedSize = s.selectedIds().size;
                return observedSize;
            });
            size(); // prime
            expect(observedSize).toBe(0);
            s.add('a');
            size();
            expect(observedSize).toBe(1);
            s.toggle('b');
            size();
            expect(observedSize).toBe(2);
            s.clear();
            size();
            expect(observedSize).toBe(0);
            dispose();
        });
    });

    it('add no-op does not invalidate downstream memo', () => {
        let runs = 0;
        createRoot(() => {
            const s = createSelectionStore();
            s.add('a');
            const memo = createMemo(() => {
                runs++;
                return s.selectedIds().size;
            });
            memo();
            expect(runs).toBe(1);
            // Re-add same id: identity stable → memo should not re-run when read.
            s.add('a');
            memo();
            expect(runs).toBe(1);
        });
    });
});
