// celengan-api/services/paymentService.js (CONTOH FILE BARU)
const pool = require('../config/db');

/**
 * Mengkonfirmasi deposit ke target setelah pembayaran berhasil.
 * @param {number} userId ID pengguna
 * @param {number} targetId ID target
 * @param {number} amount Jumlah yang dideposit
 * @param {string} description Deskripsi transaksi
 * @param {string} paymentRef Referensi pembayaran (misal, panzngen_keyorkut atau our_transaction_ref)
 * @returns {Promise<object>} Hasil operasi
 */
async function confirmTargetDeposit(userId, targetId, amount, description, paymentRef) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [targets] = await connection.query(
            'SELECT * FROM targets WHERE id = ? AND user_id = ?',
            [targetId, userId]
        );

        if (targets.length === 0) {
            throw new Error('Target tidak ditemukan atau bukan milik pengguna.');
        }
        const target = targets[0];

        if (target.status === 'tercapai') {
            throw new Error('Target sudah tercapai, tidak bisa deposit lagi.');
        }

        const newJumlahTerkumpul = parseFloat(target.jumlah_terkumpul) + parseFloat(amount);
        let newStatus = target.status;

        if (newJumlahTerkumpul >= parseFloat(target.jumlah_target)) {
            newStatus = 'tercapai';
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
        console.error("Error dalam confirmTargetDeposit:", error.message);
        throw error; // Lempar error agar bisa ditangani oleh pemanggil
    } finally {
        if (connection) connection.release();
    }
}

module.exports = { confirmTargetDeposit };
