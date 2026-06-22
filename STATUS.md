# The Kebab Factory — Status & Arsitektur

Dokumen ini ringkasan kondisi proyek saat ini: arsitektur, daftar file,
endpoint, dan apa yang masih perlu dikerjakan. Tujuannya supaya sesi
kerja berikutnya tidak perlu re-explore semua file dari awal.

---

## 1. Arsitektur Umum

```
Frontend          : Vanilla HTML/CSS/JS (tanpa framework)
Backend           : Google Apps Script (.gs)
Database          : Google Sheets (1 spreadsheet, banyak sheet/tab)
Cache             : CacheService (built-in Apps Script)
Hosting frontend  : Vercel (proxy ke Apps Script + serve static files)
Secrets           : PropertiesService (BUKAN hardcode di kode)
```

**Alur request:**
```
Browser → Vercel (/api/proxy) → Apps Script (exec URL) → Google Sheets
```

Semua file frontend memanggil `APPS_SCRIPT_URL` yang seharusnya diisi
`/api/proxy` (jika pakai Vercel) atau URL `.../exec` langsung.

---

## 2. Struktur Folder Rekomendasi (saat deploy)

```
/ (root)
├── index.html              ← web customer
├── login.html              ← login kasir/KDS/admin
├── kasir.html               ← PWA kasir
├── kds.html                 ← PWA kitchen display
├── manifest.json            ← PWA kasir
├── manifest-kds.json        ← PWA KDS
├── sw.js                    ← service worker
├── vercel.json
├── package.json
├── api/
│   └── proxy.js             ← reverse proxy ke Apps Script
└── admin/
    ├── dashboard.html        (NB: dashboard.html versi ROOT ada juga,
    │                           lihat catatan di bawah)
    ├── produk.html
    ├── promo.html
    ├── cabang.html
    ├── user.html
    ├── konten.html
    └── setting.html
```

⚠️ **Catatan dashboard.html**: ada 2 konteks penamaan dalam riwayat kerja —
versi yang link-nya pakai prefix `admin/...` dimaksudkan untuk diletakkan
di **root**, sedangkan halaman lain di `admin/` saling link tanpa prefix
(`produk.html`, bukan `admin/produk.html`) dan logout ke `../login.html`.
**Sebelum deploy: cek ulang konsistensi path ini.**

---

## 3. Backend — Daftar File `.gs`

| File | Isi |
|---|---|
| `00_Config.gs` | Konstanta non-rahasia: ID Sheet, nama tab, kolom (`COL_*`), status valid, `isBotActiveNow()`, `corsOutput()`, helper umum (`generateOrderId`, `formatItems`, dst). **Tidak ada secret di sini.** |
| `01_Webhook.gs` | Router utama `doGet`/`doPost`. Semua `action` di-dispatch dari sini. Juga berisi `CacheService` wrapper (`cacheGet/Set/Remove/GetOrLoad`, `CACHE_TTL`, `CACHE_PREFIX`). |
| `02_Order.gs` | `handleNewOrder` (order dari web/WA), `handleNewOrderKasir`, `handleCekStatus`, `handleUploadBukti`, integrasi Qrisly (`generateQrisly`, `checkQrislyStatus`), `handleUploadFotoProduk` (upload ke Drive). |
| `02_Services.gs` | Wrapper `LockService` (`withScriptLock`) dan `CacheService` tambahan. |
| `03_KDS.gs` | `handleGetAllOrders`, `handleUpdateStatus`, `requireAdmin`, CRUD Cabang & User (admin). |
| `04_AI.gs` | `handleFonnteincoming` (WA masuk → AI), `handleWAMedia` (foto bukti via WA), `handleChat` (web chatbot). Memanggil `buildSystemPrompt('wa'|'web')` dari `08_Produk.gs`. |
| `05_Fonnte.gs` | `kirimFonnte`, `kirimFonnteGambar`, semua notif WA (`kirimNotifAdmin`, `kirimNotifKonfirmasiCustomer`, `kirimNotifQrisDinamis`, `kirimNotifStatusCustomer`, `kirimNotifCabang`, `kirimRingkasanHarian`). |
| `06_Debug.gs` | 17 fungsi test manual (jalankan dari Apps Script Editor untuk debugging). |
| `07_Auth.gs` | `handleLogin`, `handleAdminRequestOTP`, `handleVerifyOTP`, `verifikasiRecaptcha`, `requireSession`. **Baru ditambahkan**: `handleCustomerRequestOTP`/`handleCustomerVerifyOTP`/`isCustomerWAVerified` (OTP WA untuk order Cash via web). |
| `08_Produk.gs` | CRUD produk/varian/promo (admin), `getProdukPublik`, `buildMenuContext()`, `buildPromoContext()`, `getPromoAktifInternal()`, **`buildSystemPrompt(mode)`** — sumber tunggal prompt AI dinamis. |
| `09_Setting.gs` | `SETTING_KEYS`, `API_KEYS`, semua getter (`getGroqKey`, `getFonnteToken`, `getQrislyToken`, `getAdminPhone`, `getNamaToko`, `getOngkirConfig`, dll), `getThemeSettingPublik()` (public-safe untuk inject CSS ke index.html). |
| `10_Laporan.gs` | 11 handler laporan: Ringkasan, Produk, Cabang, Promo, RushHour, MetodeBayar, Customer, Delivery, Trend, Sumber, Dashboard (all-in-one). |
| `11_Konten.gs` | CRUD Galeri, Berita, Pengumuman. Auto-create sheet jika belum ada. `getGaleriPublik/getBeritaPublik/getPengumumanPublik` (cached, publik). |

---

## 4. Sheet/Tab di Spreadsheet

| Sheet | Fungsi | Auto-create? |
|---|---|---|
| `Order` | Semua order (web, kasir, WA) | manual (header via `ensureOrderHeader`) |
| `ChatLog` | Log percakapan AI (jika dipakai) | - |
| `Login` | User staff (kasir/KDS/admin) | manual |
| `Cabang` | Daftar cabang + koordinat GPS | manual |
| `Id_produk` | Produk (`SHEET_PRODUK_ID`) | manual |
| `Varian` | Varian produk (tipe, nama, harga tambah) | manual |
| `Promo` | Kode promo | manual |
| `Setting` | Key-value setting toko | via `setupAwalSetting()` |
| `Galeri` | Foto galeri web customer | ✅ auto (`ensureGaleriSheet`) |
| `Berita` | Artikel berita & edukasi | ✅ auto (`ensureBeritaSheet`) |
| `Pengumuman` | Teks news bar | ✅ auto (`ensurePengumumanSheet`) |

---

## 5. Daftar Endpoint (`action=...`)

### GET (publik, tanpa auth)
```
getMenu          → menu + varian dari Id_produk/Varian
getGaleri        → foto galeri aktif
getBerita        → artikel aktif
getPengumuman    → news bar aktif (terjadwal)
getThemeSetting  → customCSS + info toko (untuk inject ke index.html)
getCabang        → daftar cabang
validasiPromo    → cek kode promo (GET & POST)
verifySession    → cek sessionToken masih valid
```

### POST — Auth & Customer
```
login                 → staff login (kasir/KDS)
adminRequestOTP       → kirim OTP admin via WA/email
verifyOTP             → verifikasi OTP (staff & admin)
customerRequestOTP    → kirim OTP WA ke customer (untuk order Cash) — BARU
customerVerifyOTP     → verifikasi OTP customer — BARU
chat                  → web chatbot (handleChat)
```

### POST — Order
```
(tanpa action, hanya `data`) → handleNewOrder (order dari web)
newOrderKasir         → order dari kasir
getAllOrders          → list order (KDS/admin)
updateStatus          → update status order (KDS)
uploadBukti           → upload bukti transfer QRIS manual
uploadFotoProduk      → upload foto ke Drive (dipakai di banyak admin page)
toggleStok            → quick update stok produk
```

### POST — Admin CRUD (semua butuh `sessionToken` admin via `requireAdmin`)
```
Produk/Varian   : getProdukList, saveProduk, deleteProduk,
                  getVarianList, saveVarian, deleteVarian
Promo           : getPromoList, savePromo, deletePromo
Cabang          : getCabangList, saveCabang, deleteCabang
User            : getUserList, saveUser, deleteUser
Konten          : getGaleriList/saveGaleri/deleteGaleri,
                  getBeritaList/saveBerita/deleteBerita,
                  getPengumumanList/savePengumuman/deletePengumuman
Setting         : getSetting, saveSetting, resetSetting, saveAPIKey
Laporan         : laporanRingkasan, laporanProduk, laporanCabang,
                  laporanPromo, laporanRushHour, laporanMetodeBayar,
                  laporanCustomer, laporanDelivery, laporanTrend,
                  laporanSumber, laporanDashboard
```

---

## 6. Frontend — Daftar File

| File | Peran |
|---|---|
| `login.html` | Single login untuk Kasir/KDS (3-step: login→OTP→pilih cabang) dan Admin (klik "Kirim OTP" saja, tanpa username/password) |
| `index.html` | Web customer — menu dinamis, galeri, berita, pengumuman (news bar), search global, promo popup + floating CTA, OTP cash, custom CSS injector, chat AI |
| `kasir.html` | PWA kasir — menu dinamis, keranjang, print struk (BT/USB/popup), setting struk & printer |
| `kds.html` | PWA Kitchen Display — kanban order real-time, sound notif |
| `admin/dashboard.html` | Overview, KPI, chart, order table |
| `admin/produk.html` | CRUD produk & varian, upload/URL foto |
| `admin/promo.html` | CRUD promo, card/table view, countdown |
| `admin/cabang.html` | CRUD cabang, parser link Google Maps, embed peta |
| `admin/user.html` | CRUD user staff, reset password, role guide |
| `admin/konten.html` | CRUD Galeri/Berita/Pengumuman, upload/URL foto |
| `admin/setting.html` | Setting toko/ongkir/pembayaran/bot/notifikasi/API keys/Custom CSS (CodeMirror + live preview) |

---

## 7. Fitur AI (Status Terkini)

```
✅ buildSystemPrompt(mode) — prompt dinamis dari Sheet+Setting
   mode='wa'  → strict JSON untuk auto-create order via WA
   mode='web' → chat santai, arahkan checkout ke web

✅ Info toko, menu+varian, promo aktif, ongkir — semua live dari Sheet
✅ Jam aktif bot (isBotActiveNow) — bot tidak respon di luar jam
✅ OTP WA untuk order Cash via web (customerRequestOTP/VerifyOTP)

❌ BELUM: AI tools/function-calling read-only untuk admin
   (analisa stok menipis, performa promo, dst — masih ide)
❌ BELUM: WA bot minta konfirmasi "lanjut?" sebelum create order
   (saat ini langsung return type:"order" jika data lengkap)
❌ BELUM: Posting otomatis ke Instagram/sosmed
❌ BELUM: Endpoint webhook Instagram/Make.com — slot KEY sudah ada
   di 09_Setting.gs (getInstagramToken, getMakeWebhookUrl, dst)
   tapi BELUM ada handler yang memanggilnya
```

---

## 8. Checklist Sebelum Deploy

```
[ ] 1. ⚠️ REGENERATE 4 TOKEN (sudah pernah ter-expose di chat):
       GROQ_API_KEY, FONNTE_TOKEN, QRISLY_TOKEN, RECAPTCHA_SECRET_KEY
       → isi ulang via setupAwalAPIKeys() ke PropertiesService

[ ] 2. Ganti semua 'GANTI_DENGAN_URL_APPS_SCRIPT_EXEC' 
       → '/api/proxy' (jika pakai Vercel) atau URL exec langsung
       Tersebar di: login, dashboard, produk, promo, cabang, user,
       konten, setting, kasir, kds, index

[ ] 3. api/proxy.js → isi GAS_URL (env var atau hardcode)

[ ] 4. Jalankan setupAwalSetting() agar Sheet Setting terisi default
       (Galeri/Berita/Pengumuman auto-create saat endpoint pertama
       diakses, tidak perlu manual)

[ ] 5. Cek ulang konsistensi path admin/ (lihat bagian 2)

[ ] 6. QRISLY_MODE = 'sandbox' dulu untuk testing, baru ke 'production'

[ ] 7. Test alur OTP customer (Cash) end-to-end — belum pernah di-test
       Test alur OTP juga untuk WA bot (Fonnte harus benar2 terhubung)

[ ] 8. Isi minimal 1 data: Cabang, Id_produk, Varian, Login (admin/kasir)
```

---

## 9. Roadmap Diskusi (belum dikerjakan, urutan usulan)

```
B. WA bot konfirmasi sebelum order   ← kecil, prasyarat alami untuk C
C. Order via WA bot atau web         ← web sudah ada, WA perlu (B) dulu
A. AI auto-post ke Instagram/sosmed  ← paling besar, scheduler + Graph API

Catatan: AI bersifat SUGGESTION/read-only untuk insight admin
(analisa stok, performa promo) — tidak ada delegasi aksi otomatis
yang mengubah data tanpa staff/admin menekan tombol sendiri.
```

---

## 10. Proyek Berikutnya (terpisah, belum mulai)

```
Stack rencana: Go (backend) + Supabase/PostgreSQL + Redis (cache) 
+ S3-compatible storage
Tujuan: platform multi-tenant F&B (generalisasi dari sistem ini)
Catatan penting: desain skema DB (dengan tenant_id) sebelum coding,
karena migrasi schema yang salah di awal mahal diperbaiki nanti.

CRM WA (wacrm, Next.js+Supabase) — proyek terpisah, integrasi 
penuh dengan sistem Sheets saat ini TIDAK realistis (beda DB/auth).
Opsi: re-theme warna saja, atau link manual di admin/setting.html.
```
