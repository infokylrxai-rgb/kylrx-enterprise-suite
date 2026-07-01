const fs = require('fs');
const path = require('path');

const rootDir = 'c:/Users/Admin/OneDrive/Desktop/product_sprint';

const checks = {
    // Priority 1
    p1_1_activation_alert: {
        title: "onboarding-invite.html — Activation alert replaced with branded toast",
        check: () => {
            const file = path.join(rootDir, 'onboarding-invite.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return !content.includes('alert("Activation successful') && !content.includes('alert(\"Activation successful');
        }
    },
    p1_2_wizard_title: {
        title: "onboarding-wizard.html — Title updated to Kylrx AI",
        check: () => {
            const file = path.join(rootDir, 'onboarding-wizard.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('<title>Onboarding Wizard | Kylrx AI</title>');
        }
    },
    p1_3_invite_title: {
        title: "onboarding-invite.html — Title updated to Kylrx AI",
        check: () => {
            const file = path.join(rootDir, 'onboarding-invite.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('<title>Welcome to Kylrx AI | Employee Onboarding</title>');
        }
    },
    p1_4_invite_body: {
        title: "onboarding-invite.html — Brand name updated from HRFlow to Kylrx AI in body",
        check: () => {
            const file = path.join(rootDir, 'onboarding-invite.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return !content.includes('at **HRFlow** has been provisioned');
        }
    },
    p1_5_insert_tracker: {
        title: "insert_tracker.js — Dev clean up or removal of stale references",
        check: () => {
            const file = path.join(rootDir, 'insert_tracker.js');
            return !fs.existsSync(file); // Completed if file is deleted
        }
    },

    // Priority 2
    p2_1_mentions_dropdown: {
        title: "admin-message.html — Dynamic mentions dropdown from loaded users array",
        check: () => {
            const adminFile = path.join(rootDir, 'admin-message.html');
            const mgrFile = path.join(rootDir, 'manager-message.html');
            const hrmsFile = path.join(rootDir, 'hrms-message.html');
            if (!fs.existsSync(adminFile) || !fs.existsSync(mgrFile) || !fs.existsSync(hrmsFile)) return false;
            
            const adminContent = fs.readFileSync(adminFile, 'utf8');
            const mgrContent = fs.readFileSync(mgrFile, 'utf8');
            const hrmsContent = fs.readFileSync(hrmsFile, 'utf8');
            
            // Check that hardcoded mentions are removed and dynamic mentions are set up
            const hasDynamicMentions = adminContent.includes('mentionsDropdown') && adminContent.includes('insertMention');
            const mgrPlaceholdersRemoved = !mgrContent.includes("onclick=\"insertMention('Sarah Wilson')\"");
            const hrmsPlaceholdersRemoved = !hrmsContent.includes("onclick=\"insertMention('Sarah Wilson')\"");
            
            return hasDynamicMentions && mgrPlaceholdersRemoved && hrmsPlaceholdersRemoved;
        }
    },
    p2_2_badge_position: {
        title: "hrms-dashboard.html — Red/blue dot badges parent has relative positioning",
        check: () => {
            const file = path.join(rootDir, 'hrms-dashboard.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('.action-icon') && content.includes('position: relative');
        }
    },
    p2_3_progress_bar: {
        title: "onboarding-wizard.html — Progress formula starts above 0% and hits 100% on last step",
        check: () => {
            const file = path.join(rootDir, 'onboarding-wizard.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('currentStepIdx + 1') && content.includes('flowSteps.length');
        }
    },
    p2_4_sidebar_labels: {
        title: "admin-message.html — Sidebar link labels fixed for attendance and inactivity",
        check: () => {
            const file = path.join(rootDir, 'admin-message.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('admin-inactivity-monitor.html') && content.includes('Inactivity Radar');
        }
    },

    // Priority 3
    p3_1_reinvite_flow: {
        title: "onboarding-invite.html — Request new token flow for expired links",
        check: () => {
            const file = path.join(rootDir, 'onboarding-invite.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('Request New Invite Link') || content.includes('requestNewToken') || content.includes('reinvite');
        }
    },
    p3_2_save_draft_toast: {
        title: "onboarding-wizard.html — Save draft visual confirmation toast/indicator",
        check: () => {
            const file = path.join(rootDir, 'onboarding-wizard.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('Draft Saved') || content.includes('draft-saved') || content.includes('auto-save') || content.includes('Draft saved');
        }
    },
    p3_3_broadcast_messages: {
        title: "admin-message.html — Broadcast messaging to multiple recipients/departments",
        check: () => {
            const file = path.join(rootDir, 'admin-message.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('selectedContacts.size > 1') || content.includes('selectedContacts.forEach') || content.includes('broadcast');
        }
    },
    p3_4_bulk_upload_error: {
        title: "hrms-dashboard.html — Bulk employee upload error list/panel UX",
        check: () => {
            const file = path.join(rootDir, 'hrms-dashboard.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('uploadErrorPanel') || content.includes('errorDetailsList');
        }
    },
    p3_5_unrecognized_steps: {
        title: "onboarding-wizard.html — Graceful fallback for unrecognized onboarding steps",
        check: () => {
            const file = path.join(rootDir, 'onboarding-wizard.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return content.includes('skipUnknownStep') || content.includes('Skip Step');
        }
    },
    p3_6_sidebar_anchor_links: {
        title: "hrms-dashboard.html — Sidebar links navigate to real pages instead of empty '#' anchors",
        check: () => {
            const file = path.join(rootDir, 'hrms-dashboard.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return !content.includes('href="#payroll"') && !content.includes('href="#pms"');
        }
    },

    // Priority 4
    p4_1_stale_scripts: {
        title: "DevOps — Python migration/patch scripts archived/deleted",
        check: () => {
            const files = ['fix_injection.py', 'patch_hydration.py', 'remove_broken_calls.py', 'extract_lost_changes.py', 'undo_custom_apps.py'];
            return files.every(f => !fs.existsSync(path.join(rootDir, f)));
        }
    },
    p4_2_old_demo_files: {
        title: "DevOps — Old demo stub files (demo_old_v1/v2/v3) deleted",
        check: () => {
            const files = ['demo_old_v1.html', 'demo_old_v2.html', 'demo_old_v3.html'];
            return files.every(f => !fs.existsSync(path.join(rootDir, f)));
        }
    },
    p4_3_consolidate_injectors: {
        title: "DevOps — Consolidation of script injectors (insert_tracker/status_widget/link.js)",
        check: () => {
            const files = ['insert_tracker.js', 'insert_status_widget.js', 'insert_link.js'];
            return files.every(f => !fs.existsSync(path.join(rootDir, f)));
        }
    },
    p4_4_credentials_file: {
        title: "Security — Dev credentials file 1.txt deleted/gitignored",
        check: () => {
            const file = path.join(rootDir, '1.txt');
            return !fs.existsSync(file);
        }
    },
    p4_5_api_base_url: {
        title: "Code Quality — API_BASE localhost references externalized/configurable",
        check: () => {
            const file = path.join(rootDir, 'admin-message.html');
            if (!fs.existsSync(file)) return false;
            const content = fs.readFileSync(file, 'utf8');
            return !content.includes("const API_BASE = 'http://localhost:3000/api';");
        }
    }
};

const results = {};
let completed = 0;
let total = 0;

for (const key in checks) {
    total++;
    const isDone = checks[key].check();
    results[key] = {
        title: checks[key].title,
        status: isDone ? "COMPLETED" : "PENDING"
    };
    if (isDone) completed++;
}

console.log(JSON.stringify({
    percentage: Math.round((completed / total) * 100),
    completed,
    total,
    results
}, null, 2));
process.exit(0);
