import 'dotenv/config'; // Load environment variables from .env file
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import publicationRoutes from './routes/publicationRoutes.js';
import adminRoutes from './routes/admin.js';
import roleRoutes from './routes/roles.js';
import externalUserRoutes from './routes/externalUserRoutes.js'
import institutionRoutes from './routes/institutionRoutes.js'
import { verifyToken } from './middlewares/authMiddleware.js';
import { errorHandler } from "./middlewares/errorMiddleware.js"; // Import middleware


const app = express();



// Middlewares
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    next();
});
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());


if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}



// Public routes
app.use('/api/auth', authRoutes);

// Protected routes (apply verifyToken middleware) 
app.use('/api/users', verifyToken, userRoutes);
app.use('/api/institutions', verifyToken, institutionRoutes);
app.use('/api/publications', verifyToken, publicationRoutes);
app.use('/api/all-publications', publicationRoutes);
app.use('/api/admin', verifyToken, adminRoutes); // Use the admin routes
app.use('/api/roles', verifyToken, roleRoutes); // Use the admin routes
app.use('/api/external', verifyToken, externalUserRoutes);
app.use('/api/institutions', institutionRoutes);

app.use(errorHandler);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


