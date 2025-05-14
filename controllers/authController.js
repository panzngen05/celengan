// celengan-api/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Fungsi untuk generate JWT (kembali digunakan)
const generateToken = (id) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        console.error("KRITIKAL: JWT_SECRET tidak terdefinisi di variabel lingkungan!");
        throw new Error('Konfigurasi server tidak lengkap: JWT_SECRET tidak ada.');
    }
    return jwt.sign({ id }, secret, {
        expiresIn: '30d', // Token berlaku 30 hari
    });
};

// @desc    Register a new user with a PIN
// @route   POST /api/auth/register-pin
// @access  Public
const registerUserWithPin = async (req, res) => {
    const { nama, email, pin } = req.body;

    if (!nama || !email || !pin) {
        return res.status(400).json({ message: 'Mohon isi semua field: nama, email, dan PIN.' });
    }

    // Validasi PIN (misalnya, harus 6 digit angka)
    if (!/^\d{6}$/.test(pin)) { // Contoh: PIN harus 6 digit angka
        return res.status(400).json({ message: 'PIN tidak valid. Harus 6 digit angka.' });
    }

    try {
        const [userExists] = await pool.query('SELECT email FROM users WHERE email = ?', [email]);
        if (userExists.length > 0) {
            return res.status(400).json({ message: 'User dengan email ini sudah terdaftar.' });
        }

        const salt = await bcrypt.genSalt(10);
        const pin_hash = await bcrypt.hash(pin, salt);

        const [result] = await pool.query(
            'INSERT INTO users (nama, email, pin_hash) VALUES (?, ?, ?)',
            [nama, email, pin_hash]
        );

        if (result && result.insertId) {
            const token = generateToken(result.insertId);
            res.status(201).json({
                id: result.insertId,
                nama,
                email,
                token: token,
                message: 'Registrasi berhasil! Anda sekarang bisa login.'
            });
        } else {
            res.status(400).json({ message: 'Data pengguna tidak valid atau gagal menyimpan.' });
        }
    } catch (error) {
        console.error('Kesalahan saat registrasi dengan PIN:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server saat registrasi.' });
    }
};

// @desc    Authenticate a user with email and PIN
// @route   POST /api/auth/login-pin
// @access  Public
const loginUserWithPin = async (req, res) => {
    const { email, pin } = req.body;

    if (!email || !pin) {
        return res.status(400).json({ message: 'Mohon sediakan email dan PIN.' });
    }

    // PENTING: Implementasikan Rate Limiting di sini untuk mencegah brute-force PIN!
    // Contoh menggunakan library seperti 'express-rate-limit' pada rute ini.

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        if (users.length === 0) {
            return res.status(401).json({ message: 'Kredensial tidak valid (email tidak ditemukan).' });
        }

        const user = users[0];
        if (!user.pin_hash) {
            return res.status(401).json({ message: 'Akun ini belum memiliki PIN. Silakan hubungi admin.' });
        }

        const isMatch = await bcrypt.compare(pin, user.pin_hash);

        if (isMatch) {
            // Jika PIN cocok, reset percobaan gagal jika ada mekanisme lockout
            const token = generateToken(user.id);
            res.json({
                id: user.id,
                nama: user.nama,
                email: user.email,
                token: token,
            });
        } else {
            // Jika PIN salah, catat percobaan gagal dan implementasikan lockout jika perlu
            res.status(401).json({ message: 'Kredensial tidak valid (PIN salah).' });
        }
    } catch (error) {
        console.error('Kesalahan saat login dengan PIN:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server saat login.' });
    }
};

// @desc    Get user profile (berdasarkan JWT dari PIN login)
// @route   GET /api/auth/profile
// @access  Private (via JWT)
const getUserProfile = async (req, res) => {
    // req.user sudah di-set oleh middleware JWT protect
    if (!req.user) {
        return res.status(404).json({ message: 'User tidak ditemukan atau token tidak valid.' });
    }
    // Ambil data user terbaru dari DB untuk memastikan data fresh (opsional tapi bagus)
    try {
        const [users] = await pool.query('SELECT id, nama, email, created_at FROM users WHERE id = ?', [req.user.id]);
        if (users.length > 0) {
            res.json(users[0]);
        } else {
            res.status(404).json({ message: 'User tidak ditemukan di database.'});
        }
    } catch (error) {
        console.error('Error mengambil profil user:', error);
        res.status(500).json({ message: 'Kesalahan server saat mengambil profil.'});
    }
};

module.exports = {
    registerUserWithPin,
    loginUserWithPin,
    getUserProfile,
};
