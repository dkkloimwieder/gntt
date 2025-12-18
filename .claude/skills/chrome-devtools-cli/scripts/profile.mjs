#!/usr/bin/env node
/**
 * Performance profiler CLI
 * Captures detailed CPU profiles, call trees, rendering stats
 */

import { captureProfile, CPUProfiler, Tracer, PerformanceMetrics, HeapProfiler } from './lib/profiler.mjs';
import { connectToPage } from './lib/cdp-client.mjs';
import { writeFileSync } from 'node:fs';

const VERSION = '1.0.0';

function printHelp() {
  console.log(`
chrome-devtools-profiler v${VERSION}
Detailed performance profiling via Chrome DevTools Protocol

REQUIREMENTS:
  Chrome must be running with remote debugging enabled:
  google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile

USAGE:
  node profile.mjs <command> [options]

COMMANDS:
  capture           Full profile capture (CPU + rendering + metrics)
  cpu               CPU profile with call tree
  trace             Timeline trace with rendering stats
  metrics           Performance metrics snapshot
  heap              Heap snapshot

OPTIONS:
  --browserUrl, -b  Chrome debug URL (default: http://127.0.0.1:9222)
  --duration, -d    Capture duration in ms (default: 5000)
  --url, -u         Navigate to URL before profiling
  --output, -o      Output file (JSON)
  --page, -p        Page index to profile (default: 0)
  --format, -f      Output format: json, summary (default: summary)

EXAMPLES:
  # Full profile of current page for 5 seconds
  node profile.mjs capture

  # Profile specific URL for 10 seconds
  node profile.mjs capture --url https://example.com --duration 10000

  # CPU profile only, save to file
  node profile.mjs cpu --duration 3000 --output cpu-profile.json

  # Get current metrics
  node profile.mjs metrics

  # Trace rendering performance
  node profile.mjs trace --duration 5000
`);
}

function parseArgs(args) {
  const result = { command: null, options: {} };
  
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '-b' || arg === '--browserUrl') {
      result.options.browserUrl = args[++i];
    } else if (arg === '-d' || arg === '--duration') {
      result.options.duration = parseInt(args[++i], 10);
    } else if (arg === '-u' || arg === '--url') {
      result.options.url = args[++i];
    } else if (arg === '-o' || arg === '--output') {
      result.options.output = args[++i];
    } else if (arg === '-p' || arg === '--page') {
      result.options.pageIndex = parseInt(args[++i], 10);
    } else if (arg === '-f' || arg === '--format') {
      result.options.format = args[++i];
    } else if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      result.options[key] = val ?? true;
    } else if (!result.command) {
      result.command = arg;
    }
    i++;
  }
  
  return result;
}

function formatCallTree(tree, indent = 0) {
  if (!tree) return '';
  
  const prefix = '  '.repeat(indent);
  let output = `${prefix}${tree.name} (${tree.totalPercent}% total, ${tree.selfPercent}% self)`;
  
  if (tree.location) {
    output += ` @ ${tree.location}`;
  }
  output += '\n';
  
  if (tree.children) {
    for (const child of tree.children.slice(0, 5)) { // Top 5 children
      output += formatCallTree(child, indent + 1);
    }
    if (tree.children.length > 5) {
      output += `${prefix}  ... and ${tree.children.length - 5} more\n`;
    }
  }
  
  return output;
}

function formatSummary(results) {
  let output = '';
  
  output += `\n${'='.repeat(60)}\n`;
  output += `PERFORMANCE PROFILE - ${results.url || 'Current Page'}\n`;
  output += `Captured: ${results.capturedAt}\n`;
  output += `Duration: ${results.duration}\n`;
  output += `${'='.repeat(60)}\n`;

  if (results.metrics) {
    output += `\n📊 METRICS\n`;
    output += `-`.repeat(40) + '\n';
    output += `  DOM Nodes: ${results.metrics.nodes}\n`;
    output += `  JS Event Listeners: ${results.metrics.jsEventListeners}\n`;
    output += `  Layout Count: ${results.metrics.layoutCount}\n`;
    output += `  Style Recalcs: ${results.metrics.recalcStyleCount}\n`;
    output += `  Script Duration: ${results.metrics.scriptDuration}\n`;
    output += `  Layout Duration: ${results.metrics.layoutDuration}\n`;
    output += `  JS Heap Used: ${results.metrics.jsHeapSizeUsed}\n`;
  }

  if (results.cpu) {
    output += `\n🔥 HOT FUNCTIONS (by self time)\n`;
    output += `-`.repeat(40) + '\n';
    
    if (results.cpu.hotFunctions?.length > 0) {
      for (const fn of results.cpu.hotFunctions.slice(0, 10)) {
        output += `  ${fn.selfPercent.padStart(6)} | ${fn.selfTime.padStart(10)} | ${fn.function}\n`;
        if (fn.location !== '(native)') {
          output += `         ${fn.location}\n`;
        }
      }
    } else {
      output += `  No significant function calls captured\n`;
    }

    if (results.cpu.callTree?.tree) {
      output += `\n📈 CALL TREE (functions > 1% of total time)\n`;
      output += `-`.repeat(40) + '\n';
      output += formatCallTree(results.cpu.callTree.tree);
    }
  }

  if (results.rendering) {
    const r = results.rendering;
    output += `\n🎨 RENDERING\n`;
    output += `-`.repeat(40) + '\n';
    output += `  Frames: ${r.frames.count} (${r.frames.fps} FPS avg, ${r.frames.jank} janky)\n`;
    output += `  Paints: ${r.paints.count} (${r.paints.totalTime} total, ${r.paints.avgTime} avg)\n`;
    output += `  Layouts: ${r.layouts.count} (${r.layouts.totalTime} total, ${r.layouts.avgTime} avg)\n`;
    output += `  Scripts: ${r.scripts.count} executions (${r.scripts.totalTime} total)\n`;
    output += `  GC: ${r.gc.count} collections (${r.gc.totalTime} total)\n`;
    
    if (r.longTasks.count > 0) {
      output += `\n⚠️  LONG TASKS (>50ms)\n`;
      output += `-`.repeat(40) + '\n';
      output += `  Count: ${r.longTasks.count}\n`;
      output += `  Total Blocking Time: ${r.longTasks.totalTime}\n`;
    }
  }

  if (results.heap) {
    output += `\n💾 HEAP\n`;
    output += `-`.repeat(40) + '\n';
    // Basic heap info from sampling profile
    output += `  Sampling profile captured\n`;
  }

  output += `\n${'='.repeat(60)}\n`;
  
  return output;
}

async function runCapture(options) {
  console.error('Starting profile capture...');
  
  const results = await captureProfile({
    browserUrl: options.browserUrl || 'http://127.0.0.1:9222',
    pageIndex: options.pageIndex || 0,
    duration: options.duration || 5000,
    url: options.url,
    includeCPU: true,
    includeTracing: true,
    includeHeap: false
  });
  
  return results;
}

async function runCPU(options) {
  console.error('Starting CPU profile...');
  
  const client = await connectToPage(
    options.browserUrl || 'http://127.0.0.1:9222',
    options.pageIndex || 0
  );
  
  try {
    if (options.url) {
      await client.send('Page.enable');
      await client.send('Page.navigate', { url: options.url });
      await new Promise(r => setTimeout(r, 1000));
    }
    
    const profiler = new CPUProfiler(client);
    await profiler.enable();
    await profiler.setSamplingInterval(100);
    await profiler.start();
    
    await new Promise(r => setTimeout(r, options.duration || 5000));
    
    const profile = await profiler.stop();
    await profiler.disable();
    
    return {
      url: client.targetInfo?.url,
      capturedAt: new Date().toISOString(),
      duration: (options.duration || 5000) + 'ms',
      cpu: {
        rawProfile: profile,
        hotFunctions: profiler.getHotFunctions(profile),
        callTree: profiler.getCallTree(profile)
      }
    };
  } finally {
    client.close();
  }
}

async function runTrace(options) {
  console.error('Starting trace...');
  
  const client = await connectToPage(
    options.browserUrl || 'http://127.0.0.1:9222',
    options.pageIndex || 0
  );
  
  try {
    if (options.url) {
      await client.send('Page.enable');
      await client.send('Page.navigate', { url: options.url });
      await new Promise(r => setTimeout(r, 1000));
    }
    
    const tracer = new Tracer(client);
    await tracer.start();
    
    await new Promise(r => setTimeout(r, options.duration || 5000));
    
    const events = await tracer.stop();
    
    return {
      url: client.targetInfo?.url,
      capturedAt: new Date().toISOString(),
      duration: (options.duration || 5000) + 'ms',
      rendering: tracer.getRenderingStats(events),
      traceEventCount: events.length,
      rawEvents: options.includeRaw ? events : undefined
    };
  } finally {
    client.close();
  }
}

async function runMetrics(options) {
  const client = await connectToPage(
    options.browserUrl || 'http://127.0.0.1:9222',
    options.pageIndex || 0
  );
  
  try {
    const perfMetrics = new PerformanceMetrics(client);
    await perfMetrics.enable();
    
    return {
      url: client.targetInfo?.url,
      capturedAt: new Date().toISOString(),
      metrics: await perfMetrics.getMetrics()
    };
  } finally {
    client.close();
  }
}

async function runHeap(options) {
  console.error('Capturing heap snapshot (this may take a moment)...');
  
  const client = await connectToPage(
    options.browserUrl || 'http://127.0.0.1:9222',
    options.pageIndex || 0
  );
  
  try {
    const heapProfiler = new HeapProfiler(client);
    await heapProfiler.enable();
    
    const snapshot = await heapProfiler.takeSnapshot();
    const summary = heapProfiler.parseSnapshotSummary(snapshot);
    
    await heapProfiler.disable();
    
    return {
      url: client.targetInfo?.url,
      capturedAt: new Date().toISOString(),
      heap: {
        summary,
        rawSnapshot: options.includeRaw ? snapshot : undefined
      }
    };
  } finally {
    client.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  
  const { command, options } = parseArgs(args);
  
  let results;
  
  try {
    switch (command) {
      case 'capture':
        results = await runCapture(options);
        break;
      case 'cpu':
        results = await runCPU(options);
        break;
      case 'trace':
        results = await runTrace(options);
        break;
      case 'metrics':
        results = await runMetrics(options);
        break;
      case 'heap':
        results = await runHeap(options);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
    
    // Output
    if (options.output) {
      writeFileSync(options.output, JSON.stringify(results, null, 2));
      console.error(`Results saved to: ${options.output}`);
    }
    
    if (options.format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatSummary(results));
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('ECONNREFUSED')) {
      console.error('\nMake sure Chrome is running with remote debugging:');
      console.error('  google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile');
    }
    process.exit(1);
  }
}

main();
