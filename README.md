# Magic SOAP & Kronologi

Chrome Extension MV3 berbasis vanilla HTML/CSS/JS untuk membantu membuat draft Magic SOAP dan Kronologi BPJS dari input manual di Chrome Side Panel.

Extension ini berdiri sendiri dan tidak mengambil data dari halaman eRM. Semua input, hasil generate, preview, dan riwayat berada di side panel.

## Fitur

- Side Panel Chrome dengan 2 tab: Magic SOAP dan Kronologi.
- Input manual identitas anonim pasien dan data SOAP awal.
- Upload foto klinis opsional pada Objektif untuk dianalisis oleh model vision sebelum SOAP dibuat.
- Generate hasil AI sebagai preview yang bisa diedit.
- Copy hasil per form/field.
- Draft tiap tab autosave ke `chrome.storage.local`.
- Riwayat pasien tersimpan maksimal 60 hari dan bisa dihapus manual.
- Pengingat kronologi pada hasil Magic SOAP bila AI menandai kasus trauma/cedera eksternal.
- Warning JKN tampil kondisional hanya saat ada isi dari respons AI.
- Mode API pribadi/BYOK.
- Mode API admin bersama dengan login panel admin, pengaturan API key admin, dan manajemen user.

## Struktur File

```text
manifest.json
background.js
sidepanel.html
sidepanel.css
sidepanel.js
icon.png
fonts/
supabase/
DESIGN.md
SKILL.md
```

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
magic-soap
```

Folder `supabase/` berisi catatan dan migration awal untuk konfigurasi admin API `magic-soap`. Shared endpoint mengikuti pola aplikasi medis lain yang sudah ada.

## Validasi

Jalankan:

```bash
node --check sidepanel.js
node --check background.js
node sidepanel.js
```

`node sidepanel.js` menjalankan self-check prompt agar prompt Magic SOAP dan Kronologi tidak berubah tanpa sengaja.

## Catatan Keamanan

- Extension tidak membaca atau menulis field halaman eRM.
- Identitas pasien dianggap manual dan anonim.
- Foto klinis hanya disimpan sementara di memori side panel, dikirim ke provider saat Generate, lalu dilepas setelah analisis berhasil.
- Hasil AI selalu tampil sebagai preview/editable result sebelum dipakai user.
- Admin credential hanya dipakai untuk sesi panel admin dan tidak disimpan permanen di extension.
