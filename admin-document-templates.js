/**
 * admin-document-templates.js
 * 
 * Document & Template Engine — Admin UI Controller
 * 
 * Handles:
 * - Template catalog rendering (10 standard enterprise templates)
 * - Template detail side panel with version timeline, field mapping, permitted modules
 * - Document preview with token interpolation
 * - Generated documents archive
 * - Generate document modal
 * - Audit & security gating visualization
 */

const API = 'http://localhost:3000/api';

const CATEGORY_STYLES = {
    'Onboarding':           { icon: 'fa-user-plus',        bg: 'rgba(91,138,240,0.14)',  color: '#5b8af0', tag: 'tag-blue' },
    'Employee Lifecycle':   { icon: 'fa-arrows-spin',      bg: 'rgba(165,108,240,0.14)', color: '#a56cf0', tag: 'tag-purple' },
    'Compensation':         { icon: 'fa-indian-rupee-sign', bg: 'rgba(245,200,66,0.14)', color: '#f5c842', tag: 'tag-gold' },
    'Payroll':              { icon: 'fa-money-bill-wave',   bg: 'rgba(62,207,178,0.14)', color: '#3ecfb2', tag: 'tag-teal' },
    'Exit':                 { icon: 'fa-door-open',         bg: 'rgba(240,91,114,0.14)', color: '#f05b72', tag: 'tag-red' },
};

const MODULE_LABELS = {
    onboarding:    { label: 'Onboarding',    icon: 'fa-user-plus' },
    hr_admin:      { label: 'HR Admin',       icon: 'fa-shield-halved' },
    payroll:       { label: 'Payroll',        icon: 'fa-money-bill-wave' },
    exit:          { label: 'Exit',           icon: 'fa-door-open' },
    pms:           { label: 'PMS',            icon: 'fa-star' },
    statutory:     { label: 'Statutory',      icon: 'fa-scale-balanced' },
};

let allTemplates = [];
let currentTemplate = null;

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   INITIALIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
document.addEventListener('DOMContentLoaded', () => {
    loadTemplates();
    loadNotifBadge();
});

async function loadTemplates() {
    try {
        const res = await fetch(`${API}/document-templates`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed to load templates');

        allTemplates = json.data;
        renderStats(allTemplates);
        renderTemplateGrid(allTemplates);
        renderGatingRules(allTemplates);
    } catch (err) {
        showToast('error', 'Could not load templates: ' + err.message);
        document.getElementById('template-grid').innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <i class="fas fa-triangle-exclamation"></i>
                <h3>Could not load templates</h3>
                <p>${err.message}</p>
            </div>`;
    }
}

async function loadNotifBadge() {
    try {
        const res = await fetch(`${API}/notification-center/summary`);
        const json = await res.json();
        if (json.success) {
            const badge = document.getElementById('sidebar-notif-badge');
            if (badge) badge.textContent = json.data.totalActionable || '—';
        }
    } catch (_) {}
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STATS ROW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderStats(templates) {
    const totalApproved = templates.filter(t => {
        const active = t.versions?.find(v => v.status === 'approved');
        return !!active;
    }).length;

    const totalPending = templates.reduce((sum, t) => {
        return sum + (t.versions?.filter(v => v.status === 'pending_approval').length || 0);
    }, 0);

    const totalModules = new Set(templates.flatMap(t => t.permittedModules || [])).size;

    document.getElementById('stat-total').textContent = templates.length;
    document.getElementById('stat-approved').textContent = totalApproved;
    document.getElementById('stat-pending').textContent = totalPending;
    document.getElementById('stat-gated').textContent = totalModules;

    // Load generated doc count
    fetchGeneratedDocCount();
}

async function fetchGeneratedDocCount() {
    try {
        const res = await fetch(`${API}/document-templates/generated`);
        const json = await res.json();
        if (json.success) {
            document.getElementById('stat-generated').textContent = json.total;
        }
    } catch (_) {
        document.getElementById('stat-generated').textContent = '0';
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TEMPLATE GRID
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderTemplateGrid(templates) {
    const grid = document.getElementById('template-grid');
    if (!templates.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-file-lines"></i><h3>No templates found</h3><p>Adjust your search or filters.</p></div>`;
        return;
    }

    grid.innerHTML = templates.map(t => {
        const style = CATEGORY_STYLES[t.category] || CATEGORY_STYLES['Onboarding'];
        const latestVersion = t.versions?.[t.versions.length - 1];
        const approvedVersion = t.versions?.find(v => v.status === 'approved');
        const tokenCount = t.fieldMappings?.length || latestVersion?.fieldMappings?.length || 0;

        const statusTag = approvedVersion
            ? `<span class="tag tag-green"><i class="fas fa-check-circle"></i> Approved</span>`
            : `<span class="tag tag-gold"><i class="fas fa-clock"></i> Draft</span>`;

        const moduleTags = (t.permittedModules || []).slice(0, 3).map(m => {
            const info = MODULE_LABELS[m] || { label: m, icon: 'fa-plug' };
            return `<span class="tag tag-gray"><i class="fas ${info.icon}"></i> ${info.label}</span>`;
        }).join('');
        const moreModules = (t.permittedModules?.length || 0) > 3
            ? `<span class="tag tag-gray">+${t.permittedModules.length - 3} more</span>` : '';

        return `
        <div class="template-card" onclick="openTemplateDetail('${t.key}')" id="tcard-${t.key}">
            <div class="template-card-header">
                <div class="template-type-icon" style="background:${style.bg};color:${style.color};">
                    <i class="fas ${style.icon}"></i>
                </div>
                <div class="template-card-title">
                    <h3>${t.name}</h3>
                    <p>${t.description}</p>
                </div>
            </div>
            <div class="template-meta">
                <span class="tag ${style.tag}">${t.category}</span>
                ${statusTag}
                <span class="tag tag-blue"><i class="fas fa-code"></i> ${tokenCount} tokens</span>
            </div>
            <div class="template-meta" style="margin-top:-4px;">
                ${moduleTags}${moreModules}
            </div>
            <div class="template-card-footer">
                <div class="template-version-info">
                    <span>${latestVersion?.versionNumber || 'v1.0'}</span> · ${t.versions?.length || 1} version${(t.versions?.length || 1) > 1 ? 's' : ''}
                    ${approvedVersion ? ` · Active since ${new Date(approvedVersion.effectiveFrom).toLocaleDateString('en-IN')}` : ''}
                </div>
                <div class="template-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-secondary btn-sm" onclick="previewTemplate('${t.key}')">
                        <i class="fas fa-eye"></i> Preview
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="quickGenerate('${t.key}')">
                        <i class="fas fa-file-circle-plus"></i>
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function filterTemplates() {
    const search = document.getElementById('search-input').value.toLowerCase();
    const category = document.getElementById('category-filter').value;

    const filtered = allTemplates.filter(t => {
        const matchSearch = !search ||
            t.name.toLowerCase().includes(search) ||
            t.description.toLowerCase().includes(search) ||
            t.category.toLowerCase().includes(search) ||
            (t.permittedModules || []).some(m => m.includes(search));
        const matchCat = category === 'all' || t.category === category;
        return matchSearch && matchCat;
    });

    renderTemplateGrid(filtered);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TEMPLATE DETAIL SIDE PANEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function openTemplateDetail(key) {
    try {
        const res = await fetch(`${API}/document-templates/${key}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        currentTemplate = json.data;
        renderSidePanel(json.data);
        document.getElementById('panel-overlay').classList.add('active');
        document.getElementById('side-panel').classList.add('open');
    } catch (err) {
        showToast('error', 'Could not open template: ' + err.message);
    }
}

function renderSidePanel(template) {
    const style = CATEGORY_STYLES[template.category] || CATEGORY_STYLES['Onboarding'];
    const approvedVer = template.versions?.find(v => v.status === 'approved');
    const allVersions = [...(template.versions || [])].reverse();

    // Header
    const iconEl = document.getElementById('panel-icon');
    iconEl.style.background = style.bg;
    iconEl.style.color = style.color;
    iconEl.innerHTML = `<i class="fas ${style.icon}"></i>`;
    document.getElementById('panel-title').textContent = template.name;
    document.getElementById('panel-subtitle').textContent = `${template.category} · ${template.versions?.length || 1} version(s) · ${template.permittedModules?.length || 0} permitted modules`;

    const fieldMappings = approvedVer?.fieldMappings || template.fieldMappings || [];
    const permittedModules = template.permittedModules || [];

    document.getElementById('panel-body').innerHTML = `
        <!-- Version Timeline -->
        <div class="section-card">
            <div class="section-card-title"><i class="fas fa-code-branch"></i> Version History</div>
            <div class="version-list">
                ${allVersions.map((v, i) => `
                <div class="version-item ${v.status === 'approved' && i === 0 ? 'active-version' : ''}">
                    <div class="version-dot ${v.status}"></div>
                    <div class="version-info">
                        <strong>${v.versionNumber}</strong>
                        <span class="tag ${v.status === 'approved' ? 'tag-green' : v.status === 'draft' ? 'tag-gold' : 'tag-blue'}" style="font-size:10px;padding:2px 8px;margin-left:8px;">${v.status.replace('_', ' ').toUpperCase()}</span>
                        <p>${v.changeNotes || 'Initial version'}</p>
                        <small>
                            Created by <strong>${v.createdBy || 'HR Admin'}</strong> · 
                            Effective: ${new Date(v.effectiveFrom).toLocaleDateString('en-IN')}
                            ${v.approvedBy ? ` · Approved by <strong>${v.approvedBy}</strong>` : ''}
                        </small>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        ${v.status === 'approved' ? `<button class="btn btn-green btn-sm" onclick="quickGenerate('${template.key}')"><i class="fas fa-file-circle-plus"></i></button>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="previewVersion('${template.key}','${v.versionNumber}')"><i class="fas fa-eye"></i></button>
                        ${v.status === 'draft' ? `<button class="btn btn-primary btn-sm" onclick="approveVersion('${template.key}','${v.versionNumber}')"><i class="fas fa-check"></i> Approve</button>` : ''}
                    </div>
                </div>`).join('')}
            </div>
        </div>

        <!-- Field Mapping -->
        <div class="section-card">
            <div class="section-card-title"><i class="fas fa-map"></i> Field Mapping (${fieldMappings.length} tokens)</div>
            ${fieldMappings.length > 0 ? `
            <table class="field-table">
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Label</th>
                        <th>Sample Value</th>
                        <th>Req.</th>
                    </tr>
                </thead>
                <tbody>
                    ${fieldMappings.map(f => `
                    <tr>
                        <td><span class="token-badge">${f.token}</span></td>
                        <td style="color:var(--text-secondary);">${f.label}</td>
                        <td style="color:var(--text-muted);font-size:12px;">${f.sample || '—'}</td>
                        <td>${f.required ? '<span class="required-dot" title="Required"></span>' : '<span style="color:var(--text-muted);font-size:11px;">opt</span>'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>` : '<p style="color:var(--text-muted);font-size:13px;">No field mappings defined.</p>'}
        </div>

        <!-- Permitted Modules -->
        <div class="section-card">
            <div class="section-card-title"><i class="fas fa-lock"></i> Permitted Modules (${permittedModules.length})</div>
            <div class="permission-grid">
                ${['onboarding','hr_admin','payroll','exit','pms','statutory'].map(m => {
                    const allowed = permittedModules.includes(m);
                    const info = MODULE_LABELS[m] || { label: m, icon: 'fa-plug' };
                    return `<div class="permission-item ${allowed ? 'allowed' : 'restricted'}">
                        <i class="fas ${allowed ? 'fa-check-circle' : 'fa-ban'} ${allowed ? '' : 'text-muted'}"></i>
                        <span style="font-size:12px;">${info.label}</span>
                    </div>`;
                }).join('')}
            </div>
            <p style="font-size:11.5px;color:var(--text-muted);margin-top:10px;line-height:1.6;">
                <i class="fas fa-info-circle" style="color:var(--accent-blue);"></i>
                Only permitted modules may call <code style="font-size:10px;background:var(--bg-hover);padding:2px 5px;border-radius:3px;">generateDocument()</code> for this template. Unauthorized calls receive <strong>403 Forbidden</strong>.
            </p>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:10px;padding-bottom:10px;">
            <button class="btn btn-primary" style="flex:1;" onclick="previewTemplate('${template.key}')">
                <i class="fas fa-eye"></i> Preview Template
            </button>
            <button class="btn btn-green" style="flex:1;" onclick="quickGenerate('${template.key}')">
                <i class="fas fa-file-circle-plus"></i> Generate Document
            </button>
        </div>
    `;
}

function closeSidePanel() {
    document.getElementById('panel-overlay').classList.remove('active');
    document.getElementById('side-panel').classList.remove('open');
    currentTemplate = null;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function previewTemplate(key) {
    openTemplateDetail(key).then(() => {
        setTimeout(() => previewVersion(key, null), 600);
    });
}

async function previewVersion(key, versionNumber) {
    const previewContainer = document.createElement('div');
    previewContainer.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:500;display:flex;align-items:center;justify-content:center;" onclick="this.remove()">
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;width:80vw;max-width:900px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;" onclick="event.stopPropagation()">
                <div style="padding:16px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
                    <i class="fas fa-eye" style="color:var(--accent-blue);"></i>
                    <h2 style="font-size:15px;font-weight:700;flex:1;">Template Preview${versionNumber ? ` — ${versionNumber}` : ' — Active Version'}</h2>
                    <button onclick="this.closest('[style]').remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;"><i class="fas fa-xmark"></i></button>
                </div>
                <div style="flex:1;overflow-y:auto;padding:24px;" id="preview-modal-body">
                    <div class="preview-loading"><div class="spinner"></div></div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(previewContainer);

    try {
        const body = versionNumber ? { versionNumber } : {};
        const res = await fetch(`${API}/document-templates/${key}/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        const modalBody = document.getElementById('preview-modal-body');
        modalBody.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:12px;color:var(--text-muted);">
                <span class="tag tag-teal">Version ${json.data.versionNumber}</span>
                <span class="tag ${json.data.status === 'approved' ? 'tag-green' : 'tag-gold'}">${json.data.status.toUpperCase()}</span>
                <span>· Effective from ${new Date(json.data.effectiveFrom).toLocaleDateString('en-IN')}</span>
                <span style="margin-left:auto;color:var(--accent-blue);font-size:11px;"><i class="fas fa-info-circle"></i> Rendered with sample data</span>
            </div>
            <div class="preview-frame">${json.data.renderedHtml}</div>`;
    } catch (err) {
        const modalBody = document.getElementById('preview-modal-body');
        modalBody.innerHTML = `<p style="color:var(--accent-red);">Preview failed: ${err.message}</p>`;
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   APPROVE VERSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function approveVersion(templateKey, versionNumber) {
    if (!confirm(`Approve version '${versionNumber}' of template '${templateKey}'?`)) return;
    try {
        const res = await fetch(`${API}/document-templates/${templateKey}/versions/${versionNumber}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approvedBy: 'HR Director', approvalRemarks: 'Approved via Admin UI' })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        showToast('success', `Version '${versionNumber}' approved successfully!`);
        await loadTemplates();
        openTemplateDetail(templateKey);
    } catch (err) {
        showToast('error', 'Approval failed: ' + err.message);
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GENERATE DOCUMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function quickGenerate(templateKey) {
    const template = allTemplates.find(t => t.key === templateKey) || currentTemplate;
    if (!template) return showToast('error', 'Template not found.');

    const approvedVer = template.versions?.find(v => v.status === 'approved');
    if (!approvedVer) return showToast('error', 'No approved version available to generate from.');

    const fieldMappings = approvedVer.fieldMappings || template.fieldMappings || [];

    const modal = document.createElement('div');
    modal.id = 'gen-modal';
    modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:500;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;width:580px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;" onclick="event.stopPropagation()">
                <div style="padding:18px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
                    <i class="fas fa-file-circle-plus" style="color:var(--accent-green);font-size:18px;"></i>
                    <div style="flex:1;">
                        <h2 style="font-size:15px;font-weight:700;">Generate — ${template.name}</h2>
                        <p style="font-size:12px;color:var(--text-muted);">Version ${approvedVer.versionNumber} · ${fieldMappings.length} fields required</p>
                    </div>
                    <button onclick="this.closest('[style]').remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;"><i class="fas fa-xmark"></i></button>
                </div>
                <div style="flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px;">
                    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:12.5px;color:var(--text-secondary);line-height:1.7;">
                        <i class="fas fa-info-circle" style="color:var(--accent-blue);"></i>
                        Fill in the employee data fields below. Leave blank to use sample placeholder values for demo purposes.
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;" id="gen-fields">
                        ${fieldMappings.slice(0, 8).map(f => `
                        <div>
                            <label style="font-size:11.5px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px;display:block;margin-bottom:5px;">
                                ${f.label} ${f.required ? '<span style="color:var(--accent-red);">*</span>' : ''}
                            </label>
                            <input type="text" placeholder="${f.sample || 'Enter value…'}"
                                data-token="${f.token}"
                                style="width:100%;background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;padding:9px 12px;font-family:inherit;outline:none;transition:border-color 0.2s;"
                                onfocus="this.style.borderColor='var(--border-active)'"
                                onblur="this.style.borderColor='var(--border)'" />
                        </div>`).join('')}
                    </div>
                    <div>
                        <label style="font-size:11.5px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px;display:block;margin-bottom:5px;">Caller Module</label>
                        <select id="gen-module" style="width:100%;background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;padding:9px 12px;font-family:inherit;outline:none;">
                            ${(template.permittedModules || ['hr_admin']).map(m => `<option value="${m}">${MODULE_LABELS[m]?.label || m}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="this.closest('[style]').remove()">Cancel</button>
                    <button class="btn btn-green" onclick="submitGenerateDoc('${templateKey}')">
                        <i class="fas fa-file-circle-plus"></i> Generate Document
                    </button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function openGenerateModal() {
    if (!allTemplates.length) return showToast('error', 'Templates not loaded yet.');
    quickGenerate(allTemplates[0].key);
}

async function submitGenerateDoc(templateKey) {
    const modal = document.getElementById('gen-modal');
    const inputs = modal.querySelectorAll('input[data-token]');
    const callerModule = modal.querySelector('#gen-module')?.value || 'hr_admin';

    // Build data context from token paths
    const dataContext = {};
    inputs.forEach(input => {
        const token = input.getAttribute('data-token').replace(/[{}]/g, '').trim();
        const parts = token.split('.');
        const value = input.value.trim() || input.placeholder;
        let curr = dataContext;
        for (let i = 0; i < parts.length - 1; i++) {
            curr[parts[i]] = curr[parts[i]] || {};
            curr = curr[parts[i]];
        }
        curr[parts[parts.length - 1]] = value;
    });

    try {
        const res = await fetch(`${API}/document-templates/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateKey,
                dataContext,
                callerModule,
                actor: 'HR Administrator'
            })
        });
        const json = await res.json();

        if (res.status === 403) {
            showToast('error', `Access Denied: Module '${callerModule}' is not permitted for this template.`);
            return;
        }
        if (!json.success) throw new Error(json.error);

        modal.querySelector('[style]').remove();
        showToast('success', `Document '${json.data.docId}' generated for ${json.data.recipientName}!`);
        fetchGeneratedDocCount();
    } catch (err) {
        showToast('error', 'Generation failed: ' + err.message);
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GENERATED DOCUMENTS ARCHIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function loadGeneratedDocs() {
    switchTab('generated', document.getElementById('tab-generated'));
    const tbody = document.getElementById('generated-tbody');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);"><div class="spinner" style="margin:0 auto;"></div></td></tr>';

    try {
        const res = await fetch(`${API}/document-templates/generated`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        if (!json.data.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);">No documents generated yet. Use "Generate Document" to create your first one.</td></tr>';
            return;
        }

        tbody.innerHTML = json.data.map(doc => `
            <tr>
                <td style="font-family:monospace;font-size:11px;color:var(--accent-teal);">${doc.docId}</td>
                <td style="font-weight:600;">${doc.templateName || doc.templateKey}</td>
                <td>${doc.recipientName}</td>
                <td><span class="tag tag-blue" style="font-size:10px;">${doc.versionNumber}</span></td>
                <td style="color:var(--text-secondary);font-size:12px;">${doc.generatedBy}</td>
                <td><span class="status-badge generated"><i class="fas fa-check-circle"></i> Generated</span></td>
                <td><span class="hash-text" title="${doc.sha256}">${doc.sha256?.substring(0, 12)}…</span></td>
                <td style="color:var(--text-muted);font-size:12px;">${new Date(doc.generatedAt).toLocaleString('en-IN')}</td>
            </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--accent-red);">Error: ${err.message}</td></tr>`;
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GATING RULES (AUDIT TAB)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderGatingRules(templates) {
    const container = document.getElementById('gating-rules-list');
    if (!container) return;

    container.innerHTML = templates.map(t => {
        const style = CATEGORY_STYLES[t.category] || CATEGORY_STYLES['Onboarding'];
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
            <div style="width:28px;height:28px;border-radius:7px;background:${style.bg};color:${style.color};display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">
                <i class="fas ${style.icon}"></i>
            </div>
            <span style="flex:1;font-size:12.5px;font-weight:600;">${t.name}</span>
            <div style="display:flex;gap:4px;">
                ${(t.permittedModules || []).map(m => `<span class="tag tag-blue" style="font-size:10px;">${MODULE_LABELS[m]?.label || m}</span>`).join('')}
            </div>
            <i class="fas fa-lock" style="color:var(--accent-red);font-size:12px;" title="Strict permission gating enabled"></i>
        </div>`;
    }).join('');
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TABS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function switchTab(name, btn) {
    // Hide all tabs
    ['catalog', 'generated', 'audit'].forEach(t => {
        const el = document.getElementById(`tab-content-${t}`);
        if (el) el.style.display = 'none';
        const tabBtn = document.getElementById(`tab-${t}`);
        if (tabBtn) tabBtn.classList.remove('active');
    });

    // Show active
    const active = document.getElementById(`tab-content-${name}`);
    if (active) active.style.display = '';
    if (btn) btn.classList.add('active');
    if (!btn) {
        const tabBtn = document.getElementById(`tab-${name}`);
        if (tabBtn) tabBtn.classList.add('active');
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TOAST NOTIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function showToast(type, message) {
    const container = document.getElementById('toast-container');
    const icons = { success: 'fa-check-circle', error: 'fa-circle-exclamation', info: 'fa-info-circle' };
    const colors = { success: 'var(--accent-green)', error: 'var(--accent-red)', info: 'var(--accent-blue)' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas ${icons[type] || 'fa-info-circle'}" style="color:${colors[type]};font-size:15px;flex-shrink:0;"></i>
        <span style="flex:1;">${message}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;"><i class="fas fa-xmark"></i></button>`;
    container.appendChild(toast);
    setTimeout(() => toast.style.opacity = '0', 4000);
    setTimeout(() => toast.remove(), 4400);
}

// Keyboard shortcut: Escape closes side panel
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidePanel();
});
