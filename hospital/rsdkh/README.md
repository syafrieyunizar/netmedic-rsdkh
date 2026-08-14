# Modul Khusus RSDKH

Integrasi ini aktif hanya pada halaman rekam medis SIAPMEDIS RSDKH di `rsudbalangan.com` dan jaringan lokal `10.10.0.3`.

## File

- `ai.js`: memilah SOAP dan menyusun preview e-Resep terstruktur menggunakan API pribadi atau API admin `netmedic-rsdkh`.
- `erm.js`: menyisipkan tombol `Input SOAP`, menampilkan modal, dan menjalankan urutan pengisian eRM.
- `erm.css`: tampilan tombol, modal, progres, error, dan toast yang terisolasi dari CSS SIAPMEDIS.
- `prescription.js`: menyisipkan tombol `e-Resep otomatis`, menampilkan preview editable, dan memasukkan produk secara serial ke Resep Non Racikan.
- `prescription.css`: tampilan modal, kartu item, status, dan tombol e-Resep yang terisolasi.

Side panel juga menyediakan tombol `dari eRM saat ini` di samping Identitas anonim pasien. Tombol ini hanya membaca jenis kelamin dan umur dari halaman rekam medis yang sedang aktif; nama, nomor rekam medis, dan identitas pribadi lain tidak diambil.

## Alur Input SOAP

1. User menekan `Input SOAP` di sebelah tombol Alergi.
2. SOAP dikirim ke provider API yang aktif untuk dipilah tanpa mengubah isi klinis.
3. Subjektif disimpan ke Anamnesis sebagai Keluhan Utama.
4. Objektif disimpan ke Pemeriksaan Fisik sebagai Pemeriksaan Lokal.
5. Assessment disimpan ke Diagnosis dengan jenis `Diagnosa Awal`.
6. Asesment IGD 2 dibuka, Assessment diisikan ke Diagnosa Kerja, dan Planning diisikan ke baris Instruksi Dokter baru.
7. Asesment IGD 2 sengaja tidak disimpan agar dokter dapat memeriksa hasil akhir.

Selector mengandalkan label dan teks komponen SIAPMEDIS, bukan atribut Angular sementara seperti `_ngcontent-*`. Bila struktur target tidak ditemukan, proses berhenti dan menunjukkan tahap yang gagal.

## Alur e-Resep Otomatis

1. User membuka Resep Elektronik V2 dan menekan `e-Resep otomatis` di sebelah Racikan.
2. User memilih Rawat inap, Rawat jalan, atau Resep IGD (Ranap), lalu menulis daftar obat secara bebas.
3. AI menghasilkan ringkasan terapi dan kartu item resep yang seluruhnya dapat diedit.
   Untuk Resep IGD (Ranap) dengan terapi injeksi/IV, umur dibaca dan diproses lokal dari header eRM. Extension memastikan Surflo 22 untuk pasien minimal 18 tahun dan Surflo 24 untuk pasien di bawah 18 tahun, lalu mencarinya dengan istilah katalog `Surflo no 22` atau `Surflo no 24`. Umur tidak dikirim ke provider AI.
4. User mengonfirmasi kesesuaian terapi sebelum tombol `Masukkan e-Resep` aktif.
5. Saat `Masukkan e-Resep` ditekan, modal extension ditutup agar halaman eRM tidak lagi berstatus `inert`. Progres berjalan melalui toast.
6. Extension memfokuskan AutoComplete `Pilih Produk`, mengosongkan input, lalu mengetik nama pencarian karakter demi karakter menggunakan input browser asli dengan fallback event Angular.
7. Setelah setiap karakter, extension menunggu daftar milik `aria-controls` selesai diperbarui. Bila hanya tersisa satu opsi, opsi tersebut langsung dipilih.
8. Bila setelah nama selesai masih ada beberapa opsi, extension menyaring seluruh kandidat berdasarkan sediaan dan kekuatan/ukuran dari kartu resep. Hanya satu hasil akhir yang boleh dipilih otomatis.
9. Qty diisi melalui rangkaian event keyboard/input yang dikenali Angular, aturan pakai diisi bila tersedia, lalu tombol Tambah ditekan satu per satu.
10. Keberhasilan Tambah diperiksa dari reset form dan kemunculan produk pada tabel hasil di seluruh halaman, bukan hanya tabel di dalam panel input.
11. Bila produk tidak ditemukan atau masih ambigu, proses berhenti dan modal dibuka kembali pada item yang merah. Item yang sudah berhasil tidak diulang saat mencoba kembali.

Versi extension baru dinaikkan setelah alur pengisian ini berhasil diuji pada eRM aktual.

Jangan menaruh logic umum Magic SOAP/Kronologi di folder ini. Logic umum tetap mengikuti upstream `magic-soap`.
