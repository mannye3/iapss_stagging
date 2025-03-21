import bcrypt from 'bcryptjs';
import { db } from '../connect.js';
import transporter from '../config/nodemailer.js';


// List all roles
export const getRoles = (req, res) => {
    const query = 'SELECT * FROM roles';

    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch roles' });
        }
        res.status(200).json(results);
    });
};

// Add a new role
export const addRole = (req, res) => {
    const { name } = req.body;

    // Check for validation errors
    if (!name) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    // Check for name in the database
    const queryCheckRole = 'SELECT * FROM roles WHERE name = ?';
    db.query(queryCheckRole, [name], (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to check for existing role' });
        }

        if (data.length > 0) {
            return res.status(409).json({ error: 'Role already exists' });
        }

        // Proceed to add the role if not found
        const query = 'INSERT INTO roles (name) VALUES (?)';

        db.query(query, [name], (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to add role' });
            }
            res.status(201).json({ message: 'Role created successfully', id: result.insertId });
        });
    });
};



// Edit an existing role
export const editRole = (req, res) => {
    const { name } = req.body;
    const roleId = req.params.id;

    // Check if the role exists by its ID
    const queryCheckRoleById = 'SELECT * FROM roles WHERE id = ?';
    db.query(queryCheckRoleById, [roleId], (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to check for existing role by ID' });
        }
        if (data.length === 0) {
            return res.status(404).json({ error: 'Role not found' });
        }

        // Check if the new name already exists, excluding the current role
        const queryCheckRoleName = 'SELECT * FROM roles WHERE name = ? AND id != ?';
        db.query(queryCheckRoleName, [name, roleId], (err, data) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to check for existing role name' });
            }

            if (data.length > 0) {
                return res.status(409).json({ error: 'Role name already exists' });
            }

            // Proceed with updating the role name
            const queryUpdateRole = 'UPDATE roles SET name = ? WHERE id = ?';
            db.query(queryUpdateRole, [name, roleId], (err, result) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to update role' });
                }
                res.status(200).json({ message: 'Role updated successfully' });
            });
        });
    });
};


// Delete a role
export const deleteRole = (req, res) => {
    const roleId = req.params.id;

    const query = 'DELETE FROM roles WHERE id = ?';

    db.query(query, [roleId], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete role' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Role not found' });
        }
        res.status(200).json({ message: 'Role deleted successfully' });
    });
};



