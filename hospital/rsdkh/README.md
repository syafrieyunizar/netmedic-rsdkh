# Modul Khusus RSDKH

Integrasi ini aktif hanya pada halaman rekam medis SIAPMEDIS RSDKH di `rsudbalangan.com` dan jaringan lokal `10.10.0.3`.

## File

- `ai.js`: memilah SOAP menjadi JSON `s`, `o`, `a`, dan `p` menggunakan API pribadi atau API admin `netmedic-rsdkh`.
- `erm.js`: menyisipkan tombol `Input SOAP`, menampilkan modal, dan menjalankan urutan pengisian eRM.
- `erm.css`: tampilan tombol, modal, progres, error, dan toast yang terisolasi dari CSS SIAPMEDIS.

## Alur Input SOAP

1. User menekan `Input SOAP` di sebelah tombol Alergi.
2. SOAP dikirim ke provider API yang aktif untuk dipilah tanpa mengubah isi klinis.
3. Subjektif disimpan ke Anamnesis sebagai Keluhan Utama.
4. Objektif disimpan ke Pemeriksaan Fisik sebagai Pemeriksaan Lokal.
5. Assessment disimpan ke Diagnosis dengan jenis `Diagnosa Awal`.
6. Asesment IGD 2 dibuka, Assessment diisikan ke Diagnosa Kerja, dan Planning diisikan ke baris Instruksi Dokter baru.
7. Asesment IGD 2 sengaja tidak disimpan agar dokter dapat memeriksa hasil akhir.

Selector mengandalkan label dan teks komponen SIAPMEDIS, bukan atribut Angular sementara seperti `_ngcontent-*`. Bila struktur target tidak ditemukan, proses berhenti dan menunjukkan tahap yang gagal.

Jangan menaruh logic umum Magic SOAP/Kronologi di folder ini. Logic umum tetap mengikuti upstream `magic-soap`.
