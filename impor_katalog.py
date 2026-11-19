"""
Impor katalog-dqueen.xlsx + folder foto/ ke Supabase (categories, products, product_variants, bucket "produk").
Jalankan 02_sesuaikan_tabel.sql dulu.

Pakai (PowerShell, di folder proyek yang ada .env):
    pip install openpyxl requests
    python impor_katalog.py "D:\\hasil\\katalog-dqueen.xlsx" --dry-run     # tes dulu, tidak kirim apa-apa
    python impor_katalog.py "D:\\hasil\\katalog-dqueen.xlsx"               # impor sungguhan

Folder foto dicari di sebelah file xlsx (nama folder: foto). Bisa diganti: --foto "D:\\hasil\\foto"
Aman dijalankan ulang: data di-upsert (berdasarkan kode produk dan SKU), foto ditimpa.
.env harus berisi PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (kunci rahasia, jangan dikirim ke siapa pun).
"""
import argparse, math, re, sys
from pathlib import Path

from openpyxl import load_workbook

BUCKET = "produk"
UNIT = {
    "per buket": "per_buket",
    "per tangkai": "per_tangkai",
    "per tangkai (dalam 1 buket)": "per_tangkai_dalam_buket",
}


def baca_env(path):
    env = {}
    p = Path(path)
    if not p.exists():
        return env
    for ln in p.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#") or "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def kosong(v):
    return v is None or (isinstance(v, float) and math.isnan(v)) or (isinstance(v, str) and not v.strip())


def teks(v):
    return None if kosong(v) else str(v).strip()


def angka(v):
    return None if kosong(v) else int(round(float(v)))


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "produk"


def baca_sheet(wb, nama):
    ws = wb[nama]
    rows = ws.iter_rows(values_only=True)
    head = [str(h).strip() if h is not None else "" for h in next(rows)]
    out = []
    for r in rows:
        d = dict(zip(head, r))
        if not kosong(d.get(head[0])):
            out.append(d)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--foto", default=None)
    ap.add_argument("--env", default=".env")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    xlsx = Path(a.xlsx)
    foto_dir = Path(a.foto) if a.foto else xlsx.parent / "foto"
    wb = load_workbook(xlsx, data_only=True)
    produk_rows = baca_sheet(wb, "Produk")
    varian_rows = baca_sheet(wb, "Varian")

    # ---- susun data produk
    produk, slug_dipakai = [], set()
    for r in produk_rows:
        kode = teks(r["id_produk"])
        nama = teks(r["nama_produk"])
        slug = slugify(nama)
        if slug in slug_dipakai:
            slug = f"{slug}-{kode.lower()}"
        slug_dipakai.add(slug)
        produk.append(dict(kode=kode, slug=slug, name=nama, category=teks(r["kategori"]) or "Lainnya",
                           flower_type=teks(r.get("jenis_bunga")), stem_count=angka(r.get("jumlah_tangkai")),
                           is_active=True))
    kode_set = {p["kode"] for p in produk}

    # ---- susun data varian
    varian, urut, foto_pakai = [], {}, set()
    for r in varian_rows:
        kode = teks(r["id_produk"])
        if kode not in kode_set:
            print(f"! SKU {r['sku']}: id_produk {kode} tidak ada di sheet Produk, dilewati")
            continue
        if kosong(r["harga"]):
            print(f"! SKU {r['sku']}: harga kosong, dilewati")
            continue
        unit = UNIT.get(str(r["satuan"]).strip().lower())
        if not unit:
            print(f"! SKU {r['sku']}: satuan '{r['satuan']}' tidak dikenal, dianggap per_buket")
            unit = "per_buket"
        urut[kode] = urut.get(kode, 0) + 1
        foto = teks(r.get("file_foto"))
        if foto and not (foto_dir / foto).exists():
            alt = foto.replace(".jpg", "_a.jpg")       # halaman dengan 2+ foto disimpan sebagai _a, _b
            if (foto_dir / alt).exists():
                print(f"  {foto} tidak ada, pakai {alt} untuk {r['sku']}")
                foto = alt
        if foto:
            foto_pakai.add(foto)
        rev = teks(r.get("ucapan_bisa_direvisi"))
        varian.append(dict(
            sku=teks(r["sku"]), kode=kode, name=teks(r["nama_varian"]) or f"Model {urut[kode]}",
            price=angka(r["harga"]), price_unit=unit,
            min_qty=angka(r.get("min_qty")), max_qty=angka(r.get("max_qty")),
            process_time=teks(r.get("proses")), freshness=teks(r.get("ketahanan")),
            order_lead=teks(r.get("pemesanan")),
            custom_color=teks(r.get("custom_warna")) == "Ya",
            greeting_revisable=None if rev is None else rev.lower() != "tidak",
            includes_doll=teks(r.get("include_boneka")) == "Ya",
            photo_label=teks(r.get("label_di_foto")), image_path=foto,
            needs_review=teks(r.get("perlu_dicek")) == "Ya", review_note=teks(r.get("catatan")),
            sort_order=urut[kode], is_active=True))

    # foto semua varian (unik, berurutan) dan harga dasar (termurah) per produk
    fotos_by, harga_by = {}, {}
    for v in varian:
        if v["image_path"] and v["image_path"] not in fotos_by.setdefault(v["kode"], []):
            fotos_by[v["kode"]].append(v["image_path"])
        harga_by[v["kode"]] = min(harga_by.get(v["kode"], v["price"]), v["price"])
    for p in produk:
        p["fotos"] = fotos_by.get(p["kode"], [])
        p["base_price"] = harga_by.get(p["kode"], 0)

    hilang = sorted(f for f in foto_pakai if not (foto_dir / f).exists())
    print(f"Produk: {len(produk)} | Varian: {len(varian)} | Foto dipakai: {len(foto_pakai)}")
    print(f"Varian perlu dicek: {sum(v['needs_review'] for v in varian)}")
    if hilang:
        print(f"! Foto tidak ketemu di {foto_dir}: {', '.join(hilang[:10])}" + (" ..." if len(hilang) > 10 else ""))
    if a.dry_run:
        print("\n--dry-run: tidak ada yang dikirim. Contoh produk pertama:")
        print(produk[0])
        print("Contoh varian pertama:")
        print(varian[0])
        return

    import requests
    env = baca_env(a.env)
    url = (env.get("PUBLIC_SUPABASE_URL") or "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url.startswith("https://") or len(key) < 30 or key.startswith("tempel"):
        sys.exit("PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY di .env belum benar.")
    h = {"apikey": key}
    if not key.startswith("sb_"):          # kunci lama (JWT) juga dikirim sebagai Bearer
        h["Authorization"] = f"Bearer {key}"

    def cek(resp, apa):
        if not resp.ok:
            sys.exit(f"GAGAL {apa}: {resp.status_code} {resp.text[:400]}")

    def foto_url(f):
        return f"{url}/storage/v1/object/public/{BUCKET}/{f}"

    # 1) foto -> Storage
    print(f"Upload {len(foto_pakai) - len(hilang)} foto ...")
    for f in sorted(foto_pakai):
        if f in hilang:
            continue
        with open(foto_dir / f, "rb") as fh:
            resp = requests.post(f"{url}/storage/v1/object/{BUCKET}/{f}", data=fh.read(),
                                 headers={**h, "Content-Type": "image/jpeg", "x-upsert": "true"})
        cek(resp, f"upload {f}")

    # 2) kategori (cocokkan lewat slug, tambah yang belum ada)
    resp = requests.get(f"{url}/rest/v1/categories?select=id,slug", headers=h)
    cek(resp, "baca categories")
    cat_id = {c["slug"]: c["id"] for c in resp.json()}
    nama_kat = list(dict.fromkeys(p["category"] for p in produk))
    baru = [dict(name=n, slug=slugify(n), sort_order=i) for i, n in enumerate(nama_kat, 1)
            if slugify(n) not in cat_id]
    if baru:
        resp = requests.post(f"{url}/rest/v1/categories", json=baru,
                             headers={**h, "Prefer": "return=representation"})
        cek(resp, "simpan categories")
        cat_id.update({c["slug"]: c["id"] for c in resp.json()})
    print(f"Kategori baru: {len(baru)}")

    # 3) produk
    payload_p = [dict(kode=p["kode"], slug=p["slug"], name=p["name"],
                      category_id=cat_id[slugify(p["category"])], base_price=p["base_price"],
                      image_urls=[foto_url(f) for f in p["fotos"]], is_active=True,
                      flower_type=p["flower_type"], stem_count=p["stem_count"]) for p in produk]
    resp = requests.post(f"{url}/rest/v1/products?on_conflict=kode", json=payload_p,
                         headers={**h, "Prefer": "resolution=merge-duplicates,return=representation"})
    cek(resp, "simpan products")
    id_by_kode = {p["kode"]: p["id"] for p in resp.json()}

    # 4) varian
    payload = []
    for v in varian:
        d = {k: val for k, val in v.items() if k not in ("kode", "image_path")}
        d["product_id"] = id_by_kode[v["kode"]]
        d["image_url"] = foto_url(v["image_path"]) if v["image_path"] else None
        payload.append(d)
    for i in range(0, len(payload), 50):
        resp = requests.post(f"{url}/rest/v1/product_variants?on_conflict=sku", json=payload[i:i + 50],
                             headers={**h, "Prefer": "resolution=merge-duplicates,return=minimal"})
        cek(resp, "simpan product_variants")
    print(f"Selesai: {len(produk)} produk, {len(payload)} varian, foto sudah di bucket '{BUCKET}'.")


if __name__ == "__main__":
    main()
