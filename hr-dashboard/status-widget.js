// Add a status control widget to the topbar
document.addEventListener('DOMContentLoaded', () => {
    // Global Fix for "sw.js" errors: Unregister any ghost service workers
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            for (let registration of registrations) {
                registration.unregister().then(success => {
                    if (success) console.log('Successfully unregistered stale service worker.');
                });
            }
        });
    }

    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return;

    // Create widget container
    const widget = document.createElement('div');
    widget.style.cssText = `
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: rgba(255, 255, 255, 0.1);
        padding: 4px 8px;
        border-radius: 20px;
        margin-right: 1rem;
        border: 1px solid var(--surface-border, #e2e8f0);
    `;

    // Dropdown for status
    const select = document.createElement('select');
    select.style.cssText = `
        background: transparent;
        border: none;
        outline: none;
        font-family: inherit;
        font-weight: 600;
        font-size: 0.85rem;
        cursor: pointer;
        color: var(--text-main, #1e293b);
    `;
    
    // Check if body is dark mode (some dashboards are dark)
    const isDark = getComputedStyle(document.body).backgroundColor === 'rgb(15, 23, 42)' || getComputedStyle(document.body).backgroundColor === 'rgb(5, 11, 20)';
    if (isDark) {
        select.style.color = '#fff';
    }

    const options = [
        { value: 'Active', text: '🟢 Online', color: '#10b981' },
        { value: 'Break', text: '☕ On Break', color: '#f59e0b' },
        { value: 'Away', text: '🚶 Away', color: '#ef4444' },
        { value: 'Idle', text: '⏳ Idle', color: '#f59e0b' },
        { value: 'Offline', text: '⛔ Offline', color: '#64748b' }
    ];

    options.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.text;
        optionEl.style.color = '#000'; // Reset for dropdown options
        select.appendChild(optionEl);
    });

    // Indicator dot
    const dot = document.createElement('div');
    dot.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #10b981; // Success green
        box-shadow: 0 0 5px rgba(16, 185, 129, 0.5);
    `;

    select.addEventListener('change', (e) => {
        const selected = options.find(o => o.value === e.target.value);
        if (selected) {
            dot.style.backgroundColor = selected.color;
            dot.style.boxShadow = `0 0 5px ${selected.color}`;
        }
        
        if (window.setTrackerOverride) {
            window.setTrackerOverride(e.target.value);
        } else if (window.setTrackerBreak) {
            // fallback
            window.setTrackerBreak(e.target.value === 'Break');
        }
    });

    widget.appendChild(dot);
    widget.appendChild(select);

    // Insert before the notification wrapper or avatar
    topbarRight.insertBefore(widget, topbarRight.children[topbarRight.children.length - 1]);
});

