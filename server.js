// celengan-api/server.js

// 1. Panggil dotenv.config() di paling atas
// Ini memastikan variabel lingkungan dari file .env dimuat sebelum digunakan oleh modul lain.
const dotenv = require('dotenv');
dotenv.config();

// 2. Impor modul-modul yang dibutuhkan
const express = require('express');
const cors = require('cors'); // Middleware untuk Cross-Origin Resource Sharing
const path = require('path'); // Modul path bawaan Node.js
const pool = require('./config/db'); // Opsional di sini, tapi baik untuk memastikan config db terpanggil jika belum

// Impor Modul Rute Anda
// Pastikan file-file ini sudah ada dan dikonfigurasi dengan benar untuk sistem PIN + JWT
const authRoutes = require('./routes/authRoutes');
const targetRoutes = require('./routes/targetRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

// 3. Inisialisasi aplikasi Express
const app = express();

// 4. Konfigurasi CORS (Cross-Origin Resource Sharing)
// ==================================================
// Whitelist berisi origin (domain) frontend yang diizinkan untuk mengakses backend ini.
const whitelist = [`https://celengan.sgp.dom.my.id`];

// Untuk pengembangan lokal, Anda mungkin ingin menambahkan origin localhost frontend Anda
// if (process.env.NODE_ENV !== 'production') {
//     whitelist.push('http://localhost:PORT_FRONTEND_ANDA'); // Ganti PORT_FRONTEND_ANDA
//     whitelist.push('http://127.0.0.1:PORT_FRONTEND_ANDA');
// }

const corsOptions = {
    origin: function (origin, callback) {
        // Izinkan request jika origin ada di whitelist
        // Juga izinkan request tanpa origin (misalnya, dari Postman, aplikasi mobile, atau curl saat pengujian)
        if (!origin || whitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`CORS: Akses dari origin ${origin} ditolak oleh konfigurasi.`);
            callback(new Error('Origin ini tidak diizinkan oleh kebijakan CORS server.'));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE", // Metode HTTP yang diizinkan
    allowedHeaders: "Content-Type,Authorization,X-Requested-With", // Header yang diizinkan (Authorization penting untuk JWT)
    credentials: true, // Izinkan pengiriman cookies atau header Authorization
    optionsSuccessStatus: 200 // Beberapa browser lama mungkin bermasalah dengan default 204 untuk preflight request
};

app.use(cors(corsOptions)); // Terapkan konfigurasi CORS ke semua rute
// ==================================================

// 5. Middleware Global Lainnya
app.use(express.json()); // Untuk mem-parsing body request dengan format JSON
app.use(express.urlencoded({ extended: false })); // Untuk mem-parsing body request dengan format URL-encoded

// 6. Middleware untuk Menyajikan File Statis dari folder 'public'
// Berguna jika Anda ingin backend menyajikan frontend Anda (index.html, css, js).
app.use(express.static(path.join(__dirname, 'public')));

// 7. Gunakan Modul Rute API
// Semua permintaan ke /api/auth akan ditangani oleh authRoutes, dst.
// Pastikan di dalam file-file rute ini, middleware 'protect' (JWT) dan rate-limiter (untuk login PIN) sudah diterapkan dengan benar.
app.use('/api/auth', authRoutes);
app.use('/api/targets', targetRoutes);
app.use('/api/transactions', transactionRoutes);

// 8. Rute Dasar untuk API (Opsional, untuk tes cepat)
app.get('/api', (req, res) => {
    res.json({
        message: 'Selamat Datang di Celengan API!',
        status: 'Aktif',
        authenticationMode: 'PIN + JWT',
        timestamp: new Date().toISOString()
    });
});

// 9. Penanganan Rute Frontend (Untuk Single Page Application - SPA)
// Jika Anda tidak membuat SPA yang kompleks, bagian ini bisa diabaikan atau disesuaikan.
// Pastikan ini diletakkan SETELAH semua rute API Anda.
app.get('*', (req, res) => {
    // Hanya kirim index.html jika request BUKAN untuk API
    if (!req.path.startsWith('/api/')) {
        const indexPath = path.join(__dirname, 'public', 'index.html');
        if (require('fs').existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            res.status(404).send('Halaman frontend (index.html) tidak ditemukan di folder public. Pastikan file tersebut ada dan path static serving sudah benar.');
        }
    } else {
        // Jika request adalah untuk /api tapi tidak ada rute yang cocok, kirim 404 JSON
        res.status(404).json({ message: `Endpoint API '${req.path}' tidak ditemukan.` });
    }
});


// 10. Middleware Error Handling Global Sederhana
// Akan menangkap semua error yang tidak tertangani oleh rute spesifik.
app.use((err, req, res, next) => {
    console.error("!! Terjadi Error Tidak Tertangani di Server !!");
    console.error("Pesan Error:", err.message);
    if (process.env.NODE_ENV !== 'production') { // Hanya tampilkan stack di mode development
        console.error("Stack Trace:", err.stack);
    }
    
    const status = err.status || 500;
    // Di produksi, jangan kirim pesan error teknis ke klien untuk error 500
    const responseMessage = (process.env.NODE_ENV === 'production' && status === 500)
                          ? 'Terjadi kesalahan internal pada server.' 
                          : err.message || 'Terjadi kesalahan pada server.';
    
    res.status(status).json({
        message: responseMessage,
    });
});

// 11. Jalankan Server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Penting untuk Railway dan platform serupa

app.listen(PORT, HOST, () => {
    console.log(`\n🚀 Server Backend Celengan Digital Anda Berhasil Dijalankan! 🚀`);
    console.log(`-----------------------------------------------------------------`);
    console.log(`  🏷️  Mode Aplikasi   : ${process.env.NODE_ENV === 'production' ? 'Produksi (Disarankan HTTPS)' : 'Pengembangan (HTTP)'}`);
    console.log(`  💻 Host            : ${HOST} (Menerima koneksi dari semua alamat IP)`);
    console.log(`  🔌 Port            : ${PORT}`);
    console.log(`-----------------------------------------------------------------`);
    console.log(`  🔗 Link Akses yang Mungkin (sesuaikan protokol & konfigurasi jaringan Anda):`);
    console.log(``);
    console.log(`     🏠 Akses dari Mesin Lokal (komputer ini):`);
    console.log(`        HTTP  : http://localhost:${PORT}`);
    console.log(`        HTTP  : http://127.0.0.1:${PORT}`);
    console.log(``);
    console.log(`     🌐 Akses dari Jaringan Lokal (LAN, misal dari HP di WiFi yang sama):`);
    console.log(`        HTTP  : http://[ALAMAT_IP_LOKAL_SERVER_ANDA]:${PORT}`);
    console.log(`        (Untuk menemukan IP Lokal: 'ipconfig' di Windows, 'ifconfig' atau 'ip addr' di Linux/macOS)`);
    console.log(``);
    console.log(`     ☁️  Akses dari Publik (Jika server Anda memiliki IP Publik/domain & port terbuka):`);
    console.log(`        URL Anda: https://celengan.up.railway.app (Railway biasanya menangani port publik 80/443)`);
    console.log(``);
    console.log(`  ✨ Endpoint API Utama biasanya ada di /api`);
    console.log(`     Contoh: https://celengan.up.railway.app/api/auth/profile`);
    console.log(`-----------------------------------------------------------------`);
    console.log(`  PENTING untuk https://celengan.sgp.dom.my.id/:`);
    console.log(`  ➡️ Backend Anda di https://celengan.up.railway.app/ HARUS berjalan di HTTPS.`);
    console.log(`  ➡️ Konfigurasi CORS di atas sudah mencoba mengizinkan https://celengan.sgp.dom.my.id/.`);
    console.log(`  ➡️ Pastikan semua variabel lingkungan (DB, JWT_SECRET) sudah diatur dengan benar di Railway.`);
    console.log(`-----------------------------------------------------------------\n`);
});
