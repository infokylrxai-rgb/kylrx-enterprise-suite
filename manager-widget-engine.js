/**
 * Manager Widget Engine
 * Dynamically renders widgets for any department-specific dashboard
 */

export class ManagerWidgetEngine {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.widgets = [];
    }

    render(config) {
        if (!this.container) return;
        this.container.innerHTML = '';
        
        config.forEach(widgetId => {
            const widgetEl = this.createWidget(widgetId);
            this.container.appendChild(widgetEl);
        });

        if (window.lucide) lucide.createIcons();
    }

    createWidget(id) {
        const div = document.createElement('div');
        const isDashboard = this.container.id === 'managerGrid';
        div.className = isDashboard ? 'widget-item w-md' : 'canvas-widget';
        div.dataset.id = id;
        
        const content = this.getWidgetContent(id, isDashboard);
        div.innerHTML = `
            <div class="widget-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                <h4 style="font-size:0.8rem; font-weight:800; text-transform:uppercase; color: var(--text-muted);">${id} Insights</h4>
                <div class="widget-actions"><i data-lucide="more-horizontal" size="14"></i></div>
            </div>
            <div class="widget-body">${content}</div>
        `;
        return div;
    }

    getWidgetContent(id, isDashboard) {
        const height = isDashboard ? '200px' : '120px';
        switch(id) {
            case 'productivity':
                return `<div style="height:${height}; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#f8fafc; border-radius:12px; border:1px dashed #cbd5e1;">
                            <i data-lucide="bar-chart" style="color:var(--primary); margin-bottom:10px;"></i>
                            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">Productivity Stream Active</span>
                        </div>`;
            case 'telemetry':
                return `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
                            <div style="background:#eff6ff; padding:15px; border-radius:16px; border:1px solid #dbeafe;">
                                <div style="font-size:0.6rem; font-weight:800; color:#3b82f6; text-transform:uppercase; letter-spacing:1px;">Active</div>
                                <div style="font-size:1.5rem; font-weight:800; color:var(--text-main);">24</div>
                            </div>
                            <div style="background:#fef2f2; padding:15px; border-radius:16px; border:1px solid #fee2e2;">
                                <div style="font-size:0.6rem; font-weight:800; color:#ef4444; text-transform:uppercase; letter-spacing:1px;">Idle</div>
                                <div style="font-size:1.5rem; font-weight:800; color:var(--text-main);">3</div>
                            </div>
                        </div>`;
            case 'security':
                return `<div style="padding:15px; background:#fff1f2; border-radius:16px; border:1px solid #ffe4e6; color:#e11d48;">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                                <i data-lucide="shield-alert" size="16"></i>
                                <b style="font-size:0.8rem;">Critical Alerts</b>
                            </div>
                            <p style="font-size:0.7rem; margin:0; font-weight:600;">2 Unprivileged access attempts detected in segment B-4.</p>
                        </div>`;
            case 'payroll':
                return `<div style="padding:15px; background:#f0fdf4; border-radius:16px; border:1px solid #dcfce7; color:#16a34a;">
                            <div style="font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Monthly Burn</div>
                            <div style="font-size:1.5rem; font-weight:800; color:var(--text-main);">₹4.2M</div>
                            <div style="font-size:0.65rem; font-weight:600; margin-top:5px;">+12.5% vs Prev Month</div>
                        </div>`;
            default:
                return `<p style="font-size:0.75rem; color:#64748b;">Widget configuration pending.</p>`;
        }
    }
}
