import { For } from 'solid-js';

export function CurveDiagnostic() {
    const curves = [
        {
            name: 'Q1',
            path: 'M 50 100 a 50 50 0 0 0 50 -50',
            start_x: 50,
            start_y: 100,
            end_x: 100,
            end_y: 50
        },
        {
            name: 'Q2',
            path: 'M 100 100 a 50 50 0 0 1 50 -50',
            start_x: 100,
            start_y: 100,
            end_x: 150,
            end_y: 50
        },
        {
            name: 'Q3',
            path: 'M 50 50 a 50 50 0 0 0 50 50',
            start_x: 50,
            start_y: 50,
            end_x: 100,
            end_y: 100
        },
        {
            name: 'Q4',
            path: 'M 100 50 a 50 50 0 0 1 50 50',
            start_x: 100,
            start_y: 50,
            end_x: 150,
            end_y: 100
        }
    ];

    return (
        <div style={{ padding: '20px' }}>
            <h2>Four Curves</h2>
            <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '20px' }}>
                <For each={curves}>
                    {(curve) => (
                        <div style={{ border: '2px solid #ccc', padding: '15px' }}>
                            <h3>{curve.name}</h3>
                            <svg width="200" height="200" style={{ border: '1px solid #ddd' }}>
                                <path d={curve.path} fill="transparent" stroke="#2563eb" stroke-width="3" />
                                <circle cx={curve.start_x} cy={curve.start_y} r="4" fill="green" />
                                <circle cx={curve.end_x} cy={curve.end_y} r="4" fill="red" />
                            </svg>
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
}
