import express from 'express';

import { createPublication, approveRejectPublication, editPublication, getAllPendingPublications, getAllPublications, getUsersByInstitutionAndRole, deletePublication, enableDisablePublication, publishDraft, getAllApprovedPublications, getAllInstitutionsPublications, getAllGeneralPublications } from '../controllers/publicationController.js';




const router = express.Router();

router.post('/create', createPublication);
router.put('/approve-reject/:id', approveRejectPublication);
router.put('/update/:id', editPublication);
router.delete('/delete/:id', deletePublication);
router.post('/enable-disable/:id', enableDisablePublication);
router.get('/authorisers', getUsersByInstitutionAndRole)
router.get('/', getAllPublications)
router.get('/all-approved', getAllGeneralPublications);
router.get('/approved', getAllApprovedPublications);
router.get('/requests', getAllPendingPublications);
router.put('/publish-draft/:id', publishDraft);
router.get('/institutions', getAllInstitutionsPublications);




export default router



