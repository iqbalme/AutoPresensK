// Jalankan manual: node autopresensi.js
// Di GitHub Actions: otomatis dijalankan via workflow

const { chromium } = require('playwright');
const { generateRandomCoordinates } = require('./randomCoordinate');
const fs = require('fs');
const moment = require('moment-timezone');

// --- Helpers Waktu ---
function getServerTimeInGMT8() {
    return moment().tz("Asia/Makassar").format('HH:mm');
}

function getServerDateInGMT8() {
    return moment().tz("Asia/Makassar").format('YYYY-MM-DD');
}

// --- Validasi Environment Variables ---
function parseEnvFloat(key) {
    const val = process.env[key];
    if (!val) {
        throw new Error(`Environment variable "${key}" tidak ditemukan. Pastikan sudah diisi di GitHub Secrets.`);
    }
    const parsed = parseFloat(val);
    if (isNaN(parsed)) {
        throw new Error(`Environment variable "${key}" bukan angka valid: "${val}"`);
    }
    return parsed;
}

function parseEnvString(key) {
    const val = process.env[key];
    if (!val) {
        throw new Error(`Environment variable "${key}" tidak ditemukan. Pastikan sudah diisi di GitHub Secrets.`);
    }
    return val;
}

// --- Koordinat Patokan ---
let baseLatitude, baseLongitude, radius, endpointPresensi;
try {
    baseLatitude     = parseEnvFloat('BASE_LATITUDE');
    baseLongitude    = parseEnvFloat('BASE_LONGITUDE');
    radius           = parseEnvFloat('RADIUS');
    endpointPresensi = parseEnvString('ENDPOINT_PRESENSI');
} catch (err) {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
}

// --- Daftar User ---
// Tambah/hapus envKey di sini, script akan otomatis sinkronisasi ke data.json
const ENV_KEYS = ['USER1', 'USER2'];

// --- Baca Credentials dari Environment Variables (GitHub Secrets) ---
// Format secret: "username|password"
// Credential HANYA dibaca saat dibutuhkan, tidak disimpan ke file apapun
function parseCredential(envKey) {
    const envValue = process.env[envKey];
    if (!envValue) {
        throw new Error(`Secret "${envKey}" tidak ditemukan. Pastikan sudah diisi di GitHub Secrets.`);
    }
    const parts = envValue.split('|');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Format "${envKey}" salah. Gunakan format: "username|password"`);
    }
    return { username: parts[0], password: parts[1] };
}

// --- File Path ---
const filePath = 'data.json';
let dataStore  = { hari: '', users: [] };

// --- Tulis ke data.json ---
function writeDataToFile() {
    fs.writeFileSync(filePath, JSON.stringify(dataStore, null, 2), 'utf8');
}

// --- Fungsi Random Time ---
function getRandomTime(period, hari) {
    const timeRanges = {
        pagi       : { startHour: 6,  startMinute: 1,  endHour: 6,  endMinute: 37 },
        sore       : { startHour: 14, startMinute: 30, endHour: 16, endMinute: 59 },
        sore_sabtu : { startHour: 15, startMinute: 0,  endHour: 16, endMinute: 59 },
        sore_jumat : { startHour: 11, startMinute: 30, endHour: 16, endMinute: 59 },
    };

    let chosenRange = {};
    if (period === 'pagi') {
        chosenRange = timeRanges['pagi'];
    } else if (period === 'sore') {
        if      (hari === 5) chosenRange = timeRanges['sore_jumat'];
        else if (hari === 6) chosenRange = timeRanges['sore_sabtu'];
        else                 chosenRange = timeRanges['sore'];
    }

    if (!chosenRange || !Object.keys(chosenRange).length) {
        throw new Error("Parameter tidak valid. Gunakan 'pagi' atau 'sore'.");
    }

    const randomHour = chosenRange.startHour +
        Math.floor(Math.random() * (chosenRange.endHour - chosenRange.startHour + 1));

    let randomMinute;
    if      (randomHour === chosenRange.startHour) randomMinute = chosenRange.startMinute + Math.floor(Math.random() * (60 - chosenRange.startMinute));
    else if (randomHour === chosenRange.endHour)   randomMinute = Math.floor(Math.random() * (chosenRange.endMinute + 1));
    else                                           randomMinute = Math.floor(Math.random() * 60);

    if (randomHour === chosenRange.endHour && randomMinute > chosenRange.endMinute) {
        randomMinute = Math.floor(Math.random() * chosenRange.endMinute);
    }

    return `${String(randomHour).padStart(2,'0')}:${String(randomMinute).padStart(2,'0')}`;
}

// --- Inisialisasi / Sinkronisasi data.json ---
function initDataStore() {
    const today   = getServerDateInGMT8();
    const hariInt = new Date(today).getDay();

    // Baca file yang sudah ada, atau mulai dari struktur kosong
    if (fs.existsSync(filePath)) {
        dataStore = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
        dataStore = { hari: today, users: [] };
    }

    let ada_perubahan = false;

    // 1. Hapus user yang sudah tidak ada di ENV_KEYS
    const sebelum = dataStore.users.length;
    dataStore.users = dataStore.users.filter(u => ENV_KEYS.includes(u.envKey));
    const sesudah = dataStore.users.length;
    if (sebelum !== sesudah) {
        console.log(`[sync] ${sebelum - sesudah} user dihapus dari data.json karena tidak ada di ENV_KEYS.`);
        ada_perubahan = true;
    }

    // 2. Tambahkan user baru dari ENV_KEYS yang belum ada di data.json
    //    Jika secret tidak ditemukan atau format salah, user dilewati (tidak gagal total)
    //    Hanya user yang valid dan punya secret yang akan dieksekusi
    ENV_KEYS.forEach(envKey => {
        const sudahAda = dataStore.users.some(u => u.envKey === envKey);
        if (!sudahAda) {
            try {
                parseCredential(envKey); // validasi secret ada dan formatnya benar
                dataStore.users.push({
                    envKey,
                    jam_pagi : getRandomTime("pagi", hariInt),
                    jam_sore : getRandomTime("sore", hariInt),
                    pagi     : 0,
                    sore     : 0
                });
                console.log(`[sync] ${envKey} ditambahkan ke data.json.`);
                ada_perubahan = true;
            } catch (err) {
                console.warn(`[sync] ${envKey} dilewati -- ${err.message}`);
            }
        }
    });

    if (ada_perubahan) writeDataToFile();

    // 3. Jika setelah sinkronisasi tidak ada user valid sama sekali, hentikan proses
    if (dataStore.users.length === 0) {
        console.error('[FATAL] Tidak ada user valid yang bisa dieksekusi. Periksa ENV_KEYS dan GitHub Secrets.');
        process.exit(1);
    }
}

// --- Update status presensi user ---
function updateUser(envKey, newValues) {
    const user = dataStore.users.find(u => u.envKey === envKey);
    if (user) {
        Object.assign(user, newValues);
        console.log(`[updateUser] ${envKey} diperbarui.`);
        writeDataToFile();
    }
}

// --- Fungsi Absen via Playwright ---
// Jika terjadi error (endpoint tidak bisa diakses, gagal login, dsb),
// error dilempar ke atas agar script exit dan cron mengulang di jadwal berikutnya
async function setAbsen(user, pOrS) {
    // Credential dibaca dari secret saat diperlukan, tidak dari data.json
    let cred;
    try {
        cred = parseCredential(user.envKey);
    } catch (err) {
        console.warn(`[setAbsen] ${user.envKey} dilewati -- ${err.message}`);
        return;
    }

    const { username, password } = cred;
    let browser;

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        const { latitude: newLatitude, longitude: newLongitude } =
            generateRandomCoordinates(baseLatitude, baseLongitude, radius);

        const context = await browser.newContext({
            geolocation: { latitude: newLatitude, longitude: newLongitude, accuracy: 10 },
            permissions: ['geolocation']
        });

        const page = await context.newPage();

        // Buka halaman login -- jika endpoint tidak bisa diakses, langsung throw
        try {
            await page.goto(`${endpointPresensi}/login`, { waitUntil: 'networkidle', timeout: 30000 });
        } catch (e) {
            throw new Error(`Endpoint tidak bisa diakses: ${e.message}`);
        }

        // Isi form login
        await page.fill('input[name="email"]',    username);
        await page.fill('input[name="password"]', password);
        await page.click('button[type="submit"]');

        // Deteksi gagal login: jika setelah submit masih di halaman /login
        await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
        if (page.url().includes('/login')) {
            throw new Error(`Login gagal untuk ${user.envKey}. Periksa username/password di secret.`);
        }
        console.log(`${user.envKey}: Login berhasil.`);

        // Buka halaman presensi
        try {
            await page.goto(`${endpointPresensi}/profile/presence`, { waitUntil: 'networkidle', timeout: 30000 });
        } catch (e) {
            throw new Error(`Gagal membuka halaman presensi: ${e.message}`);
        }
        console.log(`${user.envKey}: Halaman presensi berhasil dibuka.`);

        if (pOrS === 'pagi') {
            await page.waitForTimeout(2000);
            await page.waitForLoadState('load');

            const btnMasuk = page.getByRole('button', { name: 'Presensi masuk' });
            if (await btnMasuk.count() === 0) {
                console.log(`${user.envKey}: Tombol Presensi masuk tidak ditemukan, mungkin sudah absen.`);
                await browser.close();
                return;
            }
            await btnMasuk.click();
            await page.waitForTimeout(500);
            await page.waitForLoadState('networkidle');
            updateUser(user.envKey, { pagi: 1, sore: 0 });
            console.log(`${user.envKey}: Presensi MASUK berhasil.`);

        } else {
            await page.waitForTimeout(2000);
            await page.waitForLoadState('load');

            const btnPulang = page.getByRole('button', { name: 'Presensi pulang' });
            if (await btnPulang.count() === 0) {
                console.log(`${user.envKey}: Tombol Presensi pulang tidak ditemukan, mungkin sudah absen.`);
                await browser.close();
                return;
            }
            await btnPulang.click();

            const btnYa = page
                .getByRole('heading', { name: /konfirmasi presensi pulang/i })
                .locator('..')
                .getByRole('button', { name: /^ya$/i });

            await Promise.all([
                page.waitForLoadState('networkidle'),
                btnYa.click(),
            ]);

            await page.waitForTimeout(500);
            await page.waitForLoadState('load');
            updateUser(user.envKey, { pagi: user.pagi, sore: 1 });
            console.log(`${user.envKey}: Presensi PULANG berhasil.`);
        }

        await browser.close();

    } catch (error) {
        if (browser) await browser.close().catch(() => {});
        // Lempar error ke atas agar executeData bisa exit(1)
        // Script berhenti, cron akan mengulang di jadwal berikutnya
        throw new Error(`[setAbsen] ${user.envKey}: ${error.message}`);
    }
}

// --- Fungsi Utama ---
async function executeData() {
    initDataStore();

    const today    = getServerDateInGMT8();
    const hariIni  = new Date(today);
    const hariInt  = hariIni.getDay();
    const isSunday = hariInt === 0;
    const now      = getServerTimeInGMT8();

    const dataLibur = fs.existsSync('libur.json')
        ? JSON.parse(fs.readFileSync('libur.json', 'utf8'))
        : [];

    console.log(`[executeData] Waktu WITA: ${now} | Tanggal: ${today}`);

    // Reset semua user jika hari sudah berganti (1 operasi untuk semua user)
    if (dataStore.hari < today && now >= "01:00" && now < "06:00") {
        console.log(`[reset] Hari baru terdeteksi, mereset semua user...`);
        dataStore.hari = today;
        dataStore.users.forEach(user => {
            user.jam_pagi = getRandomTime("pagi", hariInt);
            user.jam_sore = getRandomTime("sore", hariInt);
            user.pagi     = 0;
            user.sore     = 0;
        });
        writeDataToFile();
        console.log(`[reset] Semua user direset untuk tanggal ${today}.`);
    }

    // Presensi
    if (dataStore.hari === today && !dataLibur.includes(today) && !isSunday) {
        for (const user of dataStore.users) {
            // Presensi pagi: 06:00 - 06:59
            if (now >= "06:00" && now < "07:59") {
                if (user.pagi === 0 && now >= user.jam_pagi) {
                    console.log(`[pagi] Absen untuk ${user.envKey}`);
                    await setAbsen(user, "pagi");
                }
            }
            // Presensi sore: 14:30 - 20:00
            else if (now >= "14:30" && now < "20:00") {
                if (user.sore === 0 && now >= user.jam_sore) {
                    console.log(`[sore] Absen untuk ${user.envKey}`);
                    await setAbsen(user, "sore");
                }
            }
        }
    }
}

// --- Jalankan ---
executeData().then(() => {
    console.log('Selesai.');
    process.exit(0);
}).catch(err => {
    console.error(`[FATAL] ${err.message}`);
    console.error('Script dihentikan. Akan dicoba ulang di jadwal cron berikutnya.');
    process.exit(1);
});