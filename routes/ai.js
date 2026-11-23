const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

const aiWorkflowCreator = require('../services/ai-workflow-creator-service');

router.use(verifyToken);

router.post('/correct', aiController.correctSentence);

router.post('/generate-workflow', authorize(ADMIN_HR_ROLES), (req, res) => {
    try {
        const { prompt, options } = req.body || {};
        if (!prompt) return res.status(400).json({ status: 'error', message: 'Prompt is required' });
        const result = aiWorkflowCreator.generateWorkflowFromPrompt(prompt, options);
        res.json({
            status: 'success',
            workflow: result.workflow,
            explanation: result.explanation,
            nodeChain: result.nodeChain,
            confidence: result.confidence
        });
    } catch (err) {
        res.status(400).json({ status: 'error', message: err.message });
    }
});

module.exports = router;
