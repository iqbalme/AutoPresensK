# Dokumentasi Workflow Auto Presensi

## Gambaran Umum

Project ini menjalankan script presensi otomatis menggunakan **GitHub Actions** sebagai scheduler dan **Playwright** sebagai browser automation. Tidak memerlukan server atau VPS — semua berjalan di atas infrastruktur GitHub secara gratis.

---

## Struktur Repo

```
repo/
├── .github/
│   └── workflows/
│       └── presensi.yml       # Konfigurasi penjadwalan & alur GitHub Actions
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
│                   GitHub Cron Trigger                │
│  (setiap 5 menit pada jam presensi pagi & sore WIB)  │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
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
│  1. Sinkronisasi data.json dengan ENV_KEYS           │
│     - Hapus user yg tidak ada di ENV_KEYS            │
│     - Tambah user baru (jika secret valid)           │
│     - Exit jika tidak ada user valid sama sekali     │
│                                                      │
│  2. Cek apakah perlu reset hari baru                 │
│     - Jika data.json.hari < hari ini → reset semua   │
│                                                      │
│  3. Loop tiap user → cek jadwal & status             │
│     - Pagi (06:00-06:59): absen masuk                │
│     - Sore (14:01-20:00): absen pulang               │
│     - Jika sudah absen (pagi=1/sore=1) → dilewati    │
│                                                      │
│  4. Playwright buka browser, login, klik presensi    │
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

## Jadwal Cron

Semua waktu di GitHub Actions menggunakan **UTC**. WITA = UTC+8, jadi dikurangi 8 jam.

    Semua waktu dalam UTC (WITA = UTC+8, jadi kurangi 8 jam)
    Cron jalan tiap hari, pengecekan hari libur & Minggu ditangani oleh script
    - cron: '*/30 17-21 * * *' # 01:00-05:59 WITA tiap 30 menit - reset hari baru
    - cron: '* 22 * * *'       # 06:00-06:59 WITA tiap menit    - presensi pagi
    - cron: '* 6-11 * * *'     # 14:00-19:59 WITA tiap menit    - presensi sore
    - cron: '0 12 * * *'       # 20:00 WITA                     - presensi sore akhir

> GitHub Actions tidak menjamin waktu eksekusi tepat. Bisa terlambat 1–5 menit, terutama saat load tinggi. Itulah mengapa script punya `jam_pagi` dan `jam_sore` acak — presensi tetap wajar meski ada keterlambatan ringan.

---

## Kredensial & Keamanan

Kredensial disimpan di **GitHub Secrets**, bukan di kode. Format tiap secret:

```
username|password
```

Contoh: `user1|pass1`

### Cara Menambahkan Secret

1. Buka repo di GitHub
2. Klik **Settings** → **Secrets and variables** → **Actions**
3. Klik **New repository secret**
4. Isi nama dan nilai sesuai tabel berikut:

| Secret Name | Nilai |
|-------------|-------|
| `USER1`     | `user1|pass1` |

> `GITHUB_TOKEN` **tidak perlu diisi** — disediakan otomatis oleh GitHub setiap run.

---

## Sinkronisasi User (ENV_KEYS)

User dikelola melalui variabel `ENV_KEYS` di `autopresensi.js`:

```js
const ENV_KEYS = ['USER1', 'USER2', 'USER3', 'USER4'];
```

Setiap kali script jalan, terjadi sinkronisasi otomatis antara `ENV_KEYS` dan `data.json`:

| Kondisi | Hasil |
|---------|-------|
| Ada di `ENV_KEYS` + secret valid | Ditambahkan ke `data.json` & dieksekusi |
| Ada di `ENV_KEYS` + secret tidak ada | Dilewati, log warning, tidak crash |
| Tidak ada di `ENV_KEYS` + ada di `data.json` | Dihapus dari `data.json` |
| Tidak ada user valid sama sekali | Script berhenti `exit(1)` |

### Cara Menambah User Baru

1. Tambahkan secret baru di GitHub (misal `USER5`)
2. Tambahkan `'USER5'` ke `ENV_KEYS` di `autopresensi.js`
3. Tambahkan baris berikut di `presensi.yml` pada bagian `env:` job presensi:
   ```yaml
   USER5: ${{ secrets.USER5 }}
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
| `ENV_KEYS` di `autopresensi.js` | `'USER5'` |
| `env:` di `presensi.yml` | `USER5: ${{ secrets.USER5 }}` |
| Secret di GitHub | `USER5` = `username\|password` |

Konsekuensi jika tidak sinkron:

| Kondisi | Akibat |
|---------|--------|
| Ada di `ENV_KEYS`, tidak ada di `presensi.yml` | Secret tidak diteruskan ke script → `parseCredential` gagal → `exit(1)`, semua user setelahnya tidak diproses |
| Ada di `presensi.yml`, tidak ada di `ENV_KEYS` | Secret diteruskan tapi tidak dipakai, user tidak diproses |
| Ada di `ENV_KEYS` + `presensi.yml`, tidak ada secret di GitHub | Secret kosong → user dilewati saat sinkronisasi, log warning |

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

| Field      | Keterangan |
|------------|------------|
| `hari`     | Tanggal aktif. Jika berbeda dengan hari ini, semua user direset |
| `envKey`   | Referensi ke secret GitHub (`USER1`, dst) |
| `jam_pagi` | Jam acak untuk absen masuk (di-generate saat reset) |
| `jam_sore` | Jam acak untuk absen pulang (di-generate saat reset) |
| `pagi`     | `0` = belum absen masuk, `1` = sudah |
| `sore`     | `0` = belum absen pulang, `1` = sudah |

---

## Error Handling

| Kondisi Error | Perilaku |
|---------------|----------|
| Secret tidak ada | User dilewati, warning di log, user lain tetap jalan |
| Tidak ada user valid sama sekali | `exit(1)`, workflow merah |
| Endpoint tidak bisa diakses | `exit(1)`, workflow merah, cron ulang berikutnya |
| Login gagal (username/password salah) | `exit(1)`, workflow merah, cron ulang berikutnya |
| Tombol presensi tidak ditemukan | Dilewati (kemungkinan sudah absen), lanjut user berikutnya |

Jika workflow berstatus **merah**, script akan **otomatis dicoba ulang** di jadwal cron berikutnya (±5 menit) tanpa perlu intervensi manual.

---

## Hari Libur

Daftar tanggal libur disimpan di `libur.json`. Format: array string `YYYY-MM-DD`.

```json
["2025-01-01", "2025-03-28", "2025-08-17"]
```

Perbarui file ini setiap tahun sesuai kalender libur nasional. Jika file tidak ada, script tetap berjalan dan menganggap tidak ada hari libur.

---

## Menjalankan Manual

Buka tab **Actions** di GitHub → pilih workflow **Auto Presensi** → klik **Run workflow**. Berguna untuk testing atau jika ingin trigger presensi di luar jadwal cron.