import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
);

export interface Category { id: string; name: string; slug: string; sort_order: number | null }
export interface Variant {
  id: string; product_id: string; name: string; sku: string; price: number; price_unit: string;
  min_qty: number | null; max_qty: number | null; process_time: string | null; freshness: string | null;
  order_lead: string | null; custom_color: boolean; greeting_revisable: boolean | null;
  includes_doll: boolean; image_url: string | null;
}
export interface Product {
  id: string; slug: string; name: string; base_price: number; stem_count: number | null;
  fotos: string[]; category: Category | null; variants: Variant[];
}

export const rupiah = (n: number) => 'Rp' + new Intl.NumberFormat('id-ID').format(n);
export const satuan: Record<string, string> = {
  per_buket: '', per_tangkai: '/tangkai', per_tangkai_dalam_buket: '/tangkai',
};

export function hargaMulai(p: Product) {
  const urut = [...p.variants].sort((a, b) => a.price - b.price);
  const min = urut[0], max = urut[urut.length - 1];
  const teks = rupiah(min.price) + (satuan[min.price_unit] ?? '');
  return min.price < max.price ? 'Mulai ' + teks : teks;
}

export async function getKatalog() {
  const [c, p, v] = await Promise.all([
    supabase.from('categories').select('id,name,slug,sort_order').order('sort_order'),
    supabase.from('products')
      .select('id,slug,name,category_id,base_price,image_urls,stem_count')
      .eq('is_active', true).order('kode'),
    supabase.from('product_variants')
      .select('id,product_id,name,sku,price,price_unit,min_qty,max_qty,process_time,freshness,order_lead,custom_color,greeting_revisable,includes_doll,image_url')
      .eq('is_active', true).order('sort_order'),
  ]);
  for (const r of [c, p, v]) if (r.error) throw new Error('Supabase: ' + r.error.message);

  const kat = new Map<string, Category>((c.data ?? []).map((x: any) => [x.id, x]));
  const varian = new Map<string, Variant[]>();
  for (const x of (v.data ?? []) as Variant[]) {
    if (!varian.has(x.product_id)) varian.set(x.product_id, []);
    varian.get(x.product_id)!.push(x);
  }
  const products: Product[] = (p.data ?? [])
    .map((r: any) => ({
      id: r.id, slug: r.slug, name: r.name, base_price: r.base_price, stem_count: r.stem_count,
      fotos: Array.isArray(r.image_urls) ? r.image_urls : [],
      category: kat.get(r.category_id) ?? null,
      variants: varian.get(r.id) ?? [],
    }))
    .filter((x: Product) => x.variants.length > 0);

  const dipakai = new Set(products.map((x) => x.category?.id));
  const categories = [...kat.values()].filter((x) => dipakai.has(x.id));
  return { products, categories };
}

export interface Zona { id: string; name: string; fee: number }

export async function getZona(): Promise<Zona[]> {
  const { data, error } = await supabase
    .from('delivery_zones').select('id,name,fee').eq('is_active', true).order('name');
  if (error) throw new Error('Supabase: ' + error.message);
  return (data ?? []) as Zona[];
}
