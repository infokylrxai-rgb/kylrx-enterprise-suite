const crypto = require('crypto');

/**
 * Temporary passwords for newly onboarded staff.
 *
 * The previous implementation returned `${firstName}@${randomInt(1000,9999)}#`, so every
 * account's password was the holder's own first name plus four digits: about 9,000
 * possibilities against a name that is public by definition. Sign-in goes from the browser
 * straight to Firebase Authentication, so the Express rate limiter in front of this API
 * never sees those attempts and could not slow a search of that space.
 *
 * The seed argument is still accepted so existing callers are unchanged, but it is ignored:
 * a password must not be derived from anything an attacker already knows.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I or O
const LOWER = 'abcdefghijkmnpqrstuvwxyz';   // no l
const DIGIT = '23456789';                   // no 0 or 1
const SYMBOL = '!@#$%^&*-_=+';

/** Uniform pick, via rejection-free crypto.randomInt. */
const pick = (set, n) => Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join('');

module.exports = {
    generateSecurePassword: (_seedStr = 'User') => {
        // 16 characters drawn from ~70 symbols is far beyond anything guessable, while the
        // excluded look-alike characters keep it readable over the phone or retyped by hand.
        const body = pick(UPPER, 3) + pick(LOWER, 6) + pick(DIGIT, 4) + pick(SYMBOL, 3);
        // Shuffle so the character classes do not sit in fixed, predictable positions.
        const chars = body.split('');
        for (let i = chars.length - 1; i > 0; i--) {
            const j = crypto.randomInt(i + 1);
            [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        return chars.join('');
    }
};
