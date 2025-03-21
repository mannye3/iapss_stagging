import express from 'express';
//import { register, login, requestPasswordReset, resetPassword } from '../controllers/auth.js';
import { getRoles, addRole, editRole, deleteRole } from '../controllers/roleController.js';

const router = express.Router();

router.get('/', getRoles);
router.post('/add-role', addRole);
router.put('/:id', editRole);
router.delete('/:id', deleteRole);
// router.post('/request-password-reset', requestPasswordReset);
// router.post('/reset-password/:token', resetPassword); // Ensure this route is defined

export default router;
