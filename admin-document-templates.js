/**
 * admin-document-templates.js
 * 
 * Document & Template Engine — Admin UI Controller
 * 
 * Features:
 * - Template catalog rendering (10 standard enterprise templates)
 * - Real-time search & category filtering
 * - Template detail side drawer with version timeline, field mapping, permitted modules
 * - Document preview with token interpolation, printable A4 sheet, copy HTML
 * - Document generation modal with token data binding and caller module validation
 * - Generated documents archive with live search, hash verification, view/print
 * - Version lifecycle: Draft → Pending Approval → Approved
 * - Security gating rules & Stage 8 audit trail integration
 * - Instant offline resilient seeding with seamless live API sync
 */

const API = `${typeof API_BASE !== 'undefined' ? API_BASE : (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : (typeof window !== 'undefined' && window.location ? window.location.origin : ''))}/api`;

const CATEGORY_STYLES = {
    'Onboarding':           { lucide: 'user-plus',   icon: 'fa-user-plus',         bg: '#eff6ff', color: '#2563eb', tag: 'tag-blue' },
    'Employee Lifecycle':   { lucide: 'repeat',      icon: 'fa-arrows-rotate',     bg: '#f5f3ff', color: '#7c3aed', tag: 'tag-purple' },
    'Compensation':         { lucide: 'coins',       icon: 'fa-indian-rupee-sign', bg: '#fffbeb', color: '#d97706', tag: 'tag-gold' },
    'Payroll':              { lucide: 'banknote',    icon: 'fa-money-bill-wave',   bg: '#f0fdfa', color: '#0d9488', tag: 'tag-teal' },
    'Exit':                 { lucide: 'log-out',     icon: 'fa-door-open',         bg: '#fef2f2', color: '#ef4444', tag: 'tag-red' },
};

const MODULE_LABELS = {
    onboarding: { label: 'Onboarding',  lucide: 'user-plus',    icon: 'fa-user-plus' },
    hr_admin:   { label: 'HR Admin',    lucide: 'shield-check', icon: 'fa-shield-halved' },
    payroll:    { label: 'Payroll',     lucide: 'banknote',     icon: 'fa-money-bill-wave' },
    exit:       { label: 'Exit',        lucide: 'log-out',      icon: 'fa-door-open' },
    pms:        { label: 'PMS',         lucide: 'award',        icon: 'fa-star' },
    statutory:  { label: 'Statutory',   lucide: 'scale',        icon: 'fa-scale-balanced' },
    manager:    { label: 'Manager',     lucide: 'user-check',   icon: 'fa-user-check' },
    finance:    { label: 'Finance',     lucide: 'credit-card',  icon: 'fa-credit-card' }
};

let allTemplates = [];
let currentTemplate = null;
let generatedDocsList = [];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   INITIALIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
document.addEventListener('DOMContentLoaded', () => {
    loadTemplates();
    loadNotifBadge();
    showSaveNotice();
    setInterval(showSaveNotice, 120000);
});

/**
 * Backend call: JSON body in/out, the server's message on failure, 25 s timeout. Saves are not
 * sent while Firebase refuses writes (the server would only answer 503).
 */
async function apiCall(path, { method = 'GET', body } = {}) {
    if (method !== 'GET' && !(await getWriteStatus()).accepting) {
        throw new Error('Saving is paused: Firebase is not accepting changes right now (the daily Firestore write quota is used up). Nothing was saved. Please try again after the quota resets.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const res = await fetch(`${API}${path}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) throw new Error(json.message || json.error || `Request failed (HTTP ${res.status})`);
        return json;
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('The server did not respond in time. Please try again.');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

let writeStatusCache = { at: 0, value: null };
async function getWriteStatus() {
    if (writeStatusCache.value && Date.now() - writeStatusCache.at < 60000) return writeStatusCache.value;
    try {
        const json = await (await fetch(`${API}/firestore/write-status`)).json();
        writeStatusCache = { at: Date.now(), value: { accepting: json.accepting !== false, localTestDatabase: json.localTestDatabase === true } };
    } catch (_) {
        writeStatusCache = { at: Date.now(), value: { accepting: true, localTestDatabase: false } };
    }
    return writeStatusCache.value;
}

// Banner when saves go to the local test database, or when Firebase is refusing saves
async function showSaveNotice() {
    const status = await getWriteStatus();
    let notice = document.getElementById('docSaveNotice');
    if (status.accepting && !status.localTestDatabase) { notice?.remove(); return; }
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'docSaveNotice';
        notice.style.cssText = 'margin: 0 0 1.25rem; padding: 12px 16px; border-radius: 12px; font-size: 0.85rem; font-weight: 600;';
        const header = document.querySelector('.main-content > header, .main-content > .page-header, .main-content > div');
        if (header) header.after(notice); else document.querySelector('.main-content')?.prepend(notice);
    }
    if (status.localTestDatabase) {
        notice.style.background = '#eff6ff'; notice.style.color = '#1e40af'; notice.style.border = '1px solid #bfdbfe';
        notice.textContent = 'Local test database: saves on this page go to the local copy of your Firebase data, not the live project.';
    } else {
        notice.style.background = '#fffbeb'; notice.style.color = '#92400e'; notice.style.border = '1px solid #fde68a';
        notice.textContent = 'Saving is paused: Firebase is not accepting changes right now (the daily Firestore write quota is used up). You can still view templates; saves will work again after the quota resets.';
    }
}

/** Template HTML from the server is shown without scripts, embedded frames or event handlers */
function safeDocHtml(html) {
    return String(html || '')
        .replace(/<(script|iframe|object|embed|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<(script|iframe|object|embed)[^>]*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

async function loadTemplates() {
    const grid = document.getElementById('template-grid');
    if (grid && !allTemplates.length) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="spinner" style="margin:0 auto 8px;"></div><p style="font-size:0.85rem;color:#94a3b8;">Loading templates from Firebase…</p></div>';
    }
    try {
        const json = await apiCall('/document-templates');
        allTemplates = Array.isArray(json.data) ? json.data : [];
        renderStats(allTemplates);
        filterTemplates();
        renderGatingRules(allTemplates);
    } catch (err) {
        console.error('[DOCS] Could not load templates:', err);
        if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><h3 style="font-size:1.05rem;font-weight:700;color:#b91c1c;">Could not load templates</h3><p style="font-size:0.85rem;color:#64748b;">${escapeHtmlTpl(err.message)}</p><button class="btn btn-secondary btn-sm" style="margin-top:10px;" onclick="loadTemplates()">Try again</button></div>`;
    }
}

async function loadNotifBadge() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`${API}/notification-center/summary`, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
            const json = await res.json();
            if (json.success) {
                const badge = document.getElementById('sidebar-notif-badge');
                if (badge) badge.textContent = json.data.totalActionable || '—';
            }
        }
    } catch (_) {}
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STATS ROW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderStats(templates) {
    const totalApproved = templates.filter(t => {
        if (t.status === 'approved') return true;
        const active = t.versions?.find(v => v.status === 'approved');
        return !!active;
    }).length;

    const totalPending = templates.reduce((sum, t) => {
        if (t.status === 'pending_approval') return sum + 1;
        return sum + (t.versions?.filter(v => v.status === 'pending_approval').length || 0);
    }, 0);

    const totalModules = new Set(templates.flatMap(t => t.permittedModules || [])).size;

    const statTotal = document.getElementById('stat-total');
    const statApproved = document.getElementById('stat-approved');
    const statPending = document.getElementById('stat-pending');
    const statGated = document.getElementById('stat-gated');

    if (statTotal) statTotal.textContent = templates.length;
    if (statApproved) statApproved.textContent = totalApproved;
    if (statPending) statPending.textContent = totalPending;
    if (statGated) statGated.textContent = totalModules;

    fetchGeneratedDocCount();
}

async function fetchGeneratedDocCount() {
    const statGen = document.getElementById('stat-generated');
    if (!statGen) return;

    try {
        const res = await fetch(`${API}/document-templates/generated`);
        const json = await res.json();
        if (json.success) {
            statGen.textContent = json.total;
            if (Array.isArray(json.data)) generatedDocsList = json.data;
            return;
        }
    } catch (_) {}

    statGen.textContent = generatedDocsList.length || '0';
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TEMPLATE GRID
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderTemplateGrid(templates) {
    const grid = document.getElementById('template-grid');
    if (!grid) return;

    if (!templates.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <i data-lucide="file-text" style="width:36px;height:36px;color:#94a3b8;margin-bottom:8px;"></i>
                <h3 style="font-size:1.1rem;font-weight:700;color:#334155;">No templates found</h3>
                <p style="font-size:0.85rem;color:#94a3b8;">Adjust your search or category filter criteria.</p>
            </div>`;
        if (window.renderLucideIcons) window.renderLucideIcons(grid);
        return;
    }

    grid.innerHTML = templates.map(t => {
        const style = CATEGORY_STYLES[t.category] || CATEGORY_STYLES['Onboarding'];
        const latestVersion = t.versions?.[t.versions.length - 1];
        const approvedVersion = t.versions?.find(v => v.status === 'approved') || (t.status === 'approved' ? { versionNumber: t.activeVersion || 'v1.0', effectiveFrom: t.effectiveFrom || Date.now() } : null);
        const tokenCount = t.fieldMappings?.length || latestVersion?.fieldMappings?.length || 0;

        const statusTag = approvedVersion
            ? `<span class="tag tag-green"><i data-lucide="check-circle" class="fas fa-check-circle"></i> Approved</span>`
            : `<span class="tag tag-gold"><i data-lucide="clock" class="fas fa-clock"></i> Draft</span>`;

        const moduleTags = (t.permittedModules || []).slice(0, 3).map(m => {
            const info = MODULE_LABELS[m] || { label: m, lucide: 'plug', icon: 'fa-plug' };
            return `<span class="tag tag-gray"><i data-lucide="${info.lucide}" class="fas ${info.icon}"></i> ${info.label}</span>`;
        }).join('');
        const moreModules = (t.permittedModules?.length || 0) > 3
            ? `<span class="tag tag-gray">+${t.permittedModules.length - 3} more</span>` : '';

        return `
        <div class="template-card" onclick="openTemplateDetail('${t.key}')" id="tcard-${t.key}">
            <div class="template-card-header">
                <div class="template-type-icon" style="background:${style.bg};color:${style.color};">
                    <i data-lucide="${style.lucide}" class="fas ${style.icon}"></i>
                </div>
                <div class="template-card-title">
                    <h3>${escapeHtmlTpl(t.name)}</h3>
                    <p>${escapeHtmlTpl(t.description)}</p>
                </div>
            </div>
            <div class="template-meta">
                <span class="tag ${style.tag}">${escapeHtmlTpl(t.category)}</span>
                ${statusTag}
                <span class="tag tag-blue"><i data-lucide="code" class="fas fa-code"></i> ${tokenCount} tokens</span>
            </div>
            <div class="template-meta" style="margin-top:-4px;">
                ${moduleTags}${moreModules}
            </div>
            <div class="template-card-footer">
                <div class="template-version-info">
                    <span>${escapeHtmlTpl(latestVersion?.versionNumber || 'v1.0')}</span> · ${t.versions?.length || 1} version${(t.versions?.length || 1) > 1 ? 's' : ''}
                    ${approvedVersion ? ` · Active since ${new Date(approvedVersion.effectiveFrom).toLocaleDateString('en-IN')}` : ''}
                </div>
                <div class="template-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-secondary btn-sm" onclick="previewTemplate('${t.key}')" title="Preview Document">
                        <i data-lucide="eye" class="fas fa-eye"></i> Preview
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="quickGenerate('${t.key}')" title="Quick Generate">
                        <i data-lucide="file-plus" class="fas fa-file-circle-plus"></i>
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');

    if (window.renderLucideIcons) window.renderLucideIcons(grid);
}

function filterTemplates() {
    const searchInput = document.getElementById('search-input');
    const categorySelect = document.getElementById('category-filter');
    const search = (searchInput?.value || '').toLowerCase();
    const category = categorySelect?.value || 'all';

    const filtered = allTemplates.filter(t => {
        const matchSearch = !search ||
            t.name.toLowerCase().includes(search) ||
            t.description.toLowerCase().includes(search) ||
            t.category.toLowerCase().includes(search) ||
            (t.permittedModules || []).some(m => m.toLowerCase().includes(search)) ||
            (t.fieldMappings || []).some(f => f.token.toLowerCase().includes(search) || f.label.toLowerCase().includes(search));
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
        const json = await apiCall(`/document-templates/${encodeURIComponent(key)}`);
        currentTemplate = json.data;
        // Keep the catalog in step with what Firebase holds
        const idx = allTemplates.findIndex(t => t.key === key);
        if (idx > -1) allTemplates[idx] = { ...allTemplates[idx], versions: json.data.versions };
        renderSidePanel(json.data);
        document.getElementById('panel-overlay')?.classList.add('active');
        document.getElementById('side-panel')?.classList.add('open');
    } catch (err) {
        showToast('error', 'Could not open template: ' + err.message);
    }
}

function renderSidePanel(template) {
    const style = CATEGORY_STYLES[template.category] || CATEGORY_STYLES['Onboarding'];
    const approvedVer = template.versions?.find(v => v.isActive && v.status === 'approved') || template.versions?.find(v => v.status === 'approved');
    const allVersions = [...(template.versions || [])].reverse();

    // Header
    const iconEl = document.getElementById('panel-icon');
    if (iconEl) {
        iconEl.style.background = style.bg;
        iconEl.style.color = style.color;
        iconEl.innerHTML = `<i data-lucide="${style.lucide}" class="fas ${style.icon}"></i>`;
    }
    const titleEl = document.getElementById('panel-title');
    if (titleEl) titleEl.textContent = template.name;
    const subEl = document.getElementById('panel-subtitle');
    if (subEl) subEl.textContent = `${template.category} · ${template.versions?.length || 1} version(s) · ${template.permittedModules?.length || 0} permitted modules`;

    const fieldMappings = approvedVer?.fieldMappings || template.fieldMappings || [];
    const permittedModules = template.permittedModules || [];

    const bodyEl = document.getElementById('panel-body');
    if (!bodyEl) return;

    bodyEl.innerHTML = `
        <!-- Version Timeline -->
        <div class="section-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div class="section-card-title" style="margin-bottom:0;">
                    <i data-lucide="git-branch" class="fas fa-code-branch"></i> Version History
                </div>
                <button class="btn btn-secondary btn-sm" onclick="openNewVersionModal('${template.key}')" style="padding:4px 10px;font-size:0.75rem;">
                    <i data-lucide="plus" style="width:12px;height:12px;"></i> New Draft
                </button>
            </div>
            <div class="version-list">
                ${allVersions.map((v, i) => `
                <div class="version-item ${v.status === 'approved' && i === 0 ? 'active-version' : ''}">
                    <div class="version-dot ${v.status}"></div>
                    <div class="version-info">
                        <strong>${escapeHtmlTpl(v.versionNumber)}</strong>
                        <span class="tag ${v.status === 'approved' ? 'tag-green' : v.status === 'draft' ? 'tag-gold' : 'tag-blue'}" style="font-size:10px;padding:2px 8px;margin-left:8px;">
                            ${escapeHtmlTpl(v.status.replace('_', ' ').toUpperCase())}${v.isActive ? ' · ACTIVE' : ''}
                        </span>
                        <p>${escapeHtmlTpl(v.changeNotes || 'Standard production release')}</p>
                        <small>
                            Created by <strong>${escapeHtmlTpl(v.createdBy || 'HR Admin')}</strong> ·
                            Effective: ${new Date(v.effectiveFrom).toLocaleDateString('en-IN')}
                            ${v.approvedBy ? ` · Approved by <strong>${escapeHtmlTpl(v.approvedBy)}</strong>` : ''}
                        </small>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        ${v.status === 'approved' ? `<button class="btn btn-green btn-sm" onclick="quickGenerate('${template.key}')" title="Generate Document"><i data-lucide="file-plus" class="fas fa-file-circle-plus"></i></button>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="aiReviewVersion('${template.key}','${escapeHtmlTpl(v.versionNumber)}')" title="AI Review: check tokens, structure and completeness"><i data-lucide="sparkles"></i></button>
                        <button class="btn btn-secondary btn-sm" onclick="previewVersion('${template.key}','${escapeHtmlTpl(v.versionNumber)}')" title="Preview Version"><i data-lucide="eye" class="fas fa-eye"></i></button>
                        ${v.status !== 'approved' ? `<button class="btn btn-primary btn-sm" onclick="approveVersion('${template.key}','${escapeHtmlTpl(v.versionNumber)}')" title="Approve Version"><i data-lucide="check" class="fas fa-check"></i> Approve</button>` : ''}
                    </div>
                </div>`).join('')}
            </div>
        </div>

        <!-- Field Mapping -->
        <div class="section-card">
            <div class="section-card-title"><i data-lucide="list" class="fas fa-map"></i> Field Mapping (${fieldMappings.length} tokens)</div>
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
                        <td><span class="token-badge">${escapeHtmlTpl(f.token)}</span></td>
                        <td style="color:var(--text-secondary);font-weight:600;">${escapeHtmlTpl(f.label)}</td>
                        <td style="color:var(--text-muted);font-size:12px;">${escapeHtmlTpl(f.sample || '—')}</td>
                        <td>${f.required ? '<span class="required-dot" title="Required"></span>' : '<span style="color:var(--text-muted);font-size:11px;">opt</span>'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>` : '<p style="color:var(--text-muted);font-size:13px;">No field mappings defined.</p>'}
        </div>

        <!-- Permitted Modules -->
        <div class="section-card">
            <div class="section-card-title"><i data-lucide="shield-check" class="fas fa-lock"></i> Permitted Modules (${permittedModules.length})</div>
            <div class="permission-grid">
                ${['onboarding','hr_admin','payroll','exit','pms','statutory'].map(m => {
                    const allowed = permittedModules.includes(m);
                    const info = MODULE_LABELS[m] || { label: m, lucide: 'plug', icon: 'fa-plug' };
                    return `<div class="permission-item ${allowed ? 'allowed' : 'restricted'}">
                        <i data-lucide="${allowed ? 'check-circle' : 'ban'}" class="fas ${allowed ? 'fa-check-circle' : 'fa-ban'}"></i>
                        <span style="font-size:12px;">${info.label}</span>
                    </div>`;
                }).join('')}
            </div>
            <p style="font-size:11.5px;color:var(--text-muted);margin-top:10px;line-height:1.6;">
                <i data-lucide="info" style="width:13px;height:13px;color:var(--primary);margin-right:4px;"></i>
                Only explicitly permitted modules may invoke <code style="font-size:11px;background:#eff6ff;color:#2563eb;padding:2px 6px;border-radius:4px;font-family:monospace;">generateDocument()</code>.
            </p>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:10px;padding-bottom:10px;">
            <button class="btn btn-secondary" style="flex:1;" onclick="previewTemplate('${template.key}')">
                <i data-lucide="eye"></i> Preview Document
            </button>
            <button class="btn btn-primary" style="flex:1;" onclick="quickGenerate('${template.key}')">
                <i data-lucide="file-plus"></i> Generate Document
            </button>
        </div>
    `;

    const sidePanel = document.getElementById('side-panel');
    if (sidePanel && window.renderLucideIcons) window.renderLucideIcons(sidePanel);
}

function closeSidePanel() {
    document.getElementById('panel-overlay')?.classList.remove('active');
    document.getElementById('side-panel')?.classList.remove('open');
    currentTemplate = null;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DOCUMENT PREVIEW (A4 REALISTIC SHEET)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function previewTemplate(key) {
    previewVersion(key, null);
}

async function previewVersion(key, versionNumber) {
    const template = allTemplates.find(t => t.key === key) || currentTemplate || { name: 'Document Template', key };
    openDocumentModal({
        title: `Preview: ${template.name}`,
        subtitle: `${versionNumber ? `Version ${versionNumber}` : 'Active Approved Version'} · Sample values`,
        generateKey: key
    });
    try {
        const json = await apiCall(`/document-templates/${encodeURIComponent(key)}/preview`, { method: 'POST', body: versionNumber ? { versionNumber } : {} });
        renderPreviewContent(json.data);
    } catch (err) {
        renderPreviewError(err.message);
    }
}

/** Opens the A4 document window; its body is filled by renderPreviewContent / renderPreviewError */
function openDocumentModal({ title, subtitle, generateKey }) {
    const modalId = 'preview-modal-wrapper';
    document.getElementById(modalId)?.remove();

    const previewContainer = document.createElement('div');
    previewContainer.id = modalId;
    previewContainer.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)this.parentElement.remove()">
            <div style="background:#ffffff;border:1px solid var(--border);border-radius:20px;width:92vw;max-width:960px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);" onclick="event.stopPropagation()">
                <!-- Modal Header -->
                <div style="padding:16px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#f8fafc;">
                    <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                        <div style="width:36px;height:36px;border-radius:10px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <i data-lucide="file-text" style="width:20px;height:20px;"></i>
                        </div>
                        <div style="min-width:0;">
                            <h2 style="font-size:1.05rem;font-weight:800;color:#0f172a;margin:0;">${escapeHtmlTpl(title)}</h2>
                            <p style="font-size:0.75rem;color:var(--text-muted);margin:2px 0 0 0;">${escapeHtmlTpl(subtitle)}</p>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button class="btn btn-secondary btn-sm" onclick="printPreviewDoc()" title="Print this document">
                            <i data-lucide="printer"></i> Print
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="copyPreviewHtml()" title="Copy HTML to clipboard">
                            <i data-lucide="copy"></i> Copy HTML
                        </button>
                        ${generateKey ? `<button class="btn btn-primary btn-sm" onclick="quickGenerate('${generateKey}'); document.getElementById('${modalId}').remove();" title="Proceed to Generate">
                            <i data-lucide="file-plus"></i> Generate
                        </button>` : ''}
                        <button onclick="document.getElementById('${modalId}').remove()" style="background:#f1f5f9;border:1px solid var(--border);border-radius:10px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:#64748b;cursor:pointer;margin-left:4px;">
                            <i data-lucide="x" style="width:16px;height:16px;"></i>
                        </button>
                    </div>
                </div>

                <!-- Modal Body with A4 Paper Simulation -->
                <div style="flex:1;overflow-y:auto;padding:2rem;background:#f1f5f9;display:flex;justify-content:center;" id="preview-modal-body">
                    <div class="preview-loading" style="display:flex;flex-direction:column;gap:10px;align-items:center;">
                        <div class="spinner"></div>
                        <span style="font-size:0.85rem;color:#64748b;font-weight:600;">Rendering document…</span>
                    </div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(previewContainer);
    if (window.renderLucideIcons) window.renderLucideIcons(previewContainer);
}

function renderPreviewError(message) {
    const modalBody = document.getElementById('preview-modal-body');
    if (!modalBody) return;
    modalBody.innerHTML = `<div style="max-width:520px;background:#fff;border:1px solid #fecaca;border-radius:12px;padding:1.5rem;color:#b91c1c;font-size:0.9rem;"><strong>Could not render the document.</strong><br>${escapeHtmlTpl(message)}</div>`;
}

/** data: { renderedHtml, versionNumber, effectiveFrom, companyName?, sha256?, docId? } */
function renderPreviewContent(data) {
    const modalBody = document.getElementById('preview-modal-body');
    if (!modalBody) return;
    const companyName = data.companyName || data.samplePayload?.company?.name || 'Company Document';

    modalBody.innerHTML = `
        <div style="width:100%;max-width:800px;background:#ffffff;border:1px solid var(--border);border-radius:8px;padding:3.5rem 4rem;box-shadow:0 10px 25px rgba(0,0,0,0.06);position:relative;color:#1e293b;font-size:0.92rem;line-height:1.8;" class="preview-frame" id="printable-preview-frame">
            <!-- Official Header -->
            <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:2px solid #2563eb;padding-bottom:1.5rem;margin-bottom:2rem;">
                <div>
                    <h1 style="font-size:1.4rem;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;text-transform:uppercase;">${escapeHtmlTpl(companyName)}</h1>
                    <p style="font-size:0.75rem;color:#64748b;margin:2px 0 0 0;text-transform:uppercase;letter-spacing:1px;font-weight:700;">${data.docId ? `Document ${escapeHtmlTpl(data.docId)}` : 'Preview · Sample Values'}</p>
                </div>
                <div style="text-align:right;font-size:0.75rem;color:#64748b;">
                    <div>Version: <strong>${escapeHtmlTpl(data.versionNumber || 'v1.0')}</strong></div>
                    <div>${data.generatedAt ? 'Generated' : 'Effective'}: <strong>${new Date(data.generatedAt || data.effectiveFrom || Date.now()).toLocaleDateString('en-IN')}</strong></div>
                    ${data.sha256 ? `<div style="color:#059669;font-weight:700;display:flex;align-items:center;gap:4px;justify-content:flex-end;margin-top:2px;">
                        <i data-lucide="shield-check" style="width:13px;height:13px;"></i> Sealed (SHA-256)
                    </div>` : ''}
                </div>
            </div>

            <!-- Interpolated Document Body -->
            <div style="min-height:350px;">
                ${safeDocHtml(data.renderedHtml) || '<p>No content available.</p>'}
            </div>

            <!-- Footer -->
            <div style="margin-top:3.5rem;border-top:1px solid #e2e8f0;padding-top:1.5rem;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:0.75rem;color:#94a3b8;">
                <div>${data.docId ? 'Generated by the Kylrx AI Document Engine and stored in Firebase.' : 'Preview only — not saved. Generate the document to issue it.'}</div>
                ${data.sha256 ? `<div style="font-family:monospace;font-size:0.7rem;background:#f8fafc;padding:3px 8px;border-radius:4px;border:1px solid #e2e8f0;" title="${escapeHtmlTpl(data.sha256)}">SHA-256 ${escapeHtmlTpl(data.sha256.slice(0, 16))}…</div>` : ''}
            </div>
        </div>`;

    if (window.renderLucideIcons) window.renderLucideIcons(modalBody);
}

function printPreviewDoc() {
    const content = document.getElementById('printable-preview-frame')?.innerHTML;
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Kylrx AI Document Print Preview</title>
            <style>
                @page { margin: 20mm; }
                body { font-family: 'Outfit', 'Inter', -apple-system, sans-serif; color: #0f172a; line-height: 1.7; padding: 20px; }
                h1, h2, h3 { color: #0f172a; }
                .preview-frame { border: none !important; box-shadow: none !important; padding: 0 !important; }
            </style>
        </head>
        <body>
            ${content}
        </body>
        </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 350);
}

function copyPreviewHtml() {
    const frame = document.getElementById('printable-preview-frame');
    if (!frame) return;
    navigator.clipboard.writeText(frame.innerHTML).then(() => {
        showToast('success', 'Document HTML copied to clipboard!');
    }).catch(() => {
        showToast('info', 'Please copy manually from the preview window.');
    });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   APPROVE VERSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function approveVersion(templateKey, versionNumber) {
    if (!confirm(`Approve version '${versionNumber}'? It becomes the active version used to generate documents.`)) return;
    try {
        await apiCall(`/document-templates/${encodeURIComponent(templateKey)}/versions/${encodeURIComponent(versionNumber)}/approve`, {
            method: 'POST',
            body: { approvalRemarks: 'Approved via Admin Portal' }
        });
        showToast('success', `Version '${versionNumber}' approved and saved to Firebase.`);
        await loadTemplates();
        if (currentTemplate && currentTemplate.key === templateKey) openTemplateDetail(templateKey);
    } catch (err) {
        showToast('error', 'Approval failed: ' + err.message);
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GENERATE DOCUMENT MODAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let aiPeopleCache = null;
async function loadAiPeople() {
    if (!aiPeopleCache) aiPeopleCache = (await apiCall('/document-templates/ai/people')).data || [];
    return aiPeopleCache;
}

function quickGenerate(templateKey) {
    const template = allTemplates.find(t => t.key === templateKey) || currentTemplate;
    if (!template) return showToast('error', 'Template not found.');

    const approvedVer = template.versions?.find(v => v.isActive && v.status === 'approved') || template.versions?.find(v => v.status === 'approved');
    if (!approvedVer) return showToast('error', 'This template has no approved version yet. Approve a version first.');
    const fieldMappings = approvedVer.fieldMappings || template.fieldMappings || [];
    const modalId = 'gen-modal-wrapper';
    document.getElementById(modalId)?.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)this.parentElement.remove()">
            <div style="background:#ffffff;border:1px solid var(--border);border-radius:20px;width:90vw;max-width:620px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);" onclick="event.stopPropagation()">
                <!-- Header -->
                <div style="padding:18px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:#f8fafc;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div style="width:38px;height:38px;border-radius:12px;background:#ecfdf5;color:#059669;display:flex;align-items:center;justify-content:center;">
                            <i data-lucide="file-plus" style="width:20px;height:20px;"></i>
                        </div>
                        <div>
                            <h2 style="font-size:1.1rem;font-weight:800;color:#0f172a;margin:0;">Generate — ${escapeHtmlTpl(template.name)}</h2>
                            <p style="font-size:0.75rem;color:var(--text-muted);margin:2px 0 0 0;">Version ${escapeHtmlTpl(approvedVer.versionNumber)} · ${fieldMappings.length} token fields</p>
                        </div>
                    </div>
                    <button onclick="document.getElementById('${modalId}').remove()" style="background:#f1f5f9;border:1px solid var(--border);border-radius:10px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:#64748b;cursor:pointer;">
                        <i data-lucide="x" style="width:16px;height:16px;"></i>
                    </button>
                </div>

                <!-- Form Fields -->
                <div style="flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px;" id="gen-modal-fields-container">
                    <!-- AI Fill -->
                    <div style="background:linear-gradient(135deg,#f5f3ff,#eff6ff);border:1px solid #ddd6fe;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
                        <div style="display:flex;align-items:center;gap:8px;font-size:0.8rem;font-weight:800;color:#5b21b6;">
                            <i data-lucide="sparkles" style="width:16px;height:16px;"></i> AI Fill from employee record
                        </div>
                        <div style="display:flex;gap:8px;">
                            <select id="gen-ai-person" style="flex:1;background:#fff;border:1px solid #cbd5e1;border-radius:10px;font-size:0.85rem;padding:8px 10px;font-family:inherit;">
                                <option value="">Loading people…</option>
                            </select>
                            <button class="btn btn-primary btn-sm" id="gen-ai-fill-btn" onclick="aiFillGenerate('${templateKey}')" style="background:#7c3aed;border-color:#7c3aed;">Fill</button>
                        </div>
                        <div id="gen-ai-result" style="font-size:0.75rem;color:#5b21b6;"></div>
                    </div>

                    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 16px;font-size:0.82rem;color:#1e40af;display:flex;align-items:center;gap:10px;">
                        <i data-lucide="info" style="width:18px;height:18px;flex-shrink:0;"></i>
                        <span>Fill in the recipient's details. Fields marked * are required; an empty field prints as [token] in the document.</span>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;" id="gen-fields">
                        ${fieldMappings.map(f => `
                        <div>
                            <label style="font-size:0.72rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">
                                ${escapeHtmlTpl(f.label)} ${f.required ? '<span style="color:#ef4444;">*</span>' : ''}
                            </label>
                            <input type="text" placeholder="e.g. ${escapeHtmlTpl(f.sample || 'value')}"
                                data-token="${escapeHtmlTpl(f.token)}" data-required="${f.required ? '1' : ''}" data-label="${escapeHtmlTpl(f.label)}"
                                value=""
                                style="width:100%;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;color:#0f172a;font-size:0.85rem;padding:9px 12px;font-family:inherit;outline:none;transition:all 0.2s;"
                                onfocus="this.style.borderColor='#2563eb';this.style.boxShadow='0 0 0 3px rgba(37,99,235,0.12)'"
                                onblur="this.style.borderColor='#cbd5e1';this.style.boxShadow='none'" />
                        </div>`).join('')}
                    </div>

                    <div>
                        <label style="font-size:0.72rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">Caller Authorization Module</label>
                        <select id="gen-module" style="width:100%;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;color:#0f172a;font-size:0.85rem;padding:10px 12px;font-family:inherit;outline:none;">
                            ${(template.permittedModules || ['hr_admin']).map(m => `<option value="${escapeHtmlTpl(m)}">${escapeHtmlTpl(MODULE_LABELS[m]?.label || m)}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Footer -->
                <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end;background:#f8fafc;">
                    <button class="btn btn-secondary" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
                    <button class="btn btn-primary" id="gen-submit-btn" onclick="submitGenerateDoc('${templateKey}')">
                        <i data-lucide="file-check"></i> Generate &amp; Save
                    </button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (window.renderLucideIcons) window.renderLucideIcons(modal);

    loadAiPeople().then(people => {
        const select = document.getElementById('gen-ai-person');
        if (!select) return;
        select.innerHTML = '<option value="">Choose an employee…</option>' + people.map(p =>
            `<option value="${escapeHtmlTpl(p.id)}">${escapeHtmlTpl(p.name)}${p.department ? ' · ' + escapeHtmlTpl(p.department) : ''}${p.email ? ' · ' + escapeHtmlTpl(p.email) : ''}${p.exited ? ' (exited)' : ''}</option>`
        ).join('');
    }).catch(err => {
        const select = document.getElementById('gen-ai-person');
        if (select) select.innerHTML = `<option value="">Could not load people: ${escapeHtmlTpl(err.message)}</option>`;
    });
}

async function aiFillGenerate(templateKey) {
    const employeeId = document.getElementById('gen-ai-person')?.value;
    const out = document.getElementById('gen-ai-result');
    if (!employeeId) return showToast('error', 'Choose an employee to fill from.');
    const btn = document.getElementById('gen-ai-fill-btn');
    btn.disabled = true;
    out.textContent = 'Reading the employee record…';
    try {
        const { data } = await apiCall('/document-templates/ai/autofill', { method: 'POST', body: { templateKey, employeeId } });
        document.querySelectorAll('#gen-fields input[data-token]').forEach(input => {
            const value = data.values[input.getAttribute('data-token')];
            if (value !== undefined) {
                input.value = value;
                input.style.background = '#f5f3ff';
            }
        });
        out.innerHTML = `Filled <strong>${data.filled.length}</strong> field(s) from the record.${data.missing.length ? ` Still to fill: ${escapeHtmlTpl(data.missing.join(', '))}.` : ''}`;
    } catch (err) {
        out.textContent = 'AI Fill failed: ' + err.message;
    } finally {
        btn.disabled = false;
    }
}

function openGenerateModal() {
    if (!allTemplates.length) return showToast('error', 'Templates not loaded yet.');
    quickGenerate(allTemplates[0].key);
}

async function submitGenerateDoc(templateKey) {
    const modalWrapper = document.getElementById('gen-modal-wrapper');
    if (!modalWrapper) return;

    const inputs = modalWrapper.querySelectorAll('input[data-token]');
    const callerModule = modalWrapper.querySelector('#gen-module')?.value || 'hr_admin';

    // Required fields must be filled
    const missing = [...inputs].filter(i => i.dataset.required && !i.value.trim()).map(i => i.dataset.label);
    if (missing.length) return showToast('error', `Please fill: ${missing.join(', ')}`);

    // Build dataContext ({{employee.name}} -> { employee: { name } }); empty fields are left out
    const dataContext = {};
    inputs.forEach(input => {
        const value = input.value.trim();
        if (!value) return;
        const parts = (input.getAttribute('data-token') || '').replace(/[{}]/g, '').trim().split('.');
        let curr = dataContext;
        for (let i = 0; i < parts.length - 1; i++) {
            curr[parts[i]] = curr[parts[i]] || {};
            curr = curr[parts[i]];
        }
        curr[parts[parts.length - 1]] = value;
    });

    const btn = document.getElementById('gen-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
        const json = await apiCall('/document-templates/generate', { method: 'POST', body: { templateKey, dataContext, callerModule } });
        modalWrapper.remove();
        showToast('success', `Document '${json.data.docId}' generated for ${json.data.recipientName} and saved to Firebase.`, 'View Doc', () => {
            viewGeneratedDoc(json.data.docId);
        });
        fetchGeneratedDocCount();
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="file-check"></i> Generate &amp; Save';
        if (window.renderLucideIcons) window.renderLucideIcons(btn);
        showToast('error', 'Generation failed: ' + err.message);
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GENERATED DOCUMENTS ARCHIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function loadGeneratedDocs() {
    switchTab('generated', document.getElementById('tab-generated'));
    const tbody = document.getElementById('generated-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted);"><div class="spinner" style="margin:0 auto 8px;"></div>Loading documents archive…</td></tr>';

    try {
        const json = await apiCall('/document-templates/generated');
        generatedDocsList = Array.isArray(json.data) ? json.data : [];
        renderGeneratedDocsTable(generatedDocsList);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#b91c1c;">Could not load the archive: ${escapeHtmlTpl(err.message)}</td></tr>`;
    }
}

function renderGeneratedDocsTable(docs) {
    const tbody = document.getElementById('generated-tbody');
    if (!tbody) return;

    if (!docs.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center;padding:48px 20px;color:var(--text-muted);">
                    <i data-lucide="archive" style="width:36px;height:36px;margin:0 auto 10px;display:block;opacity:0.4;"></i>
                    <strong style="display:block;font-size:0.95rem;color:#334155;margin-bottom:4px;">No Generated Documents Yet</strong>
                    <span style="font-size:0.82rem;">Click "+ Generate Document" above to issue your first document.</span>
                </td>
            </tr>`;
        if (window.renderLucideIcons) window.renderLucideIcons(tbody);
        return;
    }

    tbody.innerHTML = docs.map(doc => `
        <tr>
            <td style="font-family:monospace;font-size:12px;font-weight:700;color:var(--primary);">${escapeHtmlTpl(doc.docId)}</td>
            <td style="font-weight:700;color:#0f172a;">${escapeHtmlTpl(doc.templateName || doc.templateKey)}</td>
            <td style="font-weight:600;color:#334155;">${escapeHtmlTpl(doc.recipientName || '—')}</td>
            <td><span class="tag tag-blue" style="font-size:10px;">${escapeHtmlTpl(doc.versionNumber || 'v1.0')}</span></td>
            <td style="color:var(--text-secondary);font-size:12px;">${escapeHtmlTpl(doc.generatedBy || 'System')}</td>
            <td><span class="status-badge generated"><i data-lucide="check-circle" style="width:12px;height:12px;"></i> Generated</span></td>
            <td>
                <span class="hash-text" title="${escapeHtmlTpl(doc.sha256)}" style="cursor:pointer;" data-copy-hash="${escapeHtmlTpl(doc.sha256)}">
                    ${escapeHtmlTpl(doc.sha256?.substring(0, 10))}… <i data-lucide="copy" style="width:10px;height:10px;margin-left:2px;"></i>
                </span>
            </td>
            <td style="color:var(--text-muted);font-size:12px;">${new Date(doc.generatedAt || Date.now()).toLocaleString('en-IN')}</td>
            <td>
                <button class="btn btn-secondary btn-sm" data-view-doc="${escapeHtmlTpl(doc.docId)}" style="padding:4px 10px;font-size:11px;">
                    <i data-lucide="eye" style="width:12px;height:12px;"></i> View
                </button>
            </td>
        </tr>`).join('');

    if (window.renderLucideIcons) window.renderLucideIcons(tbody);
}

// Archive actions (ids are read from data attributes, not built into inline code)
document.addEventListener('click', (e) => {
    const view = e.target.closest('[data-view-doc]');
    if (view) return viewGeneratedDoc(view.dataset.viewDoc);
    const hash = e.target.closest('[data-copy-hash]');
    if (hash) navigator.clipboard.writeText(hash.dataset.copyHash).then(() => showToast('info', 'SHA-256 hash copied to clipboard!'));
});

function filterGeneratedDocs() {
    const q = (document.getElementById('search-generated-input')?.value || '').toLowerCase();
    const filtered = (generatedDocsList || []).filter(d =>
        (d.docId && d.docId.toLowerCase().includes(q)) ||
        (d.recipientName && d.recipientName.toLowerCase().includes(q)) ||
        (d.templateName && d.templateName.toLowerCase().includes(q)) ||
        (d.templateKey && d.templateKey.toLowerCase().includes(q)) ||
        (d.sha256 && d.sha256.toLowerCase().includes(q))
    );
    renderGeneratedDocsTable(filtered);
}

/** Shows the document exactly as it was generated and saved */
async function viewGeneratedDoc(docId) {
    openDocumentModal({ title: `Document ${docId}`, subtitle: 'As generated and stored in Firebase' });
    try {
        const { data } = await apiCall(`/document-templates/generated/${encodeURIComponent(docId)}`);
        const titleEl = document.querySelector('#preview-modal-wrapper h2');
        if (titleEl) titleEl.textContent = `${data.templateName || data.templateKey} — ${data.recipientName || ''}`;
        renderPreviewContent(data);
    } catch (err) {
        renderPreviewError(err.message);
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   NEW VERSION DRAFT MODAL (with AI Draft & AI Review)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/** Next minor version in the same style as the existing ones ("1.0.0" -> "1.1.0", "v1.2" -> "v1.3") */
function nextVersionNumber(versions) {
    const list = (versions || []).map(v => String(v.versionNumber || ''));
    if (!list.length) return '1.1.0';
    const parse = (s) => s.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const latest = [...list].sort((a, b) => {
        const x = parse(a), y = parse(b);
        return (y[0] - x[0]) || ((y[1] || 0) - (x[1] || 0)) || ((y[2] || 0) - (x[2] || 0));
    })[0];
    const [major, minor = 0] = parse(latest);
    const parts = latest.replace(/^v/, '').split('.').length;
    return `${latest.startsWith('v') ? 'v' : ''}${[major, minor + 1, 0].slice(0, Math.max(parts, 2)).join('.')}`;
}

async function openNewVersionModal(templateKey) {
    let template = currentTemplate && currentTemplate.key === templateKey ? currentTemplate : null;
    try {
        if (!template) template = (await apiCall(`/document-templates/${encodeURIComponent(templateKey)}`)).data;
    } catch (err) {
        return showToast('error', 'Could not open template: ' + err.message);
    }
    const base = template.versions?.find(v => v.isActive && v.status === 'approved') || template.versions?.[template.versions.length - 1];

    const modalId = 'version-draft-modal';
    document.getElementById(modalId)?.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)this.parentElement.remove()">
            <div style="background:#ffffff;border:1px solid var(--border);border-radius:20px;width:94vw;max-width:820px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);" onclick="event.stopPropagation()">
                <div style="padding:18px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:#f8fafc;">
                    <div>
                        <h2 style="font-size:1.1rem;font-weight:800;color:#0f172a;margin:0;">Create Draft Version — ${escapeHtmlTpl(template.name)}</h2>
                        <p style="font-size:0.75rem;color:var(--text-muted);margin:2px 0 0 0;">Starts from ${escapeHtmlTpl(base?.versionNumber || 'the current version')}. Drafts must be approved before they are used.</p>
                    </div>
                    <button onclick="document.getElementById('${modalId}').remove()" style="background:#f1f5f9;border:1px solid var(--border);border-radius:10px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:#64748b;cursor:pointer;">
                        <i data-lucide="x" style="width:16px;height:16px;"></i>
                    </button>
                </div>
                <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;">
                    <!-- AI Draft -->
                    <div style="background:linear-gradient(135deg,#f5f3ff,#eff6ff);border:1px solid #ddd6fe;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                            <span style="display:flex;align-items:center;gap:8px;font-size:0.8rem;font-weight:800;color:#5b21b6;"><i data-lucide="sparkles" style="width:16px;height:16px;"></i> AI Draft</span>
                            <span id="draft-ai-mode" style="font-size:0.68rem;font-weight:700;color:#6d28d9;"></span>
                        </div>
                        <div style="display:flex;gap:8px;">
                            <input type="text" id="draft-ai-instruction" placeholder="e.g. Add a 6-month probation clause, 90 days notice and a confidentiality clause" style="flex:1;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:0.85rem;outline:none;" />
                            <button class="btn btn-primary btn-sm" id="draft-ai-btn" onclick="aiDraftVersion('${templateKey}')" style="background:#7c3aed;border-color:#7c3aed;">Draft</button>
                        </div>
                        <div id="draft-ai-result" style="font-size:0.75rem;color:#5b21b6;"></div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:12px;">
                        <div>
                            <label style="font-size:0.75rem;font-weight:700;color:#475569;display:block;margin-bottom:4px;">Version Number</label>
                            <input type="text" id="draft-ver-num" value="${escapeHtmlTpl(nextVersionNumber(template.versions))}" style="width:100%;padding:10px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:0.85rem;outline:none;" />
                        </div>
                        <div>
                            <label style="font-size:0.75rem;font-weight:700;color:#475569;display:block;margin-bottom:4px;">Effective From</label>
                            <input type="date" id="draft-effective-date" value="${new Date().toISOString().split('T')[0]}" style="width:100%;padding:10px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:0.85rem;outline:none;" />
                        </div>
                        <div>
                            <label style="font-size:0.75rem;font-weight:700;color:#475569;display:block;margin-bottom:4px;">Change Notes</label>
                            <input type="text" id="draft-change-notes" placeholder="e.g. Updated compensation clauses per FY27 policies" style="width:100%;padding:10px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:0.85rem;outline:none;" />
                        </div>
                    </div>
                    <div>
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                            <label style="font-size:0.75rem;font-weight:700;color:#475569;">Template Body (HTML with {{tokens}})</label>
                            <button class="btn btn-secondary btn-sm" onclick="aiReviewDraft('${templateKey}')" style="padding:3px 10px;font-size:0.72rem;"><i data-lucide="sparkles" style="width:12px;height:12px;"></i> AI Review</button>
                        </div>
                        <textarea id="draft-body" rows="14" spellcheck="false" style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:0.8rem;font-family:ui-monospace,Consolas,monospace;line-height:1.5;outline:none;resize:vertical;">${escapeHtmlTpl(base?.templateBody || '')}</textarea>
                        <div id="draft-review" style="margin-top:8px;"></div>
                    </div>
                </div>
                <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end;background:#f8fafc;">
                    <button class="btn btn-secondary" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
                    <button class="btn btn-primary" id="draft-submit-btn" onclick="submitDraftVersion('${templateKey}')">Save Draft</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (window.renderLucideIcons) window.renderLucideIcons(modal);

    apiCall('/document-templates/ai/status').then(({ data }) => {
        const mode = document.getElementById('draft-ai-mode');
        if (mode) mode.textContent = data.aiConfigured ? 'AI model connected' : 'Standard clauses (no AI key configured)';
    }).catch(() => {});
}

async function aiDraftVersion(templateKey) {
    const instruction = document.getElementById('draft-ai-instruction')?.value.trim();
    const out = document.getElementById('draft-ai-result');
    if (!instruction) return showToast('error', 'Describe what to change first.');
    const btn = document.getElementById('draft-ai-btn');
    btn.disabled = true;
    out.textContent = 'Drafting…';
    try {
        const { data } = await apiCall('/document-templates/ai/draft', { method: 'POST', body: { templateKey, instruction } });
        document.getElementById('draft-body').value = data.templateBody;
        const notes = document.getElementById('draft-change-notes');
        if (notes && !notes.value.trim()) notes.value = data.changeNotes;
        out.innerHTML = `${escapeHtmlTpl(data.changeNotes)} Review the body below, then Save Draft.`;
        renderAiReview(document.getElementById('draft-review'), data.review);
    } catch (err) {
        out.textContent = err.message;
    } finally {
        btn.disabled = false;
    }
}

async function aiReviewDraft(templateKey) {
    const box = document.getElementById('draft-review');
    box.innerHTML = '<span style="font-size:0.75rem;color:#64748b;">Reviewing…</span>';
    try {
        const { data } = await apiCall('/document-templates/ai/review', { method: 'POST', body: { templateKey, templateBody: document.getElementById('draft-body').value } });
        renderAiReview(box, data);
    } catch (err) {
        box.innerHTML = `<span style="font-size:0.75rem;color:#b91c1c;">Review failed: ${escapeHtmlTpl(err.message)}</span>`;
    }
}

/** AI Review of a saved version, shown in a small window */
async function aiReviewVersion(templateKey, versionNumber) {
    const modalId = 'ai-review-modal';
    document.getElementById(modalId)?.remove();
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)this.parentElement.remove()">
            <div style="background:#fff;border-radius:18px;width:92vw;max-width:560px;max-height:85vh;overflow-y:auto;padding:20px 22px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);" onclick="event.stopPropagation()">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h2 style="font-size:1.05rem;font-weight:800;color:#0f172a;margin:0;display:flex;align-items:center;gap:8px;"><i data-lucide="sparkles" style="width:18px;height:18px;color:#7c3aed;"></i> AI Review — ${escapeHtmlTpl(versionNumber)}</h2>
                    <button onclick="document.getElementById('${modalId}').remove()" style="background:#f1f5f9;border:1px solid var(--border);border-radius:10px;width:32px;height:32px;cursor:pointer;color:#64748b;">✕</button>
                </div>
                <div id="ai-review-body"><span style="font-size:0.8rem;color:#64748b;">Reviewing…</span></div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (window.renderLucideIcons) window.renderLucideIcons(modal);
    try {
        const { data } = await apiCall('/document-templates/ai/review', { method: 'POST', body: { templateKey, versionNumber } });
        renderAiReview(document.getElementById('ai-review-body'), data);
    } catch (err) {
        document.getElementById('ai-review-body').innerHTML = `<span style="font-size:0.8rem;color:#b91c1c;">Review failed: ${escapeHtmlTpl(err.message)}</span>`;
    }
}

function renderAiReview(container, review) {
    if (!container || !review) return;
    const color = review.score >= 85 ? '#059669' : review.score >= 60 ? '#d97706' : '#dc2626';
    const sev = { critical: ['#fef2f2', '#b91c1c'], high: ['#fff7ed', '#c2410c'], medium: ['#fffbeb', '#a16207'], low: ['#f8fafc', '#475569'] };
    container.innerHTML = `
        <div style="border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:#fff;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="font-size:1.4rem;font-weight:800;color:${color};">${review.score}<span style="font-size:0.75rem;color:#94a3b8;">/100</span></div>
                <div style="font-size:0.75rem;color:#64748b;">${review.issues.length ? `${review.issues.length} issue(s) to fix` : 'No blocking issues found'} · ${review.source === 'openai' ? 'rules + AI model' : 'rule-based checks'}</div>
            </div>
            ${review.issues.map(i => `<div style="font-size:0.78rem;padding:6px 10px;border-radius:8px;background:${sev[i.severity][0]};color:${sev[i.severity][1]};"><strong>${escapeHtmlTpl(i.severity.toUpperCase())}</strong> · ${escapeHtmlTpl(i.message)}</div>`).join('')}
            ${review.suggestions.length ? `<div style="font-size:0.72rem;font-weight:800;color:#5b21b6;margin-top:4px;">SUGGESTIONS</div>${review.suggestions.map(s => `<div style="font-size:0.78rem;color:#334155;">• ${escapeHtmlTpl(s)}</div>`).join('')}` : ''}
        </div>`;
}

async function submitDraftVersion(templateKey) {
    const modal = document.getElementById('version-draft-modal');
    if (!modal) return;

    const versionNumber = modal.querySelector('#draft-ver-num')?.value.trim();
    const changeNotes = modal.querySelector('#draft-change-notes')?.value.trim() || 'Updated version draft';
    const effectiveFrom = modal.querySelector('#draft-effective-date')?.value || new Date().toISOString();
    const templateBody = modal.querySelector('#draft-body')?.value || '';

    if (!versionNumber) return showToast('error', 'Please enter a version number.');
    if (!templateBody.trim()) return showToast('error', 'The template body cannot be empty.');

    const btn = document.getElementById('draft-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        const json = await apiCall(`/document-templates/${encodeURIComponent(templateKey)}/versions`, {
            method: 'POST',
            body: { versionNumber, changeNotes, effectiveFrom, templateBody }
        });
        modal.remove();
        showToast('success', `Draft '${json.data.versionNumber}' saved to Firebase. Approve it to make it active.`);
        await loadTemplates();
        openTemplateDetail(templateKey);
    } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Save Draft';
        showToast('error', 'Could not save the draft: ' + err.message);
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
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:#ffffff;border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-sm);">
            <div style="width:34px;height:34px;border-radius:10px;background:${style.bg};color:${style.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i data-lucide="${style.lucide}" class="fas ${style.icon}" style="width:16px;height:16px;"></i>
            </div>
            <span style="flex:1;font-size:0.85rem;font-weight:700;color:#0f172a;">${t.name}</span>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
                ${(t.permittedModules || []).map(m => `<span class="tag tag-blue" style="font-size:10px;">${MODULE_LABELS[m]?.label || m}</span>`).join('')}
            </div>
            <i data-lucide="lock" style="width:14px;height:14px;color:#ef4444;" title="Caller permission gating active"></i>
        </div>`;
    }).join('');

    if (window.renderLucideIcons) window.renderLucideIcons(container);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TABS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function switchTab(name, btn) {
    ['catalog', 'generated', 'audit', 'custom_modules'].forEach(t => {
        const el = document.getElementById(`tab-content-${t}`);
        if (el) el.style.display = 'none';
        const tabBtn = document.getElementById(`tab-${t}`);
        if (tabBtn) tabBtn.classList.remove('active');
    });

    const active = document.getElementById(`tab-content-${name}`);
    if (active) active.style.display = '';
    if (btn) btn.classList.add('active');
    if (!btn) {
        const tabBtn = document.getElementById(`tab-${name}`);
        if (tabBtn) tabBtn.classList.add('active');
    }

    if (name === 'custom_modules') {
        loadAdminCustomTemplates();
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TOAST NOTIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function showToast(type, message, actionText, actionCallback) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: 'check-circle', error: 'alert-triangle', info: 'info' };
    const colors = { success: '#10b981', error: '#ef4444', info: '#2563eb' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';

    let actionBtnHtml = '';
    if (actionText && typeof actionCallback === 'function') {
        const btnId = 'toast-act-' + Math.random().toString(36).substring(2, 8);
        actionBtnHtml = `<button id="${btnId}" class="btn btn-primary btn-sm" style="padding:4px 10px;font-size:11px;margin-left:auto;">${actionText}</button>`;
        setTimeout(() => {
            document.getElementById(btnId)?.addEventListener('click', () => {
                toast.remove();
                actionCallback();
            });
        }, 50);
    }

    toast.innerHTML = `
        <i data-lucide="${icons[type] || 'info'}" style="color:${colors[type]};width:18px;height:18px;flex-shrink:0;"></i>
        <span style="flex:1;font-size:0.85rem;font-weight:600;color:#0f172a;">${message}</span>
        ${actionBtnHtml}
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;display:flex;align-items:center;">
            <i data-lucide="x" style="width:14px;height:14px;"></i>
        </button>`;

    container.appendChild(toast);
    if (window.renderLucideIcons) window.renderLucideIcons(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 4500);
}

// Keyboard shortcuts: Escape closes modals & drawer
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeSidePanel();
        document.getElementById('preview-modal-wrapper')?.remove();
        document.getElementById('gen-modal-wrapper')?.remove();
        document.getElementById('version-draft-modal')?.remove();
        document.getElementById('ai-review-modal')?.remove();
    }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   CUSTOMISABLE MODULE TEMPLATES CONTROLLER (PRD §1.2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let adminCustomTemplates = [];
let currentAdminTemplateId = null;

async function loadAdminCustomTemplates() {
    try {
        const json = await apiCall('/custom-templates');
        adminCustomTemplates = json.data || [];
        filterAdminCustomTemplates();
    } catch (err) {
        const grid = document.getElementById('admin-custom-template-grid');
        if (grid) grid.innerHTML = `<div style="grid-column:1/-1;padding:2rem;text-align:center;color:#b91c1c;">Could not load module templates: ${escapeHtmlTpl(err.message)}</div>`;
    }
}

function filterAdminCustomTemplates() {
    const searchVal = (document.getElementById('search-custom-tpl-input')?.value || '').toLowerCase().trim();
    const moduleVal = document.getElementById('custom-module-filter')?.value || 'all';
    const statusVal = document.getElementById('custom-status-filter')?.value || 'all';

    let list = [...adminCustomTemplates];

    if (moduleVal !== 'all') {
        list = list.filter(t => t.module.toLowerCase() === moduleVal.toLowerCase());
    }

    if (statusVal !== 'all') {
        list = list.filter(t => t.status.toLowerCase() === statusVal.toLowerCase());
    }

    if (searchVal) {
        list = list.filter(t => 
            t.name.toLowerCase().includes(searchVal) || 
            t.description.toLowerCase().includes(searchVal) || 
            t.module.toLowerCase().includes(searchVal)
        );
    }

    renderAdminCustomTemplates(list);
}

function renderAdminCustomTemplates(templates) {
    const grid = document.getElementById('admin-custom-template-grid');
    if (!grid) return;

    if (!templates.length) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; background: white; border: 1px dashed var(--border); border-radius: var(--radius);">
                <i data-lucide="layout-template" style="width: 32px; height: 32px; color: var(--text-muted); margin: 0 auto 10px;"></i>
                <h4 style="margin: 0 0 6px 0; color: var(--text-primary); font-size: 1.1rem; font-weight: 800;">No Module Templates Found</h4>
                <p style="margin: 0; color: var(--text-muted); font-size: 0.85rem;">No custom templates found for the selected module filter.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons({ root: grid });
        return;
    }

    grid.innerHTML = templates.map(tpl => {
        const isDraft = tpl.status === 'draft';
        const permittedCount = (tpl.permittedFields || []).filter(f => f.isPermittedToEdit).length;
        const lockedCount = (tpl.lockedFields || []).length;

        return `
            <div class="template-card" style="display: flex; flex-direction: column; justify-content: space-between; border-top: 4px solid ${isDraft ? '#f59e0b' : '#7c3aed'};">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                        <span class="tag tag-purple" style="text-transform: uppercase; font-size: 0.7rem; font-weight: 800;">
                            ${escapeHtmlTpl(String(tpl.module).toUpperCase())}
                        </span>
                        <span class="badge ${isDraft ? 'badge-draft' : 'badge-approved'}" style="font-size: 0.7rem;">
                            ${escapeHtmlTpl(String(tpl.status).toUpperCase())} (${escapeHtmlTpl(tpl.version)})
                        </span>
                    </div>

                    <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--text-primary); margin: 0 0 8px 0;">
                        ${escapeHtmlTpl(tpl.name)}
                    </h3>
                    <p style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.5; margin: 0 0 14px 0;">
                        ${escapeHtmlTpl(tpl.description || 'Standard module template structure.')}
                    </p>

                    <div style="background: var(--bg-deep); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; margin-bottom: 14px;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 4px;">
                            <span>Permitted Fields: <strong style="color: #2563eb;">${permittedCount} Editable</strong></span>
                            <span>Locked: <strong style="color: #64748b;">${lockedCount}</strong></span>
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-style: italic;">
                            "${escapeHtmlTpl(tpl.instructions || 'Standard instructions for permitted fields.')}"
                        </div>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px;">
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-outline btn-sm" style="flex: 1;" onclick="openAdminCustomizeTemplateModal('${tpl.id}')">
                            <i data-lucide="sliders" style="width: 14px; height: 14px;"></i> Edit Fields
                        </button>
                        <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="previewAdminCustomTemplate('${tpl.id}')">
                            <i data-lucide="eye" style="width: 14px; height: 14px;"></i> Preview
                        </button>
                    </div>

                    <div style="display: flex; gap: 8px;">
                        ${isDraft ? `
                            <button class="btn btn-primary btn-sm" style="flex: 1; background: #2563eb;" onclick="publishAdminTemplate('${tpl.id}')">
                                <i data-lucide="upload-cloud" style="width: 14px; height: 14px;"></i> Publish
                            </button>
                        ` : ''}
                        <button class="btn btn-outline btn-sm" style="flex: 1; border-color: #dc2626; color: #dc2626;" onclick="openAdminTemplatePermissionsModal('${tpl.id}')">
                            <i data-lucide="shield" style="width: 14px; height: 14px;"></i> Permissions
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons({ root: grid });
}

function openCreateModuleTemplateModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'create-module-template-modal';
    modal.innerHTML = `
        <div class="modal-card" style="max-width: 600px; text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <div>
                    <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;">Create New Module Template</h2>
                    <p style="font-size: 0.78rem; color: #64748b; margin: 2px 0 0 0;">Define module structure, permitted fields, and locked corporate clauses</p>
                </div>
                <button class="btn-ghost" onclick="document.getElementById('create-module-template-modal').remove()"><i data-lucide="x"></i></button>
            </div>

            <form onsubmit="submitCreateModuleTemplate(event)">
                <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 1.5rem;">
                    <div>
                        <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Template Name *</label>
                        <input type="text" id="adminTplName" required placeholder="e.g. Employee Retention & Merit Increment Template" style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.88rem; outline: none; background: #f8fafc;" />
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div>
                            <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Module *</label>
                            <select id="adminTplModule" required style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.88rem; outline: none; background: #f8fafc;">
                                <option value="goals">Goals & Objectives</option>
                                <option value="onboarding">Onboarding</option>
                                <option value="lifecycle">Employee Lifecycle</option>
                                <option value="exit">Exit & Offboarding</option>
                                <option value="payroll">Payroll & Compensation</option>
                                <option value="policy">Corporate Policy</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Category</label>
                            <input type="text" id="adminTplCategory" value="Operational Excellence" style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.88rem; outline: none; background: #f8fafc;" />
                        </div>
                    </div>
                    <div>
                        <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Description</label>
                        <textarea id="adminTplDesc" rows="2" placeholder="Overview of what this template provides..." style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.85rem; outline: none; background: #f8fafc; font-family: inherit;"></textarea>
                    </div>
                    <div>
                        <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">User Instructions *</label>
                        <textarea id="adminTplInstructions" rows="2" required placeholder="Guidelines for permitted users editing fields in this template..." style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.85rem; outline: none; background: #f8fafc; font-family: inherit;">Users can customize permitted fields before saving.</textarea>
                    </div>
                    <div>
                        <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Permitted Fields (Comma separated)</label>
                        <input type="text" id="adminTplPermitted" value="title, outcome, target, unit, targetCompletionDate" style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.88rem; outline: none; background: #f8fafc;" />
                    </div>
                    <div>
                        <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Locked Fields (Comma separated)</label>
                        <input type="text" id="adminTplLocked" value="corporateEntity, departmentCode" style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.88rem; outline: none; background: #f8fafc;" />
                    </div>
                    <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 10px; padding: 12px;">
                        <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 6px;">Initial Publication</label>
                        <div style="display: flex; gap: 20px;">
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer;">
                                <input type="radio" name="adminTplStatus" id="adminTplPub" checked />
                                <strong>Publish Immediately</strong>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer;">
                                <input type="radio" name="adminTplStatus" id="adminTplDraft" />
                                <span>Save as Draft</span>
                            </label>
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 10px;">
                    <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="document.getElementById('create-module-template-modal').remove()">Cancel</button>
                    <button type="submit" class="btn btn-primary" style="flex: 2;">Save Template</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons({ root: modal });
}

async function submitCreateModuleTemplate(e) {
    e.preventDefault();
    const name = document.getElementById('adminTplName').value.trim();
    const module = document.getElementById('adminTplModule').value;
    const category = document.getElementById('adminTplCategory').value.trim();
    const description = document.getElementById('adminTplDesc').value.trim();
    const instructions = document.getElementById('adminTplInstructions').value.trim();
    const isDraft = document.getElementById('adminTplDraft').checked;
    const permittedKeys = document.getElementById('adminTplPermitted').value.split(',').map(s => s.trim()).filter(Boolean);
    const lockedKeys = document.getElementById('adminTplLocked').value.split(',').map(s => s.trim()).filter(Boolean);

    const permittedFields = permittedKeys.map(key => ({
        fieldKey: key,
        label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
        type: 'text',
        isPermittedToEdit: true,
        isRequired: true,
        defaultValue: ''
    }));

    try {
        await apiCall('/custom-templates', {
            method: 'POST',
            body: {
                name,
                module,
                category,
                description,
                instructions,
                permittedFields,
                lockedFields: lockedKeys,
                status: isDraft ? 'draft' : 'published'
            }
        });

        document.getElementById('create-module-template-modal')?.remove();
        showToast('success', `Template "${name}" created and saved to Firebase.`);
        await loadAdminCustomTemplates();
    } catch (err) {
        showToast('error', 'Error creating template: ' + err.message);
    }
}

function openAdminCustomizeTemplateModal(id) {
    const tpl = adminCustomTemplates.find(t => t.id === id || t.key === id);
    if (!tpl) return;
    currentAdminTemplateId = id;

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'admin-customize-template-modal';
    modal.innerHTML = `
        <div class="modal-card" style="max-width: 620px; text-align: left; max-height: 85vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <div>
                    <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;">Customize Template: ${escapeHtmlTpl(tpl.name)}</h2>
                    <p style="font-size: 0.78rem; color: #64748b; margin: 2px 0 0 0;">Edit permitted fields &amp; instructions. Locked fields are protected.</p>
                </div>
                <button class="btn-ghost" onclick="document.getElementById('admin-customize-template-modal').remove()"><i data-lucide="x"></i></button>
            </div>

            <div style="margin-bottom: 14px;">
                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Instructions to Permitted Users *</label>
                <textarea id="adminCustInstructions" rows="2" style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.85rem; outline: none; background: #f8fafc; font-family: inherit;">${escapeHtmlTpl(tpl.instructions || '')}</textarea>
            </div>

            <div style="margin-bottom: 14px;">
                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Status (Draft / Published)</label>
                <select id="adminCustStatus" style="width: 100%; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.88rem; outline: none; background: #f8fafc;">
                    <option value="published" ${tpl.status === 'published' ? 'selected' : ''}>Published (Active)</option>
                    <option value="draft" ${tpl.status === 'draft' ? 'selected' : ''}>Draft</option>
                </select>
            </div>

            <div style="margin-bottom: 1.5rem;">
                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 8px; display: block;">Permitted Field Values</label>
                <div id="adminCustFieldsList">
                    ${(tpl.permittedFields || []).map(f => {
                        const isLocked = !f.isPermittedToEdit || (tpl.lockedFields || []).includes(f.fieldKey);
                        return `
                            <div style="background: ${isLocked ? '#f8fafc' : 'white'}; border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <span style="font-size: 0.8rem; font-weight: 700; color: #1e293b;">${escapeHtmlTpl(f.label || f.fieldKey)}</span>
                                    <span style="font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 6px; background: ${isLocked ? '#fee2e2' : '#dcfce7'}; color: ${isLocked ? '#dc2626' : '#15803d'};">
                                        ${isLocked ? 'LOCKED' : 'PERMITTED'}
                                    </span>
                                </div>
                                <input type="text" class="admin-cust-val" data-key="${escapeHtmlTpl(f.fieldKey)}" value="${escapeHtmlTpl(String(f.defaultValue || ''))}" ${isLocked ? 'disabled' : ''} style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); font-size: 0.82rem; background: ${isLocked ? '#f1f5f9' : 'white'}; outline: none;" />
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <div style="display: flex; gap: 10px;">
                <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="document.getElementById('admin-customize-template-modal').remove()">Cancel</button>
                <button type="button" class="btn btn-outline" style="flex: 1.2; border-color: #7c3aed; color: #7c3aed;" onclick="previewAdminCustomTemplate('${tpl.id}')">Pre-Save Preview</button>
                <button type="button" class="btn btn-primary" style="flex: 1.5;" onclick="saveAdminCustomizedTemplate('${tpl.id}')">Save Changes</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons({ root: modal });
}

async function previewAdminCustomTemplate(id) {
    const tplId = id || currentAdminTemplateId;
    const customValues = {};
    document.querySelectorAll('#adminCustFieldsList .admin-cust-val').forEach(inp => {
        customValues[inp.getAttribute('data-key')] = inp.value;
    });

    try {
        const json = await apiCall(`/custom-templates/${encodeURIComponent(tplId)}/preview`, { method: 'POST', body: { customFieldValues: customValues } });

        const previewModal = document.createElement('div');
        previewModal.className = 'modal-backdrop';
        previewModal.id = 'admin-preview-render-modal';
        previewModal.innerHTML = `
            <div class="modal-card" style="max-width: 680px; text-align: left; max-height: 85vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                    <div>
                        <h2 style="font-weight: 800; font-size: 1.25rem; margin: 0; color: #0f172a;">Pre-Save Template Preview</h2>
                        <p style="font-size: 0.78rem; color: #64748b; margin: 2px 0 0 0;">Confirm rendered layout and values before saving</p>
                    </div>
                    <button class="btn-ghost" onclick="document.getElementById('admin-preview-render-modal').remove()"><i data-lucide="x"></i></button>
                </div>
                <div style="margin-bottom: 1.5rem;">${safeDocHtml(json.data.previewHtml)}</div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" style="flex: 1;" onclick="document.getElementById('admin-preview-render-modal').remove()">Close Preview</button>
                </div>
            </div>
        `;
        document.body.appendChild(previewModal);
        if (window.lucide) window.lucide.createIcons({ root: previewModal });
    } catch (err) {
        showToast('error', 'Preview error: ' + err.message);
    }
}

async function saveAdminCustomizedTemplate(id) {
    const tplId = id || currentAdminTemplateId;
    const instructions = document.getElementById('adminCustInstructions')?.value.trim();
    const status = document.getElementById('adminCustStatus')?.value;

    const customValues = {};
    document.querySelectorAll('#adminCustFieldsList .admin-cust-val').forEach(inp => {
        customValues[inp.getAttribute('data-key')] = inp.value;
    });

    const tpl = adminCustomTemplates.find(t => t.id === tplId || t.key === tplId);
    const updatedPermittedFields = (tpl?.permittedFields || []).map(f => ({
        ...f,
        defaultValue: customValues[f.fieldKey] !== undefined ? customValues[f.fieldKey] : f.defaultValue
    }));

    try {
        await apiCall(`/custom-templates/${encodeURIComponent(tplId)}`, {
            method: 'PUT',
            body: { instructions, permittedFields: updatedPermittedFields, status }
        });

        document.getElementById('admin-customize-template-modal')?.remove();
        document.getElementById('admin-preview-render-modal')?.remove();
        showToast('success', 'Template changes saved to Firebase.');
        await loadAdminCustomTemplates();
    } catch (err) {
        showToast('error', 'Save error: ' + err.message);
    }
}

async function publishAdminTemplate(id) {
    if (!confirm('Publish this draft template for use across permitted modules?')) return;
    try {
        await apiCall(`/custom-templates/${encodeURIComponent(id)}/publish`, { method: 'POST', body: {} });

        showToast('success', 'Template published and saved to Firebase.');
        await loadAdminCustomTemplates();
    } catch (err) {
        showToast('error', 'Publish failed: ' + err.message);
    }
}

function openAdminTemplatePermissionsModal(id) {
    const tpl = adminCustomTemplates.find(t => t.id === id || t.key === id);
    if (!tpl) return;
    currentAdminTemplateId = id;

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'admin-permissions-modal';
    modal.innerHTML = `
        <div class="modal-card" style="max-width: 520px; text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 40px; height: 40px; border-radius: 12px; background: #fee2e2; color: #dc2626; display: flex; align-items: center; justify-content: center;">
                        <i data-lucide="shield" style="width: 20px; height: 20px;"></i>
                    </div>
                    <div>
                        <h2 style="font-weight: 800; font-size: 1.15rem; margin: 0; color: #0f172a;">Manage Template Permissions</h2>
                        <p style="font-size: 0.75rem; color: #64748b; margin: 2px 0 0 0;">${escapeHtmlTpl(tpl.name)}</p>
                    </div>
                </div>
                <button class="btn-ghost" onclick="document.getElementById('admin-permissions-modal').remove()"><i data-lucide="x"></i></button>
            </div>

            <div style="margin-bottom: 1.25rem;">
                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 8px;">Authorized Roles</label>
                <div style="display: flex; flex-direction: column; gap: 8px; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 12px;">
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; cursor: pointer;">
                        <input type="checkbox" id="admRoleAdmin" checked disabled />
                        <span>Super Admin</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; cursor: pointer;">
                        <input type="checkbox" id="admRoleHR" ${(tpl.permissions?.permittedRoles || []).includes('hr_admin') ? 'checked' : ''} />
                        <span>HR Administrator</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; cursor: pointer;">
                        <input type="checkbox" id="admRoleManager" ${(tpl.permissions?.permittedRoles || []).includes('manager') ? 'checked' : ''} />
                        <span>Department Manager</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; cursor: pointer;">
                        <input type="checkbox" id="admRoleEmployee" ${(tpl.permissions?.permittedRoles || []).includes('employee') ? 'checked' : ''} />
                        <span>Employee / General Staff</span>
                    </label>
                </div>
            </div>

            <div style="margin-bottom: 1.5rem;">
                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 8px;">Permitted Caller Modules</label>
                <div style="display: flex; flex-direction: column; gap: 8px; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 12px;">
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; cursor: pointer;">
                        <input type="checkbox" id="admModGoals" ${(tpl.permissions?.permittedModules || []).includes('goals') ? 'checked' : ''} />
                        <span>Goals &amp; Objectives</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; cursor: pointer;">
                        <input type="checkbox" id="admModOnboarding" ${(tpl.permissions?.permittedModules || []).includes('onboarding') ? 'checked' : ''} />
                        <span>Onboarding</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; cursor: pointer;">
                        <input type="checkbox" id="admModHR" ${(tpl.permissions?.permittedModules || []).includes('hr_admin') ? 'checked' : ''} />
                        <span>HR Admin Console</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; cursor: pointer;">
                        <input type="checkbox" id="admModPMS" ${(tpl.permissions?.permittedModules || []).includes('pms') ? 'checked' : ''} />
                        <span>PMS &amp; Evaluations</span>
                    </label>
                </div>
            </div>

            <div style="display: flex; gap: 10px;">
                <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="document.getElementById('admin-permissions-modal').remove()">Cancel</button>
                <button type="button" class="btn btn-danger" style="flex: 2; background: #dc2626; color: white;" onclick="saveAdminTemplatePermissions('${tpl.id}')">Save Permissions</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons({ root: modal });
}

async function saveAdminTemplatePermissions(id) {
    const tplId = id || currentAdminTemplateId;
    const permittedRoles = ['super_admin'];
    if (document.getElementById('admRoleHR')?.checked) permittedRoles.push('hr_admin');
    if (document.getElementById('admRoleManager')?.checked) permittedRoles.push('manager');
    if (document.getElementById('admRoleEmployee')?.checked) permittedRoles.push('employee');

    const permittedModules = [];
    if (document.getElementById('admModGoals')?.checked) permittedModules.push('goals');
    if (document.getElementById('admModOnboarding')?.checked) permittedModules.push('onboarding');
    if (document.getElementById('admModHR')?.checked) permittedModules.push('hr_admin');
    if (document.getElementById('admModPMS')?.checked) permittedModules.push('pms');

    try {
        await apiCall(`/custom-templates/${encodeURIComponent(tplId)}/permissions`, {
            method: 'PUT',
            body: { permissions: { permittedRoles, permittedModules } }
        });

        document.getElementById('admin-permissions-modal')?.remove();
        showToast('success', 'Template permissions saved to Firebase.');
        await loadAdminCustomTemplates();
    } catch (err) {
        showToast('error', 'Error updating permissions: ' + err.message);
    }
}

function escapeHtmlTpl(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

