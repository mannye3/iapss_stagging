import express from 'express';
import { approveRejectInstitution, createInstitution, deleteInstitution, editInstitution, enableDisableInstitution, createInstitution1, getAllInstitutions, getAllPendingInstitutions } from '../controllers/institutionController.js';




const router = express.Router();

router.post('/add-institution', createInstitution);
router.put('/approve-reject/:id', approveRejectInstitution);
router.put('/update/:id', editInstitution);
router.delete('/delete/:id', deleteInstitution);
router.post('/enable-disable/:id', enableDisableInstitution);
router.post('/create', createInstitution1)
router.get('/', getAllInstitutions)
router.get('/requests', getAllPendingInstitutions);




export default router



