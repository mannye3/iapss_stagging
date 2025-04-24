import { db, query } from '../connect.js';
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import ErrorResponse from '../middlewares/errorMiddleware.js';
const secretKey = process.env.JWT_SECRET; // Use the secret key from environment variables





const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com', // e.g., smtp.mailtrap.io or smtp.yourdomain.com
    port: 587, // Common port for SMTP
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL, // Your SMTP username
        pass: process.env.EMAIL_PASSWORD // Your SMTP password
    }
});




export const register = (req, res) => {
    const { name, email, password, roles } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const q = "SELECT * FROM users WHERE email = ?";
    db.query(q, [email], (err, data) => {
        if (err) return res.status(500).json(err);
        if (data.length > 0) {
            return res.status(409).json({ error: 'User already exists' });
        }

        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(password, salt);

        const insertUserQuery = "INSERT INTO users (`name`, `email`, `password`) VALUES (?, ?, ?)";
        db.query(insertUserQuery, [name, email, hashedPassword], (err, result) => {
            if (err) return res.status(500).json(err);

            const userId = result.insertId;
            const roleIds = roles.map(role => `(?, (SELECT id FROM roles WHERE name = ?))`).join(', ');
            const roleValues = roles.flatMap(role => [userId, role]);

            const insertRolesQuery = `INSERT INTO user_roles (user_id, role_id) VALUES ${roleIds}`;
            db.query(insertRolesQuery, roleValues, (err, result) => {
                if (err) return res.status(500).json(err);
                res.status(201).json({ message: 'User registered successfully' });
            });
        });
    });
};






export const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return next(new ErrorResponse('Email and password are required', 400));
        }

        // Get user data
        const userResults = await query(
            `SELECT users.id, users.name, users.email, users.password, users.is_active, users.failed_attempts, users.lock_until, users.institution, i.logo, users.password_last_changed 
             FROM users LEFT JOIN institutions i ON users.institution = i.id WHERE email = ?`,
            [email]
        );

        const userData = userResults[0];

        // Always do bcrypt compare even if user not found (to prevent timing attacks)
        if (!userData) {
            await bcrypt.compare(password, '$2b$10$abcdefghijklmnopqrstuv'); // dummy hash
            return next(new ErrorResponse('Invalid email or password', 401));
        }

        // Check account status
        if (!userData.is_active) {
            return next(new ErrorResponse('Account is inactive. Please contact administrator.', 403));
        }

        if (userData.lock_until && new Date() < new Date(userData.lock_until)) {
            return next(new ErrorResponse('Account locked. Try again later.', 403));
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, userData.password);
        if (!isPasswordValid) {
            const updatedAttempts = userData.failed_attempts + 3;

            await query(
                'UPDATE users SET failed_attempts = ? WHERE id = ?',
                [updatedAttempts, userData.id]
            );

            if (updatedAttempts >= 3) {
                const lockUntil = new Date();
                lockUntil.setMinutes(lockUntil.getMinutes() + 5);

                await query(
                    'UPDATE users SET lock_until = ? WHERE id = ?',
                    [lockUntil, userData.id]
                );

                return res.status(403).json({
                    status: 403,
                    message: 'Account locked. Please reset your password.',
                    email: userData.email,
                    isLocked: true
                });
            }

            return next(new ErrorResponse('Invalid email or password', 401));
        }

        // Reset failed attempts
        await query(
            'UPDATE users SET failed_attempts = 0, lock_until = NULL WHERE id = ?',
            [userData.id]
        );

        // Force password change on first login
        if (!userData.password_last_changed) {
            return next(new ErrorResponse('First login detected. Change your password.', 403));
        }

        // Enforce password expiration after 30 days
        const lastChanged = new Date(userData.password_last_changed);
        const now = new Date();
        const daysSinceChange = (now - lastChanged) / (1000 * 60 * 60 * 24);
        if (daysSinceChange > 30) {
            return next(new ErrorResponse('Password expired. Please reset your password.', 403));
        }

        // Get user role
        const roleResults = await query(
            `SELECT roles.name AS role 
             FROM user_roles 
             JOIN roles ON user_roles.role_id = roles.id 
             WHERE user_roles.user_id = ?`,
            [userData.id]
        );

        const role = roleResults.length > 0 ? roleResults[0].role : 'No Role Assigned';

        // Generate token
        const token = jwt.sign(
            {
                id: userData.id,
                name: userData.name,
                email: userData.email,
                role
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        return res.status(200).json({
            status: 200,
            message: 'Login successful',
            success: true,
            token,
            user: {
                id: userData.id,
                email: userData.email,
                name: userData.name,
                logo: userData.logo,
                role
            }
        });

    } catch (error) {
        return next(error);
    }
};



// Request password reset
export const requestPasswordReset = async (req, res, next) => {
    try {
        const { email } = req.body;

        if (!email) {
            return next(new ErrorResponse('Email is required', 400));
        }

        const query = "SELECT id FROM users WHERE email = ?";
        const [user] = await new Promise((resolve, reject) => {
            db.query(query, [email], (err, data) => {
                if (err) {
                    console.error('Database Query Error:', err);
                    reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                }
                resolve(data);
            });
        });

        if (!user) {
            return next(new ErrorResponse('User not found', 404));
        }

        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        const insertTokenQuery = "INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)";
        await new Promise((resolve, reject) => {
            db.query(insertTokenQuery, [user.id, token], (err, result) => {
                if (err) {
                    console.error('Token Insert Error:', err);
                    reject(new ErrorResponse(`Error creating reset token: ${err.message}`, 500));
                }
                resolve(result);
            });
        });

        const resetLink = `${process.env.CLIENT_URL}/reset-password/${token}`;
        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Password Reset',
            text: `Click on the following link to reset your password: ${resetLink}`
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
            message: 'Password reset link sent'
        });

    } catch (error) {
        next(error);
    }
};




// Reset password
export const resetPassword = async (req, res, next) => {
    try {
        const { newPassword } = req.body;
        const token = req.params.token;
        const password_changed = new Date();

        if (!token || !newPassword) {
            return next(new ErrorResponse('Token and new password are required', 400));
        }

        // Ensure password meets complexity requirements
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$/;
        if (!passwordRegex.test(newPassword)) {
            return next(new ErrorResponse('Password must be 8-128 characters, include uppercase, lowercase, number, and special character', 400));
        }

        // Verify the token
        const verifyTokenQuery = "SELECT * FROM password_reset_tokens WHERE token = ? AND used = FALSE";
        const [tokenData] = await new Promise((resolve, reject) => {
            db.query(verifyTokenQuery, [token], (err, data) => {
                if (err) reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                resolve(data);
            });
        });

        if (!tokenData) {
            return next(new ErrorResponse('Invalid or expired token', 400));
        }

        // Decode the JWT token
        const decoded = await new Promise((resolve, reject) => {
            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) reject(new ErrorResponse('Invalid or expired token', 400));
                resolve(decoded);
            });
        });

        const userId = decoded.id;

        // Fetch the last 10 passwords of the user
        const fetchOldPasswordsQuery = "SELECT old_password_hash FROM user_password_history WHERE user_id = ? ORDER BY created_at  DESC LIMIT 10";
        const oldPasswords = await new Promise((resolve, reject) => {
            db.query(fetchOldPasswordsQuery, [userId], (err, data) => {
                if (err) reject(new ErrorResponse(`Error fetching old passwords: ${err.message}`, 500));
                resolve(data);
            });
        });

        // Check if the new password was used before
        const isReusedPassword = oldPasswords.some(({ old_password_hash }) => bcrypt.compareSync(newPassword, old_password_hash));
        if (isReusedPassword) {
            return next(new ErrorResponse('Cannot reuse the last 10 passwords', 400));
        }

        // Hash the new password
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(newPassword, salt);

        // Update user password
        const updatePasswordQuery = "UPDATE users SET password = ?, password_last_changed = ?, failed_attempts = 0, lock_until = NULL  WHERE id = ?";
        await new Promise((resolve, reject) => {
            db.query(updatePasswordQuery, [hashedPassword, password_changed, userId], (err) => {
                if (err) reject(new ErrorResponse(`Error updating password: ${err.message}`, 500));
                resolve();
            });
        });

        // Store old password in history
        const insertPasswordHistoryQuery = "INSERT INTO user_password_history (user_id, old_password_hash) VALUES (?, ?)";
        await new Promise((resolve, reject) => {
            db.query(insertPasswordHistoryQuery, [userId, hashedPassword], (err) => {
                if (err) reject(new ErrorResponse(`Error saving password history: ${err.message}`, 500));
                resolve();
            });
        });

        // Mark reset token as used
        const markTokenUsedQuery = "UPDATE password_reset_tokens SET used = TRUE WHERE token = ?";
        await new Promise((resolve, reject) => {
            db.query(markTokenUsedQuery, [token], (err) => {
                if (err) reject(new ErrorResponse(`Error updating token status: ${err.message}`, 500));
                resolve();
            });
        });

        res.status(200).json({
            success: true,
            message: 'Password reset successful',
        });

    } catch (error) {
        next(error);
    }
};




export const changePassword = (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id; // Assume user ID is attached to the request after successful authentication

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Old password and new password are required' });
    }

    // Check if the old password is correct
    const queryCheckPassword = "SELECT * FROM users WHERE id = ?";
    db.query(queryCheckPassword, [userId], (err, data) => {
        if (err) return res.status(500).json(err);
        if (data.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = data[0];

        bcrypt.compare(oldPassword, user.password, (err, match) => {
            if (err) return res.status(500).json(err);
            if (!match) return res.status(400).json({ error: 'Old password is incorrect' });

            // Hash the new password
            const salt = bcrypt.genSaltSync(10);
            const hashedPassword = bcrypt.hashSync(newPassword, salt);

            // Update the password and set password_changed to true
            const queryUpdatePassword = "UPDATE users SET password = ?, password_changed = true WHERE id = ?";
            db.query(queryUpdatePassword, [hashedPassword, userId], (err, result) => {
                if (err) return res.status(500).json(err);

                res.status(200).json({ message: 'Password updated successfully' });
            });
        });
    });
};






