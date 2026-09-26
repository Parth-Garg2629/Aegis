console.log("Device View Initialized");

// In a real implementation, this would connect to the background script
// via chrome.runtime.connect() and listen for telemetry events.

function updateMetrics(metrics: any) {
    const cap = document.getElementById("lat-capture");
    const ml = document.getElementById("lat-ml");
    const san = document.getElementById("lat-sanitize");
    const tot = document.getElementById("lat-total");
    
    if (cap) cap.innerText = `${metrics.capture} ms`;
    if (ml) ml.innerText = `${metrics.ml} ms`;
    if (san) san.innerText = `${metrics.sanitize} ms`;
    if (tot) tot.innerText = `${metrics.total} ms`;
}

function updateSignals(signals: any[]) {
    const tbody = document.getElementById("signal-table");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    for (const sig of signals) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${sig.type}</td>
            <td>${sig.count}</td>
            <td>${(sig.confidence * 100).toFixed(1)}%</td>
        `;
        tbody.appendChild(row);
    }
}

// Mock update for testing UI
setTimeout(() => {
    updateMetrics({ capture: 45, ml: 120, sanitize: 12, total: 350 });
    updateSignals([
        { type: "FACE", count: 1, confidence: 0.98 },
        { type: "PAN", count: 1, confidence: 0.99 }
    ]);
}, 1000);
