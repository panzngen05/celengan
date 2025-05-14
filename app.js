// celengan-api/server.js

// 1. Panggil dotenv.config() di paling atas
// Ini memastikan variabel lingkungan dari file .env dimuat sebelum digunakan oleh modul lain.
const dotenv = require('dotenv');
dotenv.config();

// 2. Impor modul-modul yang dibutuhkan
const express = require('express');
const cors = require('cors'); // Untuk menangani Cross-Origin Resource Sharing
const path = require('path'); // Modul path bawaan Node.js
const pool = require('./config/db'); // Impor pool untuk inisialisasi (opsional di sini, tapi baik untuk memastikan config db terpanggil)

// Impor Modul Rute Anda
// Pastikan file-file ini sudah ada dan dikonfigurasi dengan benar untuk sistem PIN + JWT
const authRoutes = require('./routes/authRoutes');
const targetRoutes = require('./routes/targetRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

// 3. Inisialisasi aplikasi Express
const app = express();

// 4. Konfigurasi CORS (Cross-Origin Resource Sharing)
const whitelist = [`https://celengan.sgp.dom.my.id`]; // Domain frontend Anda

if (process.env.NODE_ENV !== 'production') {
    // Izinkan localhost untuk pengembangan jika frontend juga dijalankan lokal
    // Sesuaikan port frontend lokal Anda jika berbeda (misal 5173 untuk Vite, 3001 untuk create-react-app dev server)
    whitelist.push('http://localhost:5173');
    whitelist.push('http://localhost:3001');
    whitelist.push('http://127.0.0.1:5173');
    whitelist.push('http://127.0.0.1:3001'); // Tambahkan port frontend dev Anda jika perlu
}

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || whitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`CORS: Akses dari origin ${origin} ditolak oleh konfigurasi CORS.`);
            callback(new Error('Origin ini tidak diizinkan oleh kebijakan CORS server.'));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: "Content-Type,Authorization,X-Requested-With",
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// 5. Middleware Global Lainnya
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 6. Middleware untuk Menyajikan File Statis dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// 7. Gunakan Modul Rute API
app.use('/api/auth', authRoutes);
app.use('/api/targets', targetRoutes);
app.use('/api/transactions', transactionRoutes);

// 8. Rute Dasar untuk API (Opsional, untuk tes)
app.get('/api', (req, res) => {
    res.json({
        message: 'Selamat Datang di Celengan API!',
        status: 'Aktif',
        authenticationMode: 'PIN + JWT',
        timestamp: new Date().toISOString()
    });
});

// 9. Penanganan Rute Frontend (Untuk SPA)
// Pastikan ini diletakkan SETELAH semua rute API Anda.
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        const indexPath = path.join(__dirname, 'public', 'index.html');
        if (require('fs').existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            // Jika index.html tidak ada, kirim pesan yang lebih informatif daripada error default
            res.status(404).send('Halaman frontend (index.html) tidak ditemukan di folder public. Pastikan file tersebut ada.');
        }
    } else {
        // Jika path dimulai dengan /api tapi tidak cocok dengan rute API di atas,
        // Express akan otomatis mengirim 404 atau biarkan middleware error di bawah menangani.
        // Memberikan respons JSON untuk endpoint API yang tidak ditemukan lebih baik.
        res.status(404).json({ message: `Endpoint API '${req.path}' tidak ditemukan.` });
    }
});

// 10. Middleware Error Handling Global Sederhana
app.use((err, req, res, next) => {
    console.error("!! Terjadi Error Tidak Tertangani di Server !!");
    console.error("Pesan Error:", err.message);
    // Jangan kirim stack trace ke klien di mode produksi untuk keamanan
    if (process.env.NODE_ENV !== 'production') {
        console.error("Stack Trace:", err.stack);
    }
    
    const status = err.status || 500;
    const responseMessage = (process.env.NODE_ENV === 'production' && status === 500)
                          ? 'Terjadi kesalahan internal pada server.' 
                          : err.message || 'Terjadi kesalahan pada server.';
    
    res.status(status).json({
        message: responseMessage,
        // Hanya sertakan stack di pengembangan jika eksplisit diinginkan dan bukan error sensitif
        // stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined 
    });
});

// 11. Jalankan Server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Mendengarkan pada semua antarmuka jaringan

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
    console.log(`        HTTP  : http://[IP_PUBLIK_SERVER_ANDA_ATAU_NAMA_DOMAIN]:${PORT}`);
    console.log(`        Contoh : http://138.2.103.58:${PORT} (jika ini IP publik server Anda dan port ${PORT} terbuka)`);
    console.log(``);
    console.log(`  ✨ Endpoint API Utama biasanya ada di /api`);
    console.log(`     Contoh: http://localhost:${PORT}/api/auth/profile (jika diuji lokal)`);
    console.log(`-----------------------------------------------------------------`);
    console.log(`  PENTING:`);
    console.log(`  ➡️ Jika frontend Anda berjalan di HTTPS (misalnya https://celengan.sgp.dom.my.id/),`);
    console.log(`     maka backend ini juga HARUS berjalan di HTTPS untuk menghindari error "Mixed Content".`);
    console.log(`     Konfigurasi HTTPS di Node.js/Express memerlukan sertifikat SSL dan penanganan tambahan.`);
    console.log(`  ➡️ Pastikan firewall (jika ada) di server Anda mengizinkan koneksi masuk ke port ${PORT}.`);
    console.log(`  ➡️ Jika \`API_BASE_URL\` di frontend Anda adalah domain publik, backend ini juga harus bisa diakses dari publik.`);
    console.log(`-----------------------------------------------------------------\n`);
});
