/**
 * Shared constants for the Gantt chart library.
 * Centralizes magic numbers used across multiple files.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SUBTASK LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Subtask padding as a ratio of the main row padding.
 * Used in: ExpandedTaskContainer, rowLayoutCalculator, barCalculations
 */
export const SUBTASK_PADDING_RATIO = 0.4;

/**
 * Default subtask bar height as a ratio of the main bar height.
 */
export const SUBTASK_HEIGHT_RATIO = 0.5;

// ═══════════════════════════════════════════════════════════════════════════════
// ARROW ROUTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pixels to extend past an obstacle when routing arrows.
 * Used in Arrow.jsx for orthogonal routing.
 */
export const ARROW_OVERSHOOT = 25;

/**
 * Bezier control point ratio for approximating a circle arc.
 * Mathematical constant: 4 * (sqrt(2) - 1) / 3 ≈ 0.5523
 */
export const BEZIER_CIRCLE_K = 0.5523;

// ═══════════════════════════════════════════════════════════════════════════════
// BAR DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Default bar corner radius in pixels.
 */
export const DEFAULT_BAR_CORNER_RADIUS = 3;

/**
 * Default column width in pixels.
 */
export const DEFAULT_COLUMN_WIDTH = 45;

/**
 * Default bar height in pixels.
 */
export const DEFAULT_BAR_HEIGHT = 30;

/**
 * Default padding between bars in pixels.
 */
export const DEFAULT_BAR_PADDING = 18;
