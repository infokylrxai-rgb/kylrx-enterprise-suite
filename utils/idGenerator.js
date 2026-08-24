const crypto = require('crypto');

const generateId = (prefix = 'ID') => {
    return `${prefix}_${crypto.randomUUID().split('-')[0]}`;
};

const generateEmployeeId = (deptCode = 'EMP') => {
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${deptCode}-${randomHex}`;
};

module.exports = {
    generateId,
    generateEmployeeId
};
