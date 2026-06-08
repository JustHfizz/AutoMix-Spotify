# 🎵 AutoMix — Spicetify Extension

AutoMix adalah ekstensi Spicetify yang membawa pengalaman seperti **Apple Music AutoMix** ke Spotify — transisi antar lagu yang mulus berdasarkan tempo (BPM), energi, dan kunci nada.

---

## ✨ Fitur

| Fitur | Deskripsi |
|---|---|
| **Crossfade Otomatis** | Fade halus antar lagu dengan panjang yang disesuaikan |
| **Beat Match** | Sinkronisasi ke ketukan saat BPM dua lagu mirip (±15 BPM default) |
| **Smart Fade** | Gabungan crossfade + analisis energi untuk transisi yang natural |
| **Smart Queue** | Otomatis cari dan antri lagu berikutnya yang cocok secara tempo & energi |
| **UI Overlay** | Notifikasi kecil yang muncul saat transisi: mode, BPM, dan kunci nada |
| **Settings Panel** | Konfigurasi langsung dari tombol di top bar Spotify |

---

## 📥 Instalasi

### Prasyarat
- [Spicetify](https://spicetify.app/) sudah terpasang
- Spotify sudah di-patch dengan Spicetify

### Langkah Instalasi

```bash
# 1. Salin file ke folder ekstensi Spicetify
cp automix.js "$(spicetify -c | sed 's/config.ini/Extensions/')automix.js"

# 2. Aktifkan ekstensi
spicetify config extensions automix.js

# 3. Terapkan perubahan
spicetify apply
```

Atau secara manual:

1. Temukan folder Spicetify:
   - **Windows:** `%appdata%\spicetify\Extensions\`
   - **macOS/Linux:** `~/.config/spicetify/Extensions/`

2. Salin `automix.js` ke folder tersebut

3. Jalankan di terminal:
   ```bash
   spicetify config extensions automix.js
   spicetify apply
   ```

---

## ⚙️ Konfigurasi

Klik tombol **⟳** di top bar Spotify untuk membuka panel pengaturan.

| Pengaturan | Default | Deskripsi |
|---|---|---|
| Enable AutoMix | OFF | Aktifkan/nonaktifkan seluruh fitur |
| Smart Queue | ON | Antri otomatis lagu dengan tempo serupa |
| Energy Blend | ON | Sesuaikan panjang fade berdasarkan selisih energi lagu |
| Transition Mode | Smart | `Smart`, `Crossfade`, atau `Beat Match` |
| Crossfade Duration | 6 detik | Panjang transisi (2–12 detik) |
| Beat-Match Window | ±15 BPM | Toleransi BPM untuk mode Beat Match |

---

## 🎛️ Mode Transisi

### Smart (Otomatis)
AutoMix memilih mode terbaik berdasarkan audio features:
- BPM mirip + kunci sama → **Beat Match**
- Selisih energi besar → fade lebih panjang
- Fallback → **Crossfade** standar

### Crossfade
Fade out lagu sekarang → skip ke lagu berikutnya → fade in. Klasik dan andal.

### Beat Match
Transisi cepat dan sinkron ke ketukan. Digunakan saat BPM kedua lagu dalam window toleransi.

---

## 📊 Cara Kerja (Teknis)

```
Track berubah
    │
    ▼
Fetch Audio Features (BPM, Energy, Key, Valence)
    │
    ├─► Smart Queue: cari rekomendasi berdasarkan BPM & energi
    │
    └─► Jadwalkan transisi (dur - fadeDuration - 500ms)
            │
            ▼
        Hitung mode transisi (beatmatch / smart / crossfade)
            │
            ▼
        Tampilkan overlay UI
            │
            ▼
        Fade out → next() → fade in
```

---

## 🔧 Pengembangan

```bash
# Edit file
code automix.js

# Setelah edit, terapkan ulang
spicetify apply
```

Untuk reload cepat tanpa restart Spotify penuh:
```bash
spicetify watch -s
```

---

## 📝 Catatan

- **API Rate Limit:** Spicetify menggunakan token Spotify yang sama — penggunaan normal tidak akan kena rate limit.
- **Kompatibilitas:** Diuji pada Spicetify 2.x dengan Spotify desktop.
- **Volume API:** Fade dilakukan via `Spicetify.Platform.PlaybackAPI` — kompatibilitas bisa berbeda antar versi Spotify.

---

## 🪲 Troubleshooting

| Masalah | Solusi |
|---|---|
| Tombol ⟳ tidak muncul | Coba refresh Spotify, pastikan ekstensi aktif |
| Fade tidak terjadi | Cek apakah AutoMix di-enable di settings |
| BPM tidak terdeteksi | Spotify API kadang tidak punya data untuk lagu tertentu |
| Smart Queue tidak berjalan | Pastikan Smart Queue di-enable, dan lagu sedang diputar dari konteks yang memperbolehkan queue |

---

## 📜 Lisensi

MIT License — bebas dimodifikasi dan didistribusikan.
