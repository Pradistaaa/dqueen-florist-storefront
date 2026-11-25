import { Buffer } from 'node:buffer';
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getVarianLokal } from '../../lib/katalog';

export const prerender = false;

const db = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const wajib = [
      'customer_name', 'customer_phone', 'recipient_name',
      'recipient_phone', 'recipient_address', 'delivery_zone_id',
      'delivery_date',
    ];

    if (wajib.some((key) => !String(body[key] ?? '').trim())) {
      return json({ error: 'Lengkapi data pemesan dan pengiriman.' }, 400);
    }

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 50) {
      return json({ error: 'Keranjang kosong atau tidak valid.' }, 400);
    }

    const qtyByVariant = new Map<string, number>();
    for (const item of items) {
      const id = String(item.variantId ?? '');
      const qty = Number(item.qty);
      if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        return json({ error: 'Produk atau jumlah tidak valid.' }, 400);
      }
      qtyByVariant.set(id, Math.min(99, (qtyByVariant.get(id) ?? 0) + qty));
    }

    const ids = [...qtyByVariant.keys()];
    const variants = getVarianLokal(ids);
    const { data: zone, error: zoneError } = await db.from('delivery_zones')
      .select('id,fee')
      .eq('id', body.delivery_zone_id)
      .eq('is_active', true)
      .maybeSingle();

    if (variants.length !== ids.length) {
      return json({ error: 'Ada produk yang sudah tidak tersedia. Muat ulang keranjang.' }, 400);
    }
    if (zoneError || !zone) {
      return json({ error: 'Zona pengiriman tidak tersedia.' }, 400);
    }
    if (variants.some((v) => v.price_unit !== 'per_buket')) {
      return json({ error: 'Ada varian yang belum bisa dipesan online.' }, 400);
    }

    const subtotal = variants.reduce(
      (sum, v) => sum + Number(v.price) * qtyByVariant.get(v.id)!,
      0
    );
    const shippingFee = Number(zone.fee);

    const { data: order, error: orderError } = await db
      .from('orders')
      .insert({
        customer_name: String(body.customer_name).trim(),
        customer_phone: String(body.customer_phone).trim(),
        recipient_name: String(body.recipient_name).trim(),
        recipient_phone: String(body.recipient_phone).trim(),
        recipient_address: String(body.recipient_address).trim(),
        delivery_zone_id: zone.id,
        delivery_date: body.delivery_date,
        delivery_slot: body.delivery_slot || null,
        card_message: body.card_message || null,
        notes: body.notes || null,
        subtotal,
        discount: 0,
        shipping_fee: shippingFee,
        total: subtotal + shippingFee,
        coupon_code: null,
        status: 'pending',
        payment_status: 'unpaid',
      })
      .select('id,order_no,total')
      .single();

    if (orderError || !order) {
      return json({ error: 'Pesanan belum berhasil disimpan. Coba lagi.' }, 500);
    }

    const orderItems = variants.map((v) => ({
      order_id: order.id,
      product_id: null,
      variant_id: null,
      product_name: v.product.name,
      variant_name: v.name,
      unit_price: v.price,
      qty: qtyByVariant.get(v.id)!,
    }));

    const { error: itemError } = await db.from('order_items').insert(orderItems);
    if (itemError) {
      await db.from('orders').delete().eq('id', order.id);
      return json({ error: 'Pesanan belum berhasil disimpan. Coba lagi.' }, 500);
    }

    const serverKey = import.meta.env.MIDTRANS_SERVER_KEY;
if (!serverKey) {
  return json({ error: 'Server Key Sandbox belum terbaca.' }, 500);
}

const itemDetails = variants.map((v) => ({
  id: v.id,
  price: Number(v.price),
  quantity: qtyByVariant.get(v.id)!,
  name: String(v.name).slice(0, 50),
}));

if (shippingFee > 0) {
  itemDetails.push({
    id: 'ongkir',
    price: shippingFee,
    quantity: 1,
    name: 'Ongkos kirim',
  });
}

const finishUrl = new URL('/lacak-pesanan', request.url);
finishUrl.searchParams.set('orderNo', order.order_no);

const snapResponse = await fetch(
  'https://app.sandbox.midtrans.com/snap/v1/transactions',
  {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: order.order_no,
        gross_amount: Number(order.total),
      },
      customer_details: {
        first_name: String(body.customer_name).trim(),
        phone: String(body.customer_phone).trim(),
      },
      item_details: itemDetails,
      callbacks: { finish: finishUrl.toString() },
    }),
  }
);

const snap = await snapResponse.json();

console.error('Midtrans response:', snapResponse.status, JSON.stringify(snap));

if (!snapResponse.ok || !snap.token || !snap.redirect_url) {
  await db.from('orders')
    .update({ status: 'cancelled', payment_status: 'failed' })
    .eq('id', order.id);

  return json({
  error: 'Midtrans belum berhasil membuat pembayaran.',
  detail: snap.error_messages ?? snap.message ?? 'Tidak ada detail dari Midtrans.',
}, 502);
}

await db.from('orders')
  .update({
    midtrans_order_id: order.order_no,
    snap_token: snap.token,
    expires_at: snap.expiry_time ?? null,
  })
  .eq('id', order.id);

return json({
  orderNo: order.order_no,
  total: order.total,
  redirectUrl: snap.redirect_url,
}, 201);

  } catch {
    return json({ error: 'Permintaan pesanan tidak valid.' }, 400);
  }
};
