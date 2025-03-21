
import { db } from './../connect.js';
// import bcrypt from "bcryptjs"
// import jwt from "jsonwebtoken"
// const secretKey = process.env.JWT_SECRET; 

// Create a new publication
export const createPublication = (req, res) => {
    const { title, inputter, inputter_date, institution, authorizer, approval_date, status } = req.body;
    if (!title || !inputter || !inputter_date || !institution || !authorizer || !approval_date || !status) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const query = `INSERT INTO publications (title, inputter, inputter_date, institution, authorizer, approval_date, status, created_at) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;
    const values = [title, inputter, inputter_date, institution, authorizer, approval_date, status];

    db.query(query, values, (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Database error', details: err });
        }
        res.status(201).json({ message: 'Publication created successfully', publicationId: result.insertId });
    });
};

// Get all publications
export const getPublications = (req, res) => {
    const query = "SELECT * FROM publications";

    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database error', details: err });
        }
        res.status(200).json(results);
    });
};

// Get a single publication by ID
export const getPublicationById = (req, res) => {
    const { id } = req.params;
    const query = "SELECT * FROM publications WHERE id = ?";

    db.query(query, [id], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database error', details: err });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Publication not found' });
        }
        res.status(200).json(results[0]);
    });
};

// Update a publication
export const updatePublication = (req, res) => {
    const { id } = req.params;
    const { title, inputter, inputter_date, institution, authorizer, approval_date, status } = req.body;

    const query = `UPDATE publications 
                   SET title = ?, inputter = ?, inputter_date = ?, institution = ?, authorizer = ?, approval_date = ?, status = ? 
                   WHERE id = ?`;
    const values = [title, inputter, inputter_date, institution, authorizer, approval_date, status, id];

    db.query(query, values, (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Database error', details: err });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Publication not found' });
        }
        res.status(200).json({ message: 'Publication updated successfully' });
    });
};

// Delete a publication
export const deletePublication = (req, res) => {
    const { id } = req.params;
    const query = "DELETE FROM publications WHERE id = ?";

    db.query(query, [id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Database error', details: err });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Publication not found' });
        }
        res.status(200).json({ message: 'Publication deleted successfully' });
    });
};