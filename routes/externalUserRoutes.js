import express from 'express';
import { approveRejectUser, onboardUser, updateUser, deleteUser, enableDisableUser, getAllUsers, getAllUsersRequests } from '../controllers/externalUserController.js';



const router = express.Router();

router.post('/create', onboardUser);
router.post('/approve-reject/:id', approveRejectUser);
router.post('/update/:id', updateUser);
router.post('/delete/:id', deleteUser);
router.post('/enable-disable/:id', enableDisableUser);
router.get('/users', getAllUsers)
router.get('/user-requests', getAllUsersRequests)





export default router



