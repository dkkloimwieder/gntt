import { createSignal, createMemo, For, onSettled } from 'solid-js';
import { createTaskStore, type TaskStore } from '../stores/taskStore.js';
import { Arrow } from '../components/Arrow';
import type { BarPosition, ProcessedTask, TaskConstraints } from '../types';

/**
 * Constraint Demo - Interactive Task Constraint Testing
 *
 * Demonstrates clear separation of concerns:
 * - ARROWS: Pure visual rendering (decorative/informative only)
 * - RELATIONSHIPS: Distance constraints (minDistance, maxDistance, fixedOffset)
 * - TASKS: Lock state only (functional/temporal/interactive)
 *
 * Relationship Constraint Types:
 * - minDistance: Minimum gap (push triggers if closer)
 * - maxDistance: Maximum gap (pull/tether triggers if further)
 * - fixedOffset: Maintains exact distance - tasks move together
 *
 * Task Constraint Types:
 * - locked: Task cannot move (blocks push/pull from relationships)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_MIN_DISTANCE = 10; // Default minimum gap between tasks (pixels)

const COLORS = {
    free: '#3498db',
    locked: '#7f8c8d',
    push: '#e67e22',
    pull: '#27ae60',
    fixedOffset: '#9b59b6',
};

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** A relationship owns the distance constraints; tasks own only `locked`. */
interface DemoRelationship {
    from: string;
    to: string;
    minDistance?: number;
    maxDistance?: number;
    fixedOffset?: boolean;
    color?: string;
}

interface DemoScenario {
    title: string;
    description: string;
    tasks: Array<{
        id: string;
        name: string;
        x: number;
        y: number;
        w: number;
        h: number;
        constraints: TaskConstraints;
    }>;
    relationships: DemoRelationship[];
}

/** A bar-only synthetic task — this demo never parses dates. */
interface DemoTask {
    id: string;
    name: string;
    _index: number;
    constraints: TaskConstraints;
    scenario: string;
    _bar: BarPosition;
}

/** One staged position in a planning pass. */
interface PlannedPos {
    x: number;
    y: number;
}

/** What one planning pass decided for the task it was asked about. */
type MovementPlan =
    | { type: 'single'; taskId: string; x: number; y: number }
    | {
          type: 'batch';
          updates: Array<{ taskId: string; x: number; y: number }>;
      };

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRAINT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find all tasks connected by fixed-offset relationships.
 * Traverses bidirectionally through fixed-offset links.
 */
function findFixedOffsetLinks(
    taskId: string,
    relationships: DemoRelationship[],
    visited: Set<string> = new Set(),
): Array<{ taskId: string; relationship: DemoRelationship }> {
    if (visited.has(taskId)) return [];
    visited.add(taskId);

    const linked: Array<{ taskId: string; relationship: DemoRelationship }> =
        [];

    relationships.forEach((rel) => {
        if (!rel.fixedOffset) return;

        if (rel.from === taskId && !visited.has(rel.to)) {
            linked.push({ taskId: rel.to, relationship: rel });
            linked.push(
                ...findFixedOffsetLinks(rel.to, relationships, visited),
            );
        }
        if (rel.to === taskId && !visited.has(rel.from)) {
            linked.push({ taskId: rel.from, relationship: rel });
            linked.push(
                ...findFixedOffsetLinks(rel.from, relationships, visited),
            );
        }
    });

    return linked;
}

/**
 * Calculate distance between two geometries (edge to edge: pred right edge
 * to succ left edge). Takes plain geometry, not tasks, so the planner can
 * feed it staged positions the store has not committed yet.
 */
function calculateDistance(
    pred: { x: number; width: number },
    succ: { x: number },
    predNewX: number | null = null,
): number {
    const predRightEdge = (predNewX ?? pred.x) + pred.width;
    return succ.x - predRightEdge;
}

/**
 * Working geometry for `id` during a planning pass: the position already
 * staged in `plan`, falling back to the store's committed bar.
 *
 * The plan — not the store — is the single source of truth while planning.
 * Under deferred writes the old shape (write `updateBarPosition`, then read
 * `_bar` back one recursion level up) answered with pre-drag pixels, so a
 * cascade of two or more hops resolved against stale geometry.
 */
function plannedPos(
    plan: Map<string, PlannedPos>,
    taskStore: TaskStore,
    id: string,
): { x: number; y: number; width: number; height: number } | null {
    const bar = taskStore.getBarPosition(id);
    if (!bar) return null;
    const staged = plan.get(id);
    return {
        x: staged ? staged.x : bar.x,
        y: staged ? staged.y : bar.y,
        width: bar.width,
        height: bar.height,
    };
}

/**
 * PURE PLANNER. Resolve a task movement with all constraints applied and
 * record every resulting position in `plan` (`Map<taskId, {x, y}>`).
 * Nothing is written to the store — `handleMouseMove` applies the finished
 * plan in one pass, which is both the correctness fix and the reason a
 * pointer move now costs one flush instead of N.
 *
 * Constraints are on RELATIONSHIPS, not tasks:
 * - minDistance: minimum gap (push if closer)
 * - maxDistance: maximum gap (pull if further)
 * - fixedOffset: exact distance maintained
 *
 * Tasks can be locked to prevent movement.
 *
 * The return value is the plan for `taskId` ITSELF; the caller decides
 * whether to stage it (a nested `batch` is dropped, exactly as before).
 */
function resolveMovement(
    taskId: string,
    newX: number,
    newY: number,
    taskStore: TaskStore,
    relationships: DemoRelationship[],
    plan: Map<string, PlannedPos>,
    depth = 0,
): MovementPlan | null {
    // Prevent infinite recursion
    if (depth > 10) return null;

    const task = taskStore.getTask(taskId);
    if (!task) return null;

    // Locked tasks cannot move
    if (task.constraints?.locked) {
        return null;
    }

    const self = plannedPos(plan, taskStore, taskId);
    if (!self) return null;

    // Check fixed-offset relationships first (they override everything)
    const fixedLinks = findFixedOffsetLinks(taskId, relationships);
    if (fixedLinks.length > 0) {
        // Check if any linked task is locked
        const hasLockedLink = fixedLinks.some((link) => {
            const linkedTask = taskStore.getTask(link.taskId);
            return linkedTask?.constraints?.locked;
        });

        if (hasLockedLink) {
            return null; // Cannot move - linked to locked task
        }

        // Calculate delta and move all linked tasks
        const deltaX = newX - self.x;
        const deltaY = newY - self.y;

        const updates = [{ taskId, x: newX, y: newY }];

        fixedLinks.forEach((link) => {
            const linked = plannedPos(plan, taskStore, link.taskId);
            if (linked) {
                updates.push({
                    taskId: link.taskId,
                    x: linked.x + deltaX,
                    y: linked.y + deltaY,
                });
            }
        });

        return { type: 'batch', updates };
    }

    // Process each relationship involving this task
    for (const rel of relationships) {
        if (rel.fixedOffset) continue; // Already handled above

        const isPredecessor = rel.from === taskId;
        const isSuccessor = rel.to === taskId;
        if (!isPredecessor && !isSuccessor) continue;

        const otherTaskId = isPredecessor ? rel.to : rel.from;
        // Re-read per relationship so an earlier iteration's staged move is
        // visible here. Within ONE iteration the min- and max-distance
        // branches are mutually exclusive (they need maxDist < minDist to
        // both fire), so a single snapshot is enough.
        const other = plannedPos(plan, taskStore, otherTaskId);
        if (!other) continue;
        const otherLocked =
            !!taskStore.getTask(otherTaskId)?.constraints?.locked;

        const minDist = rel.minDistance ?? DEFAULT_MIN_DISTANCE;
        const maxDist = rel.maxDistance;

        if (isPredecessor) {
            // This task is the PREDECESSOR - check distance to successor
            const distance = calculateDistance(self, other, newX);

            // Check minDistance (push successor if too close)
            if (distance < minDist) {
                if (otherLocked) {
                    // Can't push locked task - constrain this task
                    newX = other.x - minDist - self.width;
                } else {
                    // Push successor forward
                    const pushAmount = minDist - distance;
                    const result = resolveMovement(
                        otherTaskId,
                        other.x + pushAmount,
                        other.y,
                        taskStore,
                        relationships,
                        plan,
                        depth + 1,
                    );
                    if (result?.type === 'single') {
                        plan.set(otherTaskId, { x: result.x, y: result.y });
                    }
                }
            }

            // Check maxDistance (tether - constrain this task if too far)
            if (maxDist !== undefined && distance > maxDist) {
                if (otherLocked) {
                    // Successor is locked - constrain predecessor
                    newX = other.x - maxDist - self.width;
                } else {
                    // Pull successor back
                    const pullAmount = distance - maxDist;
                    const result = resolveMovement(
                        otherTaskId,
                        other.x - pullAmount,
                        other.y,
                        taskStore,
                        relationships,
                        plan,
                        depth + 1,
                    );
                    if (result?.type === 'single') {
                        plan.set(otherTaskId, { x: result.x, y: result.y });
                    }
                }
            }
        } else {
            // This task is the SUCCESSOR - check distance from predecessor
            const pred = other;

            // HARD LIMIT: Successor cannot start before predecessor
            if (newX < pred.x) {
                newX = pred.x;
            }

            const newDistance = newX - (pred.x + pred.width);

            // Check minDistance (can't get too close to predecessor)
            if (newDistance < minDist) {
                if (otherLocked) {
                    // Predecessor is locked - constrain successor
                    newX = pred.x + pred.width + minDist;
                } else {
                    // Pull predecessor backward
                    const pullAmount = minDist - newDistance;
                    const result = resolveMovement(
                        otherTaskId,
                        pred.x - pullAmount,
                        pred.y,
                        taskStore,
                        relationships,
                        plan,
                        depth + 1,
                    );
                    if (result?.type === 'single') {
                        plan.set(otherTaskId, { x: result.x, y: result.y });
                    }
                }
            }

            // Check maxDistance (tether - constrain this task if too far from predecessor)
            if (maxDist !== undefined && newDistance > maxDist) {
                if (otherLocked) {
                    // Predecessor is locked - constrain successor
                    newX = pred.x + pred.width + maxDist;
                } else {
                    // Push predecessor forward to maintain tether
                    const pushAmount = newDistance - maxDist;
                    const result = resolveMovement(
                        otherTaskId,
                        pred.x + pushAmount,
                        pred.y,
                        taskStore,
                        relationships,
                        plan,
                        depth + 1,
                    );
                    if (result?.type === 'single') {
                        plan.set(otherTaskId, { x: result.x, y: result.y });
                    }
                }
            }
        }
    }

    return { type: 'single', taskId, x: newX, y: newY };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function ConstraintDemo() {
    const taskStore = createTaskStore();

    // Drag state
    const [dragging, setDragging] = createSignal<string | null>(null);
    const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });

    // UI state
    const [showDebug, setShowDebug] = createSignal(false);
    const [selectedScenario, setSelectedScenario] = createSignal('all');

    // ═══════════════════════════════════════════════════════════════════════════
    // SCENARIO DEFINITIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const scenarios: Record<string, DemoScenario> = {
        push: {
            title: '1. Push (minDistance)',
            description:
                'Drag predecessor right - pushes successor when gap < 10px',
            tasks: [
                {
                    id: 'push-pred',
                    name: 'Pred',
                    x: 50,
                    y: 80,
                    w: 80,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'push-succ',
                    name: 'Succ',
                    x: 180,
                    y: 80,
                    w: 80,
                    h: 24,
                    constraints: {},
                },
            ],
            relationships: [
                {
                    from: 'push-pred',
                    to: 'push-succ',
                    minDistance: 10,
                    color: COLORS.push,
                },
            ],
        },

        blocked: {
            title: '2. Blocked by Lock',
            description:
                'Predecessor stops when it would push a locked successor',
            tasks: [
                {
                    id: 'block-pred',
                    name: 'Pred',
                    x: 50,
                    y: 140,
                    w: 80,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'block-succ',
                    name: 'Locked',
                    x: 180,
                    y: 140,
                    w: 80,
                    h: 24,
                    constraints: { locked: true },
                },
            ],
            relationships: [
                {
                    from: 'block-pred',
                    to: 'block-succ',
                    minDistance: 10,
                    color: COLORS.locked,
                },
            ],
        },

        pull: {
            title: '3. Pull/Tether (maxDistance)',
            description:
                'Drag predecessor left - pulls successor when gap > 100px',
            tasks: [
                {
                    id: 'pull-pred',
                    name: 'Pred',
                    x: 50,
                    y: 200,
                    w: 80,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'pull-succ',
                    name: 'Succ',
                    x: 180,
                    y: 200,
                    w: 80,
                    h: 24,
                    constraints: {},
                },
            ],
            relationships: [
                {
                    from: 'pull-pred',
                    to: 'pull-succ',
                    maxDistance: 100,
                    color: COLORS.pull,
                },
            ],
        },

        bounded: {
            title: '4. Bounded (min + max)',
            description:
                'Gap constrained between 10-100px - push and pull both active',
            tasks: [
                {
                    id: 'bound-pred',
                    name: 'Pred',
                    x: 50,
                    y: 260,
                    w: 80,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'bound-succ',
                    name: 'Succ',
                    x: 180,
                    y: 260,
                    w: 80,
                    h: 24,
                    constraints: {},
                },
            ],
            relationships: [
                {
                    from: 'bound-pred',
                    to: 'bound-succ',
                    minDistance: 10,
                    maxDistance: 100,
                    color: '#f39c12',
                },
            ],
        },

        fixedPair: {
            title: '5. Fixed Offset Pair',
            description:
                'Drag either task - both move together (exact distance)',
            tasks: [
                {
                    id: 'fixed-a',
                    name: 'Task A',
                    x: 50,
                    y: 320,
                    w: 70,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'fixed-b',
                    name: 'Task B',
                    x: 160,
                    y: 320,
                    w: 70,
                    h: 24,
                    constraints: {},
                },
            ],
            relationships: [
                {
                    from: 'fixed-a',
                    to: 'fixed-b',
                    fixedOffset: true,
                    color: COLORS.fixedOffset,
                },
            ],
        },

        fixedChain: {
            title: '6. Fixed Offset Chain',
            description: 'A→B→C chain - drag any, all move together',
            tasks: [
                {
                    id: 'chain-a',
                    name: 'A',
                    x: 50,
                    y: 380,
                    w: 50,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'chain-b',
                    name: 'B',
                    x: 130,
                    y: 380,
                    w: 50,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'chain-c',
                    name: 'C',
                    x: 210,
                    y: 380,
                    w: 50,
                    h: 24,
                    constraints: {},
                },
            ],
            relationships: [
                {
                    from: 'chain-a',
                    to: 'chain-b',
                    fixedOffset: true,
                    color: COLORS.fixedOffset,
                },
                {
                    from: 'chain-b',
                    to: 'chain-c',
                    fixedOffset: true,
                    color: COLORS.fixedOffset,
                },
            ],
        },

        parallel: {
            title: '7. Parallel Tasks',
            description:
                'Overlapping tasks - successor starts during predecessor',
            tasks: [
                {
                    id: 'par-pred',
                    name: 'Predecessor',
                    x: 50,
                    y: 420,
                    w: 120,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'par-succ',
                    name: 'Successor',
                    x: 100,
                    y: 470,
                    w: 100,
                    h: 24,
                    constraints: {},
                },
            ],
            relationships: [
                {
                    from: 'par-pred',
                    to: 'par-succ',
                    minDistance: -Infinity,
                    color: '#e74c3c',
                },
            ],
        },

        directions: {
            title: '8. Arrow Directions',
            description: 'Forward arrows: up, down, same level',
            tasks: [
                {
                    id: 'dir-pred-up',
                    name: 'Pred',
                    x: 350,
                    y: 140,
                    w: 70,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'dir-succ-up',
                    name: 'Succ',
                    x: 480,
                    y: 80,
                    w: 70,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'dir-pred-down',
                    name: 'Pred',
                    x: 350,
                    y: 200,
                    w: 70,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'dir-succ-down',
                    name: 'Succ',
                    x: 480,
                    y: 260,
                    w: 70,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'dir-pred-same',
                    name: 'Pred',
                    x: 350,
                    y: 320,
                    w: 70,
                    h: 24,
                    constraints: {},
                },
                {
                    id: 'dir-succ-same',
                    name: 'Succ',
                    x: 480,
                    y: 320,
                    w: 70,
                    h: 24,
                    constraints: {},
                },
            ],
            relationships: [
                { from: 'dir-pred-up', to: 'dir-succ-up', color: '#9b59b6' },
                {
                    from: 'dir-pred-down',
                    to: 'dir-succ-down',
                    color: '#3498db',
                },
                {
                    from: 'dir-pred-same',
                    to: 'dir-succ-same',
                    color: '#2ecc71',
                },
            ],
        },
    };

    // Collect all tasks and relationships.
    //
    // Both builders take the filter as a PARAMETER instead of reading
    // `selectedScenario()`: the `<select>` handler stages
    // `setSelectedScenario(next)` and must load `next`'s tasks in the same
    // turn, but the signal still answers with the previous scenario until
    // the flush. The memos below pass the signal; the handler passes the
    // value it just wrote.
    const tasksFor = (filter: string): DemoTask[] => {
        const tasks: DemoTask[] = [];

        Object.entries(scenarios).forEach(([key, scenario]) => {
            if (filter === 'all' || filter === key) {
                scenario.tasks.forEach((t) => {
                    tasks.push({
                        id: t.id,
                        name: t.name,
                        _index: tasks.length,
                        constraints: t.constraints,
                        scenario: key,
                        _bar: { x: t.x, y: t.y, width: t.w, height: t.h },
                    });
                });
            }
        });

        return tasks;
    };

    const relationshipsFor = (filter: string): DemoRelationship[] => {
        const rels: DemoRelationship[] = [];

        Object.entries(scenarios).forEach(([key, scenario]) => {
            if (filter === 'all' || filter === key) {
                rels.push(...scenario.relationships);
            }
        });

        return rels;
    };

    const allTasks = createMemo(() => tasksFor(selectedScenario()));
    const allRelationships = createMemo(() =>
        relationshipsFor(selectedScenario()),
    );

    /** The single selected scenario, or null while showing them all. */
    const activeScenario = createMemo<DemoScenario | null>(() => {
        const key = selectedScenario();
        return key === 'all' ? null : (scenarios[key] ?? null);
    });

    /**
     * Load `key`'s tasks into the store. The demo synthesises bar-only
     * tasks — the store, `Arrow` and the planner only ever read `_bar` and
     * `constraints` — so the shape gap to `ProcessedTask` is deliberate.
     */
    const updateTasks = (key: string): void => {
        taskStore.updateTasks(tasksFor(key) as unknown as ProcessedTask[]);
    };

    // Initialize store
    onSettled(() => {
        updateTasks(selectedScenario());
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DRAG HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    /** Map a client point into the SVG's user space. */
    const toSvgPoint = (
        svg: SVGSVGElement,
        clientX: number,
        clientY: number,
    ): { x: number; y: number } => {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const ctm = svg.getScreenCTM();
        return ctm
            ? pt.matrixTransform(ctm.inverse())
            : { x: clientX, y: clientY };
    };

    const handleMouseDown = (taskId: string, event: MouseEvent): void => {
        const task = taskStore.getTask(taskId);
        if (!task) return;
        if (task.constraints?.locked) return;

        const svg = (event.currentTarget as SVGGraphicsElement).ownerSVGElement;
        if (!svg) return;
        const svgP = toSvgPoint(svg, event.clientX, event.clientY);

        setDragging(taskId);
        setDragOffset({ x: svgP.x - task._bar.x, y: svgP.y - task._bar.y });
        event.preventDefault();
    };

    const handleMouseMove = (event: MouseEvent): void => {
        const taskId = dragging();
        if (!taskId) return;

        const svg = event.currentTarget as SVGSVGElement;
        const svgP = toSvgPoint(svg, event.clientX, event.clientY);

        const offset = dragOffset();
        const newX = svgP.x - offset.x;
        const newY = svgP.y - offset.y;

        // ONE planning pass, then ONE application pass. The planner never
        // touches the store, so no step reads back geometry a previous step
        // wrote, and every bar this move touches lands in a single flush.
        const plan = new Map<string, PlannedPos>();
        const result = resolveMovement(
            taskId,
            newX,
            newY,
            taskStore,
            allRelationships(),
            plan,
        );

        if (result) {
            if (result.type === 'single') {
                plan.set(result.taskId, { x: result.x, y: result.y });
            } else {
                result.updates.forEach((u) => {
                    plan.set(u.taskId, { x: u.x, y: u.y });
                });
            }
        }

        for (const [id, pos] of plan) {
            taskStore.updateBarPosition(id, pos);
        }
    };

    const handleMouseUp = () => {
        setDragging(null);
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════════

    return (
        <div
            style={{
                padding: '20px',
                'font-family': 'system-ui, sans-serif',
                'max-width': '800px',
                margin: '0 auto',
            }}
        >
            <h1 style={{ 'margin-bottom': '10px' }}>Constraint Demo</h1>
            <p style={{ color: '#666', 'margin-bottom': '20px' }}>
                Interactive demonstration of relationship constraints.{' '}
                <strong>Arrows are purely visual</strong> - constraint logic
                (minDistance, maxDistance, fixedOffset) lives on{' '}
                <strong>relationships</strong>.
            </p>

            {/* Controls */}
            <div
                style={{
                    'margin-bottom': '20px',
                    padding: '15px',
                    'background-color': '#f8f9fa',
                    'border-radius': '8px',
                    display: 'flex',
                    gap: '20px',
                    'align-items': 'center',
                    'flex-wrap': 'wrap',
                }}
            >
                <label
                    style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '8px',
                    }}
                >
                    <span style={{ 'font-size': '13px', 'font-weight': '500' }}>
                        Scenario:
                    </span>
                    <select
                        value={selectedScenario()}
                        onChange={(e) => {
                            // Pass the new key straight through: reading
                            // `selectedScenario()` back here would still
                            // answer with the OLD scenario.
                            const key = e.currentTarget.value;
                            setSelectedScenario(key);
                            updateTasks(key);
                        }}
                        style={{
                            padding: '6px 10px',
                            'border-radius': '4px',
                            border: '1px solid #ddd',
                        }}
                    >
                        <option value="all">All Scenarios</option>
                        <For each={Object.entries(scenarios)}>
                            {([key, scenario]) => (
                                <option value={key}>{scenario.title}</option>
                            )}
                        </For>
                    </select>
                </label>

                <label
                    style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '8px',
                    }}
                >
                    <input
                        type="checkbox"
                        checked={showDebug()}
                        onChange={(e) => setShowDebug(e.target.checked)}
                    />
                    <span style={{ 'font-size': '13px' }}>Show Debug</span>
                </label>

                <button
                    onClick={() => updateTasks(selectedScenario())}
                    style={{
                        padding: '6px 12px',
                        'border-radius': '4px',
                        border: '1px solid #ddd',
                        background: '#fff',
                        cursor: 'pointer',
                    }}
                >
                    Reset Positions
                </button>
            </div>

            {/* SVG Canvas */}
            <svg
                width="600"
                height="540"
                style={{
                    border: '2px solid #dee2e6',
                    'border-radius': '8px',
                    'background-color': '#fff',
                    display: 'block',
                }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                {/* Grid */}
                <defs>
                    <pattern
                        id="grid"
                        width="20"
                        height="20"
                        patternUnits="userSpaceOnUse"
                    >
                        <path
                            d="M 20 0 L 0 0 0 20"
                            fill="none"
                            stroke="#f0f0f0"
                            stroke-width="0.5"
                        />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Scenario labels */}
                {selectedScenario() === 'all' && (
                    <g class="labels" style={{ 'pointer-events': 'none' }}>
                        <For each={Object.values(scenarios)}>
                            {(scenario) => {
                                const firstTask = scenario.tasks[0];
                                if (!firstTask) return null;
                                return (
                                    <text
                                        x={firstTask.x}
                                        y={firstTask.y - 8}
                                        font-size="11"
                                        fill="#999"
                                    >
                                        {scenario.title}
                                    </text>
                                );
                            }}
                        </For>
                    </g>
                )}

                {/* Arrows */}
                <g class="arrows">
                    <For each={allRelationships()}>
                        {(rel) => (
                            <Arrow
                                taskStore={taskStore}
                                fromId={rel.from}
                                toId={rel.to}
                                stroke={rel.color || '#666'}
                                strokeWidth={rel.fixedOffset ? 4 : 2}
                                strokeDasharray={
                                    rel.fixedOffset ? '8,4' : undefined
                                }
                                headSize={rel.fixedOffset ? 0 : 6}
                                curveRadius={8}
                            />
                        )}
                    </For>
                </g>

                {/* Tasks */}
                <g class="tasks">
                    <For each={allTasks()}>
                        {(task) => {
                            const pos = () => taskStore.getBarPosition(task.id);
                            const currentTask = () =>
                                taskStore.getTask(task.id);
                            const isLocked = () =>
                                currentTask()?.constraints?.locked;
                            const isDragging = () => dragging() === task.id;

                            // Determine bar color (constraints are on relationships, not tasks)
                            const barColor = () => {
                                if (isLocked()) return COLORS.locked;
                                if (isDragging()) return '#2c3e50';
                                return COLORS.free;
                            };

                            return (
                                <g>
                                    <rect
                                        x={pos()?.x}
                                        y={pos()?.y}
                                        width={pos()?.width}
                                        height={pos()?.height}
                                        fill={barColor()}
                                        rx="4"
                                        style={{
                                            cursor: isLocked()
                                                ? 'not-allowed'
                                                : 'move',
                                            stroke: isLocked()
                                                ? '#c0392b'
                                                : '#2c3e50',
                                            'stroke-width': isLocked()
                                                ? '3'
                                                : '2',
                                            'stroke-dasharray': isLocked()
                                                ? '4,4'
                                                : 'none',
                                        }}
                                        onMouseDown={(e) =>
                                            handleMouseDown(task.id, e)
                                        }
                                    />
                                    <text
                                        x={
                                            (pos()?.x || 0) +
                                            (pos()?.width || 0) / 2
                                        }
                                        y={
                                            (pos()?.y || 0) +
                                            (pos()?.height || 0) / 2 +
                                            4
                                        }
                                        text-anchor="middle"
                                        fill="white"
                                        font-size="11"
                                        font-weight="600"
                                        style={{ 'pointer-events': 'none' }}
                                    >
                                        {task.name}
                                    </text>

                                    {/* Lock icon */}
                                    {isLocked() && (
                                        <text
                                            x={
                                                (pos()?.x || 0) +
                                                (pos()?.width || 0) -
                                                8
                                            }
                                            y={(pos()?.y || 0) + 10}
                                            font-size="10"
                                            style={{ 'pointer-events': 'none' }}
                                        >
                                            🔒
                                        </text>
                                    )}

                                    {/* Debug info */}
                                    {showDebug() && (
                                        <text
                                            x={pos()?.x}
                                            y={(pos()?.y || 0) - 2}
                                            font-size="9"
                                            fill="#aaa"
                                            style={{ 'pointer-events': 'none' }}
                                        >
                                            ({Math.round(pos()?.x || 0)},{' '}
                                            {Math.round(pos()?.y || 0)})
                                        </text>
                                    )}
                                </g>
                            );
                        }}
                    </For>
                </g>
            </svg>

            {/* Legend */}
            <div
                style={{
                    'margin-top': '20px',
                    padding: '15px',
                    'background-color': '#f8f9fa',
                    'border-radius': '8px',
                }}
            >
                <h3 style={{ margin: '0 0 12px 0', 'font-size': '14px' }}>
                    Legend - Relationship Constraints
                </h3>
                <div
                    style={{
                        display: 'grid',
                        'grid-template-columns':
                            'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '10px',
                        'font-size': '12px',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '8px',
                        }}
                    >
                        <span
                            style={{
                                width: '30px',
                                height: '2px',
                                background: COLORS.push,
                            }}
                        ></span>
                        <span>minDistance (push)</span>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '8px',
                        }}
                    >
                        <span
                            style={{
                                width: '30px',
                                height: '2px',
                                background: COLORS.pull,
                            }}
                        ></span>
                        <span>maxDistance (pull/tether)</span>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '8px',
                        }}
                    >
                        <span
                            style={{
                                width: '30px',
                                height: '2px',
                                background: '#f39c12',
                            }}
                        ></span>
                        <span>min + max (bounded)</span>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '8px',
                        }}
                    >
                        <span
                            style={{
                                width: '30px',
                                height: '4px',
                                background: COLORS.fixedOffset,
                                'border-radius': '2px',
                            }}
                        ></span>
                        <span>fixedOffset (dashed)</span>
                    </div>
                </div>
                <h4 style={{ margin: '15px 0 8px 0', 'font-size': '13px' }}>
                    Task Constraints
                </h4>
                <div
                    style={{
                        display: 'grid',
                        'grid-template-columns':
                            'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '10px',
                        'font-size': '12px',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '8px',
                        }}
                    >
                        <span
                            style={{
                                width: '20px',
                                height: '12px',
                                background: COLORS.free,
                                'border-radius': '2px',
                            }}
                        ></span>
                        <span>Free (draggable)</span>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '8px',
                        }}
                    >
                        <span
                            style={{
                                width: '20px',
                                height: '12px',
                                background: COLORS.locked,
                                'border-radius': '2px',
                                border: '2px dashed #c0392b',
                            }}
                        ></span>
                        <span>Locked (immovable)</span>
                    </div>
                </div>
            </div>

            {/* Scenario descriptions */}
            {activeScenario() && (
                <div
                    style={{
                        'margin-top': '15px',
                        padding: '15px',
                        'background-color': '#e7f5ff',
                        'border-radius': '8px',
                        'border-left': '4px solid #339af0',
                    }}
                >
                    <h3 style={{ margin: '0 0 8px 0', 'font-size': '14px' }}>
                        {activeScenario()?.title}
                    </h3>
                    <p
                        style={{
                            margin: 0,
                            'font-size': '13px',
                            color: '#495057',
                        }}
                    >
                        {activeScenario()?.description}
                    </p>
                </div>
            )}

            {/* Architecture note */}
            <div
                style={{
                    'margin-top': '15px',
                    padding: '15px',
                    'background-color': '#fff3cd',
                    'border-radius': '8px',
                    'border-left': '4px solid #ffc107',
                }}
            >
                <h3 style={{ margin: '0 0 8px 0', 'font-size': '14px' }}>
                    Architecture
                </h3>
                <p style={{ margin: 0, 'font-size': '13px', color: '#856404' }}>
                    <strong>Arrows</strong> are purely decorative - they render
                    a path between two rectangles.
                    <br />
                    <strong>Relationships</strong> own distance constraints
                    (minDistance, maxDistance, fixedOffset).
                    <br />
                    <strong>Tasks</strong> can be locked to prevent movement.
                </p>
            </div>
        </div>
    );
}
