import express from 'express';
import { getAdminAuthorisers } from '../controllers/userController.js';

const router = express.Router();



router.get('/authorisers', getAdminAuthorisers)


export default router



