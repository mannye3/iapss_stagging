import { db, query } from '../connect.js';
import ErrorResponse from "../middlewares/errorMiddleware.js";  // ✅ Correct import







export const getAdminAuthorisers = async (req, res, next) => {
    try {


        const usersQuery = `
    SELECT users.id, users.name, users.email, users.institution, roles.name AS role FROM users LEFT JOIN user_roles ON users.id = user_roles.user_id LEFT JOIN roles ON user_roles.role_id = roles.id WHERE roles.name = 'Super_Admin_Authoriser'`;
        const users = await query(usersQuery, []);

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