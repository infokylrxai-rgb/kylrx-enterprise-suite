/**
 * Employee TVC AI Module
 * Generates contextual AI insights based on employee productivity data.
 * Provides motivational / corrective messages + behavior labels.
 */

const AI_RULES = [
    // High performers
    { check: d => d.score >= 90 && d.switches <= 1, msg: "Outstanding focus today! You're in the top performance bracket.", label: "Peak Performer", icon: "🏆" },
    { check: d => d.score >= 85 && d.switches <= 2, msg: "Excellent work rhythm detected. Keep this momentum going!", label: "High Performer", icon: "⭐" },
    { check: d => d.score >= 80, msg: "You are highly focused today. Bonus eligibility is active.", label: "Focused", icon: "🎯" },

    // Medium performers
    { check: d => d.score >= 65 && d.switches <= 4, msg: "Good progress. Minimize idle periods to push into bonus range.", label: "Steady", icon: "📊" },
    { check: d => d.score >= 50, msg: "Average productivity detected. Increase active work time for a better score.", label: "Average", icon: "📈" },

    // Focus loss warnings
    { check: d => d.switches > 10, msg: "Critical: Excessive tab switching detected. Immediate salary deduction is active.", label: "Distracted", icon: "🚨" },
    { check: d => d.switches > 6, msg: "Reduce tab switching to avoid further salary penalty. You have exceeded the safe limit.", label: "Distracted", icon: "⚠️" },
    { check: d => d.switches > 3, msg: "Warning: Tab switching is impacting your score. Stay focused to protect your salary.", label: "Losing Focus", icon: "⚡" },

    // Idle/break warnings
    { check: d => d.idleMin > 60, msg: "Extended idle time detected. Your productivity score is dropping significantly.", label: "Inactive", icon: "💤" },
    { check: d => d.breakMin > 45, msg: "Long break duration today. Return to work to maintain your score.", label: "Extended Break", icon: "☕" },

    // Low performers
    { check: d => d.score < 30, msg: "Productivity critically low. Immediate improvement needed to avoid maximum penalty.", label: "Needs Attention", icon: "🔴" },
    { check: d => d.score < 50, msg: "Below average productivity. Focus on active tasks to recover your score.", label: "Below Average", icon: "📉" },

    // Session duration
    { check: d => d.sessionMin < 5, msg: "Session just started. Activity tracking is now live.", label: "Starting", icon: "🟢" },
];

const FALLBACK = { msg: "AI engine monitoring your performance. Stay focused for optimal results.", label: "Monitoring", icon: "🤖" };

/**
 * Generate an AI insight from current employee data.
 * @param {Object} data - { score, switches, activeMin, idleMin, breakMin, sessionMin, penalty, bonus }
 * @returns {{ msg: string, label: string, icon: string }}
 */
function generateInsight(data) {
    const d = {
        score: data.score ?? data.productivityScore ?? 0,
        switches: data.switches ?? data.focusLossCount ?? 0,
        activeMin: data.activeMin ?? Math.round((data.activeTime || 0) / 60000),
        idleMin: data.idleMin ?? Math.round((data.idleTime || 0) / 60000),
        breakMin: data.breakMin ?? Math.round((data.breakDuration || 0) / 60000),
        sessionMin: data.sessionMin ?? 0,
        penalty: data.penalty ?? 0,
        bonus: data.bonus ?? 0
    };

    for (const rule of AI_RULES) {
        if (rule.check(d)) return { msg: rule.msg, label: rule.label, icon: rule.icon };
    }
    return FALLBACK;
}

/**
 * Get focus status label from score and switch count.
 */
function getFocusStatus(score, switches) {
    if (switches > 6) return { status: 'Distracted', color: '#ef4444' };
    if (score >= 80) return { status: 'Focused', color: '#10b981' };
    if (score >= 50) return { status: 'Moderate', color: '#f59e0b' };
    return { status: 'Unfocused', color: '#ef4444' };
}

/**
 * Get salary impact description.
 */
function getSalaryVerdict(penalty, bonus) {
    if (bonus > 0 && penalty === 0) return { text: 'Salary Increase Active', color: '#10b981', icon: '📈' };
    if (penalty > 0 && bonus === 0) return { text: 'Salary Deduction Active', color: '#ef4444', icon: '📉' };
    if (penalty > 0 && bonus > 0) return { text: 'Mixed Impact', color: '#f59e0b', icon: '⚖️' };
    return { text: 'No Impact', color: '#64748b', icon: '➖' };
}

export { generateInsight, getFocusStatus, getSalaryVerdict };
