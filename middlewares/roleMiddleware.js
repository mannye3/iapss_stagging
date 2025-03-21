export const checkRole = (roles) => {
    return (req, res, next) => {
        const userId = req.user.id;

        const query = `
            SELECT r.name FROM roles r
            JOIN user_roles ur ON ur.role_id = r.id
            WHERE ur.user_id = ? AND r.name IN (?)
        `;
        db.query(query, [userId, roles], (err, data) => {
            if (err) return res.status(500).json(err);
            if (data.length === 0) {
                return res.status(403).json({ error: 'Access denied' });
            }
            next();
        });
    };
};





