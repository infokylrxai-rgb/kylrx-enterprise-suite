/**
 * Generates a secure temporary password.
 * Format: First 3 letters of name (UPPERCASE) + @ + 4-digit random number
 * Example: NAN@4821
 */
function generateSecurePassword(name) {
    if (!name || typeof name !== 'string') {
        name = "USR";
    }

    // Clean name: Remove non-alphabetic characters
    let cleanName = name.replace(/[^a-zA-Z]/g, '').trim();

    // Ensure at least 3 chars for the prefix
    let prefix = cleanName.substring(0, 3).toUpperCase();
    while (prefix.length < 3) {
        prefix += "X";
    }

    const randomNumber = Math.floor(1000 + Math.random() * 9000);

    return `${prefix}@${randomNumber}`;
}

module.exports = { generateSecurePassword };
