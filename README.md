# SILAPHAR - Sistem Rekapitulasi & Pelaporan WBP

Aplikasi web dashboard eksekutif untuk mengonversi data laporan harian Warga Binaan Pemasyarakatan (WBP) dari Google Spreadsheet menjadi dokumen presentasi PDF 8 halaman berdimensi 16:9 secara instan, lengkap dengan cover resmi dan halaman penutup.

Didesain khusus untuk Kantor Wilayah Direktorat Jenderal Pemasyarakatan Kalimantan Selatan.

---

## Fitur Utama

1. **Sinkronisasi Otomatis Google Spreadsheet via Google Apps Script (GAS)**:
   - Mengambil data langsung dari endpoint Google Apps Script Web App.
   - Mendukung multi-tab harian (otomatis memilih sheet tanggal terkini).
2. **Penyimpanan Snapshot Database Lokal (SQLite + LocalStorage Fallback)**:
   - Sekali didaftarkan, seluruh data snapshot langsung tersimpan di database lokal (`spreadsheets.sqlite`).
   - Dokumen terbuka secara instan (0 detik) tanpa perlu menunggu koneksi Google Sheets berulang kali.
   - Jika berjalan di lingkungan tanpa PHP (misal `file:///`), sistem otomatis beralih ke `localStorage`.
3. **Cover & Penutup Resmi Asli**:
   - **Slide 1 (Cover)**: Menggunakan grafis cover resmi asli beresolusi tinggi dengan overlay tanggal dinamis yang terisi otomatis.
   - **Slide 8 (Penutup)**: Menggunakan grafis penutup resmi asli (*"Terima Kasih Atas Perhatian dan Arahan"*).
   - **Slide 2 s/d 7**: Menggunakan latar belakang template grafis resmi dengan tabel data presisi tinggi.
4. **Pewarnaan Otomatis (Conditional Formatting)**:
   - Kolom `TOTAL ISI` dan `KAPASITAS` berwarna hijau neon (`#00ff00`).
   - Kolom `OVER KAPASITAS` otomatis berwarna merah (`#ff0000`) jika di atas 0%, dan hijau (`#00ff00`) jika 0%.
   - Baris total `JUMLAH` di bagian bawah otomatis diblok warna hijau terang.
5. **Manajemen Dokumen Multi-Spreadsheet**:
   - Mengelola pendaftaran Google Spreadsheet bulanan melalui dialog modal yang terstruktur.
   - Dapat menandai spreadsheet default dan menyinkronkan ulang data snapshot sewaktu-waktu.
6. **Ekspor PDF Vektor Presisi 16:9**:
   - Tombol **Simpan sebagai PDF (8 Halaman)** langsung memicu cetak native browser beresolusi tajam 100% vektor dengan orientasi lanskap 16:9 (1440px x 810px).

---

## Struktur Direktori

```
silaphar/
├── index.html                  # Halaman web dashboard & 8 slide preview
├── api.php                     # Backend API untuk penyimpanan snapshot SQLite
├── GoogleAppsScript_Code.gs    # Kode skrip Google Apps Script untuk Google Spreadsheet
├── .htaccess                   # Konfigurasi Apache / Hostinger (keamanan & kompresi)
├── .gitignore                  # Berkas yang diabaikan Git
├── README.md                   # Dokumentasi proyek
├── css/
│   └── style.css               # Styling slide 16:9, tata letak tabel, & tema portal
├── js/
│   └── app.js                  # Logika aplikasi, integrasi database, & render tabel
├── database/
│   ├── .htaccess               # Perlindungan keamanan direktori database
│   └── spreadsheets.sqlite     # Database SQLite lokal penyimpanan snapshot
└── assets/
    ├── cover_template.png      # Template gambar cover resmi (Slide 1)
    ├── table_bg.jpg            # Background slide tabel data (Slide 2-7)
    ├── closing.png             # Template gambar penutup resmi (Slide 8)
    └── Logo Permasyarakatan.webp # Logo resmi Pemasyarakatan
```

---

## Panduan Deploy ke Hostinger

### Metode 1: Git Deployment (Otomatis)
1. Buka hPanel Hostinger > **Git Repository**.
2. Masukkan URL repositori: `https://github.com/RandyFauzi/silaphar.git`.
3. Tentukan Branch: `main` (atau `master`).
4. Tentukan Direktori: `/public_html` (atau subdomain).
5. Klik **Create** lalu **Deploy**.

### Metode 2: File Manager / FTP (Manual)
1. Login ke panel kontrol **Hostinger** (hPanel).
2. Buka **File Manager** (atau gunakan FTP FileZilla).
3. Masuk ke folder root domain: `public_html/`.
4. Unggah seluruh berkas dan folder dari repositori ini.
5. Pastikan hak akses folder `database/` dapat ditulis oleh web server (`chmod 755` atau `chmod 775`).
6. Akses website melalui domain Anda di browser.
