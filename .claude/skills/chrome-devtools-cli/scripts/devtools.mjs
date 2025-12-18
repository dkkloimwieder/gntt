#!/usr/bin/env node
/**
 * CLI wrapper for chrome-devtools-mcp
 * Translates CLI commands to MCP tool calls
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const STATE_FILE = join(tmpdir(), 'chrome-devtools-cli.state');
const VERSION = '1.0.0';

// Tool definitions for CLI help
const TOOLS = {
  // Navigation
  navigate: { tool: 'navigate_page', args: ['url'], desc: 'Navigate to URL' },
  back: { tool: 'navigate_page', fixed: { type: 'back' }, desc: 'Go back in history' },
  forward: { tool: 'navigate_page', fixed: { type: 'forward' }, desc: 'Go forward in history' },
  reload: { tool: 'navigate_page', fixed: { type: 'reload' }, desc: 'Reload page' },
  'new-page': { tool: 'new_page', args: ['url'], desc: 'Open URL in new page' },
  'list-pages': { tool: 'list_pages', desc: 'List open pages' },
  'select-page': { tool: 'select_page', args: ['pageIdx:number'], desc: 'Select page by index' },
  'close-page': { tool: 'close_page', args: ['pageIdx:number'], desc: 'Close page by index' },
  
  // Input
  click: { tool: 'click', args: ['uid'], desc: 'Click element by uid' },
  fill: { tool: 'fill', args: ['uid', 'value'], desc: 'Fill input element' },
  hover: { tool: 'hover', args: ['uid'], desc: 'Hover over element' },
  'press-key': { tool: 'press_key', args: ['key'], desc: 'Press key (e.g., Enter, Control+A)' },
  
  // Debugging
  screenshot: { tool: 'take_screenshot', opts: ['filePath', 'format', 'fullPage:boolean'], desc: 'Take screenshot' },
  snapshot: { tool: 'take_snapshot', opts: ['filePath', 'verbose:boolean'], desc: 'Take accessibility tree snapshot' },
  'eval': { tool: 'evaluate_script', args: ['expression'], desc: 'Evaluate JavaScript' },
  console: { tool: 'list_console_messages', desc: 'List console messages' },
  
  // Network
  'list-requests': { tool: 'list_network_requests', opts: ['pageSize:number', 'resourceTypes'], desc: 'List network requests' },
  'get-request': { tool: 'get_network_request', args: ['reqid:number'], desc: 'Get request details' },
  
  // Performance (MCP-based)
  'perf-start': { tool: 'performance_start_trace', opts: ['reload:boolean', 'autoStop:boolean'], desc: 'Start performance trace' },
  'perf-stop': { tool: 'performance_stop_trace', desc: 'Stop performance trace' },
  'perf-analyze': { tool: 'performance_analyze_insight', args: ['insightSetId', 'insightName'], desc: 'Analyze performance insight' },
  
  // Deep profiling (CDP direct) - delegated to profile.mjs
  'profile': { custom: 'profile', args: ['command'], opts: ['duration:number', 'url', 'output'], desc: 'Deep profile (capture|cpu|trace|metrics|heap)' },
  
  // Emulation
  emulate: { tool: 'emulate', args: ['device'], desc: 'Emulate device (e.g., "iPhone 15 Pro")' },
  resize: { tool: 'resize_page', args: ['width:number', 'height:number'], desc: 'Resize viewport' },
  
  // Wait
  'wait-for': { tool: 'wait_for', args: ['text'], opts: ['timeout:number'], desc: 'Wait for text to appear' },
};

class MCPClient {
  constructor(serverArgs = []) {
    this.serverArgs = serverArgs;
    this.process = null;
    this.messageId = 0;
    this.pendingRequests = new Map();
    this.initialized = false;
    this.buffer = '';
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.process = spawn('npx', ['chrome-devtools-mcp@latest', ...this.serverArgs], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_NO_WARNINGS: '1' }
      });

      this.process.on('error', reject);
      this.process.on('exit', (code) => {
        if (!this.initialized) {
          reject(new Error(`MCP server exited with code ${code}`));
        }
      });

      // Handle stdout line by line for JSON-RPC messages
      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        // Log stderr but don't fail - MCP server logs to stderr
        const msg = data.toString().trim();
        if (msg && !msg.includes('exposes content of the browser')) {
          // Suppress the disclaimer, show other errors
          if (process.env.DEBUG) console.error('[MCP]', msg);
        }
      });

      // Initialize the connection
      this.initialize().then(resolve).catch(reject);
    });
  }

  processBuffer() {
    // JSON-RPC messages are newline-delimited
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch (e) {
        if (process.env.DEBUG) console.error('[Parse Error]', line, e.message);
      }
    }
  }

  handleMessage(msg) {
    if (process.env.DEBUG) console.error(`[Recv] id=${msg.id}`, msg.error ? `error: ${JSON.stringify(msg.error)}` : 'ok');
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const msg = { jsonrpc: '2.0', id, method, params };
      
      this.pendingRequests.set(id, { resolve, reject });
      if (process.env.DEBUG) console.error(`[Send] ${method}:`, JSON.stringify(params).slice(0, 200));
      this.process.stdin.write(JSON.stringify(msg) + '\n');
      
      // Timeout after 120s (traces can take a while)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for ${method}`));
        }
      }, 120000);
    });
  }

  // Send notification (no response expected)
  notify(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params };
    if (process.env.DEBUG) console.error(`[Notify] ${method}`);
    this.process.stdin.write(JSON.stringify(msg) + '\n');
  }

  async initialize() {
    if (process.env.DEBUG) console.error('[Initializing MCP connection...]');
    const result = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'chrome-devtools-cli', version: VERSION }
    });
    if (process.env.DEBUG) console.error('[Initialize result]', JSON.stringify(result).slice(0, 200));
    
    // This is a notification, not a request
    this.notify('notifications/initialized', {});
    this.initialized = true;
    return result;
  }

  async callTool(name, args = {}) {
    const result = await this.send('tools/call', { name, arguments: args });
    return result;
  }

  async stop() {
    if (this.process) {
      this.process.stdin.end();
      this.process.kill();
      this.process = null;
    }
  }
}

// State management for persistent sessions
function saveState(pid, serverArgs) {
  writeFileSync(STATE_FILE, JSON.stringify({ pid, serverArgs, startedAt: Date.now() }));
}

function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function clearState() {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
}

// Server options that take values
const SERVER_OPTS_WITH_VALUES = ['channel', 'browserUrl', 'viewport', 'executablePath', 'wsEndpoint', 'wsHeaders'];

// Parse CLI arguments
function parseArgs(args) {
  const result = { command: null, positional: [], options: {} };
  
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value format
        const key = arg.slice(2, eqIdx);
        result.options[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        // Check if this option takes a value
        if (SERVER_OPTS_WITH_VALUES.includes(key) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result.options[key] = args[++i];
        } else {
          result.options[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.options[key] = args[++i];
      } else {
        result.options[key] = true;
      }
    } else if (!result.command) {
      result.command = arg;
    } else {
      result.positional.push(arg);
    }
    i++;
  }
  
  return result;
}

// Build tool arguments from CLI input
function buildToolArgs(toolDef, positional, options) {
  const args = { ...toolDef.fixed };
  
  // Handle positional arguments
  if (toolDef.args) {
    toolDef.args.forEach((argDef, i) => {
      if (i < positional.length) {
        const [name, type] = argDef.split(':');
        let val = positional[i];
        if (type === 'number') val = Number(val);
        if (type === 'boolean') val = val === 'true';
        args[name] = val;
      }
    });
  }
  
  // Handle options
  if (toolDef.opts) {
    toolDef.opts.forEach((optDef) => {
      const [name, type] = optDef.split(':');
      if (options[name] !== undefined) {
        let val = options[name];
        if (type === 'number') val = Number(val);
        if (type === 'boolean') val = val === 'true' || val === true;
        args[name] = val;
      }
    });
  }
  
  // Pass through any extra options that match tool schema
  Object.keys(options).forEach(key => {
    if (args[key] === undefined) {
      args[key] = options[key];
    }
  });
  
  return args;
}

// Format tool result for output
function formatResult(result) {
  if (!result || !result.content) {
    return { text: '', images: [], isError: false };
  }
  
  const output = { text: [], images: [], isError: result.isError || false };
  
  for (const item of result.content) {
    if (item.type === 'text') {
      output.text.push(item.text);
    } else if (item.type === 'image') {
      output.images.push({
        mimeType: item.mimeType,
        data: item.data
      });
    }
  }
  
  return {
    text: output.text.join('\n'),
    images: output.images,
    isError: output.isError
  };
}

// Print help
function printHelp() {
  console.log(`
chrome-devtools-cli v${VERSION}
CLI wrapper for chrome-devtools-mcp

USAGE:
  devtools <command> [args...] [options]

SERVER OPTIONS (passed to MCP server):
  --headless          Run Chrome in headless mode
  --isolated          Use temporary user data directory
  --channel <ch>      Chrome channel: stable, beta, canary, dev
  --browserUrl <url>  Connect to existing Chrome instance
  --viewport <WxH>    Viewport size (e.g., 1280x720)

COMMANDS:
`);
  
  const categories = {
    Navigation: ['navigate', 'back', 'forward', 'reload', 'new-page', 'list-pages', 'select-page', 'close-page'],
    Input: ['click', 'fill', 'hover', 'press-key'],
    Debugging: ['screenshot', 'snapshot', 'eval', 'console'],
    Network: ['list-requests', 'get-request'],
    'Performance (MCP)': ['perf-start', 'perf-stop', 'perf-analyze'],
    'Deep Profiling (CDP)': ['profile'],
    Emulation: ['emulate', 'resize'],
    Wait: ['wait-for']
  };
  
  for (const [cat, cmds] of Object.entries(categories)) {
    console.log(`  ${cat}:`);
    for (const cmd of cmds) {
      const def = TOOLS[cmd];
      const args = def.args ? def.args.map(a => `<${a.split(':')[0]}>`).join(' ') : '';
      console.log(`    ${cmd.padEnd(14)} ${args.padEnd(25)} ${def.desc}`);
    }
    console.log();
  }
  
  console.log(`EXAMPLES:
  devtools navigate https://example.com
  devtools screenshot --filePath=page.png --fullPage=true
  devtools click btn-submit
  devtools fill input-email user@example.com
  devtools perf-start --reload=true --autoStop=true
  devtools --headless navigate https://example.com
`);
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  
  // Check if first non-option arg is a custom command (like 'profile')
  const firstCmd = args.find(a => !a.startsWith('-'));
  const toolDef = firstCmd ? TOOLS[firstCmd] : null;
  
  // If it's a custom command, delegate immediately (including --help)
  if (toolDef?.custom) {
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const scriptPath = join(__dirname, `${toolDef.custom}.mjs`);
    
    // Pass all args after the command
    const cmdIndex = args.indexOf(firstCmd);
    const subArgs = args.slice(cmdIndex + 1);
    
    const child = spawn('node', [scriptPath, ...subArgs], {
      stdio: 'inherit'
    });
    
    child.on('exit', (code) => process.exit(code || 0));
    return;
  }
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  
  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    process.exit(0);
  }
  
  const parsed = parseArgs(args);
  
  if (!parsed.command) {
    console.error('Error: No command specified');
    printHelp();
    process.exit(1);
  }
  
  const cmdToolDef = TOOLS[parsed.command];
  if (!cmdToolDef) {
    console.error(`Error: Unknown command '${parsed.command}'`);
    console.error('Run with --help to see available commands');
    process.exit(1);
  }
  
  // Extract server options
  const serverOpts = [];
  const serverOptNames = ['headless', 'isolated', 'channel', 'browserUrl', 'viewport', 'executablePath', 'wsEndpoint'];
  
  for (const opt of serverOptNames) {
    if (parsed.options[opt] !== undefined) {
      if (parsed.options[opt] === true) {
        serverOpts.push(`--${opt}`);
      } else {
        serverOpts.push(`--${opt}=${parsed.options[opt]}`);
      }
      delete parsed.options[opt];
    }
  }
  
  // Build tool arguments
  const toolArgs = buildToolArgs(cmdToolDef, parsed.positional, parsed.options);
  
  // Start MCP client
  const client = new MCPClient(serverOpts);
  
  try {
    if (process.env.DEBUG) console.error('[Starting MCP server...]');
    await client.start();
    if (process.env.DEBUG) console.error('[MCP server ready]');
    
    // Call the tool
    const result = await client.callTool(cmdToolDef.tool, toolArgs);
    const formatted = formatResult(result);
    
    // Output text
    if (formatted.text) {
      console.log(formatted.text);
    }
    
    // Handle images - save to file if not already saved
    for (const img of formatted.images) {
      if (parsed.options.filePath) {
        // Already saved by tool
      } else {
        // Save to temp file and report
        const ext = img.mimeType.split('/')[1] || 'png';
        const filename = `screenshot-${Date.now()}.${ext}`;
        const filepath = join(process.cwd(), filename);
        writeFileSync(filepath, Buffer.from(img.data, 'base64'));
        console.log(`Screenshot saved: ${filepath}`);
      }
    }
    
    // Output as JSON if requested
    if (parsed.options.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    
    process.exit(formatted.isError ? 1 : 0);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.stop();
  }
}

main();
