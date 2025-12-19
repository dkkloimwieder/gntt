#!/usr/bin/env node
/**
 * CLI script to generate calendar.json for Gantt performance testing.
 *
 * Usage:
 *   node src/scripts/generateCalendar.js
 *   node src/scripts/generateCalendar.js --tasks=300 --seed=54321 --ss=30
 *   node src/scripts/generateCalendar.js --tasks=10000 --resources=130
 *   node src/scripts/generateCalendar.js --tasks=10000 --realistic
 *
 * Options:
 *   --tasks=N     Total number of tasks (default: 200)
 *   --seed=N      Random seed for reproducibility (default: 12345)
 *   --ss=N        Percentage of SS dependencies (default: 20)
 *   --minGroup=N  Minimum group size (default: 5)
 *   --maxGroup=N  Maximum group size (default: 20)
 *   --start=DATE  Start date YYYY-MM-DD (default: 2025-01-01)
 *   --resources=N Number of resources/rows (default: 26, A-Z)
 *   --realistic   Generate realistic arrow patterns (75% same-row, 20% adjacent)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateCalendar, DEFAULT_CONFIG } from '../utils/taskGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse CLI arguments into config object
 */
function parseArgs(args) {
    const config = { ...DEFAULT_CONFIG };

    for (const arg of args.slice(2)) {
        if (!arg.startsWith('--')) continue;

        const [key, value] = arg.replace('--', '').split('=');

        switch (key) {
            case 'tasks':
                config.totalTasks = parseInt(value, 10);
                break;
            case 'seed':
                config.seed = parseInt(value, 10);
                break;
            case 'ss':
                config.ssPercent = parseInt(value, 10);
                config.fsPercent = 100 - config.ssPercent;
                break;
            case 'minGroup':
                config.minGroupSize = parseInt(value, 10);
                break;
            case 'maxGroup':
                config.maxGroupSize = parseInt(value, 10);
                break;
            case 'start':
                config.startDate = value;
                break;
            case 'resources':
                config.resourceCount = parseInt(value, 10);
                break;
            case 'dense':
                config.dense = value === undefined || value === 'true' || value === '1';
                break;
            case 'realistic':
                config.realistic = value === undefined || value === 'true' || value === '1';
                break;
            case 'minDuration':
                config.minDuration = parseInt(value, 10);
                break;
            case 'maxDuration':
                config.maxDuration = parseInt(value, 10);
                break;
            case 'help':
            case 'h':
                console.log(`
Calendar Generator for Gantt Performance Testing

Usage:
  node src/scripts/generateCalendar.js [options]

Options:
  --tasks=N     Total number of tasks (default: 200)
  --seed=N      Random seed for reproducibility (default: 12345)
  --ss=N        Percentage of SS dependencies (default: 20)
  --minGroup=N  Minimum group size (default: 5)
  --maxGroup=N  Maximum group size (default: 20)
  --start=DATE  Start date YYYY-MM-DD (default: 2025-01-01)
  --resources=N Number of resources/rows (default: 26, A-Z)
  --dense       Pack tasks tightly (back-to-back, 1-5h, for stress testing)
  --realistic   Realistic arrow patterns (75% same-row, 20% adjacent, 5% none)
  --help        Show this help message
`);
                process.exit(0);
        }
    }

    return config;
}

// Main execution
const config = parseArgs(process.argv);
console.log('Generating calendar with config:', config);

const tasks = generateCalendar(config);

// Ensure data directory exists
const dataDir = resolve(__dirname, '../data');
mkdirSync(dataDir, { recursive: true });

// Build output object
const output = {
    generated: new Date().toISOString(),
    config,
    tasks,
};

// Write to data directory
const outputPath = resolve(dataDir, 'calendar.json');
writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`Generated ${tasks.length} tasks to ${outputPath}`);

// Print summary statistics
const resources = new Set(tasks.map((t) => t.resource));
const fsCount = tasks.filter((t) => typeof t.dependencies === 'string').length;
const ssCount = tasks.filter((t) => t.dependencies?.type === 'SS').length;
const noDeps = tasks.filter((t) => !t.dependencies).length;

console.log('\nSummary:');
console.log(`  Resources: ${resources.size} (${[...resources].sort().join(', ')})`);
console.log(`  Dependencies: ${fsCount} FS, ${ssCount} SS, ${noDeps} none (group starts)`);
console.log(`  Date range: ${tasks[0]?.start} to ${tasks[tasks.length - 1]?.end}`);
