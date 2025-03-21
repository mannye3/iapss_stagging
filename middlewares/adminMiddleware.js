import { db } from "../connect.js";

export const isAdmin = (req, res, next) => {
    const userId = req.user.id;
    // const useremail = req.user.name;
     console.log('User ID:', userId); // Debug log

    if (!userId) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const query = `
        SELECT r.name FROM roles r
        JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?  AND r.name = 'Admin'
    `;
    db.query(query, [userId], (err, data) => {
        if (err) return res.status(500).json(err);
        if (data.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }
        next();
    });
};

