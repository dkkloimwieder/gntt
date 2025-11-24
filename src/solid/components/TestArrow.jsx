import { onMount, createSignal, For } from 'solid-js';
import { createTaskStore } from '../stores/taskStore.js';
import { Arrow } from './Arrow.jsx';

/**
 * Comprehensive directional arrow test.
 * Tests all 6 critical scenarios: forward/backward × up/down/same-level
 * Focus: Verify that arrows curve correctly when successor is ABOVE predecessor
 */
export function TestArrow() {
    let svgRef;
    const taskStore = createTaskStore();
    const [dragging, setDragging] = createSignal(null);
    const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });
    const [showDebug, setShowDebug] = createSignal(false);
    const [arrowConfig, setArrowConfig] = createSignal({
        curveRadius: 8,
        horizontalGap: 15,
        arrowSize: 5,
        startAnchor: 'auto',
        startAnchorOffset: 0.5
    });

    onMount(() => {
        // Test scenarios with explicit predecessor -> successor relationships
        const mockTasks = [
            // === FORWARD ARROWS ===

            // 1. Forward: Predecessor BELOW Successor (arrow goes UP)
            {
                id: 'fwd-up-pred',
                name: 'Pred',
                _index: 0,
                $bar: { x: 50, y: 180, width: 80, height: 20 }
            },
            {
                id: 'fwd-up-succ',
                name: 'Succ',
                _index: 1,
                $bar: { x: 170, y: 120, width: 80, height: 20 }
            },

            // 2. Forward: Predecessor ABOVE Successor (arrow goes DOWN)
            {
                id: 'fwd-down-pred',
                name: 'Pred',
                _index: 2,
                $bar: { x: 50, y: 230, width: 80, height: 20 }
            },
            {
                id: 'fwd-down-succ',
                name: 'Succ',
                _index: 3,
                $bar: { x: 170, y: 290, width: 80, height: 20 }
            },

            // 3. Forward: Same level
            {
                id: 'fwd-same-pred',
                name: 'Pred',
                _index: 4,
                $bar: { x: 50, y: 340, width: 80, height: 20 }
            },
            {
                id: 'fwd-same-succ',
                name: 'Succ',
                _index: 5,
                $bar: { x: 170, y: 340, width: 80, height: 20 }
            },

            // === BACKWARD ARROWS ===
            // For backward: target's left edge must be <= source's left edge + padding (18px)
            // Source bar: x=380, width=100, so left edge at 380, right edge at 480
            // Target must be at x <= 380 + 18 = 398 to trigger backward

            // 4. Backward: Predecessor BELOW Successor (loop must go UP)
            {
                id: 'back-up-pred',
                name: 'Pred',
                _index: 6,
                $bar: { x: 380, y: 180, width: 100, height: 20 }
            },
            {
                id: 'back-up-succ',
                name: 'Succ',
                _index: 7,
                $bar: { x: 300, y: 120, width: 70, height: 20 }  // clearly to the left
            },

            // 5. Backward: Predecessor ABOVE Successor (loop must go DOWN)
            {
                id: 'back-down-pred',
                name: 'Pred',
                _index: 8,
                $bar: { x: 380, y: 230, width: 100, height: 20 }
            },
            {
                id: 'back-down-succ',
                name: 'Succ',
                _index: 9,
                $bar: { x: 300, y: 290, width: 70, height: 20 }  // clearly to the left
            },

            // 6. Backward: Same level (loop above)
            {
                id: 'back-same-pred',
                name: 'Pred',
                _index: 10,
                $bar: { x: 380, y: 340, width: 100, height: 20 }
            },
            {
                id: 'back-same-succ',
                name: 'Succ',
                _index: 11,
                $bar: { x: 300, y: 340, width: 70, height: 20 }  // clearly to the left
            },

            // === DRAGGABLE TEST ===
            {
                id: 'drag-pred',
                name: 'Drag Me',
                _index: 12,
                $bar: { x: 600, y: 200, width: 100, height: 20 }
            },
            {
                id: 'drag-succ',
                name: 'Target',
                _index: 13,
                $bar: { x: 600, y: 260, width: 100, height: 20 }
            }
        ];

        taskStore.updateTasks(mockTasks);

        // Drag handlers
        const svg = svgRef.parentElement;
        svg.addEventListener('mousemove', handleMouseMove);
        svg.addEventListener('mouseup', handleMouseUp);
    });

    const handleMouseDown = (taskId, event) => {
        const task = taskStore.getTask(taskId);
        if (task) {
            const svg = event.currentTarget.ownerSVGElement;
            const pt = svg.createSVGPoint();
            pt.x = event.clientX;
            pt.y = event.clientY;
            const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

            setDragging(taskId);
            setDragOffset({
                x: svgP.x - task.$bar.x,
                y: svgP.y - task.$bar.y
            });
        }
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

    const taskIds = [
        'fwd-up-pred', 'fwd-up-succ',
        'fwd-down-pred', 'fwd-down-succ',
        'fwd-same-pred', 'fwd-same-succ',
        'back-up-pred', 'back-up-succ',
        'back-down-pred', 'back-down-succ',
        'back-same-pred', 'back-same-succ',
        'drag-pred', 'drag-succ'
    ];

    // Arrow definitions with clear predecessor -> successor relationships
    const arrows = [
        // Forward arrows
        { from: 'fwd-up-pred', to: 'fwd-up-succ', color: '#9b59b6', label: '1. Fwd Up' },
        { from: 'fwd-down-pred', to: 'fwd-down-succ', color: '#3498db', label: '2. Fwd Down' },
        { from: 'fwd-same-pred', to: 'fwd-same-succ', color: '#2ecc71', label: '3. Fwd Same' },
        // Backward arrows
        { from: 'back-up-pred', to: 'back-up-succ', color: '#e67e22', label: '4. Back Up' },
        { from: 'back-down-pred', to: 'back-down-succ', color: '#e74c3c', label: '5. Back Down' },
        { from: 'back-same-pred', to: 'back-same-succ', color: '#f39c12', label: '6. Back Same' },
        // Draggable
        { from: 'drag-pred', to: 'drag-succ', color: '#1abc9c', label: '7. Drag Test' }
    ];

    return (
        <div style={{ padding: '20px', 'font-family': 'monospace' }}>
            <h2>Arrow Directional Test - Fixed Implementation</h2>
            <p style={{ color: '#666', 'margin-bottom': '10px' }}>
                <strong>Critical Test:</strong> Arrows must curve correctly when successor is ABOVE predecessor.
                All 6 scenarios should display smooth, directional curves.
            </p>
            <p style={{ color: '#666', 'margin-bottom': '20px', 'font-size': '12px' }}>
                <em>Note: Backward arrows trigger when target's left edge ≤ source's left edge + padding</em>
            </p>

            {/* Configuration controls */}
            <div style={{
                'margin-bottom': '20px',
                padding: '15px',
                'background-color': '#f5f5f5',
                'border-radius': '4px',
                display: 'flex',
                gap: '20px',
                'align-items': 'center',
                'flex-wrap': 'wrap'
            }}>
                <label style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                    Curve Radius: <strong>{arrowConfig().curveRadius}</strong>
                    <input
                        type="range"
                        min="0"
                        max="20"
                        value={arrowConfig().curveRadius}
                        onInput={(e) => setArrowConfig({ ...arrowConfig(), curveRadius: parseInt(e.target.value) })}
                        style={{ width: '120px' }}
                    />
                </label>

                <label style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                    Padding (Gap): <strong>{arrowConfig().horizontalGap}</strong>
                    <input
                        type="range"
                        min="10"
                        max="30"
                        value={arrowConfig().horizontalGap}
                        onInput={(e) => setArrowConfig({ ...arrowConfig(), horizontalGap: parseInt(e.target.value) })}
                        style={{ width: '120px' }}
                    />
                </label>

                <label style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                    Start Anchor:
                    <select
                        value={arrowConfig().startAnchor}
                        onChange={(e) => setArrowConfig({ ...arrowConfig(), startAnchor: e.target.value })}
                        style={{ padding: '5px' }}
                    >
                        <option value="auto">Auto (top/bottom edge)</option>
                        <option value="right-center">Right Center</option>
                        <option value="top-edge">Top Edge</option>
                        <option value="bottom-edge">Bottom Edge</option>
                    </select>
                </label>

                <label style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                    Edge Position: <strong>{Math.round(arrowConfig().startAnchorOffset * 100)}%</strong>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={arrowConfig().startAnchorOffset * 100}
                        onInput={(e) => setArrowConfig({ ...arrowConfig(), startAnchorOffset: parseInt(e.target.value) / 100 })}
                        style={{ width: '120px' }}
                    />
                </label>

                <label style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                    <input
                        type="checkbox"
                        checked={showDebug()}
                        onChange={(e) => setShowDebug(e.target.checked)}
                    />
                    Show Debug Info
                </label>
            </div>

            {/* SVG Container */}
            <svg
                width="800"
                height="400"
                style={{
                    border: '2px solid #ccc',
                    'border-radius': '8px',
                    'background-color': '#fafafa'
                }}
            >
                {/* Section labels */}
                <text x="150" y="30" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">
                    FORWARD ARROWS
                </text>
                <text x="150" y="50" text-anchor="middle" font-size="11" fill="#666">
                    (Left to Right)
                </text>

                <text x="370" y="30" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">
                    BACKWARD ARROWS
                </text>
                <text x="370" y="50" text-anchor="middle" font-size="11" fill="#666">
                    (Right to Left)
                </text>

                <text x="650" y="30" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">
                    DRAG TEST
                </text>

                {/* Divider lines */}
                <line x1="280" y1="60" x2="280" y2="400" stroke="#ddd" stroke-width="2" stroke-dasharray="5,5" />
                <line x1="530" y1="60" x2="530" y2="400" stroke="#ddd" stroke-width="2" stroke-dasharray="5,5" />

                {/* Scenario labels */}
                <For each={[
                    { y: 130, label: '1. Pred BELOW Succ (UP)' },
                    { y: 240, label: '2. Pred ABOVE Succ (DOWN)' },
                    { y: 350, label: '3. Same Level' }
                ]}>
                    {(item) => (
                        <>
                            <text x="10" y={item.y} font-size="10" fill="#999">{item.label}</text>
                        </>
                    )}
                </For>

                {/* Arrows layer */}
                <g ref={svgRef} class="arrows-layer">
                    <For each={arrows}>
                        {(arrow) => (
                            <Arrow
                                fromTaskId={arrow.from}
                                toTaskId={arrow.to}
                                taskStore={taskStore}
                                curveRadius={arrowConfig().curveRadius}
                                horizontalGap={arrowConfig().horizontalGap}
                                arrowSize={arrowConfig().arrowSize}
                                startAnchor={arrowConfig().startAnchor}
                                startAnchorOffset={arrowConfig().startAnchorOffset}
                                stroke={arrow.color}
                                strokeWidth={2.5}
                            />
                        )}
                    </For>
                </g>

                {/* Task bars */}
                <For each={taskIds}>
                    {(taskId) => {
                        const pos = () => taskStore.getBarPosition(taskId);
                        const task = () => taskStore.getTask(taskId);
                        const isPred = () => taskId.includes('pred');

                        return (
                            <g>
                                <rect
                                    x={pos()?.x}
                                    y={pos()?.y}
                                    width={pos()?.width}
                                    height={pos()?.height}
                                    fill={dragging() === taskId ? "#1a252f" : (isPred() ? "#34495e" : "#95a5a6")}
                                    rx="3"
                                    style={{
                                        cursor: "move",
                                        stroke: isPred() ? "#2c3e50" : "#7f8c8d",
                                        "stroke-width": "2"
                                    }}
                                    onMouseDown={(e) => handleMouseDown(taskId, e)}
                                />
                                <text
                                    x={(pos()?.x || 0) + (pos()?.width || 0) / 2}
                                    y={(pos()?.y || 0) + (pos()?.height || 0) / 2 + 5}
                                    text-anchor="middle"
                                    fill="white"
                                    font-size="11"
                                    font-weight="600"
                                    style={{ "pointer-events": "none" }}
                                >
                                    {task()?.name}
                                </text>

                                {/* Debug info */}
                                {showDebug() && (
                                    <text
                                        x={(pos()?.x || 0)}
                                        y={(pos()?.y || 0) - 5}
                                        font-size="9"
                                        fill="#666"
                                        style={{ "pointer-events": "none" }}
                                    >
                                        y={Math.round(pos()?.y || 0)}
                                    </text>
                                )}
                            </g>
                        );
                    }}
                </For>
            </svg>

            {/* Legend */}
            <div style={{
                'margin-top': '20px',
                padding: '15px',
                'background-color': '#e8f5e9',
                'border-radius': '4px',
                'border-left': '4px solid #4caf50'
            }}>
                <strong>Test Scenarios:</strong>
                <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '10px', 'margin-top': '10px' }}>
                    <For each={arrows}>
                        {(arrow) => (
                            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                                <span style={{
                                    width: '30px',
                                    height: '3px',
                                    'background-color': arrow.color,
                                    display: 'inline-block'
                                }}></span>
                                <span style={{ 'font-size': '13px' }}>{arrow.label}</span>
                            </div>
                        )}
                    </For>
                </div>

                <p style={{ 'margin-top': '15px', 'font-size': '13px' }}>
                    <strong>Visual Key:</strong> Dark bars = Predecessors, Light bars = Successors<br/>
                    <strong>Try:</strong> Drag tasks vertically to verify arrows adapt correctly to position changes
                </p>
            </div>

            {/* Success criteria */}
            <div style={{
                'margin-top': '15px',
                padding: '15px',
                'background-color': '#fff3cd',
                'border-radius': '4px',
                'border-left': '4px solid #ffc107'
            }}>
                <strong>✓ Success Criteria:</strong>
                <ul style={{ 'margin-top': '8px', 'padding-left': '20px', 'font-size': '13px' }}>
                    <li>All forward arrows (1-3) should show smooth L-shaped curves</li>
                    <li>All backward arrows (4-6) should show smooth U-shaped loops</li>
                    <li><strong>Critical:</strong> Arrows #1 and #4 must curve UPWARD correctly (successor above predecessor)</li>
                    <li>Arrows #2 and #5 must curve DOWNWARD correctly (successor below predecessor)</li>
                    <li>Dragging tasks should update arrows in real-time without visual glitches</li>
                </ul>
            </div>
        </div>
    );
}
