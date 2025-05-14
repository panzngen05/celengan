// /app/services/paymentService.js  (atau celengan-api/services/paymentService.js)

const pool = require('../config/db'); // Pastikan path ke config/db.js ini benar dari folder services

/**
 * Mengkonfirmasi deposit ke target setelah pembayaran berhasil.
 * Fungsi ini akan mengupdate saldo target dan mencatat transaksi.
 * @param {number} userId ID pengguna
 * @param {number} targetId ID target
 * @param {number} amount Jumlah yang dideposit
 * @param {string} description Deskripsi transaksi
 * @param {string} paymentRef Referensi pembayaran (misal, panzngen_keyorkut atau our_transaction_ref)
 * @returns {Promise<object>} Hasil operasi, termasuk ID transaksi baru
 * @throws {Error} Jika terjadi kesalahan selama proses
 */
async function confirmTargetDeposit(userId, targetId, amount, description, paymentRef) {
    const connection = await pool.getConnection(); // Dapatkan koneksi dari pool
    try {
        await connection.beginTransaction(); // Mulai transaksi database

        // 1. Ambil data target untuk validasi dan update
        const [targets] = await connection.query(
            'SELECT * FROM targets WHERE id = ? AND user_id = ? FOR UPDATE', // FOR UPDATE untuk locking jika perlu
            [targetId, userId]
        );

        if (targets.length === 0) {
            throw new Error('Target tidak ditemukan atau bukan milik pengguna yang sah.');
        }
        const target = targets[0];

        // Cek apakah target sudah tercapai
        if (target.status === 'tercapai') {
            // Bisa jadi Anda ingin mengizinkan over-deposit, atau tidak. Sesuaikan.
            // Untuk saat ini, kita anggap tidak bisa deposit lagi jika sudah tercapai.
            // Atau, jika ini adalah konfirmasi pembayaran yang sudah diinisiasi, mungkin logika ini perlu disesuaikan.
            // throw new Error('Target sudah tercapai, tidak bisa melakukan deposit lagi.');
            console.warn(`Melakukan deposit ke target (${targetId}) yang statusnya sudah 'tercapai'. Saldo akan tetap bertambah.`);
        }

        // 2. Update jumlah terkumpul dan status target
        const newJumlahTerkumpul = parseFloat(target.jumlah_terkumpul) + parseFloat(amount);
        let newStatus = target.status;

        // Jika deposit ini membuat target tercapai (atau sudah tercapai dan ditambah lagi)
        if (newJumlahTerkumpul >= parseFloat(target.jumlah_target) && target.status !== 'tercapai') {
            newStatus = 'tercapai';
        }
        // Jika target sudah tercapai sebelumnya, statusnya tetap 'tercapai'
        if (target.status === 'tercapai') {
            newStatus = 'tercapai';
        }


        await connection.query(
            'UPDATE targets SET jumlah_terkumpul = ?, status = ? WHERE id = ?',
            [newJumlahTerkumpul, newStatus, targetId]
        );

        // 3. Catat transaksi di tabel 'transactions'
        const [result] = await connection.query(
            'INSERT INTO transactions (target_id, user_id, jenis_transaksi, jumlah, deskripsi, payment_gateway_ref) VALUES (?, ?, ?, ?, ?, ?)',
            [targetId, userId, 'deposit', parseFloat(amount), description, paymentRef]
        );

        await connection.commit(); // Commit semua perubahan jika berhasil

        return {
            message: 'Deposit berhasil dikonfirmasi dan dicatat.',
            transaction_id: result.insertId,
            target_id: targetId,
            new_jumlah_terkumpul: newJumlahTerkumpul,
            target_status: newStatus
        };
    } catch (error) {
        await connection.rollback(); // Batalkan semua perubahan jika ada error
        console.error("Error dalam proses konfirmasi deposit (paymentService):", error.message);
        // Lempar error lagi agar bisa ditangani oleh fungsi pemanggil di controller
        throw new Error(error.message || 'Gagal mengkonfirmasi deposit ke target.');
    } finally {
        if (connection) {
            connection.release(); // Selalu lepaskan koneksi kembali ke pool
        }
    }
}

module.exports = {
    confirmTargetDeposit
};
