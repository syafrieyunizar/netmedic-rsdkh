# Modul Khusus RSDKH

Integrasi ini aktif hanya pada halaman rekam medis SIAPMEDIS RSDKH di `rsudbalangan.com` dan jaringan lokal `10.10.0.3`.

## File

- `ai.js`: memilah SOAP dan menyusun preview e-Resep terstruktur menggunakan API pribadi atau API admin `netmedic-rsdkh`.
- `erm.js`: menyisipkan tombol `Input SOAP`, menampilkan modal, dan menjalankan urutan pengisian eRM.
- `erm.css`: tampilan tombol, modal, progres, error, dan toast yang terisolasi dari CSS SIAPMEDIS.
- `prescription.js`: menyisipkan tombol `e-Resep otomatis`, menampilkan preview editable, dan memasukkan produk secara serial ke Resep Non Racikan.
- `prescription.css`: tampilan modal, kartu item, status, dan tombol e-Resep yang terisolasi.
- `product-catalog.json`: katalog final produk eRM RSDKH.
- `product-aliases.json`: kamus istilah dokter bawaan untuk pencarian katalog.

Side panel juga menyediakan tombol `dari eRM saat ini` di samping Identitas anonim pasien. Tombol ini hanya membaca jenis kelamin dan umur dari halaman rekam medis yang sedang aktif; nama, nomor rekam medis, dan identitas pribadi lain tidak diambil.

## Alur Input SOAP

1. User menekan `Input SOAP` di sebelah tombol Alergi.
2. SOAP dikirim ke provider API yang aktif untuk dipilah tanpa mengubah isi klinis.
3. Subjektif disimpan ke Anamnesis sebagai Keluhan Utama.
4. Objektif disimpan ke Pemeriksaan Fisik sebagai Pemeriksaan Lokal.
5. Assessment disimpan ke Diagnosis dengan jenis `Diagnosa Awal`.
6. Asesment IGD 2 dibuka, Assessment diisikan ke Diagnosa Kerja, dan Planning diisikan ke baris Instruksi Dokter baru.
7. Asesment IGD 2 sengaja tidak disimpan agar dokter dapat memeriksa hasil akhir.

Hasil Magic SOAP pada side panel juga memiliki tombol `Input SOAP`. Sebelum proses berjalan, user memilih rencana status pasien. Rawat inap memilih jenis `Diagnosa Awal`, sedangkan rawat jalan memilih `Primary / utama`; langkah lain tetap sama. Tombol ini mengirim empat hasil editable S/O/A/P langsung ke content script dan menjalankan langkah 3-7 tanpa memanggil parser AI lagi. Tab aktif wajib berada pada halaman eRM pasien, dan umur serta jenis kelaminnya harus sesuai dengan identitas side panel sebelum field pertama ditulis.

Selector mengandalkan label dan teks komponen SIAPMEDIS, bukan atribut Angular sementara seperti `_ngcontent-*`. Bila struktur target tidak ditemukan, proses berhenti dan menunjukkan tahap yang gagal.

## Alur e-Resep Otomatis

Extension memuat katalog final 605 produk hasil penggabungan pemindaian autocomplete SIAPMEDIS. Nama produk dinormalisasi dan dideduplikasi sebelum dipakai untuk pencocokan hasil AI.

1. User membuka Resep Elektronik V2 dan menekan `e-Resep otomatis` di sebelah Racikan.
2. User memilih Rawat inap, Rawat jalan, atau Resep Pergantian IGD, lalu menulis daftar obat secara bebas. Rawat jalan menampilkan pertanyaan jumlah hari; bila kosong, obat oral padat menggunakan default 10 pcs per item.
3. AI menghasilkan ringkasan terapi. Extension mencocokkan setiap item ke nama produk katalog, lalu menampilkan editor ringkas berisi Produk, Qty, dan Aturan pakai tanpa kolom Sediaan terpisah.
   Untuk Resep Pergantian IGD dengan terapi injeksi/IV, umur dibaca dan diproses lokal dari header eRM. Extension memastikan Surflo 22 untuk pasien minimal 18 tahun dan Surflo 24 untuk pasien di bawah 18 tahun, lalu mencarinya dengan istilah katalog `Surflo no 22` atau `Surflo no 24`. Umur tidak dikirim ke provider AI.
   Qty infus 500 ml dihitung per 7 tpm per 24 jam, injeksi dari dosis/frekuensi terhadap kekuatan vial, tablet/kapsul dari jumlah per dosis × frekuensi × durasi, dan sirup default 1 botol.
4. User mengonfirmasi kesesuaian terapi sebelum tombol `Masukkan e-Resep` aktif.
5. Saat `Masukkan e-Resep` ditekan, modal extension ditutup agar halaman eRM tidak lagi berstatus `inert`. Progres berjalan melalui toast.
6. Extension memfokuskan AutoComplete `Pilih Produk`, mengosongkan input, lalu mengetik nama produk katalog karakter demi karakter menggunakan input browser asli dengan fallback event Angular.
7. Setelah nama selesai, extension memilih hanya opsi dropdown yang sama persis dengan nama produk katalog. Item yang belum memiliki kecocokan pasti harus dipilih atau dikoreksi user terlebih dahulu.
8. Qty diketik lalu disinkronkan melalui tombol spinner PrimeNG agar model Angular dan kolom turunan `Jumlah` ikut berubah. Extension baru menekan Tambah setelah kedua angka sesuai, kemudian mencoba ulang satu kali hanya bila produk belum masuk.
9. Keberhasilan Tambah diperiksa dari reset form dan kemunculan produk pada tabel hasil di seluruh halaman sebelum item berikutnya dimulai.
10. Kegagalan satu item disimpan pada kartu merah tanpa menghentikan item berikutnya. Setelah seluruh batch selesai, modal dibuka kembali dengan laporan nama produk dan alasan setiap kegagalan.
11. Saat dicoba kembali, hanya item gagal yang diproses; item hijau yang sudah berhasil tidak diulang.

Versi extension baru dinaikkan setelah alur pengisian ini berhasil diuji pada eRM aktual.

Kamus istilah dikelola melalui Side Panel → Pengaturan → Kamus Produk RSDKH. Istilah seperti Attapulgite hanya mempersempit pencarian katalog; produk dipilih otomatis bila kandidatnya tunggal atau ditahan untuk konfirmasi sesuai pengaturan alias.

Jangan menaruh logic umum Magic SOAP/Kronologi di folder ini. Logic umum tetap mengikuti upstream `magic-soap`.
