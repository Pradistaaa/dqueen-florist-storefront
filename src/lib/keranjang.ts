// Keranjang disimpan di browser (localStorage). Harga di sini HANYA untuk tampilan:
// saat checkout, server menghitung ulang harga dari database berdasarkan variantId.
const KUNCI = 'dq-keranjang';

export interface Item {
  variantId: string; qty: number; produk: string; varian: string;
  harga: number; foto: string; slug: string;
}

export const rupiah = (n: number) => 'Rp' + new Intl.NumberFormat('id-ID').format(n);

export function ambil(): Item[] {
  try {
    const d = JSON.parse(localStorage.getItem(KUNCI) ?? '[]');
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

function simpan(items: Item[]) {
  localStorage.setItem(KUNCI, JSON.stringify(items));
  window.dispatchEvent(new Event('keranjang:berubah'));
}

export function tambah(item: Omit<Item, 'qty'>, qty = 1) {
  const items = ambil();
  const ada = items.find((i) => i.variantId === item.variantId);
  if (ada) ada.qty = Math.min(99, ada.qty + qty);
  else items.push({ ...item, qty });
  simpan(items);
}

export function ubahQty(variantId: string, qty: number) {
  const items = ambil()
    .map((i) => (i.variantId === variantId ? { ...i, qty: Math.min(99, qty) } : i))
    .filter((i) => i.qty > 0);
  simpan(items);
}

export function hapus(variantId: string) {
  simpan(ambil().filter((i) => i.variantId !== variantId));
}

export const kosongkan = () => simpan([]);
export const jumlah = () => ambil().reduce((n, i) => n + i.qty, 0);
export const subtotal = () => ambil().reduce((n, i) => n + i.qty * i.harga, 0);
