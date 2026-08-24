const crypto = require('crypto');

module.exports = {
    generateSecurePassword: (seedStr = 'User') => {
        // Generate a simple secure random password
        return `${seedStr.split(' ')[0]}@${crypto.randomInt(1000, 9999)}#`;
    }
};
