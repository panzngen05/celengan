// celengan-api/services/paymentService.js

const pool = require('../config/db'); // Pastikan path ini benar

/**
 * Mengkonfirmasi deposit ke target setelah pembayaran (manual atau QRIS konfirmasi user).
 * Fungsi ini akan mengupdate saldo target dan mencatat transaksi.
 * @param {number} userId ID pengguna
 * @param {number} targetId ID target
 * @param {number} amount Jumlah yang dideposit
 * @param {string} description Deskripsi transaksi
 * @param {string} paymentRef Referensi pembayaran (misal, QRIS_USER_CONFIRMED_XYZ atau MANUAL_XYZ)
 * @returns {Promise<object>} Hasil operasi, termasuk ID transaksi baru
 * @throws {Error} Jika terjadi kesalahan selama proses
 */
async function confirmTargetDeposit(userId, targetId, amount, description, paymentRef) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [targets] = await connection.query(
            'SELECT * FROM targets WHERE id = ? AND user_id = ? FOR UPDATE',
            [targetId, userId]
        );

        if (targets.length === 0) {
            throw new Error('Target tidak ditemukan atau bukan milik pengguna yang sah.');
        }
        const target = targets[0];

        // Meskipun konfirmasi manual, tetap cek status target sebelumnya
        if (target.status === 'tercapai' && parseFloat(target.jumlah_terkumpul) >= parseFloat(target.jumlah_target)) {
            // Jika Anda ingin mencegah deposit ke target yang sudah tercapai penuh
            // throw new Error('Target sudah tercapai penuh, tidak bisa melakukan deposit lagi.');
             console.warn(`Melakukan deposit ke target (${targetId}) yang statusnya sudah 'tercapai'. Saldo akan tetap bertambah.`);
        }

        const newJumlahTerkumpul = parseFloat(target.jumlah_terkumpul) + parseFloat(amount);
        let newStatus = target.status;

        if (newJumlahTerkumpul >= parseFloat(target.jumlah_target)) {
            newStatus = 'tercapai';
        }
        // Jika sebelumnya sudah 'tercapai' dan ditambah lagi, status tetap 'tercapai'
        else if (target.status === 'tercapai' && newJumlahTerkumpul < parseFloat(target.jumlah_target)){
             newStatus = 'aktif'; // Jika saldo jadi di bawah target lagi (misal ada penarikan nanti)
        }


        await connection.query(
            'UPDATE targets SET jumlah_terkumpul = ?, status = ? WHERE id = ?',
            [newJumlahTerkumpul, newStatus, targetId]
        );

        const [result] = await connection.query(
            'INSERT INTO transactions (target_id, user_id, jenis_transaksi, jumlah, deskripsi, payment_gateway_ref) VALUES (?, ?, ?, ?, ?, ?)',
            [targetId, userId, 'deposit', parseFloat(amount), description, paymentRef]
        );

        await connection.commit();

        return {
            message: 'Deposit berhasil dikonfirmasi dan dicatat.',
            transaction_id: result.insertId,
            target_id: targetId,
            new_jumlah_terkumpul: newJumlahTerkumpul,
            target_status: newStatus
        };
    } catch (error) {
        await connection.rollback();
        console.error("Error dalam proses konfirmasi deposit (paymentService):", error.message);
        throw new Error(error.message || 'Gagal mengkonfirmasi deposit ke target.');
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

module.exports = {
    confirmTargetDeposit
};
