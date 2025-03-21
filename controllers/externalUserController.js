import bcrypt from 'bcryptjs';

import { db, query } from '../connect.js';
import { sendEmail } from '../services/emailService.js';




const generateRandomPassword = (length = 8) => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        password += characters[randomIndex];
    }
    return password;
};


export const onboardUser = async (req, res, next) => {
    try {
        const { name, email, role, authorizer_id, institution } = req.body;
        const inputter_id = req.user?.id;
        const inputter_date = new Date();

        if (!name || !email || !role || !authorizer_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        // Check if user already exists in users table
        const [existingUser] = await query(
            "SELECT id FROM users WHERE email = ?",
            [email]
        );

        if (existingUser) {
            return res.status(400).json({ 
                error: "User with this email already exists" 
            });
        }

        // Check if there's a pending request for this email
        const [pendingRequest] = await query(
            "SELECT id FROM pending_users WHERE email = ? AND status = 'pending'",
            [email]
        );

        if (pendingRequest) {
            return res.status(400).json({ 
                error: "There is already a pending request for this email" 
            });
        }

        // Verify institution exists before proceeding
        const [institutionExists] = await query(
            "SELECT id FROM institutions WHERE id = ?",
            [institution]
        );

        if (!institutionExists) {
            return res.status(400).json({ 
                error: "Invalid institution ID provided" 
            });
        }

        // Insert into users table and get the inserted user ID
        const insertUserQuery = `
            INSERT INTO users (name, email, institution, user_type)
            VALUES (?, ?, ?, ?)
        `;
        const userResult = await query(insertUserQuery, [name, email, institution, 'external']);

        const user_id = userResult.insertId; // Get the generated user ID

        // Insert into pending_users table with the obtained user_id
        const insertPendingUserQuery = `
            INSERT INTO pending_users (user_id, name, email, role, institution, inputter_id, inputter_date, action_type, user_type, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'insert', 'external', 'pending')
        `;
        await query(insertPendingUserQuery, [user_id, name, email, role, institution, inputter_id, inputter_date]);

        // Send email to authorizer
        const authorizerQuery = `SELECT email FROM users WHERE id = ?`;
        const [authorizer] = await query(authorizerQuery, [authorizer_id]);

        if (authorizer) {
            const subject = "Approval Required: New User Onboarding";
            const emailBody = `You have been selected as the authorizer for ${name}'s onboarding. Please review the request.`;
            await sendEmail(authorizer.email, subject, emailBody);
        }

        res.json({
            message: "User onboarding request sent for approval.", status: 200,
            success: true, user_id
        });
    } catch (error) {
        next(error);
    }
};


export const updateUser = async (req, res, next) => {
    try {
        const { name, email, role, authorizer_id, institution } = req.body;
        const inputter_id = req.user?.id;
        const inputter_date = new Date();
        const user_id = req.params.id;

        if (!user_id, !name || !email || !role || !authorizer_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }


        const [existingUser] = await query(
            "SELECT * FROM users WHERE id = ?",
            [user_id]
        );

        if (!existingUser) {
            return res.status(404).json({ error: "User not found" });
        }

        // Check admin_status before allowing edit
        if (existingUser.admin_status === 0) {
            return res.status(403).json({
                error: "Cannot edit this user while a previous request is pending"
            });
        }



        // Update  users table
        await query(`UPDATE users SET admin_status = 0 WHERE id = ?`, [user_id]);


        const insertQuery = `
        INSERT INTO pending_users (user_id, name, email, role, institution, inputter_id, inputter_date, action_type, user_type, status)
        VALUES (?,?, ?, ?, ?, ?, ?, 'edit', 'external', 'pending')
    `;
        await query(insertQuery, [user_id, name, email, role, institution, inputter_id, inputter_date]);



        // Fetch authorizer email
        const authorizerQuery = `SELECT email FROM users WHERE id = ?`;
        const [authorizer] = await query(authorizerQuery, [authorizer_id]);

        if (authorizer) {
            const subject = "Approval Required: New User Onboarding";
            const emailBody = `You have been selected as the authorizer for ${name}'s onboarding. Please review the request.`;
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



//delete user

export const deleteUser = async (req, res, next) => {
    try {
        const id = req.params.id;
        const inputter_id = req.user?.id;
        const inputter_date = new Date();
        const { authorizer_id, institution } = req.body;


        if (!authorizer_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }


        // Get the pending request
        const [user] = await query(`SELECT * FROM users WHERE id = ?`, [id]);
        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }


        if (user.admin_status === 0) {
            return res.status(403).json({
                error: "Cannot delete this user while a previous request is pending"
            });
        }

        // Update  users table
        await query(`UPDATE users SET admin_status = 0 WHERE id = ?`, [id]);


        // Insert into pending_users table
        const insertQuery = `
            INSERT INTO pending_users (user_id, name, email, institution, inputter_id, inputter_date, action_type, user_type, status)
            VALUES (?,?, ?, ?, ?, ?, 'delete', 'external', 'pending')
        `;
        await query(insertQuery, [user.id, user.name, user.email, user.institution, inputter_id, inputter_date]);




        // Fetch authorizer email
        const authorizerQuery = `SELECT email FROM users WHERE id = ?`;
        const [authorizer] = await query(authorizerQuery, [authorizer_id]);

        if (authorizer) {
            const subject = "Approval Required: New User Onboarding";
            const emailBody = `You have been selected as the authorizer for ${user.name}'s onboarding. Please review the request.`;
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



export const enableDisableUser = async (req, res, next) => {
    try {
        const id = req.params.id;
        const inputter_id = req.user?.id;
        const inputter_date = new Date();
        const { authorizer_id, action_type } = req.body;


        if (!authorizer_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }


        // Get the pending request
        const [user] = await query(`SELECT * FROM users WHERE id = ?`, [id]);
        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }

        if (user.admin_status === 0) {
            return res.status(403).json({
                error: "Cannot disable or enable  this user while a previous request is pending"
            });
        }


        if (action_type === "disable") {

            // Update  users table
            await query(`UPDATE users SET admin_status = 0 WHERE id = ?`, [id]);


            // Insert into pending_users table
            const insertQuery = `
                INSERT INTO pending_users (user_id, name, email, institution, inputter_id, inputter_date, action_type, user_type, status)
                VALUES (?,?, ?, ?, ?, ?, 'disable', 'external', 'pending')
            `;
            await query(insertQuery, [user.id, user.name, user.email, user.institution, inputter_id, inputter_date]);

        }




        if (action_type === "enable") {

            // Update  users table
            await query(`UPDATE users SET admin_status = 0 WHERE id = ?`, [id]);


            // Insert into pending_users table
            const insertQuery = `
             INSERT INTO pending_users (user_id, name, email, institution, inputter_id, inputter_date, action_type, user_type, status)
             VALUES (?,?, ?, ?, ?, ?, 'enable', 'external', 'pending')
         `;
            await query(insertQuery, [user.id, user.name, user.email, user.institution, inputter_id, inputter_date]);

        }





        // Fetch authorizer email
        const authorizerQuery = `SELECT email FROM users WHERE id = ?`;
        const [authorizer] = await query(authorizerQuery, [authorizer_id]);

        if (authorizer) {
            const subject = "Approval Required: New User Onboarding";
            const emailBody = `You have been selected as the authorizer for ${user.name}'s onboarding. Please review the request.`;
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
export const approveRejectUser = async (req, res, next) => {
    try {
        const { status, reason } = req.body;
        const id = req.params.id;
        const authorizer_id = req.user?.id;
        const updated_at = new Date();

        if (!status) {
            return res.status(400).json({ error: "Status is required." });
        }

        // Get the pending request
        // const [pendingUser] = await query(`SELECT * FROM pending_users WHERE id = ?`, [id]);
        // if (!pendingUser) {
        //     return res.status(404).json({ error: "Request not found." });
        // }

        const [pendingUser] = await query(
            `SELECT * FROM pending_users WHERE id = ? AND status = 'pending'`,
            [id]
        );

        if (!pendingUser) {
            return res.status(404).json({
                error: "Request not found or has already been processed"
            });
        }




        const { action_type, inputter_id, email, name, role } = pendingUser;

        if (status === "approved") {
            if (action_type === "insert") {
                // Generate a random password for new users
                const plainPassword = generateRandomPassword();
                const hashedPassword = await bcrypt.hash(plainPassword, 10);


                // Insert new user into the `users` table and get the user ID
                const insertUserResult = await query(
                    `UPDATE users SET status = ?, password = ?, admin_status = 1 WHERE id = ?`,
                    [status, hashedPassword, pendingUser.user_id]
                );


                // const insertUserRegsult = await query(
                //     `INSERT INTO users (name, email, user_type, institution, password, status) 
                //      VALUES (?, ?, ?, ?, ?, ?)`,
                //     [pendingUser.name, pendingUser.email, pendingUser.user_type, pendingUser.institution_id, hashedPassword, status]
                // );

                const user_id = pendingUser.user_id; // Get the newly inserted user's ID

                // Save the role into `user_roles`
                await query(
                    `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`,
                    [user_id, pendingUser.role]
                );

                // Send login credentials
                const userEmailBody = `
                    Your account has been approved. Please use the credentials below to log in:
                    Email: ${pendingUser.email}
                    Password: ${plainPassword}
                `;
                await sendEmail(email, "Account Approved", userEmailBody);

            } else if (action_type === "edit") {
                // Update existing user details
                const updateUserResult = await query(
                    `UPDATE users SET name = ?, email = ?, user_type = ?, institution = ?, status = ? , admin_status = 1 WHERE id = ?`,
                    [pendingUser.name, pendingUser.email, pendingUser.user_type, pendingUser.institution, pendingUser.status, pendingUser.user_id]
                );

                // Update user role if provided
                if (role) {
                    await query(
                        `UPDATE user_roles SET role_id = ? WHERE user_id = ?`,
                        [pendingUser.role, pendingUser.user_id]
                    );
                }

            } else if (action_type === "delete") {
                // Soft delete user (or permanently delete if required)
                await query(`UPDATE users SET is_active =0, admin_status= 1, deleted_at = ? WHERE id = ?`, [updated_at, pendingUser.user_id]);
            }

            else if (action_type === "disable") {
                await query(`UPDATE users SET is_active =0, admin_status= 1  WHERE id = ?`, [pendingUser.user_id]);
            }


            else if (action_type === "enable") {
                await query(`UPDATE users SET is_active = 1, admin_status= 1  WHERE id = ?`, [pendingUser.user_id]);
            }
        }

        if (status === "rejected") {
            if (!reason) {
                return res.status(400).json({ error: "Rejection reason is required." });
            }
        }

        // Update pending_users table
        await query(
            `UPDATE pending_users SET status = ?, authorizer_id = ?, updated_at = ?, reason = ? WHERE id = ?`,
            [status, authorizer_id, updated_at, reason, id]
        );

        // Notify inputter
        const [inputter] = await query(`SELECT email FROM users WHERE id = ?`, [inputter_id]);
        if (inputter) {
            await sendEmail(inputter.email, "User Request Update", `Your request for ${name} (${action_type}) was ${status}. Reason: ${reason || "N/A"}`);
        }

        res.json({
            message: `User ${status} successfully!`, status: 200,
            success: true,
        });
    } catch (error) {
        next(error);
    }
};




export const getAllUsers = async (req, res, next) => {
    try {
        const users = await query(`
            SELECT * FROM users
            ORDER BY created_at DESC
        `);

        res.status(200).json({
            message: "Users retrieved successfully",
            status: 200,
            success: true,
            users

        });
    } catch (error) {
        console.error("Error fetching users:", error);
        // return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};



export const getAllUsersRequests = async (req, res, next) => {
    try {
        const users = await query(`
            SELECT * FROM pending_users
            ORDER BY created_at DESC
        `);

        res.status(200).json({
            message: "Users requests retrieved successfully",
            status: 200,
            success: true,
            users

        });
    } catch (error) {
        console.error("Error fetching users:", error);
        // return next(new ErrorResponse(error.message || "Internal server error", 500));
    }
};


