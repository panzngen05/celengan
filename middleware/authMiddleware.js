// celengan-api/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const pool =require('../config/db'); // Sesuaikan jika path berbeda

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Mengambil data user dari DB berdasarkan ID di token. Kirim hanya data yang aman.
            const [users] = await pool.query('SELECT id, nama, email FROM users WHERE id = ?', [decoded.id]);

            if (users.length === 0) {
                return res.status(401).json({ message: 'Tidak terotorisasi, user tidak ditemukan.' });
            }
            req.user = users[0]; // Sematkan objek user (tanpa hash) ke request
            next();
        } catch (error) {
            console.error('Kesalahan otentikasi token:', error.message);
            res.status(401).json({ message: 'Tidak terotorisasi, token gagal atau tidak valid.' });
        }
    }

    if (!token) {
        res.status(401).json({ message: 'Tidak terotorisasi, tidak ada token.' });
    }
};

module.exports = { protect };
