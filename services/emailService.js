import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com', // e.g., smtp.mailtrap.io or smtp.yourdomain.com
    port: 587, // Common port for SMTP
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL, // Your SMTP username
        pass: process.env.EMAIL_PASSWORD // Your SMTP password
    }
});

/**
 * Send an email notification
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email body in HTML format
 */
export const sendEmail = async (to, subject, html) => {
    const mailOptions = {
        from: `"${process.env.SENDER_NAME}" <${process.env.EMAIL}>`,
        to,
        subject,
        html
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent: ${info.response}`);
        return true;
    } catch (error) {
        console.error('Email sending failed:', error.message);
        return false;
    }
};
