/**
 * JSON formatting utilities for task data display
 */

/**
 * Format task data for compact popup display
 * @param {Object} task - Task object
 * @param {Object} barPosition - Bar position {x, y, width, height}
 * @returns {string} Formatted text
 */
export function formatTaskCompact(task, barPosition) {
    if (!task) return '';

    const lines = [
        `Task: "${task.name || 'Unnamed'}"`,
        `ID: ${task.id}`,
        `Progress: ${task.progress ?? 0}%`,
    ];

    if (barPosition) {
        lines.push(
            `Position: (${Math.round(barPosition.x)}, ${Math.round(barPosition.y)})`,
        );
        lines.push(
            `Size: ${Math.round(barPosition.width)} x ${Math.round(barPosition.height)}`,
        );
    }

    if (task.constraints?.locked) {
        lines.push(`Status: Locked`);
    }

    if (task.invalid) {
        lines.push(`Status: Invalid`);
    }

    return lines.join('\n');
}

/**
 * Format task data for full modal display
 * @param {Object} task - Task object
 * @param {Object} barPosition - Bar position {x, y, width, height}
 * @param {Array} relationships - Array of relationship objects
 * @returns {Object} { sections: {rawTask, position, relationships}, raw: string }
 */
export function formatTaskFull(task, barPosition, relationships = []) {
    if (!task) return null;

    // Create a clean copy without internal $bar property
    const taskCopy = { ...task };
    delete taskCopy.$bar;

    const sections = {
        rawTask: JSON.stringify(taskCopy, null, 2),
        position: barPosition
            ? JSON.stringify(
                  {
                      x: Math.round(barPosition.x),
                      y: Math.round(barPosition.y),
                      width: Math.round(barPosition.width),
                      height: Math.round(barPosition.height),
                      index: barPosition.index,
                  },
                  null,
                  2,
              )
            : 'N/A',
        relationships: formatRelationships(task.id, relationships),
    };

    return {
        sections,
        raw: JSON.stringify({ task: taskCopy, position: barPosition }, null, 2),
    };
}

/**
 * Human-readable names for constraint types
 */
const CONSTRAINT_TYPE_NAMES = {
    FS: 'Finish-to-Start',
    SS: 'Start-to-Start',
    FF: 'Finish-to-Finish',
    SF: 'Start-to-Finish',
};

/**
 * Format a single relationship for display
 * @param {Object} rel - Relationship object
 * @param {string} taskId - The task ID to show (from or to depending on direction)
 * @param {string} arrow - Arrow direction ('<-' or '->')
 * @returns {string} Formatted relationship line
 */
function formatRelationshipLine(rel, taskId, arrow) {
    const typeName = CONSTRAINT_TYPE_NAMES[rel.type] || rel.type;
    const lag = rel.lag ?? 0;
    const lagStr = lag ? `, lag: ${lag} day${lag !== 1 ? 's' : ''}` : '';
    return `  ${rel.type} ${arrow} ${taskId} (${typeName}${lagStr})`;
}

/**
 * Format relationships for display
 * @param {string} taskId - Current task ID
 * @param {Array} relationships - Array of relationship objects
 * @returns {string} Formatted relationships text
 */
function formatRelationships(taskId, relationships) {
    if (!relationships || relationships.length === 0) {
        return 'No relationships defined';
    }

    const incoming = relationships.filter((r) => r.to === taskId);
    const outgoing = relationships.filter((r) => r.from === taskId);

    let result = '';

    if (incoming.length === 0) {
        result += 'Incoming: (none)\n';
    } else {
        result += 'Incoming:\n';
        incoming.forEach((r) => {
            result += formatRelationshipLine(r, r.from, '<-') + '\n';
        });
    }

    if (outgoing.length === 0) {
        result += 'Outgoing: (none)';
    } else {
        result += 'Outgoing:\n';
        outgoing.forEach((r, i) => {
            result += formatRelationshipLine(r, r.to, '->');
            if (i < outgoing.length - 1) result += '\n';
        });
    }

    return result;
}

/**
 * Add syntax highlighting to JSON string
 * @param {string} jsonString - JSON string to highlight
 * @returns {string} HTML string with span tags for highlighting
 */
export function highlightJSON(jsonString) {
    if (!jsonString) return '';

    return (
        jsonString
            // Keys (property names in quotes followed by colon)
            .replace(
                /"([^"]+)":/g,
                '<span style="color: #9b59b6;">"$1"</span>:',
            )
            // String values
            .replace(
                /: "([^"]+)"/g,
                ': <span style="color: #27ae60;">"$1"</span>',
            )
            // Numbers
            .replace(
                /: (-?\d+\.?\d*)/g,
                ': <span style="color: #e74c3c;">$1</span>',
            )
            // Booleans
            .replace(
                /: (true|false)/g,
                ': <span style="color: #3498db;">$1</span>',
            )
            // Null
            .replace(/: (null)/g, ': <span style="color: #95a5a6;">$1</span>')
    );
}
