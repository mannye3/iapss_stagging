import bcrypt from 'bcryptjs';
import { db } from '../connect.js';
import transporter from '../config/nodemailer.js';
import jwt from "jsonwebtoken"
import ErrorResponse from '../middlewares/errorMiddleware.js'; // ✅ Correct import



const generateRandomPassword = (length = 8) => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        password += characters[randomIndex];
    }
    return password;
};

export const onboardUser = (req, res) => {
    const { name, email, role } = req.body;
    const user_type = 'internal'

    // Validate request body
    if (!name || !email || !role) {
        return res.status(400).json({ error: 'All fields are required and role must be a string' });
    }

    // Generate a random password (8 characters by default)
    const password = generateRandomPassword(8);

    // Check if email already exists in the database
    const queryCheckUser = "SELECT * FROM users WHERE email = ?";
    db.query(queryCheckUser, [email], (err, data) => {
        if (err) return res.status(500).json(err);
        if (data.length > 0) {
            return res.status(409).json({ error: 'User already exists' });
        }

        // Hash the generated password using bcrypt
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(password, salt);

        // Store the hashed password and email in the database
        const queryInsertUser = "INSERT INTO users (`name`, `email`, `password`, `password_changed`) VALUES (?, ?, ?, ?)";
        db.query(queryInsertUser, [name, email, hashedPassword, false], (err, result) => {
            if (err) return res.status(500).json(err);

            const userId = result.insertId;

            // Insert single role
            const queryInsertRole = "INSERT INTO user_roles (user_id, role_id) VALUES (?, (SELECT id FROM roles WHERE name = ?))";
            db.query(queryInsertRole, [userId, role], (err) => {
                if (err) return res.status(500).json(err);

                // Generate reset token for the newly onboarded user
                const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

                // Insert the token into password_reset_tokens table
                const insertTokenQuery = "INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)";
                db.query(insertTokenQuery, [userId, token], (err) => {
                    if (err) return res.status(500).json(err);

                    // Define the reset password URL
                    const CLIENT_URL = 'https://adgtest.fmdqgroup.com/iapss';
                    const resetLink = `${CLIENT_URL}/reset-password/${token}`;

                    // Send email with login details  
                    const mailOptions = {
                        from: process.env.EMAIL,
                        to: email,
                        subject: 'Your Account Details',
                        text: `Hello ${name},\n\nYour account has been created.\n\nLogin Details:\nEmail: ${email}\nPassword: ${password}\n\nYou can click the link below to change your password after your first login:\n\n${resetLink}\n\nBest regards,\nAdmin Team`
                    };

                    // Send the email with the reset link
                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            return res.status(500).json({ error: 'Error sending email', details: error });
                        }

                        res.status(200).json({
                            message: 'User onboarded successfully and password reset link sent',
                            success: true,
                            status: 200
                        });
                    });
                });
            });
        });
    });
};

export const onboardExternalUser = async (req, res, next) => {
    try {
        const { name, email, institution, authorizerId } = req.body;
        const inputterId = req.user.id;
        const user_type = 'external';

        // Validate request body
        if (!name || !email || !institution || !authorizerId) {
            return next(new ErrorResponse('Name, email, institution and authorizer ID are required', 400));
        }

        // Check if inputter is trying to set self as authorizer
        if (inputterId === authorizerId) {
            return next(new ErrorResponse('Inputter cannot be the same as authorizer', 400));
        }

        // Check if email already exists in the database
        const [existingUser] = await new Promise((resolve, reject) => {
            db.query("SELECT * FROM users WHERE email = ?", [email], (err, data) => {
                if (err) reject(new ErrorResponse(`Database error: ${err.message}`, 500));
                resolve(data);
            });
        });

        if (existingUser) {
            return next(new ErrorResponse('User already exists', 409));
        }

        // Check if authorizer exists and has admin role
        const [authorizerData] = await new Promise((resolve, reject) => {
            const authorizerQuery = `
                SELECT u.id, u.name, u.email 
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                WHERE u.id = ? AND r.name = 'Super_Admin_Authoriser' AND u.is_active = 1
            `;
            db.query(authorizerQuery, [authorizerId], (err, result) => {
                if (err) reject(new ErrorResponse(`Database error: ${err.message}`, 500));
                resolve(result);
            });
        });

        if (!authorizerData) {
            return next(new ErrorResponse('Invalid authorizer or authorizer does not have admin rights', 400));
        }

        // Generate temporary password
        const tempPassword = generateRandomPassword(12);
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(tempPassword, salt);

        // Start transaction
        await new Promise((resolve, reject) => {
            db.beginTransaction(err => {
                if (err) reject(new ErrorResponse(`Transaction error: ${err.message}`, 500));
                resolve();
            });
        });

        try {
            // Create pending user request
            const insertResult = await new Promise((resolve, reject) => {
                db.query(
                    `INSERT INTO external_user_requests 
                    (name, email, institution, password_hash, temp_password, inputter_id, authorizer_id, status, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
                    [name, email, institution, hashedPassword, tempPassword, inputterId, authorizerId],
                    (err, result) => {
                        if (err) reject(new ErrorResponse(`Database error: ${err.message}`, 500));
                        resolve(result);
                    }
                );
            });

            // Send email to authorizer
            const mailOptions = {
                from: process.env.EMAIL,
                to: authorizerData.email,
                subject: 'External User Creation Request Pending Approval',
                text: `
                    Dear ${authorizerData.name},

                    A request has been made to create an external user account:
                    
                    Request Details:
                    - Request ID: ${insertResult.insertId}
                    - Name: ${name}
                    - Email: ${email}
                    - Institution: ${institution}
                    - Requested by: ${req.user.name}

                    Please login to the system to approve or reject this request.

                    Best regards,
                    System Administrator
                `
            };

            await new Promise((resolve, reject) => {
                transporter.sendMail(mailOptions, (error) => {
                    if (error) reject(new ErrorResponse(`Email error: ${error.message}`, 500));
                    resolve();
                });
            });

            // Commit transaction
            await new Promise((resolve, reject) => {
                db.commit(err => {
                    if (err) reject(new ErrorResponse(`Commit error: ${err.message}`, 500));
                    resolve();
                });
            });

            res.status(200).json({
                success: true,
                message: 'External user creation request submitted successfully and pending authorization',
                requestId: insertResult.insertId
            });

        } catch (error) {
            await new Promise(resolve => db.rollback(() => resolve()));
            throw error;
        }

    } catch (error) {
        next(error);
    }
};

export const authorizeExternalUser = async (req, res, next) => {
    try {
        const { requestId, approved, rejectionReason } = req.body;
        const authorizerId = req.user.id;

        // Validate request
        if (!requestId || approved === undefined) {
            return next(new ErrorResponse('Request ID and approval status are required', 400));
        }

        if (!approved && !rejectionReason) {
            return next(new ErrorResponse('Rejection reason is required when rejecting a request', 400));
        }

        // Get request details with inputter info
        const request = await new Promise((resolve, reject) => {
            const query = `
                SELECT r.*, 
                    i.name as inputter_name, 
                    i.email as inputter_email
                FROM external_user_requests r
                JOIN users i ON r.inputter_id = i.id
                WHERE r.id = ? AND r.status = 'pending'
                AND r.authorizer_id = ?
            `;
            db.query(query, [requestId, authorizerId], (err, result) => {
                if (err) reject(new ErrorResponse(`Database error: ${err.message}`, 500));
                resolve(result[0]);
            });
        });

        if (!request) {
            return next(new ErrorResponse('Request not found, already processed, or unauthorized', 404));
        }

        // Start transaction
        await new Promise((resolve, reject) => {
            db.beginTransaction(err => {
                if (err) reject(new ErrorResponse(`Transaction error: ${err.message}`, 500));
                resolve();
            });
        });

        try {
            if (approved) {
                // Create the user
                const userResult = await new Promise((resolve, reject) => {
                    const queryInsertUser = `
                        INSERT INTO users 
                        (name, email, password, institution, user_type, password_changed, is_active) 
                        VALUES (?, ?, ?, ?, 'external', false, true)
                    `;
                    db.query(
                        queryInsertUser,
                        [request.name, request.email, request.password_hash, request.institution],
                        (err, result) => {
                            if (err) reject(new ErrorResponse(`Database error: ${err.message}`, 500));
                            resolve(result);
                        }
                    );
                });

                // Generate reset token
                const token = jwt.sign({ id: userResult.insertId }, process.env.JWT_SECRET, { expiresIn: '1h' });

                // Store reset token
                await new Promise((resolve, reject) => {
                    const insertTokenQuery = "INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)";
                    db.query(insertTokenQuery, [userResult.insertId, token], (err) => {
                        if (err) reject(new ErrorResponse(`Database error: ${err.message}`, 500));
                        resolve();
                    });
                });

                const CLIENT_URL = process.env.CLIENT_URL || 'https://adgtest.fmdqgroup.com/iapss';
                const resetLink = `${CLIENT_URL}/reset-password/${token}`;

                // Send email to new user
                const userMailOptions = {
                    from: process.env.EMAIL,
                    to: request.email,
                    subject: 'Your FMDQ Account Details',
                    text: `
                        Hello ${request.name},

                        Your FMDQ account has been created and approved.

                        Login Details:
                        Email: ${request.email}
                        Temporary Password: ${request.temp_password}

                        For security reasons, please change your password after your first login using this link:
                        ${resetLink}

                        This link will expire in 1 hour.

                        Best regards,
                        FMDQ Admin Team
                    `
                };

                await new Promise((resolve, reject) => {
                    transporter.sendMail(userMailOptions, (error) => {
                        if (error) reject(new ErrorResponse(`Email error: ${error.message}`, 500));
                        resolve();
                    });
                });
            }

            // Update request status
            await new Promise((resolve, reject) => {
                const updateQuery = `
                    UPDATE external_user_requests 
                    SET 
                        status = ?,
                        authorized_at = NOW(),
                        rejection_reason = ?,
                        updated_at = NOW()
                    WHERE id = ?
                `;
                db.query(
                    updateQuery,
                    [approved ? 'approved' : 'rejected', rejectionReason || null, requestId],
                    (err) => {
                        if (err) reject(new ErrorResponse(`Database error: ${err.message}`, 500));
                        resolve();
                    }
                );
            });

            // Send notification to inputter
            const inputterMailOptions = {
                from: process.env.EMAIL,
                to: request.inputter_email,
                subject: 'External User Creation Request Status',
                text: `
                    Hello ${request.inputter_name},

                    The external user creation request has been ${approved ? 'approved' : 'rejected'}.

                    Request Details:
                    - Request ID: ${requestId}
                    - User: ${request.name}
                    - Email: ${request.email}
                    - Institution: ${request.institution}
                    ${!approved ? `\nRejection Reason: ${rejectionReason}` : ''}

                    Best regards,
                    FMDQ Admin Team
                `
            };

            await new Promise((resolve, reject) => {
                transporter.sendMail(inputterMailOptions, (error) => {
                    if (error) reject(new ErrorResponse(`Email error: ${error.message}`, 500));
                    resolve();
                });
            });

            // Commit transaction
            await new Promise((resolve, reject) => {
                db.commit(err => {
                    if (err) reject(new ErrorResponse(`Commit error: ${err.message}`, 500));
                    resolve();
                });
            });

            res.status(200).json({
                success: true,
                message: `External user creation request ${approved ? 'approved' : 'rejected'} successfully`
            });

        } catch (error) {
            await new Promise(resolve => db.rollback(() => resolve()));
            throw error;
        }

    } catch (error) {
        next(error);
    }
};

export const initiateAccountActivation = async (req, res, next) => {
    try {
        const { userId, authorizerId, action } = req.body;
        const inputterId = req.user.id;

        // Validate request
        if (!userId || !authorizerId || !action) {
            return next(new ErrorResponse('User ID, authorizer ID and action are required', 400));
        }

        // Verify action is valid
        if (!['activate', 'deactivate'].includes(action)) {
            return next(new ErrorResponse('Invalid action. Must be either activate or deactivate', 400));
        }

        // Check if inputter is trying to set self as authorizer
        if (inputterId === authorizerId) {
            return next(new ErrorResponse('Inputter cannot be the same as authorizer', 400));
        }

        // Check if user exists
        const userData = await new Promise((resolve, reject) => {
            db.query('SELECT name, email, is_active FROM users WHERE id = ?', [userId], (err, result) => {
                if (err) {
                    console.error('User Query Error:', err);
                    reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                }
                resolve(result[0]); // Get first result
            });
        });

        if (!userData) {
            return next(new ErrorResponse('User not found', 404));
        }

        // Check if authorizer exists and has admin role
        const authorizerData = await new Promise((resolve, reject) => {
            const authorizerQuery = `
                SELECT u.id, u.name, u.email 
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                WHERE u.id = ? AND r.name = 'Super_Admin_Authoriser' AND u.is_active = 1
            `;
            db.query(authorizerQuery, [authorizerId], (err, result) => {
                if (err) {
                    console.error('Authorizer Query Error:', err);
                    reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                }
                resolve(result[0]); // Get first result
            });
        });

        if (!authorizerData) {
            return next(new ErrorResponse('Invalid authorizer or authorizer does not have admin rights', 400));
        }

        // Check if there's already a pending request
        const existingRequest = await new Promise((resolve, reject) => {
            db.query(
                'SELECT id FROM account_activation_requests WHERE user_id = ? AND status = "pending"',
                [userId],
                (err, result) => {
                    if (err) {
                        console.error('Existing Request Query Error:', err);
                        reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                    }
                    resolve(result[0]); // Get first result
                }
            );
        });

        if (existingRequest) {
            return next(new ErrorResponse('There is already a pending request for this user', 400));
        }

        // Create activation request
        const insertResult = await new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO account_activation_requests 
                (user_id, inputter_id, authorizer_id, action, status, created_at) 
                VALUES (?, ?, ?, ?, 'pending', NOW())`,
                [userId, inputterId, authorizerId, action],
                (err, result) => {
                    if (err) {
                        console.error('Insert Request Error:', err);
                        reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                    }
                    resolve(result);
                }
            );
        });

        // Send email to authorizer
        const mailOptions = {
            from: process.env.EMAIL,
            to: authorizerData.email,
            subject: 'Account Activation Request Pending Approval',
            text: `
                Dear ${authorizerData.name},

                A request has been made to ${action} the account for user ${userData.name} (${userData.email}).
                
                Request Details:
                - Request ID: ${insertResult.insertId}
                - Action: ${action}
                - User: ${userData.name}
                - Requested by: ${req.user.name}

                Please login to the system to approve or reject this request.

                Best regards,
                System Administrator
            `
        };

        await new Promise((resolve, reject) => {
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Email Send Error:', error);
                    reject(new ErrorResponse(`Error sending email: ${error.message}`, 500));
                }
                resolve(info);
            });
        });

        res.status(200).json({
            success: true,
            message: 'Account activation request created successfully and notification sent to authorizer'
        });

    } catch (error) {
        next(error);
    }
};

export const authorizeAccountActivation = async (req, res, next) => {
    try {
        const { requestId, approved, rejectionReason } = req.body;
        const authorizerId = req.user.id;

        // Validate request
        if (!requestId || approved === undefined) {
            return next(new ErrorResponse('Request ID and approval status are required', 400));
        }

        // If rejecting, require a reason
        if (!approved && !rejectionReason) {
            return next(new ErrorResponse('Rejection reason is required when rejecting a request', 400));
        }

        // First check if the request exists
        const requestCheck = await new Promise((resolve, reject) => {
            const checkQuery = "SELECT * FROM account_activation_requests WHERE id = ?";
            db.query(checkQuery, [requestId], (err, result) => {
                if (err) {
                    console.error('Request Check Error:', err);
                    reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                }
                console.log('Basic request check result:', result);
                resolve(result[0]);
            });
        });

        if (!requestCheck) {
            return next(new ErrorResponse(`No request found with ID: ${requestId}`, 404));
        }

        if (requestCheck.status !== 'pending') {
            return next(new ErrorResponse(`Request ${requestId} has already been ${requestCheck.status}`, 400));
        }

        // Now get full request details
        const request = await new Promise((resolve, reject) => {
            const query = `
                SELECT ar.*, 
                    u.name as user_name, u.email as user_email,
                    i.name as inputter_name, i.email as inputter_email
                FROM account_activation_requests ar
                JOIN users u ON ar.user_id = u.id
                JOIN users i ON ar.inputter_id = i.id
                WHERE ar.id = ? AND ar.status = 'pending'`;

            console.log('Checking full request details...');
            console.log('Request ID:', requestId);
            console.log('Authorizer ID:', authorizerId);

            db.query(query, [requestId], (err, result) => {
                if (err) {
                    console.error('Full Request Query Error:', err);
                    reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                }
                console.log('Full request details:', result[0]);
                resolve(result[0]);
            });
        });



        // Start transaction
        await new Promise((resolve, reject) => {
            db.beginTransaction(err => {
                if (err) reject(new ErrorResponse(`Transaction error: ${err.message}`, 500));
                resolve();
            });
        });

        try {
            if (approved) {
                // Update user's active status based on the action requested
                const newActiveStatus = request.action === 'activate' ? 1 : 0;

                await new Promise((resolve, reject) => {
                    const updateUserQuery = 'UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?';
                    console.log('Updating user status:', { newActiveStatus, userId: request.user_id });

                    db.query(updateUserQuery, [newActiveStatus, request.user_id], (err) => {
                        if (err) {
                            console.error('User Update Error:', err);
                            reject(new ErrorResponse(`Failed to update user status: ${err.message}`, 500));
                        }
                        resolve();
                    });
                });

                console.log(`User ${request.user_id} ${request.action}d successfully`);
            }

            // Update request status with approval details
            await new Promise((resolve, reject) => {
                const updateRequestQuery = `
                    UPDATE account_activation_requests 
                    SET 
                        status = ?, 
                        authorized_at = NOW(), 
                        rejection_reason = ?,
                        updated_at = NOW()
                    WHERE id = ?
                `;

                console.log('Updating request status:', {
                    status: approved ? 'approved' : 'rejected',
                    requestId,
                    rejectionReason: rejectionReason || null
                });

                db.query(
                    updateRequestQuery,
                    [approved ? 'approved' : 'rejected', rejectionReason || null, requestId],
                    (err) => {
                        if (err) {
                            console.error('Request Update Error:', err);
                            reject(new ErrorResponse(`Failed to update request status: ${err.message}`, 500));
                        }
                        resolve();
                    }
                );
            });

            // Commit transaction
            await new Promise((resolve, reject) => {
                db.commit(err => {
                    if (err) reject(new ErrorResponse(`Commit error: ${err.message}`, 500));
                    resolve();
                });
            });

            // Send email notification
            const mailOptions = {
                from: process.env.EMAIL,
                to: request.inputter_email,
                subject: `Account ${request.action} Request ${approved ? 'Approved' : 'Rejected'}`,
                text: `
                    Hello ${request.inputter_name},

                    The request to ${request.action} the account for user ${request.user_name} has been ${approved ? 'approved' : 'rejected'}.
                    
                    Request Details:
                    - Request ID: ${requestId}
                    - Action: ${request.action}
                    - User: ${request.user_name}
                    - Status: ${approved ? 'Approved' : 'Rejected'}
                    ${approved ? `- Account has been ${request.action}d successfully` : `- Rejection Reason: ${rejectionReason}`}

                    Best regards,
                    System Administrator
                `
            };

            await new Promise((resolve, reject) => {
                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.error('Email Send Error:', error);
                        reject(new ErrorResponse(`Error sending email: ${error.message}`, 500));
                    }
                    resolve(info);
                });
            });

            res.status(200).json({
                success: true,
                message: `Account ${request.action} request ${approved ? 'approved' : 'rejected'} successfully`,
                details: {
                    requestId,
                    userId: request.user_id,
                    action: request.action,
                    status: approved ? 'approved' : 'rejected',
                    ...(approved && { newActiveStatus: request.action === 'activate' ? 'active' : 'inactive' }),
                    ...((!approved) && { rejectionReason })
                }
            });

        } catch (error) {
            // Rollback transaction on error
            await new Promise((resolve) => {
                db.rollback(() => resolve());
            });
            throw error;
        }

    } catch (error) {
        next(error);
    }
};




