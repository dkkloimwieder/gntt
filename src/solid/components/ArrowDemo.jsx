import { createSignal, createMemo, For, onMount } from 'solid-js';
import { createTaskStore } from '../stores/taskStore.js';
import { Arrow, ARROW_DEFAULTS } from './Arrow.jsx';

/**
 * Comprehensive Arrow Demo Page
 *
 * Demonstrates all Arrow component parameters:
 * - Anchoring (start/end anchors, offsets)
 * - Path routing (straight, orthogonal)
 * - Line styles (stroke, width, opacity, dash, linecap, linejoin)
 * - Arrow heads (shape, size, fill)
 * - Interactive dragging
 */
export function ArrowDemo() {
    const taskStore = createTaskStore();

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    // Global configuration
    const [config, setConfig] = createSignal({
        // Anchoring
        startAnchor: 'auto',
        startOffset: 0.5,
        endAnchor: 'left',
        endOffset: 0.5,

        // Path
        routing: 'orthogonal',
        curveRadius: 8,

        // Line style
        stroke: '#3498db',
        strokeWidth: 2,
        strokeOpacity: 1,
        strokeDasharray: '',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',

        // Arrow head
        headSize: 6,
        headShape: 'chevron',
        headFill: false,
    });

    // Dragging state
    const [dragging, setDragging] = createSignal(null);
    const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });

    // Debug mode
    const [showDebug, setShowDebug] = createSignal(false);

    // ═══════════════════════════════════════════════════════════════════════════
    // DEMO SCENARIOS
    // ═══════════════════════════════════════════════════════════════════════════

    const scenarios = [
        // Section 1: Anchor Types
        { id: 'anchor-auto-from', name: 'Auto', x: 50, y: 100, w: 70, h: 24 },
        { id: 'anchor-auto-to', name: 'Target', x: 180, y: 160, w: 70, h: 24 },

        { id: 'anchor-top-from', name: 'Top', x: 50, y: 220, w: 70, h: 24 },
        { id: 'anchor-top-to', name: 'Target', x: 180, y: 200, w: 70, h: 24 },

        { id: 'anchor-bottom-from', name: 'Bottom', x: 50, y: 280, w: 70, h: 24 },
        { id: 'anchor-bottom-to', name: 'Target', x: 180, y: 320, w: 70, h: 24 },

        { id: 'anchor-right-from', name: 'Right', x: 50, y: 380, w: 70, h: 24 },
        { id: 'anchor-right-to', name: 'Target', x: 180, y: 380, w: 70, h: 24 },

        // Section 2: Head Shapes
        { id: 'head-chevron-from', name: 'Chevron', x: 300, y: 100, w: 70, h: 24 },
        { id: 'head-chevron-to', name: '', x: 430, y: 100, w: 50, h: 24 },

        { id: 'head-triangle-from', name: 'Triangle', x: 300, y: 150, w: 70, h: 24 },
        { id: 'head-triangle-to', name: '', x: 430, y: 150, w: 50, h: 24 },

        { id: 'head-diamond-from', name: 'Diamond', x: 300, y: 200, w: 70, h: 24 },
        { id: 'head-diamond-to', name: '', x: 430, y: 200, w: 50, h: 24 },

        { id: 'head-circle-from', name: 'Circle', x: 300, y: 250, w: 70, h: 24 },
        { id: 'head-circle-to', name: '', x: 430, y: 250, w: 50, h: 24 },

        { id: 'head-none-from', name: 'None', x: 300, y: 300, w: 70, h: 24 },
        { id: 'head-none-to', name: '', x: 430, y: 300, w: 50, h: 24 },

        // Section 3: Line Styles
        { id: 'style-solid-from', name: 'Solid', x: 300, y: 380, w: 70, h: 24 },
        { id: 'style-solid-to', name: '', x: 430, y: 380, w: 50, h: 24 },

        { id: 'style-dashed-from', name: 'Dashed', x: 300, y: 420, w: 70, h: 24 },
        { id: 'style-dashed-to', name: '', x: 430, y: 420, w: 50, h: 24 },

        { id: 'style-dotted-from', name: 'Dotted', x: 300, y: 460, w: 70, h: 24 },
        { id: 'style-dotted-to', name: '', x: 430, y: 460, w: 50, h: 24 },

        // Section 4: Routing
        { id: 'route-ortho-from', name: 'Orthogonal', x: 550, y: 100, w: 80, h: 24 },
        { id: 'route-ortho-to', name: '', x: 700, y: 180, w: 50, h: 24 },

        { id: 'route-straight-from', name: 'Straight', x: 550, y: 220, w: 80, h: 24 },
        { id: 'route-straight-to', name: '', x: 700, y: 280, w: 50, h: 24 },

        // Section 5: Curve Radius
        { id: 'curve-0-from', name: 'r=0', x: 550, y: 340, w: 50, h: 24 },
        { id: 'curve-0-to', name: '', x: 650, y: 380, w: 50, h: 24 },

        { id: 'curve-10-from', name: 'r=10', x: 550, y: 420, w: 50, h: 24 },
        { id: 'curve-10-to', name: '', x: 650, y: 460, w: 50, h: 24 },

        { id: 'curve-20-from', name: 'r=20', x: 720, y: 340, w: 50, h: 24 },
        { id: 'curve-20-to', name: '', x: 820, y: 420, w: 50, h: 24 },

        // Section 6: Interactive
        { id: 'drag-from', name: 'Drag Me!', x: 550, y: 520, w: 90, h: 28, draggable: true },
        { id: 'drag-to', name: 'Target', x: 720, y: 580, w: 70, h: 28, draggable: true },

        // Section 7: Edge Cases
        { id: 'edge-same-from', name: 'Same Y', x: 50, y: 480, w: 70, h: 24 },
        { id: 'edge-same-to', name: '', x: 180, y: 480, w: 50, h: 24 },

        { id: 'edge-close-from', name: 'Close', x: 50, y: 530, w: 70, h: 24 },
        { id: 'edge-close-to', name: '', x: 130, y: 530, w: 50, h: 24 },

        { id: 'edge-far-from', name: 'Far', x: 50, y: 580, w: 50, h: 24 },
        { id: 'edge-far-to', name: '', x: 200, y: 620, w: 50, h: 24 },
    ];

    // Arrow definitions
    const arrows = [
        // Anchor demos
        { from: 'anchor-auto-from', to: 'anchor-auto-to', label: 'Auto Anchor', startAnchor: 'auto' },
        { from: 'anchor-top-from', to: 'anchor-top-to', label: 'Top Anchor', startAnchor: 'top', stroke: '#9b59b6' },
        { from: 'anchor-bottom-from', to: 'anchor-bottom-to', label: 'Bottom Anchor', startAnchor: 'bottom', stroke: '#e74c3c' },
        { from: 'anchor-right-from', to: 'anchor-right-to', label: 'Right Anchor', startAnchor: 'right', stroke: '#2ecc71' },

        // Head shape demos
        { from: 'head-chevron-from', to: 'head-chevron-to', headShape: 'chevron', stroke: '#3498db' },
        { from: 'head-triangle-from', to: 'head-triangle-to', headShape: 'triangle', headFill: true, stroke: '#e74c3c' },
        { from: 'head-diamond-from', to: 'head-diamond-to', headShape: 'diamond', headFill: true, stroke: '#9b59b6' },
        { from: 'head-circle-from', to: 'head-circle-to', headShape: 'circle', headFill: true, stroke: '#f39c12' },
        { from: 'head-none-from', to: 'head-none-to', headShape: 'none', headSize: 0, stroke: '#95a5a6' },

        // Line style demos
        { from: 'style-solid-from', to: 'style-solid-to', strokeWidth: 2, stroke: '#2ecc71' },
        { from: 'style-dashed-from', to: 'style-dashed-to', strokeDasharray: '8,4', stroke: '#e67e22' },
        { from: 'style-dotted-from', to: 'style-dotted-to', strokeDasharray: '2,4', strokeLinecap: 'round', stroke: '#9b59b6' },

        // Routing demos
        { from: 'route-ortho-from', to: 'route-ortho-to', routing: 'orthogonal', stroke: '#3498db' },
        { from: 'route-straight-from', to: 'route-straight-to', routing: 'straight', stroke: '#e74c3c' },

        // Curve radius demos
        { from: 'curve-0-from', to: 'curve-0-to', curveRadius: 0, stroke: '#95a5a6' },
        { from: 'curve-10-from', to: 'curve-10-to', curveRadius: 10, stroke: '#3498db' },
        { from: 'curve-20-from', to: 'curve-20-to', curveRadius: 20, stroke: '#2ecc71' },

        // Interactive demo - uses global config
        { from: 'drag-from', to: 'drag-to', useGlobalConfig: true },

        // Edge cases
        { from: 'edge-same-from', to: 'edge-same-to', stroke: '#7f8c8d' },
        { from: 'edge-close-from', to: 'edge-close-to', stroke: '#e74c3c' },
        { from: 'edge-far-from', to: 'edge-far-to', stroke: '#27ae60' },
    ];

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    onMount(() => {
        // Initialize task store with scenarios
        const tasks = scenarios.map((s, i) => ({
            id: s.id,
            name: s.name,
            _index: i,
            draggable: s.draggable,
            $bar: { x: s.x, y: s.y, width: s.w, height: s.h }
        }));
        taskStore.updateTasks(tasks);
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DRAG HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    const handleMouseDown = (taskId, event) => {
        const task = taskStore.getTask(taskId);
        if (!task || !task.draggable) return;

        const svg = event.currentTarget.ownerSVGElement;
        const pt = svg.createSVGPoint();
        pt.x = event.clientX;
        pt.y = event.clientY;
        const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

        setDragging(taskId);
        setDragOffset({ x: svgP.x - task.$bar.x, y: svgP.y - task.$bar.y });
        event.preventDefault();
    };

    const handleMouseMove = (event) => {
        const taskId = dragging();
        if (!taskId) return;

        const svg = event.currentTarget;
        const pt = svg.createSVGPoint();
        pt.x = event.clientX;
        pt.y = event.clientY;
        const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

        const offset = dragOffset();
        taskStore.updateBarPosition(taskId, {
            x: svgP.x - offset.x,
            y: svgP.y - offset.y
        });
    };

    const handleMouseUp = () => {
        setDragging(null);
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════════

    return (
        <div style={{ padding: '20px', 'font-family': 'system-ui, sans-serif', 'max-width': '1200px', margin: '0 auto' }}>
            <h1 style={{ 'margin-bottom': '10px' }}>Arrow Component Demo</h1>
            <p style={{ color: '#666', 'margin-bottom': '20px' }}>
                Comprehensive demonstration of all Arrow component parameters.
                The Arrow is a <strong>pure visual renderer</strong> - it has no knowledge of constraints or task semantics.
            </p>

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* CONFIGURATION PANEL */}
            {/* ═══════════════════════════════════════════════════════════════════ */}

            <div style={{
                'margin-bottom': '20px',
                padding: '20px',
                'background-color': '#f8f9fa',
                'border-radius': '8px',
                'border': '1px solid #e9ecef'
            }}>
                <h3 style={{ margin: '0 0 15px 0', 'font-size': '14px', 'text-transform': 'uppercase', color: '#495057' }}>
                    Interactive Configuration (applies to "Drag Me" arrow)
                </h3>

                <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
                    {/* Anchoring */}
                    <fieldset style={{ border: '1px solid #dee2e6', padding: '10px', 'border-radius': '4px' }}>
                        <legend style={{ 'font-size': '12px', 'font-weight': 'bold', color: '#6c757d' }}>Anchoring</legend>

                        <label style={{ display: 'block', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '12px' }}>Start Anchor:</span>
                            <select
                                value={config().startAnchor}
                                onChange={(e) => setConfig({ ...config(), startAnchor: e.target.value })}
                                style={{ width: '100%', padding: '4px', 'margin-top': '2px' }}
                            >
                                <option value="auto">Auto</option>
                                <option value="top">Top</option>
                                <option value="bottom">Bottom</option>
                                <option value="left">Left</option>
                                <option value="right">Right</option>
                                <option value="center">Center</option>
                            </select>
                        </label>

                        <label style={{ display: 'block', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '12px' }}>Start Offset: {config().startOffset.toFixed(2)}</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={config().startOffset}
                                onInput={(e) => setConfig({ ...config(), startOffset: parseFloat(e.target.value) })}
                                style={{ width: '100%' }}
                            />
                        </label>

                        <label style={{ display: 'block' }}>
                            <span style={{ 'font-size': '12px' }}>End Anchor:</span>
                            <select
                                value={config().endAnchor}
                                onChange={(e) => setConfig({ ...config(), endAnchor: e.target.value })}
                                style={{ width: '100%', padding: '4px', 'margin-top': '2px' }}
                            >
                                <option value="left">Left</option>
                                <option value="right">Right</option>
                                <option value="top">Top</option>
                                <option value="bottom">Bottom</option>
                                <option value="center">Center</option>
                            </select>
                        </label>
                    </fieldset>

                    {/* Path Shape */}
                    <fieldset style={{ border: '1px solid #dee2e6', padding: '10px', 'border-radius': '4px' }}>
                        <legend style={{ 'font-size': '12px', 'font-weight': 'bold', color: '#6c757d' }}>Path Shape</legend>

                        <label style={{ display: 'block', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '12px' }}>Routing:</span>
                            <select
                                value={config().routing}
                                onChange={(e) => setConfig({ ...config(), routing: e.target.value })}
                                style={{ width: '100%', padding: '4px', 'margin-top': '2px' }}
                            >
                                <option value="orthogonal">Orthogonal</option>
                                <option value="straight">Straight</option>
                            </select>
                        </label>

                        <label style={{ display: 'block' }}>
                            <span style={{ 'font-size': '12px' }}>Curve Radius: {config().curveRadius}px</span>
                            <input
                                type="range"
                                min="0"
                                max="30"
                                step="1"
                                value={config().curveRadius}
                                onInput={(e) => setConfig({ ...config(), curveRadius: parseInt(e.target.value) })}
                                style={{ width: '100%' }}
                            />
                        </label>
                    </fieldset>

                    {/* Line Style */}
                    <fieldset style={{ border: '1px solid #dee2e6', padding: '10px', 'border-radius': '4px' }}>
                        <legend style={{ 'font-size': '12px', 'font-weight': 'bold', color: '#6c757d' }}>Line Style</legend>

                        <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '12px' }}>Color:</span>
                            <input
                                type="color"
                                value={config().stroke}
                                onInput={(e) => setConfig({ ...config(), stroke: e.target.value })}
                                style={{ width: '40px', height: '24px', border: 'none', cursor: 'pointer' }}
                            />
                            <span style={{ 'font-size': '11px', color: '#6c757d' }}>{config().stroke}</span>
                        </label>

                        <label style={{ display: 'block', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '12px' }}>Width: {config().strokeWidth}px</span>
                            <input
                                type="range"
                                min="0.5"
                                max="8"
                                step="0.5"
                                value={config().strokeWidth}
                                onInput={(e) => setConfig({ ...config(), strokeWidth: parseFloat(e.target.value) })}
                                style={{ width: '100%' }}
                            />
                        </label>

                        <label style={{ display: 'block', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '12px' }}>Opacity: {config().strokeOpacity.toFixed(2)}</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={config().strokeOpacity}
                                onInput={(e) => setConfig({ ...config(), strokeOpacity: parseFloat(e.target.value) })}
                                style={{ width: '100%' }}
                            />
                        </label>

                        <label style={{ display: 'block' }}>
                            <span style={{ 'font-size': '12px' }}>Dash Pattern:</span>
                            <select
                                value={config().strokeDasharray}
                                onChange={(e) => setConfig({ ...config(), strokeDasharray: e.target.value })}
                                style={{ width: '100%', padding: '4px', 'margin-top': '2px' }}
                            >
                                <option value="">Solid</option>
                                <option value="8,4">Dashed (8,4)</option>
                                <option value="4,4">Dashed (4,4)</option>
                                <option value="2,4">Dotted (2,4)</option>
                                <option value="12,4,4,4">Dash-Dot</option>
                            </select>
                        </label>
                    </fieldset>

                    {/* Arrow Head */}
                    <fieldset style={{ border: '1px solid #dee2e6', padding: '10px', 'border-radius': '4px' }}>
                        <legend style={{ 'font-size': '12px', 'font-weight': 'bold', color: '#6c757d' }}>Arrow Head</legend>

                        <label style={{ display: 'block', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '12px' }}>Shape:</span>
                            <select
                                value={config().headShape}
                                onChange={(e) => setConfig({ ...config(), headShape: e.target.value })}
                                style={{ width: '100%', padding: '4px', 'margin-top': '2px' }}
                            >
                                <option value="chevron">Chevron</option>
                                <option value="triangle">Triangle</option>
                                <option value="diamond">Diamond</option>
                                <option value="circle">Circle</option>
                                <option value="none">None</option>
                            </select>
                        </label>

                        <label style={{ display: 'block', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '12px' }}>Size: {config().headSize}px</span>
                            <input
                                type="range"
                                min="0"
                                max="15"
                                step="1"
                                value={config().headSize}
                                onInput={(e) => setConfig({ ...config(), headSize: parseInt(e.target.value) })}
                                style={{ width: '100%' }}
                            />
                        </label>

                        <label style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                            <input
                                type="checkbox"
                                checked={config().headFill}
                                onChange={(e) => setConfig({ ...config(), headFill: e.target.checked })}
                            />
                            <span style={{ 'font-size': '12px' }}>Fill Head</span>
                        </label>
                    </fieldset>
                </div>

                <div style={{ 'margin-top': '15px', 'padding-top': '15px', 'border-top': '1px solid #dee2e6' }}>
                    <label style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                        <input
                            type="checkbox"
                            checked={showDebug()}
                            onChange={(e) => setShowDebug(e.target.checked)}
                        />
                        <span style={{ 'font-size': '12px' }}>Show Debug Coordinates</span>
                    </label>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* SVG CANVAS */}
            {/* ═══════════════════════════════════════════════════════════════════ */}

            <svg
                width="900"
                height="680"
                style={{
                    border: '2px solid #dee2e6',
                    'border-radius': '8px',
                    'background-color': '#fff',
                    display: 'block'
                }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                {/* Background grid */}
                <defs>
                    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" stroke-width="0.5" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Section headers */}
                <text x="120" y="70" text-anchor="middle" font-size="14" font-weight="bold" fill="#495057">
                    ANCHOR TYPES
                </text>
                <text x="380" y="70" text-anchor="middle" font-size="14" font-weight="bold" fill="#495057">
                    HEAD SHAPES
                </text>
                <text x="380" y="355" text-anchor="middle" font-size="14" font-weight="bold" fill="#495057">
                    LINE STYLES
                </text>
                <text x="680" y="70" text-anchor="middle" font-size="14" font-weight="bold" fill="#495057">
                    ROUTING
                </text>
                <text x="680" y="315" text-anchor="middle" font-size="14" font-weight="bold" fill="#495057">
                    CURVE RADIUS
                </text>
                <text x="680" y="495" text-anchor="middle" font-size="14" font-weight="bold" fill="#495057">
                    INTERACTIVE
                </text>
                <text x="120" y="455" text-anchor="middle" font-size="14" font-weight="bold" fill="#495057">
                    EDGE CASES
                </text>

                {/* Divider lines */}
                <line x1="270" y1="50" x2="270" y2="500" stroke="#e9ecef" stroke-width="2" stroke-dasharray="4,4" />
                <line x1="520" y1="50" x2="520" y2="650" stroke="#e9ecef" stroke-width="2" stroke-dasharray="4,4" />

                {/* Arrow layer */}
                <g class="arrows">
                    <For each={arrows}>
                        {(arrow) => {
                            const arrowConfig = arrow.useGlobalConfig ? config() : {};
                            return (
                                <Arrow
                                    taskStore={taskStore}
                                    fromId={arrow.from}
                                    toId={arrow.to}
                                    // Anchoring
                                    startAnchor={arrow.useGlobalConfig ? arrowConfig.startAnchor : (arrow.startAnchor ?? 'auto')}
                                    startOffset={arrow.useGlobalConfig ? arrowConfig.startOffset : arrow.startOffset}
                                    endAnchor={arrow.useGlobalConfig ? arrowConfig.endAnchor : (arrow.endAnchor ?? 'left')}
                                    endOffset={arrow.useGlobalConfig ? arrowConfig.endOffset : arrow.endOffset}
                                    // Path
                                    routing={arrow.useGlobalConfig ? arrowConfig.routing : (arrow.routing ?? 'orthogonal')}
                                    curveRadius={arrow.useGlobalConfig ? arrowConfig.curveRadius : (arrow.curveRadius ?? 8)}
                                    // Line style
                                    stroke={arrow.useGlobalConfig ? arrowConfig.stroke : (arrow.stroke ?? '#3498db')}
                                    strokeWidth={arrow.useGlobalConfig ? arrowConfig.strokeWidth : (arrow.strokeWidth ?? 2)}
                                    strokeOpacity={arrow.useGlobalConfig ? arrowConfig.strokeOpacity : (arrow.strokeOpacity ?? 1)}
                                    strokeDasharray={arrow.useGlobalConfig ? arrowConfig.strokeDasharray : arrow.strokeDasharray}
                                    // Head
                                    headShape={arrow.useGlobalConfig ? arrowConfig.headShape : (arrow.headShape ?? 'chevron')}
                                    headSize={arrow.useGlobalConfig ? arrowConfig.headSize : (arrow.headSize ?? 6)}
                                    headFill={arrow.useGlobalConfig ? arrowConfig.headFill : (arrow.headFill ?? false)}
                                />
                            );
                        }}
                    </For>
                </g>

                {/* Task bars */}
                <g class="tasks">
                    <For each={scenarios}>
                        {(scenario) => {
                            const pos = () => taskStore.getBarPosition(scenario.id);
                            const task = () => taskStore.getTask(scenario.id);
                            const isDragging = () => dragging() === scenario.id;
                            const isDraggable = () => task()?.draggable;

                            return (
                                <g>
                                    <rect
                                        x={pos()?.x}
                                        y={pos()?.y}
                                        width={pos()?.width}
                                        height={pos()?.height}
                                        fill={isDragging() ? '#2c3e50' : (isDraggable() ? '#3498db' : '#6c757d')}
                                        rx="4"
                                        style={{
                                            cursor: isDraggable() ? 'move' : 'default',
                                            stroke: isDragging() ? '#1a252f' : (isDraggable() ? '#2980b9' : '#495057'),
                                            'stroke-width': isDragging() ? '3' : '2'
                                        }}
                                        onMouseDown={(e) => handleMouseDown(scenario.id, e)}
                                    />
                                    {scenario.name && (
                                        <text
                                            x={(pos()?.x || 0) + (pos()?.width || 0) / 2}
                                            y={(pos()?.y || 0) + (pos()?.height || 0) / 2 + 4}
                                            text-anchor="middle"
                                            fill="white"
                                            font-size="11"
                                            font-weight="600"
                                            style={{ 'pointer-events': 'none' }}
                                        >
                                            {scenario.name}
                                        </text>
                                    )}

                                    {/* Debug info */}
                                    {showDebug() && (
                                        <text
                                            x={(pos()?.x || 0)}
                                            y={(pos()?.y || 0) - 4}
                                            font-size="9"
                                            fill="#adb5bd"
                                            style={{ 'pointer-events': 'none' }}
                                        >
                                            ({Math.round(pos()?.x || 0)}, {Math.round(pos()?.y || 0)})
                                        </text>
                                    )}
                                </g>
                            );
                        }}
                    </For>
                </g>
            </svg>

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* REFERENCE */}
            {/* ═══════════════════════════════════════════════════════════════════ */}

            <div style={{
                'margin-top': '20px',
                padding: '20px',
                'background-color': '#e7f5ff',
                'border-radius': '8px',
                'border-left': '4px solid #339af0'
            }}>
                <h3 style={{ margin: '0 0 15px 0' }}>API Reference</h3>

                <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', 'font-size': '13px' }}>
                    <div>
                        <h4 style={{ 'margin-bottom': '8px', color: '#1971c2' }}>Connection</h4>
                        <code style={{ display: 'block', 'background': '#f1f3f4', padding: '8px', 'border-radius': '4px', 'font-size': '11px' }}>
                            from={'{'} x, y, width, height {'}'}<br />
                            to={'{'} x, y, width, height {'}'}<br />
                            <em>-- OR --</em><br />
                            taskStore={'{store}'}<br />
                            fromId="task-1"<br />
                            toId="task-2"
                        </code>
                    </div>

                    <div>
                        <h4 style={{ 'margin-bottom': '8px', color: '#1971c2' }}>Anchoring</h4>
                        <code style={{ display: 'block', 'background': '#f1f3f4', padding: '8px', 'border-radius': '4px', 'font-size': '11px' }}>
                            startAnchor="auto|top|bottom|left|right|center"<br />
                            startOffset={'{0-1}'}<br />
                            endAnchor="left|right|top|bottom|center"<br />
                            endOffset={'{0-1}'}
                        </code>
                    </div>

                    <div>
                        <h4 style={{ 'margin-bottom': '8px', color: '#1971c2' }}>Path Shape</h4>
                        <code style={{ display: 'block', 'background': '#f1f3f4', padding: '8px', 'border-radius': '4px', 'font-size': '11px' }}>
                            routing="orthogonal|straight"<br />
                            curveRadius={'{pixels}'}
                        </code>
                    </div>

                    <div>
                        <h4 style={{ 'margin-bottom': '8px', color: '#1971c2' }}>Line Style</h4>
                        <code style={{ display: 'block', 'background': '#f1f3f4', padding: '8px', 'border-radius': '4px', 'font-size': '11px' }}>
                            stroke="#color"<br />
                            strokeWidth={'{pixels}'}<br />
                            strokeOpacity={'{0-1}'}<br />
                            strokeDasharray="8,4"<br />
                            strokeLinecap="round|butt|square"<br />
                            strokeLinejoin="round|miter|bevel"
                        </code>
                    </div>

                    <div>
                        <h4 style={{ 'margin-bottom': '8px', color: '#1971c2' }}>Arrow Head</h4>
                        <code style={{ display: 'block', 'background': '#f1f3f4', padding: '8px', 'border-radius': '4px', 'font-size': '11px' }}>
                            headShape="chevron|triangle|diamond|circle|none"<br />
                            headSize={'{pixels}'}<br />
                            headFill={'{boolean}'}
                        </code>
                    </div>

                    <div>
                        <h4 style={{ 'margin-bottom': '8px', color: '#1971c2' }}>Defaults</h4>
                        <code style={{ display: 'block', 'background': '#f1f3f4', padding: '8px', 'border-radius': '4px', 'font-size': '11px' }}>
                            startAnchor: "{ARROW_DEFAULTS.START_ANCHOR}"<br />
                            endAnchor: "{ARROW_DEFAULTS.END_ANCHOR}"<br />
                            routing: "{ARROW_DEFAULTS.ROUTING}"<br />
                            curveRadius: {ARROW_DEFAULTS.CURVE_RADIUS}<br />
                            headShape: "{ARROW_DEFAULTS.HEAD_SHAPE}"<br />
                            headSize: {ARROW_DEFAULTS.HEAD_SIZE}
                        </code>
                    </div>
                </div>
            </div>

            {/* Architecture note */}
            <div style={{
                'margin-top': '20px',
                padding: '20px',
                'background-color': '#fff3cd',
                'border-radius': '8px',
                'border-left': '4px solid #ffc107'
            }}>
                <h3 style={{ margin: '0 0 10px 0' }}>Architecture Note</h3>
                <p style={{ margin: 0, 'font-size': '14px', 'line-height': '1.6' }}>
                    The <strong>Arrow</strong> component is <em>purely decorative/informative</em>.
                    It renders an SVG path between two rectangular regions and knows nothing about:
                </p>
                <ul style={{ margin: '10px 0 0 0', 'padding-left': '20px', 'font-size': '14px', 'line-height': '1.6' }}>
                    <li><strong>Constraints</strong> - temporal rules, push behavior, fixed offsets</li>
                    <li><strong>Task semantics</strong> - what tasks mean, their relationships</li>
                    <li><strong>Movement</strong> - drag handling, collision detection</li>
                    <li><strong>Dependencies</strong> - FS/SS/FF/SF dependency types</li>
                </ul>
                <p style={{ margin: '10px 0 0 0', 'font-size': '14px' }}>
                    All of these belong in the <strong>Task System</strong>, which is responsible for
                    functional/temporal/interactive behavior.
                </p>
            </div>
        </div>
    );
}
