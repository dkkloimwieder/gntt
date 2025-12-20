#!/usr/bin/env node
/**
 * Multi-step browser workflow with persistent session
 * 
 * Usage: node workflow.mjs <workflow.json>
 * 
 * Workflow JSON format:
 * {
 *   "url": "https://example.com",
 *   "headless": true,
 *   "steps": [
 *     { "action": "snapshot" },
 *     { "action": "click", "uid": "btn-login" },
 *     { "action": "fill", "uid": "input-email", "value": "user@example.com" },
 *     { "action": "click", "uid": "btn-submit" },
 *     { "action": "wait", "text": "Dashboard" },
 *     { "action": "screenshot", "path": "/tmp/result.png" },
 *     { "action": "perf-trace", "duration": 5000 }
 *   ]
 * }
 * 
 * Or pipe steps via stdin for interactive use.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

class MCPSession {
  constructor(options = {}) {
    this.options = options;
    this.proc = null;
    this.messageId = 0;
    this.callbacks = new Map();
    this.buffer = '';
  }

  async start() {
    const args = ['chrome-devtools-mcp@latest'];
    
    if (this.options.headless) args.push('--headless');
    if (this.options.isolated) args.push('--isolated');
    if (this.options.browserUrl) args.push(`--browserUrl=${this.options.browserUrl}`);
    if (this.options.viewport) args.push(`--viewport=${this.options.viewport}`);

    this.proc = spawn('npx', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.proc.stdout.on('data', (data) => this.handleData(data));
    this.proc.stderr.on('data', (data) => {
      if (process.env.DEBUG) console.error('[MCP]', data.toString());
    });

    // Initialize
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'workflow', version: '1.0.0' }
    });

    // Send initialized notification (no response expected)
    this.proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n');

    return this;
  }

  handleData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {
        if (process.env.DEBUG) console.error('Parse error:', e.message);
      }
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.callbacks.set(id, { resolve, reject });
      
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.proc.stdin.write(msg + '\n');

      setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 60000);
    });
  }

  async callTool(name, args = {}) {
    const result = await this.send('tools/call', { name, arguments: args });
    return result;
  }

  close() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

// Execute a single step
async function executeStep(session, step, context) {
  const { action } = step;
  let result;

  switch (action) {
    case 'navigate':
      result = await session.callTool('navigate_page', { url: step.url });
      break;

    case 'snapshot':
      result = await session.callTool('take_snapshot', { verbose: step.verbose || false });
      break;

    case 'click':
      result = await session.callTool('click', { uid: step.uid });
      break;

    case 'fill':
      result = await session.callTool('fill', { uid: step.uid, value: step.value });
      break;

    case 'hover':
      result = await session.callTool('hover', { uid: step.uid });
      break;

    case 'press-key':
      result = await session.callTool('press_key', { key: step.key });
      break;

    case 'screenshot':
      result = await session.callTool('take_screenshot', {
        filePath: step.path,
        fullPage: step.fullPage || false
      });
      break;

    case 'wait':
      result = await session.callTool('wait_for', {
        text: step.text,
        timeout: step.timeout || 30000
      });
      break;

    case 'eval':
      result = await session.callTool('evaluate_script', { expression: step.expression });
      break;

    case 'perf-start':
      result = await session.callTool('performance_start_trace', {
        reload: step.reload || false,
        autoStop: step.autoStop || false
      });
      break;

    case 'perf-stop':
      result = await session.callTool('performance_stop_trace', {});
      break;

    case 'perf-trace':
      // Combined: start, wait, stop
      await session.callTool('performance_start_trace', { reload: step.reload || false });
      await new Promise(r => setTimeout(r, step.duration || 5000));
      result = await session.callTool('performance_stop_trace', {});
      break;

    case 'sleep':
      await new Promise(r => setTimeout(r, step.duration || 1000));
      result = { slept: step.duration || 1000 };
      break;

    case 'console':
      result = await session.callTool('list_console_messages', {});
      break;

    case 'network':
      result = await session.callTool('list_network_requests', {
        pageSize: step.pageSize || 50
      });
      break;

    default:
      throw new Error(`Unknown action: ${action}`);
  }

  return result;
}

// Format result for output
function formatResult(result) {
  if (!result?.content) return '';
  
  return result.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');
}

// Run a workflow from JSON
async function runWorkflow(workflow) {
  const session = new MCPSession({
    headless: workflow.headless !== false,
    isolated: workflow.isolated,
    browserUrl: workflow.browserUrl,
    viewport: workflow.viewport
  });

  try {
    console.error('Starting browser session...');
    await session.start();

    // Navigate to initial URL if specified
    if (workflow.url) {
      console.error(`Navigating to ${workflow.url}...`);
      await session.callTool('navigate_page', { url: workflow.url });
    }

    const context = { results: [] };

    // Execute each step
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      console.error(`Step ${i + 1}/${workflow.steps.length}: ${step.action}${step.uid ? ` (${step.uid})` : ''}`);
      
      try {
        const result = await executeStep(session, step, context);
        const formatted = formatResult(result);
        
        context.results.push({ step: i + 1, action: step.action, success: true, output: formatted });
        
        if (formatted && step.action !== 'sleep') {
          console.log(`\n--- ${step.action} result ---`);
          console.log(formatted);
        }
      } catch (err) {
        console.error(`Step ${i + 1} failed: ${err.message}`);
        context.results.push({ step: i + 1, action: step.action, success: false, error: err.message });
        
        if (workflow.stopOnError !== false) {
          throw err;
        }
      }
    }

    console.error('\nWorkflow complete.');
    return context.results;

  } finally {
    session.close();
  }
}

// Interactive mode: read steps from stdin
async function runInteractive(options) {
  const session = new MCPSession({
    headless: options.headless !== false,
    isolated: options.isolated,
    browserUrl: options.browserUrl
  });

  console.error('Starting interactive session...');
  await session.start();
  console.error('Ready. Enter steps as JSON objects, one per line. Ctrl+C to exit.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    
    try {
      const step = JSON.parse(line);
      const result = await executeStep(session, step, {});
      console.log(formatResult(result));
    } catch (err) {
      console.error('Error:', err.message);
    }
  });

  rl.on('close', () => {
    session.close();
    process.exit(0);
  });
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
workflow.mjs - Multi-step browser automation with persistent session

USAGE:
  node workflow.mjs <workflow.json>     Run workflow from JSON file
  node workflow.mjs --interactive       Interactive mode (JSON steps via stdin)
  echo '{"action":"snapshot"}' | node workflow.mjs --interactive --url https://example.com

OPTIONS:
  --interactive, -i   Interactive mode
  --url <url>         Initial URL to navigate to
  --headless          Run headless (default: true)
  --no-headless       Show browser UI
  --browserUrl <url>  Connect to existing Chrome

WORKFLOW JSON FORMAT:
  {
    "url": "https://example.com",
    "headless": true,
    "steps": [
      { "action": "snapshot" },
      { "action": "click", "uid": "btn-login" },
      { "action": "fill", "uid": "input-email", "value": "test@example.com" },
      { "action": "screenshot", "path": "/tmp/result.png" },
      { "action": "perf-trace", "duration": 5000 }
    ]
  }

AVAILABLE ACTIONS:
  navigate      { "action": "navigate", "url": "..." }
  snapshot      { "action": "snapshot" }
  click         { "action": "click", "uid": "..." }
  fill          { "action": "fill", "uid": "...", "value": "..." }
  hover         { "action": "hover", "uid": "..." }
  press-key     { "action": "press-key", "key": "Enter" }
  screenshot    { "action": "screenshot", "path": "...", "fullPage": true }
  wait          { "action": "wait", "text": "...", "timeout": 30000 }
  eval          { "action": "eval", "expression": "document.title" }
  perf-start    { "action": "perf-start", "reload": true }
  perf-stop     { "action": "perf-stop" }
  perf-trace    { "action": "perf-trace", "duration": 5000 }
  sleep         { "action": "sleep", "duration": 1000 }
  console       { "action": "console" }
  network       { "action": "network" }
`);
    process.exit(0);
  }

  const interactive = args.includes('--interactive') || args.includes('-i');
  
  if (interactive) {
    const options = {
      headless: !args.includes('--no-headless'),
      browserUrl: args.find((a, i) => args[i-1] === '--browserUrl'),
      url: args.find((a, i) => args[i-1] === '--url')
    };
    
    const session = new MCPSession({
      headless: options.headless,
      browserUrl: options.browserUrl
    });

    console.error('Starting session...');
    await session.start();
    
    if (options.url) {
      console.error(`Navigating to ${options.url}...`);
      await session.callTool('navigate_page', { url: options.url });
    }
    
    console.error('Ready. Enter JSON steps or Ctrl+C to exit.\n');
    
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    
    rl.on('line', async (line) => {
      if (!line.trim()) return;
      try {
        const step = JSON.parse(line);
        const result = await executeStep(session, step, {});
        console.log(formatResult(result));
      } catch (err) {
        console.error('Error:', err.message);
      }
    });
    
    rl.on('close', () => {
      session.close();
      process.exit(0);
    });
    
  } else {
    // Workflow file mode
    const workflowFile = args.find(a => !a.startsWith('-'));
    
    if (!workflowFile) {
      console.error('Error: No workflow file specified');
      console.error('Usage: node workflow.mjs <workflow.json>');
      process.exit(1);
    }

    if (!existsSync(workflowFile)) {
      console.error(`Error: File not found: ${workflowFile}`);
      process.exit(1);
    }

    const workflow = JSON.parse(readFileSync(workflowFile, 'utf-8'));
    await runWorkflow(workflow);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
