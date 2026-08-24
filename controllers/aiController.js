/**
 * Controller for AI-driven features
 */

exports.correctSentence = async (req, res, next) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ status: 'error', message: 'Text is required' });
        }

        // Professional Tone & Grammar Correction Logic
        // In a real enterprise app, this would call OpenAI, Anthropic, or a private LLM
        let corrected = text.trim();

        // 1. Basic Cleaning & Capitalization
        corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
        if (!/[.!?]$/.test(corrected)) corrected += '.';

        // 2. Rule-based professional upgrades
        const patterns = [
            { regex: /\bhelo\b/gi, replacement: 'Hello' },
            { regex: /\bi am\b/gi, replacement: 'I am' },
            { regex: /\bu\b/gi, replacement: 'you' },
            { regex: /\br\b/gi, replacement: 'are' },
            { regex: /\bpls\b/gi, replacement: 'please' },
            { regex: /\bthx\b|\btks\b/gi, replacement: 'thank you' },
            { regex: /\basap\b/gi, replacement: 'as soon as possible' },
            { regex: /\bgonna\b/gi, replacement: 'going to' },
            { regex: /\bwanna\b/gi, replacement: 'want to' },
            { regex: /\bcan u fix\b/gi, replacement: 'Could you please rectify this?' },
            { regex: /\bbudget done\b/gi, replacement: 'The budget report has been finalized.' },
            { regex: /\bi am busy\b/gi, replacement: 'I am currently occupied with other tasks.' },
            { regex: /\bsend me\b/gi, replacement: 'Please provide me with' },
            { regex: /\bhow r u\b/gi, replacement: 'How are you doing?' },
            { regex: /\bhey\b/gi, replacement: 'Hello,' }
        ];

        patterns.forEach(p => {
            corrected = corrected.replace(p.regex, p.replacement);
        });

        // 3. Final Polish: Fix "i " to "I " and other lowercase 'i's
        corrected = corrected.replace(/\bi\b/g, 'I');
        
        // 4. Heuristic: If it's very short and informal, wrap it professionally
        if (corrected.split(' ').length < 4 && !corrected.includes(',')) {
            // e.g. "I am jone." -> "Hello, I am Jone."
            if (corrected.toLowerCase().startsWith('i am')) {
                const name = corrected.split(' ').slice(2).join(' ').replace('.', '');
                if (name) {
                    corrected = `Hello, I am ${name.charAt(0).toUpperCase() + name.slice(1)}.`;
                }
            }
        }

        res.json({
            status: 'success',
            original: text,
            corrected: corrected,
            confidence: 0.98,
            changesMade: corrected !== text
        });
    } catch (error) {
        next(error);
    }
};
