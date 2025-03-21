import { sendEmail } from '../services/emailService.js';
import { upload } from '../services/uploadService.js';
import { institutionApprovalEmail, institutionStatusEmail, institutionApprovalUpdateEmail, publicationApprovalEmail } from '../services/emailTemplates.js';
import { db, query } from '../connect.js';
import dotenv from 'dotenv';

dotenv.config();





export const createInstitution = (req, res) => {
    upload.single("logo")(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        const { name, sector, rc_number, registered_address, link, authorizer_id } = req.body;
        const inputter_id = req.user?.id;


        if (!inputter_id) {
            return res.status(401).json({ error: "Unauthorized: Missing user ID" });
        }

        const inputter_date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const logo = req.file ? `${process.env.SERVER_URL}/uploads/${req.file.filename}` : null;

        try {
            // Fetch authorizer details (name and email)
            const authorizerQuery = `SELECT name, email FROM users WHERE id = ?`;
            const [authorizer] = await query(authorizerQuery, [authorizer_id]);

            if (!authorizer) {
                return res.status(404).json({ error: "Authorizer not found" });
            }

            const { name: authorizerName, email: authorizerEmail } = authorizer;

            // Insert into `institutions` table (Single Insertion)
            const insertInstitutionQuery = `
                INSERT INTO institutions (name, sector, rc_number, registered_address, logo, link, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')
            `;
            const institutionResult = await query(insertInstitutionQuery, [
                name,
                sector,
                rc_number,
                registered_address,
                logo,
                link,
                inputter_id,
                inputter_date,
            ]);

            const institution_id = institutionResult.insertId;



            // Insert into `pending_institutions` table (Single Insertion)
            const insertInstitutionPendingQuery = `
             INSERT INTO pending_institutions (institution_id,name, sector, rc_number, registered_address, logo, link, inputter_id, inputter_date, action_type, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,  'insert', 'pending')
         `;
            const institutionPendingResult = await query(insertInstitutionPendingQuery, [
                institution_id,
                name,
                sector,
                rc_number,
                registered_address,
                logo,
                link,
                inputter_id,
                inputter_date,
            ]);



            // Generate email body using the template
            const emailBody = institutionApprovalEmail(
                name,
                sector,
                rc_number,
                registered_address,
                link,
                logo,
                authorizerName
            );

            const emailSent = await sendEmail(authorizerEmail, "Institution Approval Request", emailBody);

            if (!emailSent) {
                return res.status(500).json({ error: "Institution created, but email sending failed." });
            }

            res.status(201).json({
                message: "Institution created successfully! Email sent to the authorizer.",
                status: 200,
                success: true,
                institution_id,
                logo,
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
};


export const editInstitution = (req, res) => {
    upload.single("logo")(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        const { name, sector, rc_number, registered_address, link, authorizer_id } = req.body;
        const inputter_id = req.user?.id;
        const id = req.params.id;

        if (!inputter_id) {
            return res.status(401).json({ error: "Unauthorized: Missing user ID" });
        }

        if (!id) {
            return res.status(400).json({ error: "Institution ID is required" });
        }

        const inputter_date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const logo = req.file ? `${process.env.SERVER_URL}/uploads/${req.file.filename}` : null;

        try {
            // Check if institution exists and get admin_status
            const [existingInstitution] = await query(
                "SELECT * FROM institutions WHERE id = ?",
                [id]
            );

            if (!existingInstitution) {
                return res.status(404).json({ error: "Institution not found" });
            }

            // Check admin_status before allowing edit
            if (existingInstitution.admin_status === 0) {
                return res.status(403).json({
                    error: "Cannot edit this institution while a previous request is pending"
                });
            }

            // Fetch authorizer details
            const [authorizer] = await query(
                "SELECT name, email FROM users WHERE id = ?",
                [authorizer_id]
            );

            if (!authorizer) {
                return res.status(404).json({ error: "Authorizer not found" });
            }

            const { name: authorizerName, email: authorizerEmail } = authorizer;

            // Update admin_status to 0 in institutions table
            await query(
                "UPDATE institutions SET admin_status = 0 WHERE id = ?",
                [id]
            );

            // Insert into pending_institutions table
            const insertPendingQuery = `
                INSERT INTO pending_institutions (
                    institution_id, name, sector, rc_number, registered_address, 
                    logo, link, inputter_id, inputter_date, action_type, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'edit', 'pending')
            `;
            await query(insertPendingQuery, [
                id,
                name,
                sector,
                rc_number,
                registered_address,
                logo || existingInstitution.logo, // Use new logo if provided, otherwise keep existing
                link,
                inputter_id,
                inputter_date
            ]);

            // Generate and send email
            const emailBody = institutionApprovalUpdateEmail(
                name,
                sector,
                rc_number,
                registered_address,
                link,
                logo || existingInstitution.logo,
                authorizerName
            );

            const emailSent = await sendEmail(
                authorizerEmail,
                "Institution Update Approval Request",
                emailBody
            );

            if (!emailSent) {
                return res.status(500).json({
                    error: "Institution update request created, but email sending failed."
                });
            }

            res.status(200).json({
                message: "Institution update request created successfully! Email sent to the authorizer.",
                status: 200,
                success: true,
                institution_id: id
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
};






//delete user

export const deleteInstitution = async (req, res, next) => {
    try {
        const id = req.params.id;
        const inputter_id = req.user?.id;
        const inputter_date = new Date();
        const { authorizer_id } = req.body;

        if (!authorizer_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        // Get the institution
        const [institution] = await query(`SELECT * FROM institutions WHERE id = ?`, [id]);
        if (!institution) {
            return res.status(404).json({ error: "Institution not found." });
        }


        if (institution.admin_status === 0) {
            return res.status(403).json({
                error: "Cannot delete this institution while a previous request is pending"
            });
        }

        // Update institutions table
        await query(`UPDATE institutions SET admin_status = 0 WHERE id = ?`, [id]);

        // Insert into pending_institutions table
        const insertQuery = `
            INSERT INTO pending_institutions (institution_id, inputter_id, inputter_date, action_type, status)
            VALUES (?, ?, ?, 'delete', 'pending')
        `;
        await query(insertQuery, [institution.id, inputter_id, inputter_date]);

        // Fetch authorizer email
        const authorizerQuery = `SELECT email FROM users WHERE id = ?`;
        const [authorizer] = await query(authorizerQuery, [authorizer_id]);

        if (authorizer) {
            const subject = "Institution Deletion Approval Required";
            const emailBody = `You have been selected as the authorizer for the deletion of institution: ${institution.name}. Please review the request.`;
            await sendEmail(authorizer.email, subject, emailBody);
        }

        res.json({
            message: "Institution deletion request sent for approval.", status: 200,
            success: true
        });
    } catch (error) {
        next(error);
    }
};



export const enableDisableInstitution = async (req, res, next) => {
    try {
        const id = req.params.id;
        const inputter_id = req.user?.id;
        const inputter_date = new Date();
        const { authorizer_id, action_type } = req.body;


        if (!authorizer_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }


        // Get the pending request
        const [institution] = await query(`SELECT * FROM institutions WHERE id = ?`, [id]);
        if (!institution) {
            return res.status(404).json({ error: "institutions not found." });
        }


        if (institution.admin_status === 0) {
            return res.status(403).json({
                error: "Cannot enable or disable this institution while a previous request is pending"
            });
        }


        if (action_type === "disable") {

            // Update  users table
            await query(`UPDATE institutions SET admin_status = 0 WHERE id = ?`, [id]);


            // Insert into pending_users table
            const insertQuery = `
            INSERT INTO pending_institutions (institution_id, inputter_id, inputter_date, action_type, status)
            VALUES (?, ?, ?, 'disable', 'pending')
        `;
            await query(insertQuery, [institution.id, inputter_id, inputter_date]);

        }




        if (action_type === "enable") {

            // Update  users table
            await query(`UPDATE institutions SET admin_status = 0 WHERE id = ?`, [id]);


            // Insert into pending_users table
            const insertQuery = `
            INSERT INTO pending_institutions (institution_id, inputter_id, inputter_date, action_type, status)
            VALUES (?, ?, ?, 'enable', 'pending')
         `;
            await query(insertQuery, [institution.id, inputter_id, inputter_date]);

        }





        // Fetch authorizer email
        const authorizerQuery = `SELECT email FROM users WHERE id = ?`;
        const [authorizer] = await query(authorizerQuery, [authorizer_id]);

        if (authorizer) {
            const subject = "Approval Required: New User Onboarding";
            const emailBody = `You have been selected as the authorizer for ${authorizerQuery.name}'s onboarding. Please review the request.`;
            await sendEmail(authorizer.email, subject, emailBody);
        }

        res.json({
            message: "User onboarding request sent for approval.", status: 200,
            success: true
        });
    } catch (error) {
        next(error);
    }
};



// Approve or reject user request
export const approveRejectInstitution = async (req, res, next) => {
    try {
        const { status, reason } = req.body;
        const id = req.params.id;
        const authorizer_id = req.user?.id;
        const updated_at = new Date();

        if (!status) {
            return res.status(400).json({ error: "Status is required." });
        }

        // Get the pending request and check status
        const [pendingInstitution] = await query(
            `SELECT * FROM pending_institutions WHERE id = ? AND status = 'pending'`,
            [id]
        );

        if (!pendingInstitution) {
            return res.status(404).json({
                error: "Request not found or has already been processed"
            });
        }

        const { action_type, inputter_id } = pendingInstitution;

        if (status === "approved") {
            if (action_type === "insert") {
                // Insert new user into the `institutions` table and get the user ID
                const insertInstitutionResult = await query(
                    `UPDATE institutions SET status = ?, admin_status = 1 WHERE id = ?`,
                    [status, pendingInstitution.institution_id]
                );

                const userResult = await query(`SELECT email, name FROM users WHERE id = ?`, [inputter_id]);

                if (userResult.length === 0) {
                    return next({ statusCode: 404, message: "Inputter not found" });
                }

                const { name: fullName, email } = userResult[0];
                const institutionName = pendingInstitution.name;

                // Get email subject and body from the template
                const { subject, emailBody } = institutionStatusEmail(status, fullName, institutionName, reason);

                // Send email to inputter
                const emailSent = await sendEmail(email, subject, emailBody);

                if (!emailSent) {
                    return next({ statusCode: 404, message: "Institution status updated, but email sending failed." });
                }
            } else if (action_type === "edit") {

                const updateUserResult = await query(
                    `UPDATE institutions SET name = ?, sector = ?, rc_number = ?, registered_address = ?, link = ?, status = ?, logo = ? WHERE id = ?`,
                    [pendingInstitution.name, pendingInstitution.sector, pendingInstitution.rc_number, pendingInstitution.registered_address, pendingInstitution.link, status, pendingInstitution.logo, pendingInstitution.institution_id]
                );

                const userResult = await query(`SELECT email, name FROM users WHERE id = ?`, [inputter_id]);

                if (userResult.length === 0) {
                    return next({ statusCode: 404, message: "Inputter not found" });
                }

                const { name: fullName, email } = userResult[0];
                const institutionName = pendingInstitution.name;

                // Get email subject and body from the template
                const { subject, emailBody } = institutionStatusEmail(status, fullName, institutionName, reason);

                // Send email to inputter
                const emailSent = await sendEmail(email, subject, emailBody);

                if (!emailSent) {
                    return next({ statusCode: 404, message: "Institution status updated, but email sending failed." });
                }


            } else if (action_type === "delete") {
                // Soft delete user (or permanently delete if required)
                await query(`UPDATE institutions SET is_active = 0, admin_status= 1, deleted_at = ? WHERE id = ?`, [updated_at, pendingInstitution.institution_id]);
            }

            else if (action_type === "disable") {
                await query(`UPDATE institutions SET is_active =0, admin_status= 1  WHERE id = ?`, [pendingInstitution.institution_id]);
            }


            else if (action_type === "enable") {
                await query(`UPDATE users institutions is_active = 1, admin_status= 1  WHERE id = ?`, [pendingInstitution.institution_id]);
            }
        }

        if (status === "rejected") {
            if (!reason) {
                return res.status(400).json({ error: "Rejection reason is required." });
            }
        }

        // Update pending_users table
        await query(
            `UPDATE pending_institutions SET status = ?, authoriser_id = ?, updated_at = ?, reason = ? WHERE id = ?`,
            [status, authorizer_id, updated_at, reason, id]
        );

        // Notify inputter
        const [inputter] = await query(`SELECT email FROM users WHERE id = ?`, [inputter_id]);
        if (inputter) {
            await sendEmail(inputter.email, "User Request Update", `Your request for ${pendingInstitution.name} (${action_type}) was ${status}. Reason: ${reason || "N/A"}`);
        }

        res.json({
            message: `User ${status} successfully!`, status: 200,
            success: true
        });
    } catch (error) {
        next(error);
    }
};




export const createInstitution1 = (req, res) => {
    const authorizer_id = 54

    const authorizerQuery = `SELECT name, email FROM users WHERE id = ?`;
    const [authorizer] = query(authorizerQuery, [authorizer_id]);

    if (!authorizer) {
        return res.status(404).json({ error: "Authorizer not found" });
    }

    if (authorizer) {
        const subject = "Approval Required: New User Onboarding";
        const emailBody = `You have been selected as the authorizer for ${authorizer.name}'s onboarding. Please review the request.`;
        sendEmail(authorizer.email, subject, emailBody);
    }



    upload.single("publication_doc")(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        const { title, institution_id, authorizer_id } = req.body;
        const inputter_id = req.user?.id;
        const user_id = req.user?.id;


        if (!inputter_id) {
            return res.status(401).json({ error: "Unauthorized: Missing user ID" });
        }

        const inputter_date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const fileUrl = req.file ? `${process.env.SERVER_URL}/uploads/${req.file.filename}` : null;



        try {
            // Fetch authorizer details (name and email)


            const { name: authorizerName, email: authorizerEmail } = authorizer;

            // Insert into `institutions` table (Single Insertion)
            const insertPublicationQuery = `
                INSERT INTO publications (title, institution_id, user_id, publication_doc, status)
                VALUES (?, ?, ?, ?, 'pending')
            `;

            const publicationResult = await query(insertPublicationQuery, [
                title, institution_id, user_id, fileUrl
            ]);

            const publications_id = publicationResult.insertId;



            const insertPendingQuery = `
            INSERT INTO pending_publications (publications_id, user_id, institution_id, title, publication_doc, inputter_id, inputter_date, status, action_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'insert')
        `;

            await query(insertPendingQuery, [
                publications_id,
                user_id,
                institution_id,
                title,
                fileUrl,
                inputter_id,
                inputter_date
            ]);



            // Generate email body using the template
            // const emailBody = publicationApprovalEmail(

            //     authorizerName
            // );
            console.log(authorizer.email)
            // const emailSent = await sendEmail(authorizer.email, "Institution Approval Request", emailBody);

            // if (!emailSent) {
            //     return res.status(500).json({ error: "Institution created, but email sending failed." });
            // }

            res.status(201).json({
                message: "Institution created successfully! Email sent to the authorizer.",
                status: 200,
                success: true,

            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
};





export const getAllInstitutions = async (req, res, next) => {
    try {
        const Institutions = await query(`
            SELECT * FROM institutions
            ORDER BY created_at DESC
        `);

        res.status(200).json({
            message: "Institutions retrieved successfully",
            status: 200,
            success: true,
            Institutions

        });
    } catch (error) {
        console.error("Error fetching Institutions:", error);
        // return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};







export const getAllPendingInstitutions = async (req, res, next) => {
    try {
        const Institutions = await query(`
            SELECT * FROM pending_institutions
            ORDER BY created_at DESC
        `);

        res.status(200).json({
            message: "Institutions request retrieved successfully",
            status: 200,
            success: true,
            Institutions

        });
    } catch (error) {
        console.error("Error fetching Institutions:", error);
        // return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};
