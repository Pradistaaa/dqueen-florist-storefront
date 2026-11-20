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

    const notice = await request.json();
    const orderNo = String(notice.order_id ?? '');

    if (!orderNo) return json({ error: 'Nomor pesanan tidak ada.' }, 400);

    const statusResponse = await fetch(
      `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(orderNo)}/status`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
          Accept: 'application/json',
        },
      }
    );

    const transaction = await statusResponse.json();

    if (!statusResponse.ok) {
      console.error('Midtrans status check failed:', statusResponse.status, transaction);
      return json({ error: 'Midtrans gagal memverifikasi status transaksi.' }, 502);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: order, error: findError } = await db
      .from('orders')
      .select('id')
      .eq('order_no', orderNo)
      .maybeSingle();

    if (findError) return json({ error: 'Gagal mencari pesanan.' }, 500);
    if (!order) return json({ error: 'Pesanan tidak ditemukan.' }, 404);

    const transactionStatus = String(transaction.transaction_status ?? '');
    const fraudStatus = String(transaction.fraud_status ?? '');
    const paymentType = transaction.payment_type
      ? String(transaction.payment_type)
      : null;

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
    } else {
      return json({ received: true });
    }

    const { error: updateError } = await db
      .from('orders')
      .update(updates)
      .eq('id', order.id);

    if (updateError) {
      console.error('Order payment update failed:', updateError.message);
      return json({ error: 'Gagal memperbarui pesanan.' }, 500);
    }

    return json({ received: true });
  } catch (error) {
    console.error(
      'Midtrans notification handler failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return json({ error: 'Notifikasi Midtrans gagal diproses.' }, 500);
  }
}