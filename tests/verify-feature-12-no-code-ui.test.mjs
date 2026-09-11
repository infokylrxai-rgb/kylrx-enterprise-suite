import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const htmlContent = fs.readFileSync(path.join(rootDir, 'admin-workflow-builder.html'), 'utf8');
const jsContent = fs.readFileSync(path.join(rootDir, 'admin-workflow-builder.js'), 'utf8');

test('Requirement 12: No-Code UI Requirements Suite', async (t) => {

    await t.test('1. Palette defines all 11 mandated nodes with explicit + Action Buttons', () => {
        const expectedNodes = [
            { type: 'trigger', title: '+ Trigger' },
            { type: 'condition', title: '+ Condition' },
            { type: 'branch', title: '+ Branch' },
            { type: 'approval', title: '+ Approval' },
            { type: 'wait', title: '+ Wait' },
            { type: 'escalation', title: '+ Escalation' },
            { type: 'action', title: '+ Action' },
            { type: 'notification', title: '+ Notification' },
            { type: 'document', title: '+ Document' },
            { type: 'form', title: '+ Form' },
            { type: 'end', title: '+ End' }
        ];

        for (const node of expectedNodes) {
            assert.ok(
                htmlContent.includes(`data-node-type="${node.type}"`),
                `HTML must contain data-node-type="${node.type}"`
            );
            assert.ok(
                htmlContent.includes(node.title),
                `Palette item must display label "${node.title}"`
            );
        }

        // Count palette-add-btn occurrences
        const addBtnMatches = htmlContent.match(/class="palette-add-btn"/g);
        assert.ok(addBtnMatches && addBtnMatches.length >= 11, 'Must have at least 11 1-click add buttons');
    });

    await t.test('2. HTML features prominent No-Code Guarantee banners', () => {
        assert.ok(
            htmlContent.includes('100% No-Code Guarantee'),
            'Must contain "100% No-Code Guarantee" banner'
        );
        assert.ok(
            htmlContent.includes('HR never writes Firebase, Python, JS or API code'),
            'Must explicitly reassure HR of zero Firebase, Python, JS or API coding'
        );
    });

    await t.test('3. JS controller supports both Drag-and-Drop and 1-Click Click-to-Add', () => {
        assert.ok(jsContent.includes('addNodeToCanvas'), 'JS must define addNodeToCanvas helper');
        assert.ok(jsContent.includes('setupPaletteDragEvents'), 'JS must setup drag & drop events');
        assert.ok(jsContent.includes('.palette-add-btn'), 'JS must attach handlers for palette add buttons');
        assert.ok(jsContent.includes('dragstart') && jsContent.includes('dragover') && jsContent.includes('drop'), 'Must support full HTML5 drag-and-drop');
    });

    await t.test('4. Configuration panels provide zero-code forms for all 11 nodes', () => {
        const requiredSelectors = [
            'cfg-trigger-event',       // Trigger event dropdown
            'cfg-trigger-entity',      // Target entity
            'cfg-trigger-scope',       // Filter scope
            'cfg-cond-field',          // Condition evaluation field
            'cfg-cond-op',             // Comparison operator
            'cfg-cond-val',            // Value
            'cfg-branch-true',         // Branch true route label
            'cfg-branch-false',        // Branch false route label
            'cfg-appr-role',           // Approver role
            'cfg-appr-due',            // SLA due time
            'cfg-wait-dur',            // Wait duration
            'cfg-wait-unit',           // Wait unit
            'cfg-esc-to',              // Escalate to
            'cfg-esc-sla',             // Escalation SLA threshold
            'cfg-act-type',            // Automated action type
            'cfg-act-mode',            // Action execution mode
            'cfg-notif-recip',         // Notification recipient
            'cfg-notif-chan',          // Notification channel
            'cfg-notif-msg',           // Notification template
            'cfg-doc-key',             // Document template key
            'cfg-doc-format',          // Document format
            'cfg-form-title',          // Form title
            'cfg-form-respondent',     // Form respondent
            'cfg-form-days',           // Form completion deadline
            'cfg-end-status',          // End outcome status
            'cfg-end-note'             // Audit note
        ];

        for (const selector of requiredSelectors) {
            assert.ok(
                jsContent.includes(`id="${selector}"`),
                `JS renderConfigPanel must generate element with id="${selector}"`
            );
        }
    });

    await t.test('5. Quick Preset Chips and Dynamic Variable Token helpers are available', () => {
        assert.ok(jsContent.includes('setPresetValue'), 'Must expose setPresetValue helper');
        assert.ok(jsContent.includes('setSlaHours'), 'Must expose setSlaHours helper');
        assert.ok(jsContent.includes('insertToken'), 'Must expose insertToken helper');
        assert.ok(jsContent.includes('toggleFormField'), 'Must expose toggleFormField helper');
        assert.ok(jsContent.includes('preset-chips'), 'Must render preset-chips container');
        assert.ok(jsContent.includes('field-checkbox-grid'), 'Must render field-checkbox-grid for Form node');
    });

    await t.test('6. Form state synchronization binds all controls to workflow canvas', () => {
        assert.ok(jsContent.includes('attachConfigFormListeners'), 'Must define attachConfigFormListeners');
        assert.ok(jsContent.includes('updateNodeCard'), 'Must update node summary cards');
    });
});
