import express from 'express';
import { register, login, requestPasswordReset, resetPassword } from '../controllers/auth.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/request-password-reset', requestPasswordReset);
router.post('/reset-password/:token', resetPassword); // Ensure this route is defined

export default router;
