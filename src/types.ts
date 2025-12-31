/**
 * Type definitions for Frappe Gantt SolidJS
 */

/**
 * Dependency type codes
 * - FS: Finish-to-Start (default) - successor starts after predecessor finishes
 * - SS: Start-to-Start - successor starts when predecessor starts
 * - FF: Finish-to-Finish - successor finishes when predecessor finishes
 * - SF: Start-to-Finish - successor finishes when predecessor starts
 */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

/**
 * A dependency relationship to a predecessor task
 */
export interface Dependency {
    /** ID of the predecessor task */
    id: string;
    /** Dependency type (default: 'FS') */
    type?: DependencyType;
    /** Base offset in hours (default: 0) */
    lag?: number;
    /**
     * Maximum gap behavior:
     * - undefined: elastic (gap can grow, push only)
     * - 0: fixed (gap must equal lag exactly, push+pull)
     * - N: bounded (gap can grow up to N hours, pull when exceeded)
     */
    max?: number;
}

/**
 * Normalized dependency with defaults applied
 */
export interface NormalizedDependency {
    id: string;
    type: DependencyType;
    lag: number;
    max?: number;
}

/**
 * Lock state for a task
 * - true: completely locked (no move, no resize)
 * - 'start': start position locked (can resize right edge only)
 * - 'end': end position locked (can resize left edge only)
 * - 'duration': duration locked (can move, cannot resize)
 */
export type LockState = boolean | 'start' | 'end' | 'duration';

/**
 * Constraint configuration for a task
 */
export interface TaskConstraints {
    /** Lock state (default: false) */
    locked?: LockState;

    // Absolute time constraints (datetime strings: "YYYY-MM-DD HH:MM")
    /** Task cannot start before this time */
    minStart?: string;
    /** Task cannot start after this time */
    maxStart?: string;
    /** Task cannot end before this time */
    minEnd?: string;
    /** Task cannot end after this time (deadline) */
    maxEnd?: string;

    // Duration constraints (in hours)
    /** Minimum duration in hours */
    minDuration?: number;
    /** Maximum duration in hours */
    maxDuration?: number;
    /** Fixed duration in hours (cannot resize) */
    fixedDuration?: number;
}

/**
 * Normalized constraints with defaults applied
 */
export interface NormalizedConstraints extends TaskConstraints {
    locked: LockState;
}

/**
 * Bar position and dimensions (in pixels)
 */
export interface BarPosition {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Raw task input (what you provide to the Gantt chart).
 * Allows flexible input with optional fields and string/Date dates.
 */
export interface GanttTaskInput {
    /** Unique task identifier (auto-generated if missing) */
    id?: string;
    /** Display name */
    name?: string;
    /** Start datetime - string ("YYYY-MM-DD HH:MM") or Date */
    start?: string | Date;
    /** End datetime - string ("YYYY-MM-DD HH:MM") or Date */
    end?: string | Date;
    /** Duration string (e.g., "2d", "8h") - alternative to end */
    duration?: string;
    /** Progress percentage (0-100) */
    progress?: number;
    /** Resource/swimlane assignment */
    resource?: string;
    /** Dependencies on predecessor tasks */
    dependencies?: Dependency[];
    /** Constraint configuration */
    constraints?: Partial<TaskConstraints>;
    /** Parent task ID for nested tasks */
    parentId?: string;
    /** Task type: 'task' | 'milestone' | 'project' | 'summary' */
    type?: string;
    /** Bar color (hex) */
    color?: string;
    /** Progress bar color (hex with alpha) */
    color_progress?: string;
    /** Background fill color (rgba) */
    color_bg?: string;
    /** Progress fill color (rgba) */
    color_fill?: string;
    /** Subtask layout mode for parent tasks */
    subtaskLayout?: 'sequential' | 'parallel' | 'mixed';
    /** Sort order within resource */
    order?: number;
}

/**
 * Task configuration (normalized input with required fields)
 */
export interface GanttTask {
    /** Unique task identifier */
    id: string;
    /** Display name */
    name: string;
    /** Start datetime ("YYYY-MM-DD HH:MM") */
    start: string;
    /** End datetime ("YYYY-MM-DD HH:MM") - optional if duration provided */
    end?: string;
    /** Duration string (e.g., "2d", "8h") - alternative to end */
    duration?: string;
    /** Progress percentage (0-100) */
    progress?: number;
    /** Resource/swimlane assignment */
    resource?: string;
    /** Dependencies on predecessor tasks (always an array) */
    dependencies?: Dependency[];
    /** Constraint configuration */
    constraints?: TaskConstraints;

    // Hierarchy fields (for subtasks)
    /** Parent task ID for nested tasks */
    parentId?: string;
    /** Task type: 'task' | 'milestone' | 'project' */
    type?: string;

    // Optional styling (pre-computed by generator)
    /** Bar color (hex) */
    color?: string;
    /** Progress bar color (hex with alpha) */
    color_progress?: string;
    /** Background fill color (rgba) */
    color_bg?: string;
    /** Progress fill color (rgba) */
    color_fill?: string;

    /** Subtask layout mode for parent tasks */
    subtaskLayout?: 'sequential' | 'parallel' | 'mixed';
    /** Sort order within resource */
    order?: number;
}

/**
 * Processed task (internal representation after processing)
 * Includes computed fields prefixed with _ or $
 */
export interface ProcessedTask extends Omit<GanttTask, 'dependencies' | 'constraints'> {
    /** Parsed start date */
    _start: Date;
    /** Parsed end date */
    _end: Date;
    /** Task index in array */
    _index: number;
    /** Resource row index (-1 if hidden) */
    _resourceIndex: number;
    /** Whether task is hidden (collapsed group) */
    _isHidden: boolean;
    /** Child task IDs (for parent tasks) */
    _children: string[];
    /** Nesting depth */
    _depth: number;
    /** Subtask layout mode */
    subtaskLayout?: 'sequential' | 'parallel' | 'mixed';
    /** Computed bar position */
    _bar: BarPosition;
    /** Normalized dependencies (always array with defaults applied) */
    dependencies: NormalizedDependency[];
    /** Normalized constraints (always has locked field) */
    constraints: NormalizedConstraints;
}

/**
 * Relationship between tasks (derived from dependencies)
 */
export interface Relationship {
    /** Predecessor task ID */
    from: string;
    /** Successor task ID */
    to: string;
    /** Dependency type */
    type: DependencyType;
    /** Lag in hours */
    lag: number;
    /** Minimum offset from lag (default: 0) */
    min?: number;
    /** Maximum offset (undefined = elastic, 0 = fixed, N = bounded) */
    max?: number;
    /** Whether this is an elastic constraint (can grow but not shrink) */
    elastic?: boolean;
}

/**
 * Result of constraint resolution
 */
export interface ConstraintResult {
    /** Final X position after constraints */
    constrainedX: number;
    /** Final width after constraints */
    constrainedWidth: number;
    /** Whether the move/resize was blocked */
    blocked: boolean;
    /** Reason for blocking: 'locked' | 'conflicting_constraints' | null */
    blockReason: string | null;
    /** Map of successor task IDs to their new positions */
    cascadeUpdates: Map<string, { x: number }>;
}

/**
 * Context object for constraint resolution
 */
export interface ConstraintContext {
    /** Get bar position for a task by ID */
    getBarPosition: (id: string) => BarPosition | undefined;
    /** Get task data by ID */
    getTask: (id: string) => ProcessedTask | undefined;
    /** All relationships in the chart */
    relationships: Relationship[];
    /** Pixels per hour (for time-to-pixel conversion) */
    pixelsPerHour: number;
    /** Gantt chart start date */
    ganttStartDate: Date;
}

/**
 * View mode configuration for timeline display
 */
export interface ViewMode {
    /** Display name (e.g., 'Day', 'Week', 'Month') */
    name: string;
    /** Padding for timeline edges (e.g., '7d', '1m') */
    padding?: string;
    /** Step size (e.g., '1d', '1h', '15min') */
    step: string;
    /** Column width in pixels */
    column_width?: number;
    /** Date format string */
    date_format?: string;
    /** Lower header text - string or function */
    lower_text: string | ((date: Date, lastDate: Date | null, language: string) => string);
    /** Upper header text - string or function */
    upper_text?: string | ((date: Date, lastDate: Date | null, language: string) => string);
    /** How often upper text changes (thin lines per thick) */
    upper_text_frequency?: number;
    /** Function to determine thick separator lines */
    thick_line?: (date: Date) => boolean;
    /** Snap increment (e.g., '7d') */
    snap_at?: string;
}

/**
 * Gantt chart configuration options
 */
export interface GanttConfigOptions {
    /** Chart start date */
    ganttStart?: Date;
    /** Chart end date */
    ganttEnd?: Date;
    /** Time unit ('minute' | 'hour' | 'day' | 'week' | 'month' | 'year') */
    unit?: string;
    /** Units per column */
    step?: number;
    /** Column width in pixels */
    columnWidth?: number;
    /** Bar height in pixels */
    barHeight?: number;
    /** Header height in pixels */
    headerHeight?: number;
    /** Vertical padding between bars */
    padding?: number;
    /** Bar corner radius */
    barCornerRadius?: number;
    /** Disable all interactions */
    readonly?: boolean;
    /** Disable date changes only */
    readonlyDates?: boolean;
    /** Disable progress changes */
    readonlyProgress?: boolean;
    /** Show expected progress indicator */
    showExpectedProgress?: boolean;
    /** Auto-position task labels */
    autoMoveLabel?: boolean;
    /** Dates to skip (weekends, holidays) */
    ignoredDates?: Date[];
    /** Function to determine if date should be skipped */
    ignoredFunction?: (date: Date) => boolean;
    /** Computed ignored X positions */
    ignoredPositions?: number[];
    /** Subtask height as ratio of parent */
    subtaskHeightRatio?: number;
    /** Render mode: 'simple' | 'detailed' */
    renderMode?: 'simple' | 'detailed';
    /** IDs of expanded parent tasks */
    expandedTasks?: Set<string>;
}

/**
 * Resource (swimlane) configuration
 */
export interface Resource {
    /** Unique resource identifier */
    id: string;
    /** Display name (optional, defaults to id) */
    name?: string;
    /** Resource type */
    type: 'resource' | 'group';
    /** Group this resource belongs to */
    group?: string;
}

/** Raw resource input - can be string or Resource object */
export type ResourceInput = string | Resource;

/**
 * Date column information for header rendering
 */
export interface DateInfo {
    /** The date for this column */
    date: Date;
    /** X position of column */
    x: number;
    /** Column width */
    width: number;
    /** Lower header text (day, hour, etc.) */
    lowerText: string;
    /** Upper header text (month, year, etc.) */
    upperText: string;
    /** Whether to show thick separator line */
    isThickLine: boolean;
}

/**
 * Relationship index for O(1) constraint lookups
 */
export interface RelationshipIndex {
    /** Relationships where task is the successor (to) */
    bySuccessor: Map<string, Relationship[]>;
    /** Relationships where task is the predecessor (from) */
    byPredecessor: Map<string, Relationship[]>;
}

/**
 * Dependency offset calculations
 */
export interface DepOffsets {
    /** Base lag in pixels */
    lag: number;
    /** Minimum offset from lag */
    min: number;
    /** Maximum offset (Infinity for elastic) */
    max: number;
    /** Minimum gap (lag + min) */
    minGap: number;
    /** Maximum gap (lag + max) */
    maxGap: number;
    /** Whether gap can grow indefinitely */
    isElastic: boolean;
    /** Whether gap is fixed (push & pull) */
    isFixed: boolean;
}
