import katalogData from '../data/katalog.json';
import { createClient } from '@supabase/supabase-js';

export interface Category { id: string; name: string; slug: string; sort_order: number }
export interface Variant {
  id: string; product_id: string; name: string; sku: string; price: number; price_unit: string;
  min_qty: number | null; max_qty: number | null; process_time: string | null; freshness: string | null;
  order_lead: string | null; custom_color: boolean; greeting_revisable: boolean | null;
  includes_doll: boolean; image_url: string | null;
}
export interface Product {
  id: string; slug: string; name: string; base_price: number; stem_count: number | null;
  fotos: string[]; category: Category | null; variants: Variant[];
  source_name?: string; source_file?: string; source_page?: number; sort_order?: number;
}

const products = katalogData.products as Product[];
const categories = katalogData.categories as Category[];
const variantsById = new Map(products.flatMap((product) => product.variants.map((variant) => [variant.id, { ...variant, product }] as const)));

export const rupiah = (n: number) => 'Rp' + new Intl.NumberFormat('id-ID').format(n);
export const satuan: Record<string, string> = {
  per_buket: '', per_tangkai: '/tangkai', per_tangkai_dalam_buket: '/tangkai',
  per_meter: '/meter', per_pcs: '/pcs', per_triplek: '/triplek',
};

export function hargaMulai(p: Product) {
  const urut = [...p.variants].sort((a, b) => a.price - b.price);
  const min = urut[0], max = urut[urut.length - 1];
  if (!min) return 'Hubungi kami';
  const teks = rupiah(min.price) + (satuan[min.price_unit] ?? '');
  return max && min.price < max.price ? 'Mulai ' + teks : teks;
}

export function getKatalog() {
  return { products, categories };
}

export function getVarianLokal(ids: string[]) {
  return ids.map((id) => variantsById.get(id)).filter((item) => item !== undefined);
}

export interface Zona { id: string; name: string; fee: number }

export async function getZona(): Promise<Zona[]> {
  const supabase = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY
  );
  const { data, error } = await supabase
    .from('delivery_zones').select('id,name,fee').eq('is_active', true).order('name');
  if (error) throw new Error('Supabase: ' + error.message);
  return (data ?? []) as Zona[];
}
