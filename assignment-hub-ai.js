/**
 * Assignment Hub AI assistant (admin-assignment-matrix.html).
 * Ask a "what if" question in plain English; the server maps it to assignment attributes,
 * computes the real impact diff with the Central Assignment Engine and explains it.
 * "Show on page" loads the new attributes into the 6 input dropdowns.
 */
(function () {
    const API = `${window.API_BASE || window.location.origin}/api/assignments/ai/scenario`;
    const SELECTS = {
        legalEntity: 'selEntity',
        businessUnit: 'selBU',
        employeeType: 'selType',
        location: 'selLocation',
        department: 'selDepartment',
        grade: 'selGrade'
    };
    const LABELS = {
        legalEntity: 'Legal Entity', businessUnit: 'Business Unit', employeeType: 'Employee Type',
        location: 'Location', department: 'Department', grade: 'Grade'
    };
    let lastResult = null;

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    function readInputs() {
        const current = {};
        const options = {};
        for (const [dim, id] of Object.entries(SELECTS)) {
            const el = document.getElementById(id);
            if (!el) continue;
            current[dim] = el.value;
            options[dim] = [...el.options].map(o => o.value).filter(Boolean);
        }
        return { current, options };
    }

    function ensureModal() {
        let modal = document.getElementById('assignmentAiModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'assignmentAiModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,0.45);align-items:center;justify-content:center;padding:16px;';
        modal.innerHTML = `
            <div style="background:#fff;border-radius:16px;width:100%;max-width:680px;max-height:90vh;overflow:auto;box-shadow:0 20px 50px rgba(15,23,42,0.25);">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e2e8f0;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <i data-lucide="sparkles" style="color:#7c3aed;width:20px;height:20px;"></i>
                        <div>
                            <div style="font-weight:800;font-size:1.05rem;color:#0f172a;">Ask AI: What If?</div>
                            <div style="font-size:0.75rem;color:#64748b;">Starts from the current inputs on the page</div>
                        </div>
                    </div>
                    <button type="button" onclick="closeAssignmentAi()" style="background:none;border:none;cursor:pointer;color:#64748b;font-size:1.3rem;line-height:1;" aria-label="Close">&times;</button>
                </div>
                <div style="padding:18px 22px;">
                    <textarea id="assignmentAiQuestion" rows="3" maxlength="1000" placeholder="e.g. What changes if this employee becomes a contractor working remotely?"
                        style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:12px;font-family:inherit;font-size:0.9rem;resize:vertical;"></textarea>
                    <div id="assignmentAiStatus" style="font-size:0.82rem;color:#64748b;margin-top:8px;min-height:1.2em;"></div>
                    <div id="assignmentAiResult" style="margin-top:10px;"></div>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid #e2e8f0;">
                    <button type="button" class="btn-hub" onclick="closeAssignmentAi()">Close</button>
                    <button type="button" class="btn-hub" id="assignmentAiApplyBtn" style="display:none;" onclick="showAssignmentAiOnPage()">Show on Page</button>
                    <button type="button" class="btn-hub btn-hub-primary" id="assignmentAiAskBtn" onclick="askAssignmentAi()">Ask AI</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        return modal;
    }

    window.openAssignmentAi = function () {
        const modal = ensureModal();
        lastResult = null;
        document.getElementById('assignmentAiStatus').textContent = '';
        document.getElementById('assignmentAiResult').innerHTML = '';
        document.getElementById('assignmentAiApplyBtn').style.display = 'none';
        modal.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
        document.getElementById('assignmentAiQuestion').focus();
    };

    window.closeAssignmentAi = function () {
        const modal = document.getElementById('assignmentAiModal');
        if (modal) modal.style.display = 'none';
    };

    window.askAssignmentAi = async function () {
        const question = document.getElementById('assignmentAiQuestion').value.trim();
        const status = document.getElementById('assignmentAiStatus');
        const out = document.getElementById('assignmentAiResult');
        const btn = document.getElementById('assignmentAiAskBtn');
        if (!question) {
            status.textContent = 'Type a question first.';
            return;
        }
        btn.disabled = true;
        status.textContent = 'Analysing...';
        out.innerHTML = '';
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, ...readInputs() })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) throw new Error(json.error || `Request failed (HTTP ${res.status})`);
            lastResult = json;
            status.textContent = json.source === 'openai'
                ? 'Answered by ChatGPT using the real assignment rules'
                : 'Answered by the built-in assistant (add OPENAI_API_KEY for ChatGPT)';

            const { current } = readInputs();
            const changes = json.changedAttributes.length
                ? json.changedAttributes.map(d => `<li><strong>${esc(LABELS[d])}:</strong> ${esc(current[d])} &rarr; <span style="color:#2563eb;font-weight:700;">${esc(json.prospective[d])}</span></li>`).join('')
                : '<li>No input matched your question. Mention a value shown in the dropdowns (e.g. Contractor, Mumbai, L5).</li>';
            const modified = Object.entries(json.impact.categories || {}).filter(([, c]) => c.status === 'MODIFIED').map(([k]) => k);
            out.innerHTML = `
                <div style="font-weight:800;color:#0f172a;margin-bottom:6px;">Interpreted change</div>
                <ul style="margin:0 0 12px;padding-left:20px;font-size:0.85rem;color:#334155;line-height:1.7;">${changes}</ul>
                <div style="font-weight:800;color:#0f172a;margin-bottom:6px;">Impact</div>
                <div style="font-size:0.85rem;color:#334155;line-height:1.6;margin-bottom:8px;">${esc(json.summary)}</div>
                <div style="font-size:0.78rem;color:#64748b;">Rule: ${esc(json.impact.matchedRuleBefore)} &rarr; ${esc(json.impact.matchedRuleAfter)} &middot; ${modified.length} area(s) change${modified.length ? ': ' + esc(modified.join(', ')) : ''}</div>`;
            document.getElementById('assignmentAiApplyBtn').style.display = json.changedAttributes.length ? 'inline-flex' : 'none';
        } catch (err) {
            status.textContent = 'Could not answer: ' + err.message;
        } finally {
            btn.disabled = false;
        }
    };

    // Loads the AI's prospective attributes into the input dropdowns (nothing is saved)
    window.showAssignmentAiOnPage = function () {
        if (!lastResult) return;
        for (const [dim, id] of Object.entries(SELECTS)) {
            const el = document.getElementById(id);
            if (el && lastResult.prospective[dim]) el.value = lastResult.prospective[dim];
        }
        closeAssignmentAi();
        if (typeof window.resolveAndUpdateAssignments === 'function') window.resolveAndUpdateAssignments();
    };
})();
