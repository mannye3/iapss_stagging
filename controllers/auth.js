import { db } from './../connect.js';
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
        // Validate request body
        if (!req.body.email || !req.body.password) {
            return next(new ErrorResponse('Email and password are required', 400));
        }

        // Check if the user exists and is active in the database
        const checkUserQuery = `
            SELECT u.id, u.name, u.email, u.password, u.is_active, u.institution 
            FROM users u 
            WHERE u.email = ?
        `;

        // Using promisify to handle the database query with async/await
        const [userData] = await new Promise((resolve, reject) => {
            db.query(checkUserQuery, [req.body.email], (err, result) => {
                if (err) {
                    console.error('Database Query Error:', err);
                    reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                }
                resolve(result);
            });
        });

        if (!userData) {
            return next(new ErrorResponse('Invalid email or password', 401));
        }

        // Check if account is active
        if (!userData.is_active) {
            return next(new ErrorResponse('Account is inactive. Please contact administrator', 403));
        }

        // Compare the password with the hashed password in the database
        const isPasswordValid = await bcrypt.compare(req.body.password, userData.password);
        if (!isPasswordValid) {
            return next(new ErrorResponse('Invalid email or password', 401));
        }

        // Fetch user's role
        const getUserRoleQuery = `
            SELECT roles.name AS role 
            FROM user_roles 
            JOIN roles ON user_roles.role_id = roles.id 
            WHERE user_roles.user_id = ?
        `;

        const roleData = await new Promise((resolve, reject) => {
            db.query(getUserRoleQuery, [userData.id], (err, result) => {
                if (err) {
                    console.error('Role Query Error:', err);
                    reject(new ErrorResponse(`Error fetching user role: ${err.message}`, 500));
                }
                resolve(result);
            });
        });

        const role = roleData.length > 0 ? roleData[0].role : 'No Role Assigned';

        // Generate a JWT token
        const token = jwt.sign(
            { id: userData.id, name: userData.name, email: userData.email, institution_id: userData.institution, role },
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
                institution_id: userData.institution,
                email: userData.email,
                name: userData.name,
                role
            }
        });

    } catch (error) {
        console.error('Login Error:', error);
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

        if (!token || !newPassword) {
            return next(new ErrorResponse('Token and new password are required', 400));
        }

        const verifyTokenQuery = "SELECT * FROM password_reset_tokens WHERE token = ?";
        const [tokenData] = await new Promise((resolve, reject) => {
            db.query(verifyTokenQuery, [token], (err, data) => {
                if (err) {
                    console.error('Token Verification Error:', err);
                    reject(new ErrorResponse(`Database query failed: ${err.message}`, 500));
                }
                resolve(data);
            });
        });

        if (!tokenData || tokenData.used) {
            return next(new ErrorResponse('Invalid or expired token', 400));
        }

        // Verify JWT token
        const decoded = await new Promise((resolve, reject) => {
            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    reject(new ErrorResponse('Invalid or expired token', 400));
                }
                resolve(decoded);
            });
        });

        const userId = decoded.id;
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(newPassword, salt);

        // Update password
        const updatePasswordQuery = "UPDATE users SET password = ? WHERE id = ?";
        await new Promise((resolve, reject) => {
            db.query(updatePasswordQuery, [hashedPassword, userId], (err) => {
                if (err) {
                    console.error('Password Update Error:', err);
                    reject(new ErrorResponse(`Error updating password: ${err.message}`, 500));
                }
                resolve();
            });
        });

        // Mark token as used
        const markTokenUsedQuery = "UPDATE password_reset_tokens SET used = TRUE WHERE token = ?";
        await new Promise((resolve, reject) => {
            db.query(markTokenUsedQuery, [token], (err) => {
                if (err) {
                    console.error('Token Update Error:', err);
                    reject(new ErrorResponse(`Error updating token status: ${err.message}`, 500));
                }
                resolve();
            });
        });

        res.status(200).json({
            success: true,
            message: 'Password reset successful'
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






