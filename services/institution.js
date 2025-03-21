import { sendEmail } from '../services/emailService.js';
import { upload } from '../services/uploadService.js';
import { institutionApprovalEmail, institutionStatusEmail } from '../services/emailTemplates.js';
import { db } from '../connect.js';
import dotenv from 'dotenv';

dotenv.config();



export const createInstitution = (req, res) => {
    upload.single('logo')(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        const { name, sector, rc_number, registered_address, link, authorizer_id } = req.body;
        const inputter_id = req.user?.id;

        if (!inputter_id) {
            return res.status(401).json({ error: 'Unauthorized: Missing user ID' });
        }

        const inputter_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const logo = req.file ? `${process.env.SERVER_URL}/uploads/${req.file.filename}` : null;

        // Fetch authorizer details (name and email)
        const authorizerQuery = `SELECT name, email FROM users WHERE id = ?`;

        db.query(authorizerQuery, [authorizer_id], async (err, authorizerResult) => {
            if (err) {
                return res.status(500).json({ error: 'Error fetching authorizer details' });
            }

            if (authorizerResult.length === 0) {
                return res.status(404).json({ error: 'Authorizer not found' });
            }

            const { name: authorizerName, email: authorizerEmail } = authorizerResult[0];

            // Insert institution into the database
            const query = `
                INSERT INTO Institutions (name, sector, rc_number, registered_address, logo, link, inputter_id, inputter_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.query(query, [name, sector, rc_number, registered_address, logo, link, inputter_id, inputter_date], async (err, result) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                // Generate email body using the template
                const emailBody = institutionApprovalEmail(name, sector, rc_number, registered_address, link, logo, authorizerName);

                const emailSent = await sendEmail(authorizerEmail, 'Institution Approval Request', emailBody);

                if (!emailSent) {
                    return res.status(500).json({ error: 'Institution created, but email sending failed.' });
                }

                res.status(201).json({
                    message: 'Institution created successfully! Email sent to the authorizer.',
                    id: result.insertId,
                    logo
                });
            });
        });
    });
};



/**
 * Approve or reject an institution and notify the inputter via email.
 */


// export const approveRejectInstitution = async (req, res) => {
//     const { status } = req.body;
//     const id = req.params.id;

//     if (!id || !status) {
//         return res.status(400).json({ error: 'Missing required fields: id and status' });
//     }

//     const getInstitutionQuery = `SELECT * FROM Institutions WHERE id = ?`;
//     db.query(getInstitutionQuery, [id], (err, result) => {
//         if (err) {
//             return res.status(500).json({ error: err.message });
//         }

//         if (result.length === 0) {
//             return res.status(404).json({ error: 'Institution not found' });
//         }

//         const { inputter_id, name: institutionName } = result[0];

//         // Update the institution status in the database
//         const updateStatusQuery = `UPDATE Institutions SET status = ? WHERE id = ?`;
//         db.query(updateStatusQuery, [status, id], (updateErr, updateResult) => {
//             if (updateErr) {
//                 return res.status(500).json({ error: updateErr.message });
//             }

//             const getInputterQuery = `SELECT email, name FROM users WHERE id = ?`;
//             db.query(getInputterQuery, [inputter_id], async (userErr, userResult) => {
//                 if (userErr) {
//                     return res.status(500).json({ error: userErr.message });
//                 }

//                 if (userResult.length === 0) {
//                     return res.status(404).json({ error: 'Inputter not found' });
//                 }

//                 const { name: fullName, email } = userResult[0];

//                 // Get email subject and body from the template
//                 const { subject, emailBody } = institutionStatusEmail(status, fullName, institutionName);

//                 // Send email to inputter
//                 const emailSent = await sendEmail(email, subject, emailBody);

//                 const newStatus = status === 1 ? 'Approved' : 'Rejected';

//                 if (!emailSent) {
//                     return res.status(500).json({ error: 'Institution status updated, but email sending failed.' });
//                 }

//                 res.json({ message: `Institution ${newStatus} successfully! Email sent to inputter.` });
//             });
//         });
//     });
// };



export const approveRejectInstitution = async (req, res) => {
    const { status, reason } = req.body;
    const id = req.params.id;

    if (!id || !status) {
        return res.status(400).json({ error: 'Missing required fields: id and status' });
    }

    // If status is "Rejected" (2), a rejection reason must be provided
    if (status === 2 && !reason) {
        return res.status(400).json({ error: 'Rejection reason is required when rejecting an institution.' });
    }

    const getInstitutionQuery = `SELECT * FROM Institutions WHERE id = ?`;
    db.query(getInstitutionQuery, [id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (result.length === 0) {
            return res.status(404).json({ error: 'Institution not found' });
        }

        const { inputter_id, name: institutionName } = result[0];

        // Update the institution status and rejection reason if applicable
        const updateStatusQuery = status === 2
            ? `UPDATE Institutions SET status = ?, rejection_reason = ? WHERE id = ?`
            : `UPDATE Institutions SET status = ? WHERE id = ?`;

        const updateValues = status === 2 ? [status, reason, id] : [status, id];

        db.query(updateStatusQuery, updateValues, (updateErr, updateResult) => {
            if (updateErr) {
                return res.status(500).json({ error: updateErr.message });
            }

            const getInputterQuery = `SELECT email, name FROM users WHERE id = ?`;
            db.query(getInputterQuery, [inputter_id], async (userErr, userResult) => {
                if (userErr) {
                    return res.status(500).json({ error: userErr.message });
                }

                if (userResult.length === 0) {
                    return res.status(404).json({ error: 'Inputter not found' });
                }

                const { name: fullName, email } = userResult[0];

                // Get email subject and body from the template
                const { subject, emailBody } = institutionStatusEmail(status, fullName, institutionName, reason);

                // Send email to inputter
                const emailSent = await sendEmail(email, subject, emailBody);

                const newStatus = status === 1 ? 'Approved' : 'Rejected';

                if (!emailSent) {
                    return res.status(500).json({ error: 'Institution status updated, but email sending failed.' });
                }

                res.json({ message: `Institution ${newStatus} successfully! Email sent to inputter.` });
            });
        });
    });
};



// Get all institutions

export const getAllInstitutions = (req, res) => {
    const query = 'SELECT * FROM Institutions';

    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
};



// Get all Authorisers
export const getAllAuthorisers = (req, res) => {
    const query = `
        SELECT u.id, u.name, u.email 
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        WHERE r.name = 'Super_Admin_Authoriser'
    `;

    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
};




// Get a single institution

export const getInstitutionById = (req, res) => {
    const { id } = req.params;

    const query = 'SELECT * FROM Institutions WHERE id =?';

    db.query(query, [id], (err, result) => {
        if (err) {
            return res.status(404).json({ error: 'Institution not found' });
        }
        res.json(result[0]);
    });
};



// Update an institution

export const updateInstitution = (req, res) => {
    const { id } = req.params;
    const { name, institution, sector, rc_number, registered_address, logo, link } = req.body;

    const query = `
        UPDATE Institutions
        SET name =?, institution =?, sector =?, rc_number =?, registered_address =?, logo =?, link =?
        WHERE id =?
    `;

    db.query(query, [name, institution, sector, rc_number, registered_address, logo, link, id], (err, result) => {
        if (err) {
            return res.status(404).json({ error: 'Institution not found' });
        }
        res.json({ message: 'Institution updated successfully!' });
    });
};




// Delete an institution

export const deleteInstitution = (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM Institutions WHERE id =?';

    db.query(query, [id], (err, result) => {
        if (err) {
            return res.status(404).json({ error: 'Institution not found' });
        }
        res.json({ message: 'Institution deleted successfully!' });
    });
};

