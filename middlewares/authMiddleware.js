import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

export const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(403).json({ error: 'No token provided' });
    }

    const tokenPart = token.split(' ')[1]; // Assuming the format is "Bearer <token>"

    jwt.verify(tokenPart, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to authenticate token' });
        }
        req.user = decoded; // Save the decoded token payload to req.user
        console.log('Decoded JWT:', decoded); // Debug log
        next();
    });
};
