import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function POST({ request }: { request: Request }) {
  try {
    const serverKey = import.meta.env.MIDTRANS_SERVER_KEY;
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serverKey || !supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Konfigurasi server belum lengkap.' }, 500);
    }

    const body = await request.json();
    const orderNo = String(body.order_id ?? '');
    const statusCode = String(body.status_code ?? '');
    const grossAmount = String(body.gross_amount ?? '');
    const signature = String(body.signature_key ?? '');

    if (!orderNo || !statusCode || !grossAmount || !signature) {
      return json({ error: 'Data notifikasi tidak lengkap.' }, 400);
    }

    const expected = createHash('sha512')
      .update(orderNo + statusCode + grossAmount + serverKey)
      .digest();

    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return json({ error: 'Tanda tangan notifikasi tidak valid.' }, 401);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: order, error: findError } = await db
      .from('orders')
      .select('id,payment_status,status')
      .eq('order_no', orderNo)
      .maybeSingle();

    if (findError) return json({ error: 'Gagal mencari pesanan.' }, 500);
    if (!order) return json({ error: 'Pesanan tidak ditemukan.' }, 404);

    const transactionStatus = String(body.transaction_status ?? '');
    const fraudStatus = String(body.fraud_status ?? '');
    const paymentType = body.payment_type ? String(body.payment_type) : null;

    let updates: Record<string, unknown> = { payment_type: paymentType };

    if (
      transactionStatus === 'settlement' ||
      (transactionStatus === 'capture' && fraudStatus === 'accept')
    ) {
      updates = {
        ...updates,
        payment_status: 'paid',
        status: 'paid',
        paid_at: new Date().toISOString(),
      };
    } else if (transactionStatus === 'expire') {
      updates = { ...updates, payment_status: 'expired', status: 'expired' };
    } else if (transactionStatus === 'deny' || transactionStatus === 'cancel') {
      updates = { ...updates, payment_status: 'failed', status: 'cancelled' };
    } else if (transactionStatus === 'pending') {
      updates = { ...updates, payment_status: 'unpaid', status: 'pending' };
    } else {
      return json({ received: true });
    }

    const { error: updateError } = await db
      .from('orders')
      .update(updates)
      .eq('id', order.id);

    if (updateError) return json({ error: 'Gagal memperbarui pesanan.' }, 500);

    return json({ received: true });
  } catch {
    return json({ error: 'Notifikasi Midtrans gagal diproses.' }, 500);
  }
}