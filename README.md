# Netmedic RSDKH

Chrome Extension MV3 berbasis vanilla HTML/CSS/JS untuk RSDKH, diturunkan dari base Magic SOAP dan siap dikembangkan dengan menu khusus rumah sakit.

Repo ini adalah turunan RSDKH dari base `magic-soap`. Fitur core tetap mengikuti upstream, sementara modul khusus RSDKH ditempatkan di repo ini.

## Fitur

- Side Panel Chrome dengan 2 tab: Magic SOAP dan Kronologi.
- Sesi `Jaga IGD` lokal dengan tombol Mulai Jaga, Selesai Jaga, dan pinned dashboard tunggal.
- Dashboard mengurutkan pasien berdasarkan BED, menyediakan pencarian dan status operasional, serta membuka kembali tab eRM pasien.
- Dashboard menandai kelengkapan Pengkajian Dokter IGD dengan indikator hijau centang atau merah silang tanpa mengubah status disposisi pasien.
- Riwayat sesi jaga dan riwayat hasil pasien dikelompokkan per tanggal, dengan retensi maksimal 60 hari.
- Memori SOAP/Kronologi terpisah per pasien berdasarkan nomor RM pada eRM aktif.
- Bar pasien menampilkan nama dan BED secara lokal, sedangkan prompt AI tetap hanya memakai umur serta jenis kelamin anonim.
- BED pasien dapat diubah dan dipakai untuk memaksa judul tab eRM menjadi `<bed> <nama pasien>`.
- Upload foto klinis opsional pada Objektif untuk dianalisis oleh model vision sebelum SOAP dibuat.
- Generate hasil AI sebagai preview yang bisa diedit.
- Copy hasil per form/field.
- Draft tiap tab autosave ke `chrome.storage.local`.
- Riwayat pasien tersimpan maksimal 60 hari dan bisa dihapus manual.
- Pengingat kronologi pada hasil Magic SOAP bila AI menandai kasus trauma/cedera eksternal.
- Warning JKN tampil kondisional hanya saat ada isi dari respons AI.
- Mode API pribadi/BYOK.
- Mode API admin bersama dengan login panel admin, pengaturan API key admin, dan manajemen user.
- Tombol `Input SOAP` di sebelah judul Pengkajian Dokter IGD untuk memilah dan mengisi S/O/A/P pada satu halaman. Diagnosis disimpan melalui panel ICD 10 FreeText; S/O/P tetap ditinjau sebelum Pengkajian disimpan.
- Tombol `Input SOAP` pada hasil Magic SOAP untuk membuka otomatis `Asesmen UGD → Pengkajian Dokter → Tambah` pada kunjungan pasien yang sama, lalu mengirim hasil S/O/A/P yang sudah diedit tanpa parsing AI ulang. User memilih rencana status pasien terlebih dahulu: rawat inap memakai `Diagnosa Awal`, sedangkan rawat jalan memakai `Primary / utama`.
- Identitas pasien aktif disinkronkan saat tab browser atau kunjungan eRM berubah. Judul tab memakai nama pasien, dengan awalan BED bila tersedia.
- Capture hasil laboratorium menyalin PNG ke clipboard, termasuk dari alamat eRM internal HTTP melalui jendela clipboard extension yang menutup otomatis.
- Tombol `e-Resep otomatis` pada Resep Elektronik V2 untuk mengambil Planning Pengkajian Dokter IGD atau Pengantar Opname, mewajibkan pilihan depo, merapikan resep, dan memasukkannya secara berurutan setelah konfirmasi dokter.
- Katalog final 605 produk RSDKH digunakan untuk mencocokkan hasil AI dengan nama produk eRM secara deterministik.
- Pengaturan menyediakan Kamus Produk RSDKH yang dapat ditambah, diedit, dihapus, dan direset tanpa mengubah katalog asli.
- Qty resep dihitung ulang dari bentuk sediaan, kekuatan produk, frekuensi, tpm, dan durasi rawat jalan sebelum ditampilkan untuk konfirmasi.

## Struktur File

```text
manifest.json
background.js
shift.js
dashboard.html
dashboard.css
dashboard.js
sidepanel.html
sidepanel.css
sidepanel.js
icon.png
fonts/
supabase/
hospital/rsdkh/
DESIGN.md
SKILL.md
```

## Hubungan dengan Base Repo

Repo ini adalah turunan dari:

```bash
https://github.com/syafrieyunizar/magic-soap.git
```

Remote yang dipakai:

```bash
origin   = https://github.com/syafrieyunizar/netmedic-rsdkh.git
upstream = https://github.com/syafrieyunizar/magic-soap.git
```

Untuk mengambil update fitur umum dari base:

```bash
git fetch upstream
git merge upstream/main
```

Perubahan khusus RSDKH sebaiknya dibuat terpisah dan terdokumentasi agar merge dari base tetap aman.

## Modul Khusus RSDKH

Fitur khusus RSDKH seperti auto input SOAP ke eRM, mapping selector eRM, workflow tombol kirim, atau validasi overwrite ditempatkan di folder `hospital/rsdkh/`.

Base `magic-soap` tetap tidak membaca atau menulis halaman eRM. Integrasi eRM hanya dibuat di repo turunan seperti repo ini.
## Cara Menjalankan di Chrome

1. Buka `chrome://extensions`.
2. Aktifkan `Developer mode`.
3. Klik `Load unpacked`.
4. Pilih folder repo ini.
5. Klik icon extension, lalu buka side panel.

## Pengaturan API

Extension mendukung dua alur:

- API pribadi: user mengisi provider dan API key sendiri di menu pengaturan.
- API admin: admin login melalui panel admin, menyimpan konfigurasi provider/API key bersama, lalu menambahkan user yang boleh memakai API admin.

Analisis foto dapat menggunakan API pribadi/BYOK atau API admin dengan model yang mendukung vision. Foto menerima format JPG, PNG, atau WebP hingga 8 MB. Mode API admin mengirim foto melalui action `ai_generate_vision` pada shared Edge Function.

API key disimpan di `chrome.storage.local` untuk mode pribadi. Tidak ada API key, token, atau password yang di-hardcode di source extension.

## Backend Admin

Konfigurasi admin memakai app id:

```text
netmedic-rsdkh
```

Folder `supabase/` berisi catatan dan migration awal untuk konfigurasi admin API `netmedic-rsdkh`. Shared endpoint mengikuti pola aplikasi medis lain yang sudah ada.

## Validasi

Jalankan:

```bash
node --check sidepanel.js
node --check background.js
node --check dashboard.js
node shift.js
node --check hospital/rsdkh/erm.js
node --check hospital/rsdkh/ai.js
node hospital/rsdkh/ai.js
node sidepanel.js
```

`node sidepanel.js` menjalankan self-check prompt agar prompt Magic SOAP dan Kronologi tidak berubah tanpa sengaja.

## Catatan Keamanan

- Modul RSDKH menulis Subjektif, Objektif, Assessment, dan Planning ke field eRM hanya setelah user menekan `Generate` pada modal Input SOAP.
- e-Resep otomatis tidak langsung menulis hasil AI. Dokter harus meninjau item, mencentang konfirmasi kesesuaian terapi, lalu menekan `Masukkan e-Resep`.
- Produk hanya dipilih otomatis bila dropdown menyisakan satu kandidat yang sesuai. Kandidat ambigu menghentikan proses pada item tersebut dan tidak dilewati diam-diam.
- Item resep dimasukkan secara serial. Item yang sudah berhasil ditandai dan tidak diulang saat user memperbaiki item berikutnya.
- Diagnosis disimpan melalui tombol Simpan di panel ICD 10 FreeText. S, O, dan P hanya diisikan agar dokter dapat meninjaunya sebelum menyimpan Pengkajian Dokter IGD.
- SOAP yang ditempel dikirim ke provider API yang aktif untuk dipilah menjadi S/O/A/P.
- Identitas pada side panel tetap anonim, dapat diisi manual atau ditarik sebagai jenis kelamin dan umur dari halaman eRM pasien aktif.
- Nama, nomor RM, BED, status sesi, dan URL eRM untuk dashboard hanya disimpan di `chrome.storage.local`; data tersebut tidak ditambahkan ke prompt AI.
- Hasil Magic SOAP dan Kronologi di side panel tetap tampil sebagai preview/editable result sebelum dipakai user.
- Magic SOAP hanya mencantumkan TTV yang tersedia; nilai kosong dihilangkan dan tidak diperkirakan oleh AI.
- Foto klinis hanya disimpan sementara di memori side panel, dikirim ke provider saat Generate, lalu dilepas setelah analisis berhasil.
- Admin credential hanya dipakai untuk sesi panel admin dan tidak disimpan permanen di extension.
