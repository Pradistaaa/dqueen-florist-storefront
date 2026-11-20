import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const db = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

export const POST: APIRoute = async ({ request }) => {
  try {
    const { orderNo, phone } = await request.json();

    if (!orderNo || !phone) {
      return json({ error: 'Isi nomor pesanan dan nomor HP pemesan.' }, 400);
    }

    const { data, error } = await db
      .from('orders')
      .select(
        'order_no,customer_phone,status,payment_status,delivery_date,tracking_carrier,tracking_number,tracking_url,status_updated_at'
      )
      .eq('order_no', String(orderNo).trim())
      .maybeSingle();

    const digits = (value: string) => value.replace(/\D/g, '');
    if (
      error ||
      !data ||
      digits(data.customer_phone) !== digits(String(phone))
    ) {
      return json({ error: 'Nomor pesanan atau nomor HP tidak cocok.' }, 404);
    }

    return json({
      orderNo: data.order_no,
      status: data.status,
      paymentStatus: data.payment_status,
      deliveryDate: data.delivery_date,
      carrier: data.tracking_carrier,
      trackingNumber: data.tracking_number,
      trackingUrl: data.tracking_url,
      updatedAt: data.status_updated_at,
    });
  } catch {
    return json({ error: 'Permintaan cek status tidak valid.' }, 400);
  }
};