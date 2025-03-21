


import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com', // e.g., smtp.mailtrap.io or smtp.yourdomain.com
    port: 587, // Common port for SMTP
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL, // Your SMTP username
        pass: process.env.EMAIL_PASSWORD // Your SMTP password
    }
});

export default transporter;




