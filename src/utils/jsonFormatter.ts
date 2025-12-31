import type { BarPosition, Relationship, ProcessedTask, DependencyType } from '../types';

interface TaskFormattable {
    id: string;
    name?: string;
    progress?: number;
    constraints?: { locked?: unknown };
    invalid?: boolean;
    _bar?: BarPosition;
}

interface FormattedTaskFull {
    sections: {
        rawTask: string;
        position: string;
        relationships: string;
    };
    raw: string;
}

export function formatTaskCompact(task: TaskFormattable | null | undefined, barPosition?: BarPosition): string {
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

export function formatTaskFull(
    task: TaskFormattable | null | undefined,
    barPosition?: BarPosition,
    relationships: Relationship[] = []
): FormattedTaskFull | null {
    if (!task) return null;

    const taskCopy = { ...task } as Record<string, unknown>;
    delete taskCopy['_bar'];

    const sections = {
        rawTask: JSON.stringify(taskCopy, null, 2),
        position: barPosition
            ? JSON.stringify(
                  {
                      x: Math.round(barPosition.x),
                      y: Math.round(barPosition.y),
                      width: Math.round(barPosition.width),
                      height: Math.round(barPosition.height),
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

const CONSTRAINT_TYPE_NAMES: Record<DependencyType, string> = {
    FS: 'Finish-to-Start',
    SS: 'Start-to-Start',
    FF: 'Finish-to-Finish',
    SF: 'Start-to-Finish',
};

function formatRelationshipLine(rel: Relationship, taskId: string, arrow: string): string {
    const typeName = CONSTRAINT_TYPE_NAMES[rel.type] || rel.type;
    const lag = rel.lag ?? 0;
    const lagStr = lag ? `, lag: ${lag} day${lag !== 1 ? 's' : ''}` : '';
    return `  ${rel.type} ${arrow} ${taskId} (${typeName}${lagStr})`;
}

function formatRelationships(taskId: string, relationships: Relationship[]): string {
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

export function highlightJSON(jsonString: string | null | undefined): string {
    if (!jsonString) return '';

    return (
        jsonString
            .replace(
                /"([^"]+)":/g,
                '<span style="color: #9b59b6;">"$1"</span>:',
            )
            .replace(
                /: "([^"]+)"/g,
                ': <span style="color: #27ae60;">"$1"</span>',
            )
            .replace(
                /: (-?\d+\.?\d*)/g,
                ': <span style="color: #e74c3c;">$1</span>',
            )
            .replace(
                /: (true|false)/g,
                ': <span style="color: #3498db;">$1</span>',
            )
            .replace(/: (null)/g, ': <span style="color: #95a5a6;">$1</span>')
    );
}
