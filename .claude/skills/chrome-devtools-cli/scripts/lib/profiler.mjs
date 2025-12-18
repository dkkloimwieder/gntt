/**
 * Performance profiler using Chrome DevTools Protocol
 * Captures CPU profiles, call trees, rendering stats, and timeline events
 */

import { connectToPage } from './cdp-client.mjs';

/**
 * CPU Profiler - captures JavaScript execution with call tree
 */
export class CPUProfiler {
  constructor(client) {
    this.client = client;
    this.profile = null;
  }

  async enable() {
    await this.client.send('Profiler.enable');
  }

  async disable() {
    await this.client.send('Profiler.disable');
  }

  /**
   * Set sampling interval (microseconds, default 1000 = 1ms)
   */
  async setSamplingInterval(interval = 100) {
    await this.client.send('Profiler.setSamplingInterval', { interval });
  }

  async start() {
    await this.client.send('Profiler.start');
  }

  async stop() {
    const { profile } = await this.client.send('Profiler.stop');
    this.profile = profile;
    return profile;
  }

  /**
   * Parse profile into call tree structure
   */
  parseCallTree(profile = this.profile) {
    if (!profile) return null;

    const { nodes, samples, timeDeltas } = profile;
    
    // Build node map
    const nodeMap = new Map();
    for (const node of nodes) {
      nodeMap.set(node.id, {
        id: node.id,
        functionName: node.callFrame.functionName || '(anonymous)',
        url: node.callFrame.url,
        lineNumber: node.callFrame.lineNumber,
        columnNumber: node.callFrame.columnNumber,
        scriptId: node.callFrame.scriptId,
        hitCount: 0,
        selfTime: 0,
        totalTime: 0,
        children: node.children || []
      });
    }

    // Count hits and calculate times
    let totalDelta = 0;
    for (let i = 0; i < samples.length; i++) {
      const nodeId = samples[i];
      const delta = timeDeltas[i];
      totalDelta += delta;
      
      const node = nodeMap.get(nodeId);
      if (node) {
        node.hitCount++;
        node.selfTime += delta;
      }
    }

    // Calculate total time (self + children) via DFS
    const calculateTotalTime = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return 0;
      visited.add(nodeId);
      
      const node = nodeMap.get(nodeId);
      if (!node) return 0;
      
      let total = node.selfTime;
      for (const childId of node.children) {
        total += calculateTotalTime(childId, visited);
      }
      node.totalTime = total;
      return total;
    };

    // Start from root (node 1)
    calculateTotalTime(1);

    return {
      nodes: Array.from(nodeMap.values()),
      totalTime: totalDelta,
      startTime: profile.startTime,
      endTime: profile.endTime
    };
  }

  /**
   * Get hot functions sorted by self time
   */
  getHotFunctions(profile = this.profile, limit = 20) {
    const tree = this.parseCallTree(profile);
    if (!tree) return [];

    return tree.nodes
      .filter(n => n.selfTime > 0 && n.functionName !== '(root)' && n.functionName !== '(idle)')
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, limit)
      .map(n => ({
        function: n.functionName,
        selfTime: (n.selfTime / 1000).toFixed(2) + 'ms',
        selfPercent: ((n.selfTime / tree.totalTime) * 100).toFixed(1) + '%',
        totalTime: (n.totalTime / 1000).toFixed(2) + 'ms',
        location: n.url ? `${n.url}:${n.lineNumber}:${n.columnNumber}` : '(native)',
        hits: n.hitCount
      }));
  }

  /**
   * Build hierarchical call tree for display
   */
  getCallTree(profile = this.profile, minPercent = 1) {
    const tree = this.parseCallTree(profile);
    if (!tree) return null;

    const nodeMap = new Map(tree.nodes.map(n => [n.id, n]));
    const threshold = (minPercent / 100) * tree.totalTime;

    const buildTree = (nodeId, depth = 0) => {
      const node = nodeMap.get(nodeId);
      if (!node || node.totalTime < threshold) return null;

      const children = node.children
        .map(id => buildTree(id, depth + 1))
        .filter(Boolean)
        .sort((a, b) => b.totalTime - a.totalTime);

      return {
        name: node.functionName,
        selfTime: node.selfTime,
        totalTime: node.totalTime,
        selfPercent: ((node.selfTime / tree.totalTime) * 100).toFixed(1),
        totalPercent: ((node.totalTime / tree.totalTime) * 100).toFixed(1),
        location: node.url ? `${node.url}:${node.lineNumber}` : null,
        children: children.length > 0 ? children : undefined
      };
    };

    return {
      tree: buildTree(1),
      totalTime: tree.totalTime,
      duration: (tree.totalTime / 1000).toFixed(2) + 'ms'
    };
  }
}

/**
 * Tracing - captures detailed timeline events
 */
export class Tracer {
  constructor(client) {
    this.client = client;
    this.events = [];
    this.collecting = false;
  }

  async start(categories = null) {
    this.events = [];
    this.collecting = true;

    // Default categories for performance analysis
    const defaultCategories = [
      '-*',  // Disable all first
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'disabled-by-default-devtools.timeline.stack',
      'v8.execute',
      'blink.user_timing',
      'blink.console',
      'loading',
      'latencyInfo',
      'disabled-by-default-v8.cpu_profiler'
    ];

    // Collect trace events
    this.client.on('Tracing.dataCollected', ({ value }) => {
      if (this.collecting) {
        this.events.push(...value);
      }
    });

    await this.client.send('Tracing.start', {
      categories: (categories || defaultCategories).join(','),
      options: 'sampling-frequency=10000'  // 10kHz sampling
    });
  }

  async stop() {
    this.collecting = false;
    
    return new Promise((resolve) => {
      this.client.once('Tracing.tracingComplete', () => {
        resolve(this.events);
      });
      this.client.send('Tracing.end');
    });
  }

  /**
   * Parse trace events into structured data
   */
  parseEvents(events = this.events) {
    const result = {
      frames: [],
      paints: [],
      layouts: [],
      scripts: [],
      network: [],
      gc: [],
      userTiming: [],
      longTasks: []
    };

    const durationEvents = new Map();

    for (const event of events) {
      const { name, cat, ph, ts, dur, args } = event;

      // Handle duration events (B/E pairs)
      if (ph === 'B') {
        durationEvents.set(`${name}-${event.tid}`, { start: ts, args });
        continue;
      }
      if (ph === 'E') {
        const start = durationEvents.get(`${name}-${event.tid}`);
        if (start) {
          event.dur = ts - start.start;
          event.args = { ...start.args, ...event.args };
          durationEvents.delete(`${name}-${event.tid}`);
        }
      }

      const duration = (dur || 0) / 1000; // Convert to ms

      // Categorize events
      switch (name) {
        case 'BeginFrame':
        case 'DrawFrame':
          result.frames.push({ name, ts, duration });
          break;
          
        case 'Paint':
        case 'PaintImage':
        case 'RasterTask':
          result.paints.push({ 
            name, 
            ts, 
            duration,
            details: args?.data 
          });
          break;
          
        case 'Layout':
        case 'UpdateLayoutTree':
        case 'RecalculateStyles':
          result.layouts.push({ 
            name, 
            ts, 
            duration,
            nodeCount: args?.data?.elementCount 
          });
          break;
          
        case 'EvaluateScript':
        case 'v8.compile':
        case 'FunctionCall':
          if (duration > 0) {
            result.scripts.push({ 
              name, 
              ts, 
              duration,
              url: args?.data?.url,
              functionName: args?.data?.functionName
            });
          }
          break;
          
        case 'ResourceSendRequest':
        case 'ResourceReceiveResponse':
        case 'ResourceFinish':
          result.network.push({ name, ts, args });
          break;
          
        case 'MinorGC':
        case 'MajorGC':
        case 'V8.GCScavenger':
        case 'V8.GCCompactor':
          result.gc.push({ name, ts, duration, args });
          break;
          
        case 'RunTask':
          if (duration > 50) { // Long task threshold
            result.longTasks.push({ 
              ts, 
              duration,
              details: args 
            });
          }
          break;
      }

      // User timing marks/measures
      if (cat?.includes('blink.user_timing')) {
        result.userTiming.push({ name, ts, duration, ph });
      }
    }

    return result;
  }

  /**
   * Get rendering statistics summary
   */
  getRenderingStats(events = this.events) {
    const parsed = this.parseEvents(events);
    
    // Calculate frame stats
    const frameTimes = [];
    for (let i = 1; i < parsed.frames.length; i++) {
      const delta = (parsed.frames[i].ts - parsed.frames[i-1].ts) / 1000;
      frameTimes.push(delta);
    }

    const avgFrameTime = frameTimes.length > 0 
      ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length 
      : 0;

    const paintTimes = parsed.paints.map(p => p.duration).filter(d => d > 0);
    const layoutTimes = parsed.layouts.map(l => l.duration).filter(d => d > 0);

    return {
      frames: {
        count: parsed.frames.length,
        avgFrameTime: avgFrameTime.toFixed(2) + 'ms',
        fps: avgFrameTime > 0 ? (1000 / avgFrameTime).toFixed(1) : 'N/A',
        jank: frameTimes.filter(t => t > 16.67).length // Frames > 60fps threshold
      },
      paints: {
        count: paintTimes.length,
        totalTime: paintTimes.reduce((a, b) => a + b, 0).toFixed(2) + 'ms',
        avgTime: paintTimes.length > 0 
          ? (paintTimes.reduce((a, b) => a + b, 0) / paintTimes.length).toFixed(2) + 'ms'
          : '0ms'
      },
      layouts: {
        count: layoutTimes.length,
        totalTime: layoutTimes.reduce((a, b) => a + b, 0).toFixed(2) + 'ms',
        avgTime: layoutTimes.length > 0
          ? (layoutTimes.reduce((a, b) => a + b, 0) / layoutTimes.length).toFixed(2) + 'ms'
          : '0ms'
      },
      scripts: {
        count: parsed.scripts.length,
        totalTime: parsed.scripts.reduce((a, b) => a + b.duration, 0).toFixed(2) + 'ms'
      },
      gc: {
        count: parsed.gc.length,
        totalTime: parsed.gc.reduce((a, b) => a + (b.duration || 0), 0).toFixed(2) + 'ms'
      },
      longTasks: {
        count: parsed.longTasks.length,
        totalTime: parsed.longTasks.reduce((a, b) => a + b.duration, 0).toFixed(2) + 'ms',
        tasks: parsed.longTasks.slice(0, 10).map(t => ({
          duration: t.duration.toFixed(2) + 'ms'
        }))
      }
    };
  }
}

/**
 * Performance metrics from Chrome
 */
export class PerformanceMetrics {
  constructor(client) {
    this.client = client;
  }

  async enable() {
    await this.client.send('Performance.enable');
  }

  async getMetrics() {
    const { metrics } = await this.client.send('Performance.getMetrics');
    
    // Convert to readable format
    const result = {};
    for (const { name, value } of metrics) {
      result[name] = value;
    }

    return {
      // Timing
      navigationStart: result.NavigationStart,
      domContentLoaded: result.DomContentLoaded,
      
      // Counts
      documents: result.Documents,
      frames: result.Frames,
      jsEventListeners: result.JSEventListeners,
      nodes: result.Nodes,
      layoutCount: result.LayoutCount,
      recalcStyleCount: result.RecalcStyleCount,
      
      // Durations
      layoutDuration: (result.LayoutDuration * 1000).toFixed(2) + 'ms',
      recalcStyleDuration: (result.RecalcStyleDuration * 1000).toFixed(2) + 'ms',
      scriptDuration: (result.ScriptDuration * 1000).toFixed(2) + 'ms',
      taskDuration: (result.TaskDuration * 1000).toFixed(2) + 'ms',
      
      // Memory
      jsHeapSizeUsed: formatBytes(result.JSHeapUsedSize),
      jsHeapSizeTotal: formatBytes(result.JSHeapTotalSize)
    };
  }
}

/**
 * Heap Profiler for memory analysis
 */
export class HeapProfiler {
  constructor(client) {
    this.client = client;
  }

  async enable() {
    await this.client.send('HeapProfiler.enable');
  }

  async disable() {
    await this.client.send('HeapProfiler.disable');
  }

  /**
   * Take heap snapshot
   */
  async takeSnapshot() {
    const chunks = [];
    
    const handler = ({ chunk }) => chunks.push(chunk);
    this.client.on('HeapProfiler.addHeapSnapshotChunk', handler);
    
    await this.client.send('HeapProfiler.takeHeapSnapshot', { 
      reportProgress: false 
    });
    
    this.client.removeListener('HeapProfiler.addHeapSnapshotChunk', handler);
    
    return JSON.parse(chunks.join(''));
  }

  /**
   * Get allocation profile
   */
  async startSampling(interval = 32768) {
    await this.client.send('HeapProfiler.startSampling', {
      samplingInterval: interval
    });
  }

  async stopSampling() {
    const { profile } = await this.client.send('HeapProfiler.stopSampling');
    return profile;
  }

  /**
   * Parse heap snapshot for summary stats
   */
  parseSnapshotSummary(snapshot) {
    const { nodes, strings } = snapshot;
    
    // Node format: [type, name, id, self_size, edge_count, trace_node_id]
    const nodeFieldCount = snapshot.snapshot.meta.node_fields.length;
    const typeIndex = snapshot.snapshot.meta.node_fields.indexOf('type');
    const sizeIndex = snapshot.snapshot.meta.node_fields.indexOf('self_size');
    const nameIndex = snapshot.snapshot.meta.node_fields.indexOf('name');
    
    const types = snapshot.snapshot.meta.node_types[0];
    const typeCounts = {};
    const typeSizes = {};

    for (let i = 0; i < nodes.length; i += nodeFieldCount) {
      const type = types[nodes[i + typeIndex]];
      const size = nodes[i + sizeIndex];
      
      typeCounts[type] = (typeCounts[type] || 0) + 1;
      typeSizes[type] = (typeSizes[type] || 0) + size;
    }

    return {
      totalNodes: nodes.length / nodeFieldCount,
      byType: Object.entries(typeSizes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([type, size]) => ({
          type,
          count: typeCounts[type],
          size: formatBytes(size)
        }))
    };
  }
}

/**
 * Combined profiler that captures everything
 */
export async function captureProfile(options = {}) {
  const {
    browserUrl = 'http://127.0.0.1:9222',
    pageIndex = 0,
    duration = 5000,
    url = null,
    includeHeap = false,
    includeCPU = true,
    includeTracing = true
  } = options;

  const client = await connectToPage(browserUrl, pageIndex);
  
  const results = {
    url: client.targetInfo?.url,
    capturedAt: new Date().toISOString(),
    duration: duration + 'ms'
  };

  try {
    // Navigate if URL provided
    if (url) {
      await client.send('Page.enable');
      await client.send('Page.navigate', { url });
      await new Promise(r => setTimeout(r, 1000)); // Wait for initial load
    }

    // Setup profilers
    const cpuProfiler = includeCPU ? new CPUProfiler(client) : null;
    const tracer = includeTracing ? new Tracer(client) : null;
    const heapProfiler = includeHeap ? new HeapProfiler(client) : null;
    const perfMetrics = new PerformanceMetrics(client);

    // Enable and start
    await perfMetrics.enable();
    
    if (cpuProfiler) {
      await cpuProfiler.enable();
      await cpuProfiler.setSamplingInterval(100);
      await cpuProfiler.start();
    }
    
    if (tracer) {
      await tracer.start();
    }
    
    if (heapProfiler) {
      await heapProfiler.enable();
      await heapProfiler.startSampling();
    }

    // Wait for specified duration
    await new Promise(r => setTimeout(r, duration));

    // Collect results
    results.metrics = await perfMetrics.getMetrics();

    if (cpuProfiler) {
      const profile = await cpuProfiler.stop();
      results.cpu = {
        hotFunctions: cpuProfiler.getHotFunctions(profile),
        callTree: cpuProfiler.getCallTree(profile)
      };
      await cpuProfiler.disable();
    }

    if (tracer) {
      const events = await tracer.stop();
      results.rendering = tracer.getRenderingStats(events);
      results.traceEventCount = events.length;
    }

    if (heapProfiler) {
      const heapProfile = await heapProfiler.stopSampling();
      results.heap = {
        samplingProfile: heapProfile
      };
      await heapProfiler.disable();
    }

  } finally {
    client.close();
  }

  return results;
}

// Utility
function formatBytes(bytes) {
  if (bytes === 0 || bytes === undefined) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default { CPUProfiler, Tracer, PerformanceMetrics, HeapProfiler, captureProfile };
