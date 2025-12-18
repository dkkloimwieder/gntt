/**
 * Direct Chrome DevTools Protocol client
 * Bypasses MCP for low-level profiling access
 */

import { createConnection } from 'node:net';
import { request as httpRequest } from 'node:http';
import { EventEmitter } from 'node:events';

export class CDPClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.messageId = 0;
    this.callbacks = new Map();
    this.sessions = new Map();
  }

  /**
   * Connect to Chrome via HTTP endpoint to get WebSocket URL
   */
  async connect(options = {}) {
    const { browserUrl = 'http://127.0.0.1:9222', targetId } = options;
    
    // Get WebSocket debugger URL
    const wsUrl = await this.getWebSocketUrl(browserUrl, targetId);
    
    // Connect via WebSocket
    await this.connectWebSocket(wsUrl);
    
    return this;
  }

  async getWebSocketUrl(browserUrl, targetId) {
    return new Promise((resolve, reject) => {
      const url = new URL(browserUrl);
      const endpoint = targetId ? `/json/list` : `/json/version`;
      
      const req = httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: endpoint,
        method: 'GET'
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (targetId) {
              // Find specific target
              const target = json.find(t => t.id === targetId || t.type === 'page');
              if (target) {
                resolve(target.webSocketDebuggerUrl);
              } else {
                reject(new Error('Target not found'));
              }
            } else {
              resolve(json.webSocketDebuggerUrl);
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }

  async connectWebSocket(wsUrl) {
    // Use native WebSocket if available (Node 21+), otherwise dynamic import
    const WebSocket = globalThis.WebSocket || (await import('ws')).default;
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onclose = () => this.emit('close');
      
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.id !== undefined && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        } else if (msg.method) {
          // Event from Chrome
          this.emit(msg.method, msg.params);
          this.emit('event', msg.method, msg.params);
        }
      };
    });
  }

  /**
   * Send CDP command
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      
      // Timeout
      setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  /**
   * Get list of available targets (pages)
   */
  async getTargets(browserUrl = 'http://127.0.0.1:9222') {
    return new Promise((resolve, reject) => {
      const url = new URL(browserUrl);
      
      const req = httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: '/json/list',
        method: 'GET'
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Create new page
   */
  async newPage(browserUrl = 'http://127.0.0.1:9222', url = 'about:blank') {
    return new Promise((resolve, reject) => {
      const burl = new URL(browserUrl);
      
      const req = httpRequest({
        hostname: burl.hostname,
        port: burl.port,
        path: `/json/new?${encodeURIComponent(url)}`,
        method: 'PUT'
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * Connect to a specific page target
 */
export async function connectToPage(browserUrl = 'http://127.0.0.1:9222', pageIndex = 0) {
  const client = new CDPClient();
  const targets = await client.getTargets(browserUrl);
  
  const pages = targets.filter(t => t.type === 'page');
  if (pages.length === 0) {
    throw new Error('No page targets found');
  }
  
  const target = pages[pageIndex];
  if (!target) {
    throw new Error(`Page index ${pageIndex} not found (${pages.length} pages available)`);
  }
  
  // Connect directly to page's WebSocket
  const WebSocket = globalThis.WebSocket || (await import('ws')).default;
  
  return new Promise((resolve, reject) => {
    client.ws = new WebSocket(target.webSocketDebuggerUrl);
    
    client.ws.onopen = () => {
      client.targetInfo = target;
      resolve(client);
    };
    client.ws.onerror = reject;
    
    client.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.id !== undefined && client.callbacks.has(msg.id)) {
        const { resolve, reject } = client.callbacks.get(msg.id);
        client.callbacks.delete(msg.id);
        
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      } else if (msg.method) {
        client.emit(msg.method, msg.params);
        client.emit('event', msg.method, msg.params);
      }
    };
  });
}

export default CDPClient;
