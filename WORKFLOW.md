# Dokumentasi Workflow Auto Presensi

## Gambaran Umum

Project ini menjalankan script presensi otomatis menggunakan **GitHub Actions** sebagai eksekutor dan **Playwright** sebagai browser automation. Penjadwalan dilakukan oleh **cron-job.org** yang men-trigger GitHub Actions setiap 5 menit via API. Tidak memerlukan server atau VPS.

---

## Struktur Repo

```
repo/
├── .github/
│   └── workflows/
│       └── presensi.yml       # Konfigurasi GitHub Actions (trigger: workflow_dispatch)
├── autopresensi.js            # Script utama
├── randomCoordinate.js        # Helper generate koordinat acak
├── data.json                  # State presensi (di-commit otomatis tiap run)
├── libur.json                 # Daftar tanggal libur nasional
├── package.json               # Dependency Node.js
└── .gitignore
```

---

## Alur Kerja Keseluruhan

```
┌─────────────────────────────────────────────────────┐
│                   cron-job.org                       │
│  (trigger setiap 5 menit via GitHub API)             │
└─────────────────────┬───────────────────────────────┘
                      │  POST /dispatches
                      ▼
┌─────────────────────────────────────────────────────┐
│              GitHub Actions (workflow_dispatch)       │
│              Checkout Repo (ambil data.json terbaru) │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│         Setup Node.js + Install Dependencies         │
│         npm install + playwright install chromium    │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              Jalankan autopresensi.js                │
│                                                      │
│  1. Validasi env variables (koordinat, endpoint)     │
│                                                      │
│  2. Sinkronisasi data.json dengan ENV_KEYS           │
│     - Hapus user yg tidak ada di ENV_KEYS            │
│     - Tambah user baru (jika secret valid)           │
│     - Exit jika tidak ada user valid sama sekali     │
│                                                      │
│  3. Cek apakah perlu reset hari baru                 │
│     - Jika data.json.hari < hari ini → reset semua   │
│                                                      │
│  4. Loop tiap user → cek jadwal & status             │
│     - Pagi (06:00-06:59 WITA): absen masuk           │
│     - Sore (14:30-20:00 WITA): absen pulang          │
│     - Jika sudah absen (pagi=1/sore=1) → dilewati    │
│                                                      │
│  5. Playwright buka browser, login, klik presensi    │
│     - Gagal akses endpoint → exit(1)                 │
│     - Gagal login → exit(1)                          │
│     - Berhasil → update data.json                    │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│         Commit & Push data.json ke repo              │
│  (menyimpan status presensi untuk run berikutnya)    │
└─────────────────────────────────────────────────────┘
```

---

## Penjadwalan via cron-job.org

GitHub Actions tidak menjamin ketepatan waktu cron bawaan — bisa terlambat 15–60 menit. Oleh karena itu penjadwalan menggunakan **cron-job.org** yang men-trigger workflow via GitHub API dengan lebih konsisten.

### Cara Setup cron-job.org

**Langkah 1 — Buat GitHub Personal Access Token**

1. Buka GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Klik **Generate new token (classic)**
3. Isi **Note** dan centang scope **`workflow`** saja
4. Klik **Generate token** → copy tokennya (hanya muncul sekali)

**Langkah 2 — Buat Cronjob di cron-job.org**

Daftar di [https://cron-job.org](https://cron-job.org), lalu buat **3 cronjob** dengan konfigurasi berikut.

Untuk semua cronjob, isi bagian **Advanced**:
```
Request method : POST
Request headers:
  Accept        : application/vnd.github+json
  Authorization : Bearer <token_github>
  Content-Type  : application/json
Request body   : {"ref":"main"}
```

URL untuk semua cronjob:
```
https://api.github.com/repos/<username>/<nama-repo>/actions/workflows/presensi.yml/dispatches
```

Jadwal masing-masing cronjob (timezone: **Australia/Perth = GMT+8 = WITA**):

| Cronjob | Menit | Jam | Tujuan |
|---------|-------|-----|--------|
| Reset Hari Baru | `*/30` | `1,2,3,4,5` | 01:00–05:59 WITA tiap 30 menit |
| Presensi Pagi | `*/5` | `6` | 06:00–06:59 WITA tiap 5 menit |
| Presensi Sore | `*/5` | `14,15,16,17,18,19` | 14:00–19:59 WITA tiap 5 menit |

> Hari, Bulan, dan Weekday semua diisi `*` (setiap hari). Pengecekan hari libur dan Minggu dilakukan oleh script, bukan oleh cron.

---

## Kredensial & Keamanan

Kredensial disimpan di **GitHub Secrets**, bukan di kode. Format tiap secret:

```
username|password
```

### Cara Menambahkan Secret

1. Buka repo di GitHub
2. Klik **Settings** → **Secrets and variables** → **Actions**
3. Klik **New repository secret**
4. Isi nama dan nilai sesuai kebutuhan:

| Secret Name | Keterangan |
|-------------|------------|
| `USER1` | `username\|password` user pertama |
| `USER2` | `username\|password` user kedua |
| `BASE_LATITUDE` | Latitude koordinat patokan |
| `BASE_LONGITUDE` | Longitude koordinat patokan |
| `RADIUS` | Radius acak koordinat dalam meter, contoh: `50` |
| `ENDPOINT_PRESENSI` | URL base aplikasi, contoh: `https://xxxx.com` |

> `GITHUB_TOKEN` **tidak perlu diisi** — disediakan otomatis oleh GitHub setiap run.

---

## Sinkronisasi User (ENV_KEYS)

User dikelola melalui variabel `ENV_KEYS` di `autopresensi.js`:

```js
const ENV_KEYS = ['USER1', 'USER2'];
```

Setiap kali script jalan, terjadi sinkronisasi otomatis antara `ENV_KEYS` dan `data.json`:

| Kondisi | Hasil |
|---------|-------|
| Ada di `ENV_KEYS` + secret valid | Ditambahkan ke `data.json` & dieksekusi |
| Ada di `ENV_KEYS` + secret tidak ada | Dilewati, log warning, tidak crash |
| Tidak ada di `ENV_KEYS` + ada di `data.json` | Dihapus dari `data.json` |
| Tidak ada user valid sama sekali | Script berhenti `exit(1)` |

### Cara Menambah User Baru

1. Tambahkan secret baru di GitHub (misal `USER3`)
2. Tambahkan `'USER3'` ke `ENV_KEYS` di `autopresensi.js`
3. Tambahkan baris berikut di `presensi.yml` pada bagian `env:`:
   ```yaml
   USER3: ${{ secrets.USER3 }}
   ```
4. Commit & push — sinkronisasi berjalan otomatis di run berikutnya

### Cara Menghapus User

1. Hapus envKey dari `ENV_KEYS` di `autopresensi.js`
2. Hapus baris `USERx: ${{ secrets.USERx }}` yang sesuai dari `presensi.yml`
3. Commit & push — user otomatis dihapus dari `data.json` di run berikutnya
4. Secret di GitHub bisa dihapus manual (opsional)

### Penting: Sinkronisasi Tiga Tempat

Setiap user harus terdaftar di **ketiga tempat** berikut secara konsisten:

| Tempat | Contoh |
|--------|--------|
| `ENV_KEYS` di `autopresensi.js` | `'USER3'` |
| `env:` di `presensi.yml` | `USER3: ${{ secrets.USER3 }}` |
| Secret di GitHub | `USER3` = `username\|password` |

Konsekuensi jika tidak sinkron:

| Kondisi | Akibat |
|---------|--------|
| Ada di `ENV_KEYS`, tidak ada di `presensi.yml` | Secret tidak diteruskan → `exit(1)`, user setelahnya tidak diproses |
| Ada di `presensi.yml`, tidak ada di `ENV_KEYS` | Secret diteruskan tapi tidak dipakai, user tidak diproses |
| Ada di `ENV_KEYS` + `presensi.yml`, tidak ada secret di GitHub | Secret kosong → user dilewati, log warning |

---

## Mode Test Playwright

Untuk mendiagnosis masalah tanpa mengeksekusi presensi, aktifkan test mode di `autopresensi.js`:

```js
const TEST_MODE = true;   // false = presensi normal
const TEST_USER = 'USER1'; // user yang dipakai untuk test
```

Saat `TEST_MODE = true`, script hanya login dan menampilkan semua tombol yang ditemukan di halaman presensi — tidak mengubah `data.json` dan tidak mengeksekusi presensi apapun. Kembalikan ke `false` setelah selesai testing.

---

## Struktur data.json

```json
{
  "hari": "2025-05-22",
  "users": [
    { "envKey": "USER1", "jam_pagi": "06:15", "jam_sore": "15:30", "pagi": 1, "sore": 0 },
    { "envKey": "USER2", "jam_pagi": "06:20", "jam_sore": "15:45", "pagi": 1, "sore": 0 }
  ]
}
```

| Field | Keterangan |
|-------|------------|
| `hari` | Tanggal aktif. Jika berbeda dengan hari ini, semua user direset |
| `envKey` | Referensi ke secret GitHub (`USER1`, dst) |
| `jam_pagi` | Jam acak absen masuk, di-generate saat reset (06:01–06:37 WITA) |
| `jam_sore` | Jam acak absen pulang, di-generate saat reset (bervariasi per hari) |
| `pagi` | `0` = belum absen masuk, `1` = sudah |
| `sore` | `0` = belum absen pulang, `1` = sudah |

### Rentang jam_sore per Hari

| Hari | Rentang |
|------|---------|
| Senin–Kamis | 14:30–16:59 WITA |
| Jumat | 11:30–16:59 WITA |
| Sabtu | 15:00–16:59 WITA |

---

## Error Handling

| Kondisi Error | Perilaku |
|---------------|----------|
| Env variable tidak ada / bukan angka | `exit(1)`, workflow merah |
| Secret user tidak ada | User dilewati, warning di log, user lain tetap jalan |
| Tidak ada user valid sama sekali | `exit(1)`, workflow merah |
| Endpoint tidak bisa diakses | `exit(1)`, workflow merah, cron-job.org ulang 5 menit berikutnya |
| Login gagal | `exit(1)`, workflow merah, cron-job.org ulang 5 menit berikutnya |
| Tombol presensi tidak ditemukan | Dilewati (kemungkinan sudah absen), lanjut user berikutnya |

---

## Hari Libur

Daftar tanggal libur disimpan di `libur.json`. Format: array string `YYYY-MM-DD`.

```json
["2025-01-01", "2025-03-28", "2025-08-17"]
```

Perbarui file ini setiap tahun sesuai kalender libur nasional. Jika file tidak ada, script tetap berjalan dan menganggap tidak ada hari libur.

---

## Menjalankan Manual

Buka tab **Actions** di GitHub → pilih workflow **Auto Presensi** → klik **Run workflow**. Berguna untuk testing atau jika ingin trigger presensi di luar jadwal.