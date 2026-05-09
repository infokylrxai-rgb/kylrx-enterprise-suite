import { auth, db } from "./firebase-config.js";
import { collection, doc, setDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { ManagerWidgetEngine } from "./manager-widget-engine.js";

// Builder State
const state = {
    currentStep: 1,
    deptData: {
        departmentName: "",
        departmentCode: "",
        icon: "shield-check",
        layout: [],
        aiConfig: {
            thresholds: { productivity: 70, burnout: 85 },
            activeModules: ['performance', 'risk']
        },
        theme: 'enterprise-light',
        primaryColor: '#3b82f6',
        gridDensity: 'standard'
    },
    activeDepartments: []
};

// UI Elements
const deptNameInput = document.getElementById('deptName');
const deptCodeInput = document.getElementById('deptCode');
const pName = document.getElementById('pName');
const pCode = document.getElementById('pCode');
const previewIcon = document.getElementById('previewIcon');

// Initialize Lucide
lucide.createIcons();

// Step Switching
window.switchStep = (step) => {
    document.querySelectorAll('.builder-step').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    
    const stepEl = document.getElementById(`step-${step}`);
    const linkEl = document.getElementById(`linkStep${step}`);
    if (stepEl) stepEl.classList.add('active');
    if (linkEl) linkEl.classList.add('active');
    state.currentStep = step;
};

// Live Preview Logic
document.getElementById('btnPreview').onclick = () => {
    const deptId = state.deptData.departmentName.toLowerCase().replace(/\s+/g, '-');
    if (!deptId) {
        alert("Please enter a Department Name to preview.");
        return;
    }
    // Open in new tab with current ID
    window.open(`manager-dashboard.html?id=${deptId}&preview=true`, '_blank');
};

// Icon Selector
document.querySelectorAll('.icon-opt').forEach(opt => {
    opt.onclick = () => {
        document.querySelectorAll('.icon-opt').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        state.deptData.icon = opt.dataset.icon;
        previewIcon.innerHTML = `<i data-lucide="${opt.dataset.icon}" size="32"></i>`;
        lucide.createIcons();
    };
});

// Icon Keyword Mapping for Auto-Suggestion
const ICON_SUGGESTIONS = {
    'security': 'shield-check',
    'cyber': 'shield-check',
    'protect': 'shield-check',
    'finance': 'pie-chart',
    'sale': 'target',
    'marketing': 'target',
    'data': 'database',
    'analytic': 'pie-chart',
    'monitor': 'monitor',
    'tvc': 'monitor',
    'engineer': 'code-2',
    'dev': 'code-2',
    'tech': 'zap',
    'human': 'users',
    'hr': 'users',
    'people': 'users',
    'message': 'message-square',
    'chat': 'message-square',
    'briefcase': 'briefcase',
    'ops': 'briefcase',
    'operation': 'briefcase'
};

const suggestIcon = (name) => {
    const lowerName = name.toLowerCase();
    for (const [keyword, icon] of Object.entries(ICON_SUGGESTIONS)) {
        if (lowerName.includes(keyword)) return icon;
    }
    return null;
};

const selectIcon = (iconId) => {
    const opt = document.querySelector(`.icon-opt[data-icon="${iconId}"]`);
    if (!opt) return;
    
    document.querySelectorAll('.icon-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    state.deptData.icon = iconId;
    previewIcon.innerHTML = `<i data-lucide="${iconId}" size="32"></i>`;
    lucide.createIcons();
};

// Sync Identity Preview
deptNameInput.oninput = (e) => {
    const val = e.target.value;
    state.deptData.departmentName = val;
    pName.innerText = val || "New Department";
    
    // Auto-select Icon
    const suggested = suggestIcon(val);
    if (suggested) selectIcon(suggested);

    if (!deptCodeInput.value) {
        const code = val.substring(0, 3).toUpperCase();
        deptCodeInput.value = code;
        pCode.innerText = code + " UNIT";
        state.deptData.departmentCode = code;
    }
};

deptCodeInput.oninput = (e) => {
    state.deptData.departmentCode = e.target.value;
    pCode.innerText = e.target.value.toUpperCase() + " UNIT";
};

// Deployment Logic
document.getElementById('btnDeploy').onclick = async () => {
    if (!state.deptData.departmentName || !state.deptData.departmentCode) {
        alert("Please provide a Department Name and Code.");
        return;
    }

    const btn = document.getElementById('btnDeploy');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="spin"></i> Deploying...`;
    lucide.createIcons();

    try {
        const deptId = state.deptData.departmentName.toLowerCase().replace(/\s+/g, '-');
        
        // 1. Create Department Document
        await setDoc(doc(db, "departments", deptId), {
            ...state.deptData,
            departmentId: deptId,
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser?.email || 'admin'
        });

        // 2. Create Manager Dashboard Configuration
        await setDoc(doc(db, "managerDashboards", deptId), {
            deptId: deptId,
            config: {
                layout: state.deptData.layout,
                theme: state.deptData.theme,
                ai: state.deptData.aiConfig
            },
            updatedAt: serverTimestamp()
        });

        // Replace alert with Premium Modal
        const modal = document.getElementById('successModal');
        const modalMsg = document.getElementById('modalMsg');
        if (modal && modalMsg) {
            modalMsg.innerText = `Success! The ${state.deptData.departmentName} department has been deployed with its AI-Ready Manager Dashboard.`;
            modal.style.display = 'flex';
            
            // Update button to go to new dashboard
            const returnBtn = modal.querySelector('button');
            if (returnBtn) {
                returnBtn.innerText = "View Deployed Dashboard";
                returnBtn.onclick = () => window.location.href = `manager-dashboard.html?id=${deptId}`;
            }
        } else {
            alert(`Success! ${state.deptData.departmentName} has been deployed.`);
            window.location.href = `manager-dashboard.html?id=${deptId}`;
        }

    } catch (err) {
        console.error("Deployment Error:", err);
        alert("Deployment failed: " + err.message);
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="rocket"></i> Deploy Dashboard`;
        lucide.createIcons();
    }
};

// Initialize Widget Engine
const widgetEngine = new ManagerWidgetEngine('layoutCanvas');

// Drag and Drop Logic
const toolboxWidgets = document.querySelectorAll('.draggable-widget');
const canvas = document.getElementById('layoutCanvas');
const placeholder = canvas.querySelector('.canvas-placeholder');

toolboxWidgets.forEach(widget => {
    widget.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', widget.dataset.widget);
        widget.style.opacity = '0.5';
    });
    
    widget.addEventListener('dragend', () => {
        widget.style.opacity = '1';
    });
});

canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvas.style.borderColor = 'var(--primary)';
    canvas.style.background = 'var(--primary-light)';
});

canvas.addEventListener('dragleave', () => {
    canvas.style.borderColor = 'var(--border)';
    canvas.style.background = 'transparent';
});

canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    canvas.style.borderColor = 'var(--border)';
    canvas.style.background = 'transparent';
    
    const widgetId = e.dataTransfer.getData('text/plain');
    if (widgetId) {
        if (placeholder) placeholder.style.display = 'none';
        
        // Update state
        state.deptData.layout.push(widgetId);
        
        // Render
        widgetEngine.render(state.deptData.layout);
    }
});

window.removeWidget = (id) => {
    state.deptData.layout = state.deptData.layout.filter(w => w !== id);
    widgetEngine.render(state.deptData.layout);
    if (state.deptData.layout.length === 0 && placeholder) {
        placeholder.style.display = 'block';
    }
};

// Grid Density Logic
window.setGridDensity = (density) => {
    state.deptData.gridDensity = density;
    document.querySelectorAll('.canvas-controls .btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.grid === density);
    });
    
    const canvas = document.getElementById('layoutCanvas');
    canvas.classList.remove('density-compact', 'density-spacious');
    if (density !== 'standard') canvas.classList.add(`density-${density}`);
};

// Branding Color Logic
const colorInput = document.getElementById('primaryColor');
const hexVal = document.getElementById('hexVal');

const updatePrimaryColor = (color) => {
    state.deptData.primaryColor = color;
    hexVal.innerText = color.toUpperCase();
    colorInput.value = color;
    
    // Update live CSS variables for preview
    document.documentElement.style.setProperty('--primary', color);
    
    // Update theme previews
    document.querySelectorAll('.theme-preview div').forEach(div => {
        if (div.style.background.includes('var(--primary)') || div.style.background === 'rgb(59, 130, 246)') {
            div.style.background = color;
        }
    });
};

colorInput.oninput = (e) => updatePrimaryColor(e.target.value);

document.querySelectorAll('.color-preset').forEach(preset => {
    preset.onclick = () => {
        document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('active'));
        preset.classList.add('active');
        updatePrimaryColor(preset.dataset.color);
    };
});

// AI Calibration Logic
const rangeProd = document.getElementById('rangeProd');
const rangeBurn = document.getElementById('rangeBurn');
const valProd = document.getElementById('valProd');
const valBurn = document.getElementById('valBurn');

rangeProd.oninput = (e) => {
    valProd.innerText = e.target.value + '%';
    state.deptData.aiConfig.thresholds.productivity = Number(e.target.value);
};

rangeBurn.oninput = (e) => {
    valBurn.innerText = e.target.value + '%';
    state.deptData.aiConfig.thresholds.burnout = Number(e.target.value);
};

document.querySelectorAll('input[type="checkbox"][data-module]').forEach(cb => {
    cb.onchange = () => {
        const active = Array.from(document.querySelectorAll('input[type="checkbox"][data-module]:checked'))
                            .map(c => c.dataset.module);
        state.deptData.aiConfig.activeModules = active;
    };
});

// Theme Engine Logic
document.querySelectorAll('.theme-card').forEach(card => {
    card.onclick = () => {
        document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.deptData.theme = card.dataset.theme;
        
        // Update Preview
        const preview = document.querySelector('.dept-badge-preview');
        if (state.deptData.theme === 'deep-space') {
            preview.style.background = '#0f172a';
            preview.style.borderColor = '#1e293b';
            preview.querySelector('h3').style.color = 'white';
        } else if (state.deptData.theme === 'glassmorphism') {
            preview.style.background = 'rgba(255, 255, 255, 0.4)';
            preview.style.backdropFilter = 'blur(12px)';
            preview.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            preview.querySelector('h3').style.color = 'var(--text-main)';
        } else {
            preview.style.background = '#eff6ff';
            preview.style.borderColor = '#dbeafe';
            preview.querySelector('h3').style.color = 'var(--text-main)';
        }
    };
});

// Edit Mode Initialization
async function initEditMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('id') || urlParams.get('edit');
    
    if (editId) {
        console.log("Loading Department for Edit:", editId);
        const deptRef = doc(db, "departments", editId);
        
        onSnapshot(deptRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                state.deptData = { ...state.deptData, ...data };
                
                // Populate UI
                deptNameInput.value = data.departmentName;
                deptCodeInput.value = data.departmentCode;
                pName.innerText = data.departmentName;
                pCode.innerText = (data.departmentCode || '').toUpperCase() + " UNIT";
                
                // Set Icon
                selectIcon(data.icon);
                
                // Set AI
                if (data.aiConfig) {
                    rangeProd.value = data.aiConfig.thresholds.productivity;
                    valProd.innerText = data.aiConfig.thresholds.productivity + '%';
                    rangeBurn.value = data.aiConfig.thresholds.burnout;
                    valBurn.innerText = data.aiConfig.thresholds.burnout + '%';
                    
                    document.querySelectorAll('input[type="checkbox"][data-module]').forEach(cb => {
                        cb.checked = data.aiConfig.activeModules.includes(cb.dataset.module);
                    });
                }
                
                // Set Theme
                if (data.theme) {
                    const themeCard = document.querySelector(`.theme-card[data-theme="${data.theme}"]`);
                    if (themeCard) themeCard.click();
                }
                
                // Render Canvas
                if (data.layout) {
                    placeholder.style.display = 'none';
                    widgetEngine.render(data.layout);
                }

                // Update Header
                document.querySelector('h1').innerText = "Edit Department Dashboard";
                document.getElementById('btnDeploy').innerHTML = `<i data-lucide="save"></i> Update Dashboard`;
                lucide.createIcons();
            }
        });
    }
}

initEditMode();

// End of script

// Active Commands Directory Logic
function loadActiveCommands() {
    const container = document.getElementById('active-commands-grid');
    if (!container) return;

    // Listen for users to get employee counts
    onSnapshot(collection(db, "users"), (userSnap) => {
        state.employees = userSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeDepartments.length > 0) renderCommands(container);
    });

    onSnapshot(collection(db, "departments"), (snapshot) => {
        state.activeDepartments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderCommands(container);
    });

    // Add Search Listener
    document.getElementById('directorySearch')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        renderCommands(container, query);
    });
}

function renderCommands(container, query = '') {
    if (!container) return;
    
    let filteredDepts = state.activeDepartments;
    if (query) {
        filteredDepts = state.activeDepartments.filter(dept => 
            (dept.departmentName || '').toLowerCase().includes(query) || 
            (dept.departmentCode || '').toLowerCase().includes(query)
        );
    }
    
    if (filteredDepts.length === 0) {
        container.innerHTML = `<div style="padding:4rem; text-align:center; color:var(--text-muted); background: #f8fafc; border-radius: 20px; border: 2px dashed var(--border); grid-column: 1/-1;">${query ? 'No matching command centers found.' : 'No Command Centers deployed yet.'}</div>`;
        return;
    }

    const EMP_VIEW_MAP = {
        'engineering': 'engineering-employee.html',
        'finance': 'finance-employee.html',
        'marketing': 'marketing-employee.html',
        'sales': 'sales-employee.html',
        'hr': 'hr-employee.html',
        'operations': 'operational-employee.html'
    };

    container.innerHTML = filteredDepts.map(dept => {
        const name = dept.departmentName || dept.name || 'Unnamed Dept';
        const code = dept.departmentCode || 'UNIT';
        const icon = dept.icon || 'layout';
        const id = dept.id;
        const empCount = state.employees ? state.employees.filter(e => e.departmentId === id).length : 0;
        const empLink = EMP_VIEW_MAP[id] || 'employee-login.html';

        return `
            <div class="card" style="padding: 1.5rem; transition: 0.3s; border: 1px solid var(--border); border-radius: 20px; background: white; position: relative;">
                <div style="position: absolute; top: 15px; right: 15px; background: var(--primary-light); color: var(--primary); font-size: 0.6rem; font-weight: 800; padding: 4px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Manager Console</div>
                
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 1.5rem;">
                    <div style="width: 48px; height: 48px; background: #eff6ff; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--primary); border: 1px solid #dbeafe;">
                        <i data-lucide="${icon}"></i>
                    </div>
                    <div>
                        <div style="font-weight: 800; font-size: 1rem;">${name}</div>
                        <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;">${code} UNIT • ${empCount} Personnel</div>
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <a href="manager-dashboard.html?id=${id}" target="_blank" class="btn btn-outline" style="flex: 1; justify-content: center; padding: 12px; font-size: 0.8rem; text-decoration: none; display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="external-link" size="14"></i> View
                    </a>
                    <a href="manager-dashboard-builder.html?id=${id}" class="btn btn-outline" style="flex: 1; justify-content: center; padding: 12px; font-size: 0.8rem; border-color: var(--primary); color: var(--primary); text-decoration: none; display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="edit-3" size="14"></i> Edit
                    </a>
                </div>
                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); text-align: center;">
                    <a href="${empLink}" target="_blank" style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 5px;">
                        <i data-lucide="users" size="12"></i> Switch to Employee View
                    </a>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

// Start Listeners
loadActiveCommands();
