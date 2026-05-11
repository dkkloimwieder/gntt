/**
 * Critical Path Method (CPM) for the Gantt dependency graph.
 *
 * Forward pass computes earliest start (ES) / earliest finish (EF) for each
 * task in topological order. Backward pass from project finish computes
 * latest start (LS) / latest finish (LF). Slack = LS - ES; tasks with slack
 * within EPSILON_PX are on the critical path — any delay pushes the project
 * finish.
 *
 * Operates entirely in pixel space (consistent with constraintEngine).
 * Pure function: no store mutation, no side effects.
 *
 * Complexity: O(V + E) topo sort + two linear passes.
 */
import { EPSILON_PX } from './constraintEngine';
import type { Relationship, DependencyType } from '../types';

interface TaskLike {
    id: string;
    _bar?: { x: number; width: number };
}

export interface CPMResult {
    /** Task IDs on the critical path (zero slack within EPSILON_PX). */
    critical: Set<string>;
    /** Earliest start position (pixels) per task. */
    es: Map<string, number>;
    /** Earliest finish position (pixels) per task. */
    ef: Map<string, number>;
    /** Latest start position (pixels) per task. */
    ls: Map<string, number>;
    /** Latest finish position (pixels) per task. */
    lf: Map<string, number>;
    /** Slack per task (pixels). 0 means critical. */
    slack: Map<string, number>;
    /** Project finish position (pixels) — max EF. */
    projectFinish: number;
    /** Relationship indices (predecessor, successor) for the critical edges. */
    criticalEdges: Set<number>;
}

function iterateTasks<T extends TaskLike>(
    tasksObj: Map<string, T> | Record<string, T | undefined>,
): T[] {
    if (tasksObj instanceof Map) {
        return Array.from(tasksObj.values());
    }
    return Object.values(tasksObj).filter(
        (t): t is T => t !== undefined && !!t._bar,
    );
}

/** Earliest successor start given a single predecessor constraint. */
function forwardEdgeConstraint(
    type: DependencyType,
    predES: number,
    predEF: number,
    succWidth: number,
    lagPx: number,
): number {
    switch (type) {
        case 'FS':
            return predEF + lagPx;
        case 'SS':
            return predES + lagPx;
        case 'FF':
            return predEF + lagPx - succWidth;
        case 'SF':
            return predES + lagPx - succWidth;
        default:
            return -Infinity;
    }
}

/** Latest predecessor start given a single successor constraint. */
function backwardEdgeConstraint(
    type: DependencyType,
    succLS: number,
    succLF: number,
    predWidth: number,
    lagPx: number,
): number {
    switch (type) {
        case 'FS':
            return succLS - lagPx - predWidth;
        case 'SS':
            return succLS - lagPx;
        case 'FF':
            return succLF - lagPx - predWidth;
        case 'SF':
            return succLF - lagPx;
        default:
            return Infinity;
    }
}

/**
 * Compute the critical path of the dependency graph.
 *
 * Tasks without `_bar` are skipped. Tasks not connected to any relationship
 * become both root and sink; they contribute their own start/finish to the
 * project bounds. A graph with cycles will still terminate but the topo sort
 * may not visit cycle members — those tasks are excluded from the critical
 * set rather than risk an infinite loop.
 */
export function computeCriticalPath<T extends TaskLike>(
    tasksObj: Map<string, T> | Record<string, T | undefined>,
    relationships: Relationship[],
    pixelsPerHour: number,
): CPMResult {
    const tasks = iterateTasks(tasksObj);
    const widths = new Map<string, number>();
    for (const t of tasks) widths.set(t.id, t._bar?.width ?? 0);

    // Build adjacency + in-degree for Kahn's topo sort
    const successorsByPred = new Map<
        string,
        { rel: Relationship; idx: number }[]
    >();
    const predecessorsBySucc = new Map<
        string,
        { rel: Relationship; idx: number }[]
    >();
    const inDegree = new Map<string, number>();
    for (const t of tasks) inDegree.set(t.id, 0);

    relationships.forEach((rel, idx) => {
        if (!widths.has(rel.from) || !widths.has(rel.to)) return;
        if (!successorsByPred.has(rel.from)) successorsByPred.set(rel.from, []);
        successorsByPred.get(rel.from)!.push({ rel, idx });
        if (!predecessorsBySucc.has(rel.to)) predecessorsBySucc.set(rel.to, []);
        predecessorsBySucc.get(rel.to)!.push({ rel, idx });
        inDegree.set(rel.to, (inDegree.get(rel.to) ?? 0) + 1);
    });

    // Kahn's: start with all in-degree-0 tasks
    const order: string[] = [];
    const queue: string[] = [];
    for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
    while (queue.length > 0) {
        const id = queue.shift()!;
        order.push(id);
        for (const { rel } of successorsByPred.get(id) ?? []) {
            const next = (inDegree.get(rel.to) ?? 0) - 1;
            inDegree.set(rel.to, next);
            if (next === 0) queue.push(rel.to);
        }
    }
    // Cycle members (if any) are not in `order`.

    // Forward pass: ES/EF
    const es = new Map<string, number>();
    const ef = new Map<string, number>();
    for (const id of order) {
        const taskMap = tasksObj instanceof Map ? tasksObj : null;
        const task = taskMap
            ? taskMap.get(id)
            : (tasksObj as Record<string, T | undefined>)[id];
        const startBaseline = task?._bar?.x ?? 0;
        const width = widths.get(id) ?? 0;
        const preds = predecessorsBySucc.get(id) ?? [];

        let earliestStart: number;
        if (preds.length === 0) {
            // Root: anchor to current bar position.
            earliestStart = startBaseline;
        } else {
            earliestStart = -Infinity;
            for (const { rel } of preds) {
                const predES = es.get(rel.from);
                const predEF = ef.get(rel.from);
                if (predES === undefined || predEF === undefined) continue;
                const lagPx = (rel.lag ?? 0) * pixelsPerHour;
                const constraint = forwardEdgeConstraint(
                    rel.type,
                    predES,
                    predEF,
                    width,
                    lagPx,
                );
                if (constraint > earliestStart) earliestStart = constraint;
            }
            if (earliestStart === -Infinity) earliestStart = startBaseline;
        }
        es.set(id, earliestStart);
        ef.set(id, earliestStart + width);
    }

    // Project finish = max EF across visited tasks.
    let projectFinish = 0;
    for (const v of ef.values()) if (v > projectFinish) projectFinish = v;

    // Backward pass: LF/LS in reverse topo order.
    const lf = new Map<string, number>();
    const ls = new Map<string, number>();
    for (let i = order.length - 1; i >= 0; i--) {
        const id = order[i]!;
        const width = widths.get(id) ?? 0;
        const succs = successorsByPred.get(id) ?? [];

        let latestStart: number;
        if (succs.length === 0) {
            latestStart = projectFinish - width; // sink: anchor to project finish
        } else {
            latestStart = Infinity;
            for (const { rel } of succs) {
                const succLS = ls.get(rel.to);
                const succLF = lf.get(rel.to);
                if (succLS === undefined || succLF === undefined) continue;
                const lagPx = (rel.lag ?? 0) * pixelsPerHour;
                const constraint = backwardEdgeConstraint(
                    rel.type,
                    succLS,
                    succLF,
                    width,
                    lagPx,
                );
                if (constraint < latestStart) latestStart = constraint;
            }
            if (latestStart === Infinity) latestStart = projectFinish - width;
        }
        ls.set(id, latestStart);
        lf.set(id, latestStart + width);
    }

    // Slack and critical set
    const slack = new Map<string, number>();
    const critical = new Set<string>();
    for (const id of order) {
        const s = (ls.get(id) ?? 0) - (es.get(id) ?? 0);
        slack.set(id, s);
        if (Math.abs(s) < EPSILON_PX) critical.add(id);
    }

    // Critical edges: both endpoints are critical AND the edge is "tight"
    // (the predecessor's contribution drives the successor's ES).
    const criticalEdges = new Set<number>();
    relationships.forEach((rel, idx) => {
        if (!critical.has(rel.from) || !critical.has(rel.to)) return;
        const predES = es.get(rel.from);
        const predEF = ef.get(rel.from);
        const succES = es.get(rel.to);
        const succWidth = widths.get(rel.to) ?? 0;
        if (
            predES === undefined ||
            predEF === undefined ||
            succES === undefined
        )
            return;
        const lagPx = (rel.lag ?? 0) * pixelsPerHour;
        const constraint = forwardEdgeConstraint(
            rel.type,
            predES,
            predEF,
            succWidth,
            lagPx,
        );
        if (Math.abs(constraint - succES) < EPSILON_PX) criticalEdges.add(idx);
    });

    return { critical, es, ef, ls, lf, slack, projectFinish, criticalEdges };
}
