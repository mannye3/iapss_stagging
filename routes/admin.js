import express from 'express';
import { onboardUser, onboardExternalUser, initiateAccountActivation, authorizeAccountActivation } from '../controllers/adminController.js';
import { isAdmin } from '../middlewares/adminMiddleware.js';
import { verifyToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/onboard', verifyToken, isAdmin, onboardUser);
router.post('/add-user', onboardUser);
router.post('/add-external-user', onboardExternalUser);
router.post('/account-status', initiateAccountActivation);
router.post('/accept-reject', authorizeAccountActivation);

export default router;
