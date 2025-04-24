import { sendEmail } from '../services/emailService.js';
import { upload } from '../services/uploadService.js';
import { institutionStatusEmail, institutionApprovalUpdateEmail, publicationApprovalEmail } from '../services/emailTemplates.js';
import { db, query } from '../connect.js';
import ErrorResponse from "../middlewares/errorMiddleware.js";  // ✅ Correct import



import dotenv from 'dotenv';


dotenv.config();





export const createPublication = (req, res) => {
    upload.single("publication_doc")(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        const { title, authorizer_id, content, isDraft } = req.body;
        const inputter_id = req.user?.id;
        const user_id = req.user?.id;

        if (!inputter_id) {
            return res.status(401).json({ error: "Unauthorized: Missing user ID" });
        }

        const inputter_date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const fileUrl = req.file ? `${process.env.SERVER_URL}/uploads/${req.file.filename}` : null;

        try {
            // Get the user's institution
            const userQuery = `SELECT institution FROM users WHERE id = ?`;
            const [user] = await query(userQuery, [user_id]);

            if (!user) {
                return res.status(404).json({ error: "User institution not found" });
            }

            let authorizerName = null, authorizerEmail = null;

            // Check if the publication is NOT a draft (i.e., it's pending and requires authorization)
            if (isDraft == "0") {
                const authorizerQuery = `SELECT name, email FROM users WHERE id = ?`;
                const [authorizer] = await query(authorizerQuery, [authorizer_id]);

                if (!authorizer) {
                    return res.status(404).json({ error: "Authorizer not found" });
                }
                authorizerName = authorizer.name;
                authorizerEmail = authorizer.email;
            }

            // Insert publication
            const insertPublicationQuery = `
                INSERT INTO publications (title, content, user_id, publication_doc, institution_id, status)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            const publicationResult = await query(insertPublicationQuery, [
                title,
                content,
                user_id,
                fileUrl,
                user.institution,
                isDraft == "1" ? "draft" : "pending"
            ]);

            const publications_id = publicationResult.insertId;

            // If the publication is pending, add it to pending_publications and send email
            if (isDraft == "0") {
                const insertPendingPublicationQuery = `
                    INSERT INTO pending_publications (publications_id, user_id, title, content, publication_doc, institution_id, inputter_id, inputter_date, status, action_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'insert')
                `;
                await query(insertPendingPublicationQuery, [
                    publications_id,
                    user_id,
                    title,
                    content,
                    fileUrl,
                    user.institution,
                    inputter_id,
                    inputter_date
                ]);

                // Send email only if not a draft
                const emailBody = publicationApprovalEmail(title, user_id, fileUrl, authorizerName);
                const emailSent = await sendEmail(authorizerEmail, "Publication Approval Request", emailBody);

                if (!emailSent) {
                    return res.status(500).json({ error: "Publication created, but email sending failed." });
                }
            }

            res.status(201).json({
                message: isDraft == "1"
                    ? "Publication saved as draft successfully!"
                    : "Publication created successfully! Email sent to the authorizer.",
                status: 200,
                success: true,
                fileUrl,
                publications_id
            });
        } catch (error) {
            console.error("Error creating publication:", error);
            res.status(500).json({ error: error.message || "Internal server error" });
        }
    });
};


export const editPublication = (req, res) => {
    upload.single("publication_doc")(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        const { title, authorizer_id } = req.body;
        const inputter_id = req.user?.id;
        const user_id = req.user?.id;
        const id = req.params.id;

        if (!inputter_id) {
            return res.status(401).json({ error: "Unauthorized: Missing user ID" });
        }

        if (!id) {
            return res.status(400).json({ error: "Publication ID is required" });
        }

        const inputter_date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const publication_doc = req.file ? `${process.env.SERVER_URL}/uploads/${req.file.filename}` : null;

        try {
            // Check if publication exists and get admin_status
            const [existingPublication] = await query(
                "SELECT * FROM publications WHERE id = ?",
                [id]
            );

            if (!existingPublication) {
                return res.status(404).json({ error: "Publication not found" });
            }

            // Check admin_status before allowing edit
            if (existingPublication.admin_status === 0) {
                return res.status(403).json({
                    error: "Cannot edit this publication while a previous request is pending"
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

            // Update admin_status to 0 in publications table
            await query(
                "UPDATE publications SET admin_status = 0 WHERE id = ?",
                [id]
            );

            // Insert into pending_publications table
            const insertPendingQuery = `
                INSERT INTO pending_publications (publications_id, user_id, title, content, publication_doc, institution_id, inputter_id, inputter_date, status, action_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'edit')
            `;
            await query(insertPendingQuery, [
                id,
                user_id,
                title,
                content,
                publication_doc || existingPublication.publication_doc,
                existingPublication.institution_id,
                inputter_id,
                inputter_date
            ]);

            // Generate and send email
            const emailBody = publicationApprovalEmail(
                title, user_id, publication_doc || existingPublication.publication_doc, authorizerName
            );

            const emailSent = await sendEmail(
                authorizerEmail,
                "Publication Update Approval Request",
                emailBody
            );

            if (!emailSent) {
                return res.status(500).json({
                    error: "Publication update request created, but email sending failed."
                });
            }

            res.status(200).json({
                message: "Publication update request created successfully! Email sent to the authorizer.",
                status: 200,
                success: true,
                publications_id: id
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
};


export const deletePublication = async (req, res, next) => {
    try {
        const id = req.params.id;
        const inputter_id = req.user?.id;
        const inputter_date = new Date();
        const { authorizer_id } = req.body;

        if (!authorizer_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        // Get the institution
        const [publication] = await query(`SELECT * FROM publications WHERE id = ?`, [id]);
        if (!publication) {
            return res.status(404).json({ error: "Publication not found." });
        }


        if (publication.admin_status === 0) {
            return res.status(403).json({
                error: "Cannot delete this publication while a previous request is pending"
            });
        }

        // Update institutions table
        await query(`UPDATE publications SET admin_status = 0 WHERE id = ?`, [id]);

        // Insert into pending_institutions table
        const insertQuery = `
            INSERT INTO pending_publications (publications_id, inputter_id, inputter_date, action_type, status)
            VALUES (?, ?, ?, 'delete', 'pending')
        `;
        await query(insertQuery, [id, inputter_id, inputter_date]);

        // Fetch authorizer email
        const authorizerQuery = `SELECT email FROM users WHERE id = ?`;
        const [authorizer] = await query(authorizerQuery, [authorizer_id]);

        if (authorizer) {
            const subject = "Publication Deletion Approval Required";
            const emailBody = `You have been selected as the authorizer for the deletion of publication: ${publication.title}. Please review the request.`;
            await sendEmail(authorizer.email, subject, emailBody);
        }

        res.json({
            message: "Publication deletion request sent for approval.", status: 200,
            success: true
        });
    } catch (error) {
        next(error);
    }
};



export const enableDisablePublication = async (req, res, next) => {
    try {
        const id = req.params.id;
        const inputter_id = req.user?.id;
        const inputter_date = new Date();
        const { authorizer_id, action_type } = req.body;


        if (!authorizer_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }


        // Get the pending request
        const [publication] = await query(`SELECT * FROM publications WHERE id = ?`, [id]);
        if (!publication) {
            return res.status(404).json({ error: "publications not found." });
        }


        if (publication.admin_status === 0) {
            return res.status(403).json({
                error: "Cannot enable or disable this publication while a previous request is pending"
            });
        }


        if (action_type === "disable") {

            // Update  users table
            await query(`UPDATE publications SET admin_status = 0 WHERE id = ?`, [id]);


            // Insert into pending_users table
            const insertQuery = `
            INSERT INTO pending_publications (publications_id, inputter_id, inputter_date, action_type, status)
            VALUES (?, ?, ?, 'disable', 'pending')
        `;
            await query(insertQuery, [publication.id, inputter_id, inputter_date]);

        }



        if (action_type === "enable") {

            // Update  users table
            await query(`UPDATE institutions SET admin_status = 0 WHERE id = ?`, [id]);


            // Insert into pending_users table
            const insertQuery = `
            INSERT INTO pending_publications (publications_id, inputter_id, inputter_date, action_type, status)
            VALUES (?, ?, ?, 'enable', 'pending')
        `;
            await query(insertQuery, [publication.id, inputter_id, inputter_date]);

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
            message: "Publication request sent for approval.", status: 200,
            success: true
        });
    } catch (error) {
        next(error);
    }
};



// Approve or reject user request
export const approveRejectPublication = async (req, res, next) => {
    try {
        const { status, reason } = req.body;
        const id = req.params.id;
        const authorizer_id = req.user?.id;
        const updated_at = new Date();

        if (!status) {
            return res.status(400).json({ error: "Status is required." });
        }

        // Get the pending request and check status
        const [pendingPublication] = await query(
            `SELECT * FROM pending_publications WHERE id = ? AND status = 'pending'`,
            [id]
        );

        if (!pendingPublication) {
            return res.status(404).json({
                error: "Request not found or has already been processed"
            });
        }

        const { action_type, inputter_id } = pendingPublication;

        if (status === "approved") {
            if (action_type === "insert") {
                // Insert new user into the `institutions` table and get the user ID
                const insertPublicationResult = await query(
                    `UPDATE publications SET status = ?, admin_status = 1 WHERE id = ?`,
                    [status, pendingPublication.publication_id]
                );

                const userResult = await query(`SELECT email, name FROM users WHERE id = ?`, [inputter_id]);

                if (userResult.length === 0) {
                    return next({ statusCode: 404, message: "Inputter not found" });
                }

                const { name: fullName, email } = userResult[0];
                const institutionName = pendingPublication.name;

                // Get email subject and body from the template
                const { subject, emailBody } = institutionStatusEmail(status, fullName, institutionName, reason);

                // Send email to inputter
                const emailSent = await sendEmail(email, subject, emailBody);

                if (!emailSent) {
                    return next({ statusCode: 404, message: "Institution status updated, but email sending failed." });
                }
            } else if (action_type === "edit") {

                const updateUserResult = await query(
                    `UPDATE publications SET title = ?, publication_doc = ?, institution_id = ?, status = ? WHERE id = ?`,
                    [pendingPublication.title, pendingPublication.publication_doc, pendingPublication.institution_id, status, pendingPublication.publication_id]
                );


                const userResult = await query(`SELECT email, name FROM users WHERE id = ?`, [inputter_id]);

                if (userResult.length === 0) {
                    return next({ statusCode: 404, message: "Inputter not found" });
                }

                const { name: fullName, email } = userResult[0];
                const institutionName = pendingPublication.name;

                // Get email subject and body from the template
                const { subject, emailBody } = institutionStatusEmail(status, fullName, institutionName, reason);

                // Send email to inputter
                const emailSent = await sendEmail(email, subject, emailBody);

                if (!emailSent) {
                    return next({ statusCode: 404, message: "Institution status updated, but email sending failed." });
                }


            } else if (action_type === "delete") {
                // Soft delete user (or permanently delete if required)
                //console.log(pendingPublication.publication_id)
                await query(`UPDATE publications SET is_active = 0, admin_status= 1, deleted_at = ? WHERE id = ?`, [updated_at, pendingPublication.publications_id]);
            }

            else if (action_type === "disable") {
                await query(`UPDATE publications SET is_active =0, admin_status= 1  WHERE id = ?`, [pendingPublication.publication_id]);
            }


            else if (action_type === "enable") {
                await query(`UPDATE users publications is_active = 1, admin_status= 1  WHERE id = ?`, [pendingPublication.publication_id]);
            }
        }

        if (status === "rejected") {
            if (!reason) {
                return res.status(400).json({ error: "Rejection reason is required." });
            }
        }

        // Update pending_users table
        await query(
            `UPDATE pending_publications SET status = ?, authorizer_id = ?, updated_at = ?, reason = ? WHERE id = ?`,
            [status, authorizer_id, updated_at, reason, id]
        );

        // Notify inputter
        const [inputter] = await query(`SELECT email FROM users WHERE id = ?`, [inputter_id]);
        if (inputter) {
            await sendEmail(inputter.email, "User Request Update", `Your request for ${pendingPublication.name} (${action_type}) was ${status}. Reason: ${reason || "N/A"}`);
        }

        res.json({
            message: `Publication ${status} successfully!`, status: 200,
            success: true
        });
    } catch (error) {
        next(error);
    }
};









export const getAllApprovedPublications = async (req, res, next) => {
    try {
        const publications = await query(`
            SELECT 
                p.id, 
                p.title, 
                p.user_id, 
                u.name AS user_name,
                p.publication_doc,
                p.content,
                p.status, 
                p.created_at,
                i.name AS institution_name
            FROM publications p
            LEFT JOIN institutions i ON p.institution_id = i.id
            LEFT JOIN users u ON p.user_id = u.id
            WHERE p.status = 'approved'
            ORDER BY p.created_at DESC
        `);

        res.status(200).json({
            message: "Publications retrieved successfully",
            status: 200,
            success: true,
            publications
        });
    } catch (error) {
        console.error("Error fetching publications:", error);
        return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};





export const getAllPublications = async (req, res, next) => {
    try {
        const publications = await query(`
            SELECT 
                p.id, 
                p.title, 
                p.user_id, 
                u.name AS user_name,
                p.publication_doc, 
                p.status, 
                p.created_at,
                i.name AS institution_name,
                i.id AS institution_id
            FROM publications p
            LEFT JOIN institutions i ON p.institution_id = i.id
            LEFT JOIN users u ON p.user_id = u.id
            ORDER BY p.created_at DESC
        `);

        res.status(200).json({
            message: "Publications retrieved successfully",
            status: 200,
            success: true,
            publications
        });
    } catch (error) {
        console.error("Error fetching publications:", error);
        return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};







export const getAllPendingPublications = async (req, res, next) => {
    try {
        const Publications = await query(`

            SELECT 
                p.id, 
                p.title, 
                p.user_id, 
                u.name AS user_name,
                p.publication_doc, 
                p.status, 
                p.created_at,
                i.name AS institution_name
            FROM pending_publications p
            LEFT JOIN institutions i ON p.institution_id = i.id
            LEFT JOIN users u ON p.user_id = u.id
            ORDER BY p.created_at DESC


           
        `);

        res.status(200).json({
            message: "Publications request retrieved successfully",
            status: 200,
            success: true,
            Publications

        });
    } catch (error) {
        console.error("Error fetching Publications:", error);
        // return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};







export const getUsersByInstitutionAndRole = async (req, res, next) => {
    try {
        const user_id = req.user?.id;

        if (!user_id) {
            return res.status(401).json({ error: "Unauthorized: Missing user ID" });
        }

        // Get the institution ID of the logged-in user
        const institutionQuery = `SELECT institution FROM users WHERE id = ?`;
        const institutionResult = await query(institutionQuery, [user_id]);

        if (institutionResult.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const institution_id = institutionResult[0].institution;

        console.log(institution_id)

        // Get users from the same institution or those with 'Institution_Authoriser' role
        const usersQuery = `
    SELECT users.id, users.name, users.email, users.institution, roles.name AS role
    FROM users
    LEFT JOIN user_roles ON users.id = user_roles.user_id
    LEFT JOIN roles ON user_roles.role_id = roles.id
    WHERE roles.name = 'Institution_Authoriser'  AND users.institution = ?
`;
        const users = await query(usersQuery, [institution_id]);

        return res.status(200).json({
            message: "Users retrieved successfully",
            status: 200,
            success: true,
            users
        });

    } catch (error) {
        console.error("Error fetching users:", error);
        return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};



export const getAllInstitutionsPublications = async (req, res, next) => {
    try {
        const publications = await query(`
            SELECT 
                p.id, 
                p.title, 
                p.user_id, 
                u.name AS user_name,
                p.publication_doc, 
                p.status, 
                p.created_at,
                i.name AS institution_name
            FROM publications p
            LEFT JOIN institutions i ON p.institution_id = i.id
            LEFT JOIN users u ON p.user_id = u.id
            WHERE u.institution = p.institution_id
            ORDER BY p.created_at DESC
        `);

        res.status(200).json({
            message: "Publications retrieved successfully",
            status: 200,
            success: true,
            publications
        });
    } catch (error) {
        console.error("Error fetching publications:", error);
        return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};



// New function to publish a draft
export const publishDraft = async (req, res) => {
    try {
        const { id } = req.params;
        const { authorizer_id } = req.body;
        const user_id = req.user?.id;

        // Check if publication exists and is a draft
        const [publication] = await query(
            "SELECT * FROM publications WHERE id = ? AND status = 'draft'",
            [id]
        );

        if (!publication) {
            return res.status(404).json({ error: "Draft publication not found" });
        }

        // Get authorizer details
        const [authorizer] = await query(
            "SELECT name, email FROM users WHERE id = ?",
            [authorizer_id]
        );

        if (!authorizer) {
            return res.status(404).json({ error: "Authorizer not found" });
        }

        // Update publication status
        await query(
            "UPDATE publications SET status = 'pending' WHERE id = ?",
            [id]
        );

        // Create pending publication record
        const inputter_date = new Date().toISOString().slice(0, 19).replace("T", " ");
        const insertPendingQuery = `
            INSERT INTO pending_publications (
                publications_id, user_id, title, content, publication_doc,
                institution_id, inputter_id, inputter_date, status, action_type
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'insert')
        `;
        await query(insertPendingQuery, [
            id,
            user_id,
            publication.title,
            publication.content,
            publication.publication_doc,
            publication.institution_id,
            user_id,
            inputter_date
        ]);

        // Send email
        const emailBody = publicationApprovalEmail(
            publication.title,
            user_id,
            publication.publication_doc,
            authorizer.name
        );

        const emailSent = await sendEmail(
            authorizer.email,
            "Publication Approval Request",
            emailBody
        );

        res.status(200).json({
            message: "Draft published successfully and sent for approval!",
            status: 200,
            success: true
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    }
};



export const getAllGeneralPublications = async (req, res, next) => {
    try {
        const publications = await query(`
    SELECT 
        *
    FROM publications 
    WHERE status = 'approved'
    ORDER BY created_at DESC
`);

        res.status(200).json({
            message: "Publications retrieved successfully",
            status: 200,
            success: true,
            publications
        });
    } catch (error) {
        console.error("Error fetching publications:", error);
        return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};

