import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const db = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export const GET: APIRoute = async () => {
  const penjualan: Record<string, number> = {};
  const ukuranHalaman = 1000;

  for (let awal = 0; ; awal += ukuranHalaman) {
    const { data, error } = await db
      .from('order_items')
      .select('product_name,qty,orders!inner(payment_status)')
      .eq('orders.payment_status', 'paid')
      .range(awal, awal + ukuranHalaman - 1);

    if (error) {
      return new Response(JSON.stringify({ error: 'Jumlah penjualan belum bisa dimuat.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    for (const item of data ?? []) {
      penjualan[item.product_name] = (penjualan[item.product_name] ?? 0) + Number(item.qty ?? 0);
    }

    if (!data || data.length < ukuranHalaman) break;
  }

  return new Response(JSON.stringify({ penjualan }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
};
