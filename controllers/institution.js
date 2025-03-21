import { sendEmail } from '../services/emailService.js';
import { upload } from '../services/uploadService.js';
import { institutionApprovalEmail, institutionStatusEmail, institutionApprovalUpdateEmail } from '../services/emailTemplates.js';
import { db, query } from '../connect.js';
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




export const editInstitution = (req, res, next) => {
    upload.single("logo")(req, res, async (err) => {
        try {
            if (err) {
                return next({ statusCode: 400, message: err.message });
            }

            const { id } = req.params;
            const { name, sector, rc_number, registered_address, link, authorizer_id } = req.body;
            const inputter_id = req.user?.id;
            const status = "pending";

            if (!inputter_id) {
                return next({ statusCode: 401, message: "Unauthorized: Missing user ID" });
            }

            const logo = req.file ? `${process.env.SERVER_URL}/uploads/${req.file.filename}` : null;

            // Check if the institution exists
            const institutionResult = await query(`SELECT * FROM institutions WHERE id = ?`, [id]);

            if (institutionResult.length === 0) {
                return next({ statusCode: 404, message: "Institution not found" });
            }

            // Fetch authorizer details
            const authorizerResult = await query(`SELECT name, email FROM users WHERE id = ?`, [authorizer_id]);

            if (authorizerResult.length === 0) {
                return next({ statusCode: 404, message: "Authorizer not found" });
            }

            const { name: authorizerName, email: authorizerEmail } = authorizerResult[0];

            // Update institution in the database
            const result = await db.query(
                `UPDATE institutions SET name = ?, sector = ?, rc_number = ?, registered_address = ?, link = ?, status = ?, logo = COALESCE(?, logo) WHERE id = ?`,
                [name, sector, rc_number, registered_address, link, status, logo, id]
            );





            if (result.affectedRows === 0) {
                return next({ statusCode: 400, message: "No changes were made or institution not found" });
            }

            // Generate email body using the template
            const emailBody = institutionApprovalUpdateEmail(name, sector, rc_number, registered_address, link, logo, authorizerName);

            const emailSent = await sendEmail(authorizerEmail, "Institution Update Request", emailBody);

            if (!emailSent) {
                return next({ statusCode: 500, message: "Institution updated, but email sending failed." });
            }

            res.status(200).json({
                message: "Institution updated successfully! Email sent to the authorizer.",
                id,
                logo,
            });

        } catch (error) {
            next(error);
        }
    });
};




/**
 * Approve or reject an institution and notify the inputter via email.
 */

export const approveRejectInstitution = async (req, res, next) => {
    const { status, reason } = req.body;
    const id = req.params.id;
    const authoriser_id = req.user?.id;
    const authoriser_date = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
        // Input validation
        if (!id || !status) {

            return next({ statusCode: 400, message: "Missing required fields: id and status" });
        }

        // If status is "Rejected" (2), a rejection reason must be provided
        if (status === 'rejected' && !reason) {

            return next({ statusCode: 400, message: "Rejection reason is required when rejecting an institution." });

        }

        // Check if the institution exists
        const institutionResult = await query(`SELECT * FROM Institutions WHERE id = ?`, [id]);

        if (institutionResult.length === 0) {

            return next({ statusCode: 404, message: "Institution not found" });

        }

        const { inputter_id, name: institutionName } = institutionResult[0];

        // Update the institution status and rejection reason if applicable
        const updateStatusQuery = status === 'rejected'
            ? `UPDATE Institutions SET status = ?, rejection_reason = ?, authoriser_id = ?, authoriser_date =? WHERE id = ?`
            : `UPDATE Institutions SET status = ?, authoriser_id = ?, authoriser_date = ? WHERE id = ?`;

        const updateValues = status === 'rejected' ? [status, reason, authoriser_id, authoriser_date, id] : [status, authoriser_id, authoriser_date, id];

        await query(updateStatusQuery, updateValues);

        // Get inputter details
        const userResult = await query(`SELECT email, name FROM users WHERE id = ?`, [inputter_id]);

        if (userResult.length === 0) {
            return next({ statusCode: 404, message: "Inputter not found" });


        }

        const { name: fullName, email } = userResult[0];

        // Get email subject and body from the template
        const { subject, emailBody } = institutionStatusEmail(status, fullName, institutionName, reason);

        // Send email to inputter
        const emailSent = await sendEmail(email, subject, emailBody);

        const newStatus = status === 'approved' ? 'Approved' : 'Rejected';

        if (!emailSent) {

            return next({ statusCode: 404, message: "Institution status updated, but email sending failed." });

        }

        res.json({ message: `Institution ${newStatus} successfully! Email sent to inputter.` });

    } catch (error) {
        next(error); // Pass error to the next middleware
    }
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
    const { id } = req.params; // Institution ID

    const softDeleteQuery = `UPDATE institutions SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`;

    db.query(softDeleteQuery, [id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Error deleting institution' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Institution not found or already deleted' });
        }

        res.status(200).json({ message: 'Institution  deleted successfully!' });
    });
};

