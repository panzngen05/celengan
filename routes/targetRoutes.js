// celengan-api/routes/targetRoutes.js

const express = require('express');
const router = express.Router();
const {
    createTarget,
    getUserTargets,
    getTargetById,
    updateTarget,
    deleteTarget
} = require('../controllers/targetController'); // Pastikan path ke controller Anda benar
const { protect } = require('../middleware/authMiddleware'); // Menggunakan middleware JWT 'protect'

// Semua rute di bawah ini akan diproteksi dan memerlukan token JWT yang valid.
// Middleware 'protect' akan dijalankan sebelum fungsi controller.
// Jika token valid, req.user akan berisi data pengguna.

// Rute untuk mendapatkan semua target milik pengguna yang login dan membuat target baru
router.route('/')
    .get(protect, getUserTargets)   // GET /api/targets
    .post(protect, createTarget);  // POST /api/targets

// Rute untuk mendapatkan, mengupdate, atau menghapus target spesifik berdasarkan ID
router.route('/:id')
    .get(protect, getTargetById)    // GET /api/targets/:id
    .put(protect, updateTarget)     // PUT /api/targets/:id
    .delete(protect, deleteTarget); // DELETE /api/targets/:id

module.exports = router;
