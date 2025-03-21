import express from 'express';
import { createInstitution, getAllInstitutions, approveRejectInstitution, getAllAuthorisers, editInstitution, deleteInstitution } from '../controllers/institution.js';



const router = express.Router();

router.post('/add-institution', createInstitution);
router.put('/update-institution/:id', editInstitution);
router.get('/institutions', getAllInstitutions);
router.put('/approve-reject/:id', approveRejectInstitution);
router.get('/', getAllInstitutions);
router.get('/authorisers', getAllAuthorisers);
router.delete('/delete/:id', deleteInstitution);


export default router




