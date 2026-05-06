const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    try {
        const serviceAccount = require('../config/serviceAccountKey.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (error) {
        logger.error(`Firebase Init Error: ${error.message}`);
    }
}

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-enterprise-key-hrflow-2026';

const verifyToken = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
        }

        let decoded;
        let userId;

        try {
            // First try to verify as custom JWT
            decoded = jwt.verify(token, JWT_SECRET);
            userId = decoded.id;
        } catch (jwtError) {
            try {
                // Fallback to Firebase ID Token
                decoded = await admin.auth().verifyIdToken(token);
                userId = decoded.uid;
            } catch (firebaseError) {
                logger.error(`Auth Error: Token verification failed for both JWT and Firebase`);
                return res.status(401).json({ success: false, error: 'Token is invalid or expired' });
            }
        }
        
        // Fetch full user details from Firestore
        const userDoc = await admin.firestore().collection('users').doc(userId).get();
        let userData = userDoc.exists ? userDoc.data() : {};
        
        // Admin Bypass (Demo/Enterprise Dev Mode)
        // Grant Admin privileges to specific emails OR anyone on the hrflow.com domain
        const userEmail = (decoded.email || userData.email || '').toLowerCase();
        const isAdminEmail = userEmail.endsWith('@hrflow.com') || userEmail === 'admin@demo.com';
        
        if (isAdminEmail) {
            userData.role = 'Admin';
        }

        // Zero-crash architecture: Fallback logic for missing departments/managers
        userData = {
            ...userData,
            id: userId,
            email: userEmail,
            department: userData.department || 'General Operations',
            managerAssigned: userData.managerAssigned || 'default-manager-queue',
            role: userData.role || 'Employee'
        };

        req.user = userData;
        next();
    } catch (error) {
        logger.error(`Auth Error: ${error.message}`);
        return res.status(401).json({ success: false, error: 'Token is invalid or expired' });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        const lowerRoles = roles.map(r => r.toLowerCase());
        const userRole = (req.user.role || '').toLowerCase();
        
        if (!lowerRoles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                error: `User role '${req.user.role}' is not authorized to access this route`
            });
        }
        next();
    };
};

module.exports = { verifyToken, authorize };
