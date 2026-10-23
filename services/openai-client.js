/**
 * Minimal OpenAI Chat Completions client shared by the AI assistants.
 * Configured with OPENAI_API_KEY (and optional OPENAI_MODEL) in .env; callers fall back to
 * rule-based logic when isConfigured() is false.
 */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 45000;

function isConfigured() {
    return !!process.env.OPENAI_API_KEY;
}

/** Sends chat messages and returns the model's reply parsed as a JSON object. */
async function chatJson(messages, { temperature = 0.2 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(OPENAI_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                temperature,
                response_format: { type: 'json_object' },
                messages
            }),
            signal: controller.signal
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(`OpenAI error: ${(json.error && json.error.message) || res.status}`);
            err.status = 502;
            throw err;
        }
        const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
        return JSON.parse(content || '{}');
    } catch (err) {
        if (err.name === 'AbortError') {
            const e = new Error('The AI service did not respond in time. Please try again.');
            e.status = 504;
            throw e;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { isConfigured, chatJson };
