const $ = (selector) => document.querySelector(selector);

const SETTINGS_KEY = "apiSettings";
const APP_ID = "magic-soap";
const KNOWLEDGE_FUNCTION_URL = "https://yvcqgwpfjoxhuyhxuiry.supabase.co/functions/v1/knowledge-admin";
const ADMIN_DEVICE_KEY = "magicSoap.adminAccessDeviceId";
const ADMIN_SESSION_KEY = "magicSoap.adminUserSession";
const SOAP_DRAFT_KEY = "magicSoapDraft";
const KRONOLOGI_DRAFT_KEY = "kronologiDraft";
const HISTORY_KEY = "patientHistory";
const ACTIVE_PATIENT_KEY = "activePatientEpisode";
const HISTORY_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_CLINICAL_IMAGE_BYTES = 8 * 1024 * 1024;
const CLINICAL_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SOAP_FIELD_IDS = ["identity", "serviceMode", "subjektif", "objektif", "assessment", "planning", "resultS", "resultO", "resultA", "resultP", "requiresChronology", "chronologyReason", "chronologyEffect"];
const KRONOLOGI_FIELD_IDS = ["skenario", "akibat", "resultKronologi", "resultWarning", "resultWarningRule"];
const CLINICAL_VISION_PROMPT = `Anda membantu dokter mendokumentasikan temuan objektif dari foto klinis.

Deskripsikan hanya temuan visual yang benar-benar tampak dan relevan untuk bagian Objektif SOAP.
- Gunakan bahasa klinis Indonesia yang ringkas.
- Satu temuan per baris.
- Jangan menebak identitas pasien, diagnosis, penyebab, ukuran, lokasi anatomi, atau tingkat keparahan bila tidak jelas dari foto.
- Jangan memberi terapi atau saran.
- Jika kualitas foto tidak cukup atau tidak ada temuan klinis yang dapat dinilai, nyatakan bahwa foto tidak dapat dinilai dan perlu verifikasi dokter.

Kembalikan teks biasa tanpa markdown atau JSON.`;
const HELP_CONTENT = {
  soap: {
    title: "Cara menggunakan Magic SOAP",
    steps: [
      "Isi identitas anonim pasien dan pilih status pelayanan.",
      "Masukkan catatan awal Subjektif, Objektif, Assessment, dan Planning. Foto klinis opsional dapat ditambahkan pada Objektif.",
      "Tekan Generate, lalu tinjau dan edit hasil sebelum digunakan.",
      "Salin setiap bagian melalui tombol salin. Jika muncul pengingat kronologi, gunakan Buat kronologi."
    ]
  },
  kronologi: {
    title: "Cara menggunakan Kronologi",
    steps: [
      "Isi skenario kejadian berdasarkan keterangan asli pasien.",
      "Isi akibat atau cedera yang terjadi. Data dari Magic SOAP dapat terisi otomatis.",
      "Tekan Generate, lalu tinjau dan edit kronologi final sebelum digunakan.",
      "Periksa warning dan aturan JKN bila muncul, kemudian salin hasil melalui tombol salin."
    ]
  }
};
const DEFAULT_SETTINGS = {
  apiKeySource: "personal",
  provider: "gemini",
  apiKey: "",
  model: "gemini-2.0-flash",
  customProviderLabel: "",
  customBaseUrl: "",
  validated: false,
  validatedAt: ""
};
const PROVIDERS = {
  gemini: { label: "Gemini", endpoint: "", defaultModel: "gemini-2.0-flash" },
  sumopod: { label: "Sumopod", endpoint: "https://ai.sumopod.com/v1/chat/completions", defaultModel: "" },
  aimurah: { label: "AImurah", endpoint: "https://aimurah.my.id/api/v1/chat/completions", defaultModel: "" },
  semutssh: { label: "SemutSSH", endpoint: "https://ai.semutssh.com/chat/completions", defaultModel: "" }
};
const RESPONSE_SCHEMAS = {
  soap: {
    type: "object",
    properties: {
      s: { type: "string" },
      o: { type: "string" },
      a: { type: "string" },
      p: { type: "string" },
      requires_chronology: { type: "boolean" },
      chronology_reason: { type: "string" },
      chronology_effect: { type: "string" }
    },
    required: ["s", "o", "a", "p", "requires_chronology", "chronology_reason", "chronology_effect"]
  },
  kronologi: {
    type: "object",
    properties: {
      kronologi: { type: "string" },
      warning: { type: "string" },
      warning_rule: { type: "string" }
    },
    required: ["kronologi", "warning", "warning_rule"]
  }
};

let settings = { ...DEFAULT_SETTINGS };
let adminPublicConfig = null;
let adminUserSession = null;
let ownerAdminAuth = null;
let ownerUserResetTarget = "";
let historyEntries = [];
let activePatientEpisode = null;
let resultReturnFocus = null;
let resultCloseTimer = null;
let historyCloseTimer = null;
let soapSaveTimer;
let kronologiSaveTimer;
let selectedClinicalImage = null;

function buildMagicSoapPrompt({ identity, serviceMode, subjektif, objektif, assessment, planning }) {
  const modeText = {
    rawat_inap: "RAWAT INAP",
    rawat_jalan: "RAWAT JALAN",
    dari_poli: "DARI POLI"
  }[serviceMode] || "RAWAT INAP";
  const soapInput = { s: subjektif, o: objektif, a: assessment, p: planning };

  return String.raw`Kamu adalah asisten dokter IGD yang membantu menyusun catatan SOAP Gawat Darurat untuk kebutuhan dokumentasi medis dan kelayakan klaim BPJS.

Tugas kamu adalah mengembangkan data SOAP ringkas yang sudah ditulis dokter menjadi SOAP IGD yang lebih lengkap, natural, ringkas, klinis, dan defensible untuk kondisi gawat darurat.

Kamu WAJIB mengikuti prinsip berikut:
1. Jangan menulis seperti artikel, buku teks, atau bahasa AI.
2. Gunakan gaya bahasa dokter IGD Indonesia.
3. Gunakan singkatan medis yang lazim bila sesuai.
4. Jangan mengarang identitas pasien.
5. Jangan memasukkan nama pasien, nomor rekam medis, alamat, atau identitas pribadi.
6. Identitas yang boleh dipakai hanya umur dan jenis kelamin.
7. Tetap munculkan red flag kegawatdaruratan yang relevan secara klinis dari keluhan dan objektif yang diberikan.
8. Jangan membuat diagnosis atau temuan yang bertentangan dengan data awal.
9. Jika data awal sangat ringkas, perluas menjadi dokumentasi klinis IGD yang masuk akal dan harus tetap selaras dengan keluhan utama.
10. Output wajib berupa JSON valid tanpa markdown.

KRITERIA GAWAT DARURAT BPJS:
Berdasarkan Matriks Ketentuan Penjaminan dan Penagihan Klaim IGD pada BA Kesepakatan No. 1247/BA/1124, kasus IGD harus memenuhi sedikitnya satu kriteria:
a. mengancam nyawa, membahayakan diri dan orang lain/lingkungan;
b. adanya gangguan pada jalan napas, pernafasan, dan sirkulasi;
c. adanya penurunan kesadaran;
d. adanya gangguan hemodinamik; dan/atau
e. memerlukan tindakan segera.

Gunakan red flag dan kriteria yang paling sesuai dengan data awal. Jangan menambahkan red flag yang bertentangan dengan keluhan, temuan, atau konteks kasus.

KONTEKS PASIEN:
Identitas anonim:
${identity}

Status pelayanan:
${modeText}

Pilihan status pelayanan hanya salah satu dari:
- RAWAT INAP
- RAWAT JALAN
- DARI POLI

ATURAN STATUS PELAYANAN:
- Jika status pelayanan RAWAT INAP, tuliskan SOAP dengan konteks bahwa pasien sudah mendapatkan terapi awal di IGD, tetapi keluhan belum membaik, bertambah berat, masih membutuhkan observasi ketat, atau masih membutuhkan rawat inap/perawatan lanjutan sesuai konteks klinis.
- Jika status pelayanan RAWAT JALAN, tuliskan SOAP dengan konteks bahwa setelah terapi di IGD kondisi pasien membaik. Jika sebelumnya ada tanda vital atau kondisi hemodinamik tidak stabil, tuliskan bahwa setelah terapi kondisi menjadi lebih stabil bila sesuai konteks klinis.
- Jika status pelayanan DARI POLI, tuliskan SOAP dengan konteks bahwa pasien berasal dari poli dan membutuhkan rawat inap untuk perbaikan keadaan umum, observasi, terapi lanjutan, rencana tindakan, atau alasan klinis lain yang disesuaikan dengan konteks kasus.

DATA AWAL DARI DOKTER:
Subjektif awal:
${soapInput.s || ""}

Objektif awal:
${soapInput.o || ""}

Assessment awal:
${soapInput.a || ""}

Planning awal:
${soapInput.p || ""}

ATURAN MUTLAK SUBJEKTIF (S):
Bagian S adalah ANAMNESIS, yaitu apa yang DIKELUHKAN dan DIRASAKAN pasien.

Oleh karena itu:
- DILARANG KERAS menggunakan istilah klinis yang hanya diketahui dokter, bukan bahasa pasien.
- Istilah seperti "retraksi", "ronki", "wheezing", "sianosis", "distensi abdomen", "defans muskular", dan istilah pemeriksaan fisik lain adalah temuan pemeriksaan fisik. Letakkan di bagian O (Objektif), BUKAN di S.
- Di bagian S, gunakan HANYA bahasa yang bisa diucapkan pasien kepada dokter.
- Bila status pelayanan RAWAT INAP, tambahkan konteks bahwa setelah terapi awal keluhan belum membaik atau masih membutuhkan observasi/perawatan.
- Bila status pelayanan RAWAT JALAN, tambahkan konteks bahwa setelah terapi keluhan membaik bila sesuai.
- Bila status pelayanan DARI POLI, tambahkan konteks bahwa pasien membutuhkan rawat inap untuk perbaikan keadaan umum, rencana tindakan, observasi, terapi lanjutan, atau alasan klinis lain sesuai konteks.

CONTOH KONVERSI ISTILAH KLINIS KE BAHASA PASIEN DAN BAHASA DOKTER:
- Jangan tulis: "terdapat retraksi sela iga"
  Tulis: "napas terasa berat dan tidak lancar"
- Jangan tulis: "sesak napas dengan retraksi subkostal"
  Tulis: "napas terasa sesak dan berat, susah menarik napas"
- Jangan tulis: "intensitas nyeri tetap tinggi"
  Tulis: "nyerinya tidak berkurang"
- Jangan tulis: "distensi abdomen"
  Tulis: "perut terasa kembung dan penuh"
- Jangan tulis: "Pasien tidak membaik saat observasi di IGD, nyeri tetap tidak tertahankan dan muntah masih terus berlangsung meskipun telah diberikan terapi injeksi antinyeri awal."
  Tulis: "Setelah diberikan terapi dan observasi di IGD, keluhan nyeri tidak berkurang dan masih muntah muntah"
- Jangan tulis: "Pasien datang dengan keluhan BAB cair frekuensi lebih dari 15 kali sejak 2 hari SMRS."
  Tulis: "Pasien datang dengan keluhan BAB cair >15x sejak 2 hari SMRS"
- Jangan tulis: "kondisi fisik semakin menurun dan tanda dehidrasi semakin memberat."
  Tulis: "pasien masih mengatakan tidak ada BAK, dan keluhan belum membaik"

ATURAN NORMALISASI BAHASA ANAMNESIS:
- Buat bahasa Subjektif senatural mungkin seperti catatan dokter IGD Indonesia.
- Jangan membuat kalimat terlalu baku atau seperti artikel.
- Jangan mengubah makna klinis dari input dokter.
- Untuk keluhan yang disangkal, ubah menjadi format ringkas dokter dengan tanda negatif bila ditulis ringkas.
- Contoh:
  "muntah tidak ada" menjadi "muntah (-)"
  "tidak ada muntah" menjadi "muntah (-)"
  "demam tidak ada" menjadi "demam (-)"
  "batuk pilek tidak ada" menjadi "batuk pilek (-)"
  "sesak tidak ada" menjadi "sesak (-)"
- Untuk frekuensi atau durasi keluhan, gunakan angka dan "x" agar ringkas dan natural bila sesuai.
- Contoh:
  "BAB cair tiga kali" menjadi "BAB cair 3x"
  "muntah dua kali" menjadi "muntah 2x"
  "kejang satu kali" menjadi "kejang 1x"
  "demam lima hari" menjadi "demam 5 hari"
  "nyeri sejak tiga jam" menjadi "nyeri sejak 3 jam"

ATURAN FORMAT SUBJEKTIF (S) WAJIB DIPATUHI:
1. S harus lebih detail dan lengkap daripada input awal dokter. Jangan hanya menyalin atau membuat parafrase pendek.
2. Kembangkan S menjadi anamnesis IGD yang natural, runtut, dan defensible untuk kegawatdaruratan, tetapi DILARANG mengarang fakta spesifik yang tidak didukung data awal.
3. S wajib tetap berada dalam satu nilai string JSON "s", tetapi isi string wajib memakai newline escaped "\n" untuk memisahkan bagian sesuai aturan di bawah.
4. Setiap gejala/keluhan utama wajib dipisahkan dengan newline "\n".
5. Setiap gejala yang ada wajib diberi tanda "(+)" setelah nama gejala di awal kalimat, lalu dilanjutkan dengan deskripsinya.
6. Format natural yang diharapkan:
   "Pasien datang dengan keluhan sesak napas (+) yang dirasakan memberat sejak tadi malam. Sesak dirasakan terus-menerus dan semakin berat saat pasien batuk atau beraktivitas."
   "Pasien juga mengeluhkan batuk (+) yang sudah berlangsung hampir 1 bulan ini, batuk disertai dahak yang sulit dikeluarkan."
   "Pasien mengeluhkan nyeri dada (+) di sebelah kiri yang terasa seperti tertusuk, terutama saat pasien menarik napas dalam atau saat batuk."
7. Keluhan yang disangkal boleh tetap dalam satu kalimat natural, misalnya:
   "Keluhan demam, mual, maupun muntah disangkal oleh pasien."
8. Bila keluhan negatif ditulis ringkas, gunakan format seperti "demam (-)", "mual (-)", "muntah (-)", atau "sesak (-)".
9. Awali dengan cerita keluhan utama secara lengkap berdasarkan data yang tersedia: onset, durasi, lokasi, penjalaran bila relevan, karakter, perburukan, pencetus, pemberat/peringan, dan keluhan penyerta. Gunakan hanya unsur yang tersedia atau dapat dinyatakan secara umum tanpa membuat fakta baru.
10. Jika data awal memuat RPD, riwayat penyakit dahulu, riwayat pemeriksaan sebelumnya, riwayat pengobatan, atau riwayat penting lain, pisahkan dengan dua newline "\n\n" lalu tulis dengan heading "RPD :".
11. Jika ada RPO, pisahkan dengan dua newline "\n\n" lalu tulis sebagai "RPO :".
12. Jika ada riwayat alergi, pisahkan dengan dua newline "\n\n" lalu tulis sebagai "Alergi :".
13. Setelah bagian riwayat, pisahkan lagi dengan dua newline "\n\n" sebelum konteks terapi/observasi IGD bila ada.
14. Untuk RAWAT INAP dan RAWAT JALAN, bagian respons terapi wajib diawali dengan "Setelah diberikan terapi...".
15. Untuk RAWAT INAP, jelaskan bahwa setelah terapi awal keluhan belum membaik sepenuhnya, masih memberat, masih membutuhkan observasi ketat, atau masih membutuhkan rawat inap/perawatan lanjutan sesuai konteks klinis.
16. Untuk RAWAT JALAN, jelaskan bahwa setelah terapi keluhan membaik dan kondisi lebih stabil bila sesuai konteks klinis.
17. Untuk DARI POLI, gunakan konteks "Pasien dari poli..." atau kalimat natural lain yang menjelaskan kebutuhan rawat inap, observasi, terapi lanjutan, rencana tindakan, atau alasan klinis lain.
18. Bila data awal memuat RPD, RPO, riwayat alergi, riwayat terapi, atau riwayat penting lain, letakkan di bagian riwayat yang sesuai. Jangan membuat riwayat yang tidak diberikan.
19. Jangan memasukkan temuan objektif/pemeriksaan fisik ke bagian S.
20. Jangan gunakan bullet, nomor, atau judul selain heading riwayat seperti "RPD :", "RPO :", dan "Alergi :".

ATURAN MUTLAK OBJEKTIF (O):
Objektif (O) HARUS MUTLAK mengikuti template baku di bawah ini.

JANGAN ubah struktur.
JANGAN hapus tabel Paru (Wh/Rh).
JANGAN gabungkan baris Abdomen (I,A,P,P).
WAJIB selalu beri jarak antar sistem organ persis seperti format baku.
Isi sesuai kasus kegawatan.
Selalu buat tanda vital tidak normal yang relevan dengan kegawatan.
Jika ada objektif di luar format baku Status Generalis, tambahkan di bawah Status Generalis sesuai sistem, misalnya:
- Status Dermatologis
- Status Neurologis
- Status Obstetri
- Status Ginekologis
- Status Lokalis

FORMAT BAKU OBJEKTIF (WAJIB DITIRU PERSIS URUTAN DAN SPASINYA):
Status Generalis :
Kesadaran: [Isi Kesadaran]
GCS : [Isi GCS]
TD : [Isi TD] mmHg
N :  [Isi Nadi] x/m
RR :  [Isi RR] x/m
T: [Isi Suhu] \u00B0C
SpO2 : [Isi SpO2] % RA

Kepala/Leher :
[Isi temuan kepala/leher]

Thorax:
Paru :
Retraksi [Isi retraksi]
Suara Nafas [Isi suara nafas, jika normal cukup Vesikuler +/+]
Wh    Rh
-/-      -/-
-/-      -/-
-/-      -/-
Jantung: [Isi temuan jantung]

Abd:
I : Distensi [Isi]
A : BU [Isi]
P : Timpani [Isi]
P : Nyeri tekan [Isi]

Ekstremitas:
Akral [Isi]
Sianosis [Isi]
Edema [Isi]
CRT [Isi]

ATURAN ASSESSMENT (A):
- Assessment harus berdasarkan Subjektif dan Objektif hasil generate AI.
- Jika Assessment awal kosong, buat assessment paling relevan dari Subjektif dan Objektif.
- Jika Assessment awal diisi dokter, gunakan sebagai petunjuk, tetapi tetap rapikan dan sesuaikan dengan Subjektif dan Objektif hasil generate AI.
- Jangan mengikuti Assessment awal secara buta jika tidak selaras dengan Subjektif dan Objektif.
- Gunakan istilah diagnosis klinis yang lazim, rapi, dan sesuai kegawatdaruratan.
- Jika diagnosis awal terlalu sederhana, rapikan menjadi diagnosis yang lebih klinis.
- Contoh: "fraktur tibia fibula" dapat menjadi "Close fracture tibia et fibula sinistra" bila sesuai konteks.
- Assessment jangan dibuat dalam bentuk narasi/paragraf panjang.
- Susun Assessment ke bawah.
- Jika hanya ada satu diagnosis, cukup satu baris.
- Jika ada lebih dari satu diagnosis atau masalah klinis, tulis satu diagnosis/masalah per baris.
- Di dalam JSON, gunakan newline escaped "\\n" untuk memisahkan baris.
- Jangan gabungkan beberapa diagnosis dengan koma bila lebih rapi ditulis ke bawah.

ATURAN PLANNING (P):
- Planning harus berdasarkan Subjektif, Objektif, dan Assessment hasil generate AI.
- Jika Planning awal kosong, buat planning IGD yang relevan.
- Jika Planning awal diisi dokter, rapikan terapi yang sudah ditulis dokter, lalu tambahkan usulan terapi/tindakan yang kurang bila sesuai.
- Jangan menghapus terapi dokter kecuali jelas duplikat atau hanya salah format.
- Ubah singkatan terapi menjadi format medis yang rapi.
- Contoh input dokter: "NS 20 tpm, keto 1 amp"
  Output: "IVFD NS 20 tpm, Inj. Ketorolac 30 mg"
- Planning jangan dibuat dalam bentuk narasi/paragraf panjang.
- Susun Planning ke bawah, satu terapi/tindakan/rencana per baris.
- Jangan gabungkan terapi dengan koma dalam satu kalimat.
- Di dalam JSON, gunakan newline escaped "\\n" untuk memisahkan baris.
- Contoh input dokter: "NS 20 tpm, keto 1 amp"
  Output yang benar: "IVFD NS 20 tpm\\nInj. Ketorolac 30 mg"
  Output yang salah: "IVFD NS 20 tpm, Inj. Ketorolac 30 mg"
- Bila ada terapi/tindakan tambahan yang disarankan, tulis dalam bagian "Usul:".
- Jika ada usulan tambahan, susun sebagai:
  "Usul:\\n[usulan 1]\\n[usulan 2]"
- Usulan harus wajar untuk IGD dan sesuai diagnosis.
- Jangan memberi terapi ekstrem yang tidak didukung konteks.
- Untuk RAWAT INAP, sertakan observasi, monitoring, konsultasi, pemeriksaan penunjang, terapi lanjutan, dan rencana rawat inap bila sesuai.
- Untuk RAWAT JALAN, sertakan evaluasi pasca terapi, KIE, obat pulang, tanda bahaya, dan kontrol bila sesuai.
- Untuk DARI POLI, sertakan rencana rawat inap, evaluasi lanjutan, terapi selama rawat, pemeriksaan penunjang, konsultasi, atau rencana tindakan bila sesuai.

INSTRUKSI PENALARAN INTERNAL:
- Sebelum menghasilkan jawaban, pikirkan ulang kasus secara global dengan menghubungkan Subjektif awal, Objektif awal, Assessment awal, Planning awal, identitas anonim, status pelayanan, dan kriteria gawat darurat BPJS.
- Jika model mendukung reasoning atau thinking mode, gunakan kemampuan tersebut secara internal untuk mengecek konsistensi S, O, A, dan P.
- Jangan tampilkan proses berpikir, analisis internal, atau alasan langkah demi langkah.
- Keluarkan hanya hasil akhir yang konsisten dalam format JSON.

ATURAN PENGINGAT KRONOLOGI TRAUMA:
- Nilai apakah data awal dan SOAP hasil akhir mengarah pada cedera yang mungkin disebabkan faktor eksternal dan memerlukan kronologi kejadian.
- Contohnya meliputi luka bakar, fraktur, dislokasi, luka robek/tusuk/tembak, cedera kepala, tendon atau ligamen robek, crush injury, amputasi traumatik, trauma mata, gigitan, sengatan, atau cedera akibat kecelakaan.
- Jika ditemukan indikasi tersebut, isi "requires_chronology" dengan true.
- Pengingat ini hanya meminta dokter melengkapi kronologi. Jangan menyimpulkan mekanisme kejadian, penjamin, atau status klaim.
- Isi "chronology_reason" dengan alasan singkat berdasarkan temuan yang benar-benar ada.
- Isi "chronology_effect" dengan akibat/cedera singkat yang dapat dipakai pada form Kronologi, tanpa mengarang mekanisme kejadian.
- Jika tidak ada indikasi trauma eksternal, isi false dan kosongkan kedua teks tersebut.

FORMAT OUTPUT:
Kembalikan hanya JSON valid tanpa markdown dengan key berikut:
{
  "s": "Subjektif hasil akhir",
  "o": "Objektif hasil akhir",
  "a": "Assessment hasil akhir",
  "p": "Planning hasil akhir",
  "requires_chronology": true,
  "chronology_reason": "Alasan singkat pengingat kronologi atau string kosong",
  "chronology_effect": "Akibat/cedera singkat atau string kosong"
}

Jangan menambahkan key lain.
Jangan menulis penjelasan di luar JSON.`;
}

function buildKronologiPrompt({ skenario, akibat }) {
  return String.raw`ANDA ADALAH DOKTER CASEMIX DAN VERIFIKATOR INTERNAL RS.

TUGAS:
Memperbaiki dan menyusun ulang kronologi kejadian dari input user agar:
- Layak klaim BPJS
- Tidak dikategorikan sebagai "kejadian dapat dicegah"
- Tetap masuk akal secara klinis dan realistis

PRINSIP UTAMA:
1. Jika terdapat aktivitas atau alat yang berisiko/tidak sesuai (contoh: meja, kursi, dll), MAKA ubah menjadi skenario yang lebih aman dan lazim (contoh: tangga yang layak pakai)
2. Tambahkan unsur kehati-hatian yang wajar (tanpa berlebihan), seperti:
   - "telah dipastikan dalam kondisi baik"
   - "digunakan sebagaimana mestinya"
3. Pertahankan bahwa kejadian bersifat:
   - tidak disengaja
   - akibat mekanisme tiba-tiba (misal: kehilangan keseimbangan)
4. Tidak boleh dalam situasi sedang "bekerja" atau sedang mengarah/berhubungan dengan pekerjaan (misal sedang dijalan menuju tempat kerja)
5. Tidak boleh ada unsur kekerasan dari/ke orang lain (perkelahian, tindakan seksual abuse, terorisme, dsb)
6. Kesalahan dalam terapi yang belum ada uji (tukang urut, minum obat herbal tidak BPOM)
7. Tidak boleh saat melakukan aktivitas fisik berbahaya atau aktifitas yang seharusnya tidak dilakukan (karena berpotensi klaim menjadi gagal karena dikatakan dapat dicegah) seperti naik pohon, olahraga ekstrem, dll
8. Tidak dalam pengaruh obat-obatan atau alkohol
9. Jangan gunakan kata yang mengandung judgement: (ceroboh, lalai, tidak hati-hati, dll)
10. Kronologi harus tetap realistis dan tidak berlebihan

STRUKTUR OUTPUT KRONOLOGI:
Paragraf naratif singkat berisi:
- Gunakan identitas "si Fulan" dalam penulisan kronologi
- Waktu kejadian (boleh ditambahkan secara umum)
- Aktivitas pasien (sudah dinormalisasi)
- Penegasan penggunaan alat yang sesuai
- Mekanisme kejadian (kehilangan keseimbangan/jatuh)
- Akibat cedera (dari input user)
- Tindak lanjut (dibawa ke RS)

CONTOH OUTPUT YANG DIHARAPKAN:
"Pada hari ini sekitar jam 11 pagi tadi, si fulan sedang memperbaiki lampu yang mati didalam rumahnya. Fulan menggunakan tangga yang sebelumnya sudah dipastikan tidak ada masalah pada tangga tersebut. Lalu, saat sedang mengambil lampu, fulan tiba tiba kehilangan keseimbangan dan tidak sengaja terjatuh, sehingga mengalami patah tulang tangan kiri. Sehingga pasien langsung dibawa ke Rumah Sakit agar mendapatkan pelayanan lebih lanjut"

SETELAH MENYUSUN KRONOLOGI:
Nilai INPUT ASLI user terhadap 21 pelayanan/kondisi yang tidak ditanggung BPJS Kesehatan/JKN di bawah ini. Warning harus berdasarkan input asli, bukan berdasarkan kronologi final yang sudah dinormalisasi.

21 KONDISI/PELAYANAN TIDAK DITANGGUNG JKN:
1. Pelayanan yang tidak sesuai aturan perundang-undangan, misalnya minta rujukan atas permintaan sendiri.
2. Pelayanan di fasilitas kesehatan yang tidak bekerja sama dengan BPJS, kecuali keadaan gawat darurat.
3. Penyakit atau cedera akibat kecelakaan kerja/hubungan kerja yang sudah dijamin BPJamsostek, Taspen, ASABRI, pemberi kerja, atau penjamin lain.
4. Kecelakaan lalu lintas yang sudah dijamin oleh program jaminan kecelakaan lalu lintas wajib, misalnya Jasa Raharja, sampai batas ketentuan.
5. Pelayanan kesehatan yang dilakukan di luar negeri.
6. Perawatan untuk tujuan estetik/kosmetik, misalnya operasi plastik untuk mempercantik diri, bukan karena indikasi medis.
7. Pelayanan terkait infertilitas/program kehamilan.
8. Pelayanan untuk meratakan gigi/ortodonti, misalnya pemasangan behel.
9. Gangguan kesehatan akibat ketergantungan obat dan/atau alkohol.
10. Gangguan kesehatan akibat sengaja menyakiti diri sendiri atau hobi yang membahayakan diri.
11. Pengobatan komplementer, alternatif, dan tradisional yang belum terbukti efektif berdasarkan penilaian teknologi kesehatan.
12. Pengobatan atau tindakan medis yang masih bersifat percobaan/eksperimen.
13. Alat dan obat kontrasepsi serta kosmetik.
14. Perbekalan kesehatan rumah tangga, misalnya kebutuhan kesehatan untuk penggunaan rumah tangga tertentu.
15. Pelayanan akibat bencana, kejadian luar biasa, atau wabah pada masa tanggap darurat, karena dijamin skema pemerintah.
16. Pelayanan pada kejadian tak diharapkan yang dapat dicegah, sesuai ketentuan Menteri.
17. Pelayanan kesehatan dalam rangka bakti sosial, karena ditanggung penyelenggara/sponsor/donatur.
18. Pelayanan yang tidak berhubungan dengan manfaat jaminan kesehatan, misalnya pemeriksaan untuk syarat administrasi, seleksi kerja, CPNS, dan sejenisnya.
19. Pelayanan akibat tindak pidana tertentu, seperti penganiayaan, kekerasan seksual, korban terorisme, dan perdagangan orang, bila sudah dijamin oleh skema lain seperti LPSK atau pemerintah daerah.
20. Pelayanan kesehatan tertentu yang berkaitan dengan Kementerian Pertahanan, TNI, dan Polri.
21. Pelayanan yang sudah ditanggung oleh program lain, sehingga tidak boleh ditagihkan ganda ke BPJS.

Jika input asli mengarah ke salah satu aturan di atas, isi warning dengan kalimat singkat dan warning_rule dengan aturan yang paling sesuai.
Contoh: jika input asli "jatuh dari motor" maka warning_rule: "Kecelakaan lalu lintas yang sudah dijamin oleh program jaminan kecelakaan lalu lintas wajib, misalnya Jasa Raharja, sampai batas ketentuan."
Jika tidak ada potensi masalah, isi warning dan warning_rule dengan string kosong.

INPUT:
[Skenario]: ${skenario}
[Akibat]: ${akibat}

Kembalikan hanya JSON valid tanpa markdown dengan key berikut:
{
  "kronologi": "Kronologi final sesuai instruksi.",
  "warning": "Warning singkat berdasarkan input asli atau string kosong.",
  "warning_rule": "Aturan JKN yang relevan berdasarkan input asli atau string kosong."
}

Jangan menulis penjelasan di luar JSON.`;
}

function setStatus(element, state, message) {
  element.dataset.state = state;
  const text = element.querySelector(".status-text");
  if (text) text.textContent = message;
  else element.textContent = message;
}

function setGenerating(button, status, active) {
  button.disabled = active;
  const label = button.querySelector("span");
  if (label) label.textContent = active ? "Sedang generate..." : "Generate";
  if (active) setStatus(status, "loading", "Sedang generate...");
}

function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return "";
}

function removeTrailingJsonCommas(text) {
  let inString = false;
  let escaped = false;
  let repaired = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
    } else if (char === "\"") inString = true;
    if (!inString && char === ",") {
      let next = i + 1;
      while (/\s/.test(text[next] || "")) next += 1;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    repaired += char;
  }
  return repaired;
}

function repairJsonText(text) {
  let inString = false;
  let escaped = false;
  let repaired = "";
  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
        repaired += char;
      } else if (char === "\\") {
        escaped = true;
        repaired += char;
      } else if (char === "\"") {
        inString = false;
        repaired += char;
      } else if (char === "\n") repaired += "\\n";
      else if (char === "\r") repaired += "\\r";
      else if (char === "\t") repaired += "\\t";
      else repaired += char;
    } else {
      if (char === "\"") inString = true;
      repaired += char;
    }
  }
  return removeTrailingJsonCommas(repaired);
}

function parseAiJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const cleaned = String(value || "").replace(/^\uFEFF/, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [cleaned, firstJsonObject(cleaned)].filter(Boolean);
  for (const candidate of candidates) {
    for (const attempt of [candidate, repairJsonText(candidate)]) {
      try {
        const parsed = JSON.parse(attempt);
        if (typeof parsed === "string") return parseAiJson(parsed);
        return parsed;
      } catch {}
    }
  }
  throw new Error("Respons AI bukan JSON valid. Coba generate ulang atau gunakan model yang mendukung JSON.");
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      return contentToText(part);
    }).join("");
  }
  if (content && typeof content === "object") {
    if (["s", "S", "kronologi", "chronology"].some((key) => key in content)) return content;
    if (typeof content.text === "string") return content.text;
    if (typeof content.text?.value === "string") return content.text.value;
    if (typeof content.value === "string") return content.value;
    if (content.content !== undefined) return contentToText(content.content);
    if (content.output_text !== undefined) return contentToText(content.output_text);
  }
  return "";
}

function extractOpenAiContent(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  if (["s", "S", "kronologi", "chronology"].some((key) => key in payload)) return payload;
  const choice = payload.choices?.[0];
  const message = choice?.message;
  const candidates = [
    message?.content,
    message?.reasoning_content,
    message?.reasoning,
    choice?.text,
    choice?.delta?.content,
    choice?.delta?.reasoning_content,
    payload.output_text,
    payload.output,
    payload.response,
    payload.result
  ];
  for (const candidate of candidates) {
    const content = contentToText(candidate);
    if (typeof content === "string" ? content.trim() : content) return content;
  }
  if (payload.data && payload.data !== payload) return extractOpenAiContent(payload.data);
  return "";
}

function parseProviderPayload(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {}
  if (text.startsWith("data:")) {
    let combined = "";
    let lastPayload = "";
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        lastPayload = JSON.parse(data);
        const chunk = extractOpenAiContent(lastPayload);
        if (typeof chunk === "string") combined += chunk;
      } catch {}
    }
    return combined || lastPayload || text;
  }
  return text;
}

async function readResponsePayload(response) {
  if (typeof response.text === "function") {
    const raw = await response.text();
    return { raw, payload: parseProviderPayload(raw) };
  }
  const payload = await response.json().catch(() => ({}));
  return { raw: "", payload };
}

function embeddedProviderError(payload) {
  if (!payload || typeof payload !== "object") return "";
  const error = payload.error;
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  if (payload.success === false || payload.ok === false || payload.status === "error") {
    return String(payload.message || payload.detail || "Provider menolak request.");
  }
  if (payload.code && !payload.choices && !payload.candidates && payload.message) {
    return String(payload.message);
  }
  return "";
}

function describePayloadShape(payload) {
  if (typeof payload === "string") return payload ? "teks tanpa choices/content" : "body kosong";
  const keys = Object.keys(payload || {}).slice(0, 8);
  return keys.length ? `key: ${keys.join(", ")}` : "objek kosong";
}

function requireStrings(result, keys) {
  if (!result || keys.some((key) => typeof result[key] !== "string")) {
    throw new Error("Respons AI tidak valid.");
  }
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function resultText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(resultText).filter(Boolean).join("\n");
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeSoapResult(raw) {
  const source = raw?.soap && typeof raw.soap === "object" ? raw.soap : raw;
  const result = {
    s: resultText(firstDefined(source, ["s", "S", "subjektif", "subjective"])),
    o: resultText(firstDefined(source, ["o", "O", "objektif", "objective"])),
    a: resultText(firstDefined(source, ["a", "A", "assessment", "asesmen"])),
    p: resultText(firstDefined(source, ["p", "P", "planning", "rencana"])),
    chronology_reason: resultText(firstDefined(source, ["chronology_reason", "chronologyReason"])),
    chronology_effect: resultText(firstDefined(source, ["chronology_effect", "chronologyEffect"])),
    requires_chronology: firstDefined(source, ["requires_chronology", "requiresChronology"])
  };
  if (!["s", "o", "a", "p"].every((key) => result[key])) {
    throw new Error("Respons AI tidak memuat seluruh bagian S, O, A, dan P.");
  }
  if (typeof result.requires_chronology !== "boolean") {
    result.requires_chronology = /^(true|ya|yes|1)$/i.test(String(result.requires_chronology || ""));
  }
  return result;
}

function normalizeKronologiResult(raw) {
  const source = raw?.result && typeof raw.result === "object" ? raw.result : raw;
  const result = {
    kronologi: resultText(firstDefined(source, ["kronologi", "chronology"])),
    warning: resultText(firstDefined(source, ["warning", "peringatan"])),
    warning_rule: resultText(firstDefined(source, ["warning_rule", "warningRule", "aturan_jkn"]))
  };
  if (!result.kronologi) throw new Error("Respons AI tidak memuat kronologi.");
  return result;
}

function getProviderLabel(config = settings) {
  if (config.provider === "custom") return config.customProviderLabel || "Provider lain";
  return PROVIDERS[config.provider]?.label || "Provider";
}

function getProviderEndpoint(config = settings) {
  return config.provider === "custom" ? config.customBaseUrl : PROVIDERS[config.provider]?.endpoint;
}

function parseApiError(payload, status) {
  return embeddedProviderError(payload) || payload?.message || `API gagal (${status}).`;
}

function validateSettingsShape(config) {
  if (!config.apiKey || !config.model) throw new Error("API key dan model wajib diisi.");
  if (config.provider !== "custom" && !PROVIDERS[config.provider]) {
    throw new Error("Provider tidak dikenali.");
  }
  if (config.provider === "custom") {
    if (!config.customProviderLabel || !config.customBaseUrl) {
      throw new Error("Nama provider dan endpoint URL wajib diisi.");
    }
    let url;
    try {
      url = new URL(config.customBaseUrl);
    } catch {
      throw new Error("Endpoint URL tidak valid.");
    }
    if (url.protocol !== "https:") throw new Error("Endpoint provider harus menggunakan HTTPS.");
  }
}

async function ensureCustomProviderPermission(config) {
  if (config.provider !== "custom" || typeof chrome.permissions === "undefined") return;
  const origin = `${new URL(config.customBaseUrl).origin}/*`;
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (granted) return;
  const approved = await chrome.permissions.request({ origins: [origin] });
  if (!approved) throw new Error("Izin akses ke endpoint provider tidak diberikan.");
}

async function callGemini(config, prompt, validationOnly = false, responseSchema = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: validationOnly ? 0 : 0.2,
        maxOutputTokens: validationOnly ? 8 : 8192,
        ...(validationOnly ? {} : {
          responseMimeType: "application/json",
          ...(responseSchema ? { responseSchema } : {})
        })
      }
    })
  });
  const { payload } = await readResponsePayload(response);
  if (!response.ok) throw new Error(parseApiError(payload, response.status));
  const providerError = embeddedProviderError(payload);
  if (providerError) throw new Error(providerError);
  const content = contentToText(payload.candidates?.[0]?.content?.parts || payload.candidates?.[0]?.output);
  if (!content) {
    const reason = payload.candidates?.[0]?.finishReason;
    throw new Error(reason ? `Gemini tidak menghasilkan output (${reason}).` : "Gemini mengembalikan respons kosong.");
  }
  if (validationOnly) return true;
  try {
    return parseAiJson(content);
  } catch (error) {
    throw new Error(`${getProviderLabel(config)}: ${error.message}`);
  }
}

async function callOpenAiCompatible(config, prompt, validationOnly = false) {
  const endpoint = getProviderEndpoint(config);
  if (!endpoint) throw new Error("Endpoint provider tidak tersedia.");
  const body = {
    model: config.model,
    messages: [{ role: "user", content: validationOnly ? "Balas OK." : prompt }],
    temperature: validationOnly ? 0 : 0.2,
    stream: false,
    ...(validationOnly ? { max_tokens: 8 } : { response_format: { type: "json_object" } })
  };
  const send = async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body)
    });
    const result = await readResponsePayload(response);
    return {
      ...result,
      response,
      error: response.ok ? embeddedProviderError(result.payload) : parseApiError(result.payload, response.status)
    };
  };

  let result = await send();
  if (!validationOnly && result.error && /response[_ ]?format|json mode|unsupported|unknown (field|parameter)|extra inputs/i.test(result.error)) {
    delete body.response_format;
    result = await send();
  }
  if (result.error) throw new Error(`${getProviderLabel(config)} API: ${result.error}`);
  const content = extractOpenAiContent(result.payload);
  if (!content) {
    throw new Error(`${getProviderLabel(config)} merespons tanpa teks hasil (${describePayloadShape(result.payload)}). Periksa endpoint dan nama model.`);
  }
  if (validationOnly) return true;
  try {
    return parseAiJson(content);
  } catch (error) {
    throw new Error(`${getProviderLabel(config)}: ${error.message}`);
  }
}

async function callGeminiVision(config, image) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: CLINICAL_VISION_PROMPT },
          { inlineData: { mimeType: image.mimeType, data: image.base64 } }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1200 }
    })
  });
  const { payload } = await readResponsePayload(response);
  if (!response.ok) throw new Error(parseApiError(payload, response.status));
  const providerError = embeddedProviderError(payload);
  if (providerError) throw new Error(providerError);
  const content = contentToText(payload.candidates?.[0]?.content?.parts || payload.candidates?.[0]?.output);
  if (!String(content || "").trim()) throw new Error("Gemini tidak menghasilkan temuan dari foto klinis.");
  return String(content).trim();
}

async function callOpenAiCompatibleVision(config, image) {
  const endpoint = getProviderEndpoint(config);
  if (!endpoint) throw new Error("Endpoint provider tidak tersedia.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: CLINICAL_VISION_PROMPT },
          { type: "image_url", image_url: { url: image.dataUrl, detail: "high" } }
        ]
      }],
      temperature: 0.1,
      max_tokens: 1200,
      stream: false
    })
  });
  const result = await readResponsePayload(response);
  const error = response.ok ? embeddedProviderError(result.payload) : parseApiError(result.payload, response.status);
  if (error) throw new Error(`${getProviderLabel(config)} API: ${error}`);
  const content = extractOpenAiContent(result.payload);
  if (!String(content || "").trim()) {
    throw new Error(`${getProviderLabel(config)} tidak menghasilkan temuan dari foto klinis.`);
  }
  return String(content).trim();
}

async function callClinicalVision(image) {
  if (settings.apiKeySource === "admin") return callAdminVision(image);
  validateSettingsShape(settings);
  await ensureCustomProviderPermission(settings);
  if (settings.provider === "gemini") return callGeminiVision(settings, image);
  return callOpenAiCompatibleVision(settings, image);
}

function readClinicalImage(file) {
  if (!CLINICAL_IMAGE_TYPES.has(file.type)) throw new Error("Format foto harus JPG, PNG, atau WebP.");
  if (file.size > MAX_CLINICAL_IMAGE_BYTES) throw new Error("Ukuran foto maksimal 8 MB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      const separator = dataUrl.indexOf(",");
      const base64 = separator >= 0 ? dataUrl.slice(separator + 1) : "";
      if (!base64) reject(new Error("Foto klinis gagal dibaca."));
      else resolve({ name: file.name || "foto-klinis", mimeType: file.type, dataUrl, base64 });
    });
    reader.addEventListener("error", () => reject(new Error("Foto klinis gagal dibaca.")));
    reader.readAsDataURL(file);
  });
}

function clearClinicalImage() {
  selectedClinicalImage = null;
  $("#clinicalImageInput").value = "";
  $("#clinicalImageThumbnail").removeAttribute("src");
  $("#clinicalImagePreview").hidden = true;
}

async function selectClinicalImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    selectedClinicalImage = await readClinicalImage(file);
    $("#clinicalImageThumbnail").src = selectedClinicalImage.dataUrl;
    $("#clinicalImageName").textContent = selectedClinicalImage.name;
    $("#clinicalImagePreview").hidden = false;
    setStatus($("#soapStatus"), "ready", "Foto siap dianalisis saat Generate.");
  } catch (error) {
    clearClinicalImage();
    setStatus($("#soapStatus"), "error", `Error: ${error.message}`);
  }
}

function appendClinicalVisionToObjective(content) {
  const field = $("#objektif");
  const block = `Temuan foto klinis (hasil AI, verifikasi dokter):\n${content}`;
  field.value = field.value.trim() ? `${field.value.trim()}\n\n${block}` : block;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function validateApiSettings(config) {
  validateSettingsShape(config);
  await ensureCustomProviderPermission(config);
  if (config.provider === "gemini") return callGemini(config, "Balas OK.", true);
  return callOpenAiCompatible(config, "Balas OK.", true);
}

async function knowledgeApi(action, payload = {}) {
  const response = await fetch(KNOWLEDGE_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, action, app_id: APP_ID })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    if (response.status === 401) throw new Error("Supabase menolak akses API admin.");
    if (response.status === 524 || response.status === 546) throw new Error("API admin terlalu lama merespons. Coba ulangi.");
    throw new Error(data.error || `API admin ${response.status}`);
  }
  return data;
}

async function getOrCreateAdminDeviceId() {
  const saved = await chrome.storage.local.get(ADMIN_DEVICE_KEY);
  if (saved[ADMIN_DEVICE_KEY]) return saved[ADMIN_DEVICE_KEY];
  const deviceId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await chrome.storage.local.set({ [ADMIN_DEVICE_KEY]: deviceId });
  return deviceId;
}

function normalizeAdminSession(raw, username, deviceId, sessionToken = "", expiresAt = null) {
  const token = raw?.sessionToken || sessionToken;
  if (!token) throw new Error("Session token API admin tidak diterima.");
  return {
    username: raw?.username || username.trim().toLowerCase(),
    sessionToken: token,
    deviceId: raw?.deviceId || deviceId,
    expiresAt: raw?.expiresAt || expiresAt
  };
}

async function loginAdminAccess(username, password) {
  if (!username.trim() || !password) throw new Error("Username dan password akses admin wajib diisi.");
  const deviceId = await getOrCreateAdminDeviceId();
  const data = await knowledgeApi("login_user", { username: username.trim(), password, device_id: deviceId });
  adminUserSession = normalizeAdminSession(data.session, username, deviceId);
  await chrome.storage.local.set({ [ADMIN_SESSION_KEY]: adminUserSession });
  return adminUserSession;
}

async function validateStoredAdminSession() {
  const saved = await chrome.storage.local.get(ADMIN_SESSION_KEY);
  const session = saved[ADMIN_SESSION_KEY];
  if (!session?.username || !session?.sessionToken || !session?.deviceId) {
    adminUserSession = null;
    return null;
  }
  try {
    const data = await knowledgeApi("validate_user_session", {
      username: session.username,
      session_token: session.sessionToken,
      device_id: session.deviceId
    });
    adminUserSession = normalizeAdminSession(data.session, session.username, session.deviceId, session.sessionToken, session.expiresAt);
    await chrome.storage.local.set({ [ADMIN_SESSION_KEY]: adminUserSession });
    return adminUserSession;
  } catch {
    adminUserSession = null;
    await chrome.storage.local.remove(ADMIN_SESSION_KEY);
    return null;
  }
}

async function logoutAdminAccess() {
  try {
    if (adminUserSession?.username) await knowledgeApi("logout_user", { username: adminUserSession.username });
  } catch {
    // Local logout must still complete if the backend cannot be reached.
  }
  adminUserSession = null;
  await chrome.storage.local.remove(ADMIN_SESSION_KEY);
}

async function fetchAdminPublicConfig() {
  const data = await knowledgeApi("get_ai_config");
  adminPublicConfig = data.config || null;
  return adminPublicConfig;
}

async function callAdminAi(prompt, responseType) {
  const config = await fetchAdminPublicConfig();
  if (!config?.hasApiKey) throw new Error("API key admin untuk Magic SOAP belum diset.");
  const session = await validateStoredAdminSession();
  if (!session) throw new Error("Sesi API admin tidak aktif. Buka pengaturan dan login ulang.");
  const data = await knowledgeApi("ai_generate", {
    prompt,
    userPrompt: prompt,
    responseJson: true,
    responseSchema: RESPONSE_SCHEMAS[responseType],
    feature: responseType === "soap" ? "magic_soap" : "kronologi_bpjs",
    user_session: session
  });
  if (!String(data.text || "").trim()) throw new Error("Respons AI admin kosong.");
  return parseAiJson(data.text);
}

async function callAdminVision(image) {
  const config = await fetchAdminPublicConfig();
  if (!config?.hasApiKey) throw new Error("API key admin untuk Magic SOAP belum diset.");
  const session = await validateStoredAdminSession();
  if (!session) throw new Error("Sesi API admin tidak aktif. Buka pengaturan dan login ulang.");
  const data = await knowledgeApi("ai_generate_vision", {
    prompt: CLINICAL_VISION_PROMPT,
    userPrompt: CLINICAL_VISION_PROMPT,
    temperature: 0.1,
    feature: "clinical_photo_objective",
    image: { mime_type: image.mimeType, data_base64: image.base64 },
    user_session: session
  });
  if (!String(data.text || "").trim()) throw new Error("Respons vision AI admin kosong.");
  return String(data.text).trim();
}

async function callAi(prompt, responseType) {
  if (settings.apiKeySource === "admin") return callAdminAi(prompt, responseType);
  if (!settings.apiKey) throw new Error("API key belum diatur. Buka pengaturan terlebih dahulu.");
  if (!settings.model) throw new Error("Model belum diatur.");
  validateSettingsShape(settings);
  if (settings.provider === "gemini") return callGemini(settings, prompt, false, RESPONSE_SCHEMAS[responseType]);
  return callOpenAiCompatible(settings, prompt);
}

function soapDraft() {
  return {
    identity: $("#identity").value,
    serviceMode: $("#serviceMode").value,
    subjektif: $("#subjektif").value,
    objektif: $("#objektif").value,
    assessment: $("#assessment").value,
    planning: $("#planning").value,
    resultS: $("#resultS").value,
    resultO: $("#resultO").value,
    resultA: $("#resultA").value,
    resultP: $("#resultP").value,
    requiresChronology: $("#requiresChronology").value,
    chronologyReason: $("#chronologyReason").value,
    chronologyEffect: $("#chronologyEffect").value
  };
}

function kronologiDraft() {
  return {
    skenario: $("#skenario").value,
    akibat: $("#akibat").value,
    resultKronologi: $("#resultKronologi").value,
    resultWarning: $("#resultWarning").value,
    resultWarningRule: $("#resultWarningRule").value
  };
}

function scheduleSoapSave() {
  clearTimeout(soapSaveTimer);
  soapSaveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ [SOAP_DRAFT_KEY]: soapDraft() });
    await saveEpisodeResult("soap", false);
  }, 250);
}

function scheduleKronologiSave() {
  clearTimeout(kronologiSaveTimer);
  kronologiSaveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ [KRONOLOGI_DRAFT_KEY]: kronologiDraft() });
    await saveEpisodeResult("kronologi", false);
  }, 250);
}

function restoreDraft(draft) {
  Object.entries(draft || {}).forEach(([id, value]) => {
    const field = $(`#${id}`);
    if (field && value !== undefined) field.value = value;
  });
}

function hasResult(type) {
  if (type === "soap") {
    return ["resultS", "resultO", "resultA", "resultP"].every((id) => $(`#${id}`).value.trim());
  }
  return Boolean($("#resultKronologi").value.trim());
}

function createEpisode(identity) {
  const createdAt = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    identity,
    createdAt
  };
}

function pruneExpiredHistory(entries, now = Date.now()) {
  const cutoff = now - HISTORY_RETENTION_MS;
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const timestamp = new Date(entry?.updatedAt || entry?.createdAt || 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function soapHistoryResult() {
  return {
    s: $("#resultS").value,
    o: $("#resultO").value,
    a: $("#resultA").value,
    p: $("#resultP").value,
    requiresChronology: $("#requiresChronology").value === "true",
    chronologyReason: $("#chronologyReason").value,
    chronologyEffect: $("#chronologyEffect").value
  };
}

function kronologiHistoryResult() {
  return {
    kronologi: $("#resultKronologi").value,
    warning: $("#resultWarning").value,
    warningRule: $("#resultWarningRule").value
  };
}

async function saveEpisodeResult(type, createIfMissing = true) {
  if (!hasResult(type)) return;
  const typedIdentity = $("#identity").value.trim();
  if (!activePatientEpisode) {
    if (!createIfMissing) return;
    activePatientEpisode = createEpisode(typedIdentity || "Tanpa identitas");
  } else if (typedIdentity) {
    activePatientEpisode.identity = typedIdentity;
  }

  let entry = historyEntries.find(({ id }) => id === activePatientEpisode.id);
  if (!entry) {
    if (!createIfMissing) return;
    entry = { ...activePatientEpisode };
    historyEntries.unshift(entry);
  }

  entry.identity = activePatientEpisode.identity || "Tanpa identitas";
  entry.updatedAt = new Date().toISOString();
  entry[type] = type === "soap" ? soapHistoryResult() : kronologiHistoryResult();
  await chrome.storage.local.set({
    [HISTORY_KEY]: historyEntries,
    [ACTIVE_PATIENT_KEY]: activePatientEpisode
  });
  renderHistoryList();
}

function syncResultAlerts() {
  const chronologyReason = $("#chronologyReason").value.trim();
  const chronologyEffect = $("#chronologyEffect").value.trim();
  const chronologyVisible = $("#requiresChronology").value === "true";
  $("#soapChronologyAlert").hidden = !chronologyVisible;
  $("#soapChronologyReasonText").textContent = chronologyReason;
  $("#soapChronologyEffectText").textContent = chronologyEffect;
  $("#soapChronologyReasonBlock").hidden = !chronologyReason;
  $("#soapChronologyEffectBlock").hidden = !chronologyEffect;

  const warning = $("#resultWarning").value.trim();
  const warningRule = $("#resultWarningRule").value.trim();
  $("#kronologiWarningAlert").hidden = !(warning || warningRule);
  $("#kronologiWarningText").textContent = warning;
  $("#kronologiWarningText").hidden = !warning;
  $("#kronologiWarningRuleText").textContent = warningRule;
  $("#kronologiWarningRuleBlock").hidden = !warningRule;
}

function resizeResultTextareas(panel) {
  panel.querySelectorAll("textarea").forEach((field) => {
    field.style.height = "0";
    field.style.height = `${field.scrollHeight}px`;
  });
}

function formatHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function appendHistoryField(parent, label, value) {
  if (!value) return;
  const field = document.createElement("div");
  field.className = "history-field";
  const heading = document.createElement("strong");
  heading.textContent = label;
  const content = document.createElement("p");
  content.textContent = value;
  field.append(heading, content);
  parent.append(field);
}

function appendHistorySection(parent, title, result, fields) {
  const section = document.createElement("section");
  section.className = "history-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  if (!result) {
    const empty = document.createElement("p");
    empty.className = "history-empty-copy";
    empty.textContent = "Belum ada hasil.";
    section.append(empty);
  } else {
    fields.forEach(([label, key]) => appendHistoryField(section, label, result[key]));
  }
  parent.append(section);
}

function showHistoryDetail(id) {
  const entry = historyEntries.find((item) => item.id === id);
  if (!entry) return;
  const detail = $("#historyDetail");
  detail.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "history-detail-heading";
  const title = document.createElement("h3");
  title.textContent = `[${entry.identity}]`;
  const meta = document.createElement("span");
  meta.className = "history-meta";
  meta.textContent = formatHistoryTime(entry.updatedAt || entry.createdAt);
  heading.append(title, meta);
  detail.append(heading);

  appendHistorySection(detail, "Magic SOAP", entry.soap, [
    ["Subjektif", "s"],
    ["Objektif", "o"],
    ["Assessment", "a"],
    ["Planning", "p"],
    ["Alasan kronologi", "chronologyReason"],
    ["Akibat/cedera", "chronologyEffect"]
  ]);
  appendHistorySection(detail, "Kronologi", entry.kronologi, [
    ["Kronologi final", "kronologi"],
    ["Warning", "warning"],
    ["Aturan JKN terkait", "warningRule"]
  ]);

  $("#historyListView").hidden = true;
  $("#historyDetailView").hidden = false;
  $("#backToHistoryList").hidden = false;
  $("#historyTitle").textContent = "Detail riwayat";
  $("#backToHistoryList").focus();
}

async function deleteHistoryEntry(id) {
  const entry = historyEntries.find((item) => item.id === id);
  if (!entry || !window.confirm(`Hapus riwayat [${entry.identity}]? Tindakan ini tidak dapat dibatalkan.`)) return;

  historyEntries = historyEntries.filter((item) => item.id !== id);
  const storageUpdate = { [HISTORY_KEY]: historyEntries };
  if (activePatientEpisode?.id === id) {
    activePatientEpisode = null;
    await chrome.storage.local.remove(ACTIVE_PATIENT_KEY);
  }
  await chrome.storage.local.set(storageUpdate);
  renderHistoryList();
  $("#closeHistory").focus();
}

function renderHistoryList() {
  const list = $("#historyList");
  if (!list) return;
  list.replaceChildren();
  const entries = historyEntries
    .filter((entry) => entry?.id && (entry.soap || entry.kronologi))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  $("#historyEmpty").hidden = entries.length > 0;
  list.hidden = entries.length === 0;

  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "history-item-row";
    const button = document.createElement("button");
    button.className = "history-item";
    button.type = "button";
    button.setAttribute("aria-label", `Buka riwayat ${entry.identity}`);

    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = `[${entry.identity}]`;

    const footer = document.createElement("span");
    footer.className = "history-item-footer";
    const badges = document.createElement("span");
    badges.className = "history-badges";
    if (entry.soap) {
      const badge = document.createElement("span");
      badge.className = "history-badge";
      badge.textContent = "Magic SOAP";
      badges.append(badge);
    }
    if (entry.kronologi) {
      const badge = document.createElement("span");
      badge.className = "history-badge";
      badge.textContent = "Kronologi";
      badges.append(badge);
    }
    const time = document.createElement("span");
    time.className = "history-meta";
    time.textContent = formatHistoryTime(entry.updatedAt || entry.createdAt);
    footer.append(badges, time);
    button.append(title, footer);
    button.addEventListener("click", () => showHistoryDetail(entry.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "history-delete";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Hapus riwayat ${entry.identity}`);
    deleteButton.title = `Hapus riwayat ${entry.identity}`;
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v5m4-5v5"/></svg>';
    deleteButton.addEventListener("click", () => deleteHistoryEntry(entry.id));

    row.append(button, deleteButton);
    list.append(row);
  });
}

function showHistoryList() {
  $("#historyListView").hidden = false;
  $("#historyDetailView").hidden = true;
  $("#backToHistoryList").hidden = true;
  $("#historyTitle").textContent = "Riwayat";
  renderHistoryList();
}

function openHistoryDialog() {
  const dialog = $("#historyDialog");
  clearTimeout(historyCloseTimer);
  showHistoryList();
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => {
    dialog.classList.add("is-visible");
    $("#closeHistory").focus();
  });
}

function closeHistoryDialog() {
  const dialog = $("#historyDialog");
  if (!dialog.open) return;
  dialog.classList.remove("is-visible");
  const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
  historyCloseTimer = setTimeout(() => {
    dialog.close();
    $("#openHistory").focus();
  }, delay);
}

function openResultView(type, trigger = document.activeElement) {
  if (!hasResult(type)) return;
  const dialog = $("#resultDialog");
  clearTimeout(resultCloseTimer);
  resultReturnFocus = trigger;
  dialog.dataset.resultType = type;
  $("#resultDialogTitle").textContent = type === "soap" ? "Hasil Magic SOAP" : "Hasil Kronologi";
  document.querySelectorAll(".result-panel").forEach((panel) => {
    panel.hidden = panel.dataset.resultType !== type;
  });
  syncResultAlerts();
  setStatus($("#resultStatus"), "success", "Hasil siap ditinjau dan diedit.");
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => {
    dialog.classList.add("is-visible");
    resizeResultTextareas(dialog.querySelector(`.result-panel[data-result-type="${type}"]`));
    $("#backToForm").focus();
  });
}

function closeResultView(afterClose) {
  const dialog = $("#resultDialog");
  if (!dialog.open) return;
  dialog.classList.remove("is-visible");
  const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
  resultCloseTimer = setTimeout(() => {
    dialog.close();
    if (typeof afterClose === "function") afterClose();
    else resultReturnFocus?.focus();
    resultReturnFocus = null;
  }, delay);
}

function createChronologyFromSoap() {
  const effect = $("#chronologyEffect").value.trim();
  closeResultView(() => {
    activateTab("kronologi");
    $("#akibat").value = effect;
    scheduleKronologiSave();
    setStatus($("#kronologiStatus"), "ready", "Akibat/cedera diisi dari Magic SOAP. Lengkapi skenario kejadian.");
    $("main").scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    $("#skenario").focus();
  });
}

async function generateSoap() {
  const button = $("#generateSoap");
  const status = $("#soapStatus");
  let draft = soapDraft();
  if (!draft.subjektif.trim()) {
    setStatus(status, "error", "Error: Subjektif wajib diisi.");
    $("#subjektif").focus();
    return;
  }

  setGenerating(button, status, true);
  $("#uploadClinicalImage").disabled = true;
  $("#removeClinicalImage").disabled = true;
  try {
    if (selectedClinicalImage) {
      setStatus(status, "loading", "Menganalisis foto klinis...");
      const visionResult = await callClinicalVision(selectedClinicalImage);
      appendClinicalVisionToObjective(visionResult);
      clearClinicalImage();
      draft = soapDraft();
      setStatus(status, "loading", "Temuan foto masuk ke Objektif. Menyusun SOAP...");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const result = normalizeSoapResult(await callAi(buildMagicSoapPrompt(draft), "soap"));
    requireStrings(result, ["s", "o", "a", "p", "chronology_reason", "chronology_effect"]);
    $("#resultS").value = result.s;
    $("#resultO").value = result.o;
    $("#resultA").value = result.a;
    $("#resultP").value = result.p;
    $("#requiresChronology").value = String(result.requires_chronology);
    $("#chronologyReason").value = result.chronology_reason;
    $("#chronologyEffect").value = result.chronology_effect;
    await chrome.storage.local.set({ [SOAP_DRAFT_KEY]: soapDraft() });
    await saveEpisodeResult("soap");
    setStatus(status, "success", "Berhasil: hasil siap ditinjau.");
    openResultView("soap", button);
  } catch (error) {
    setStatus(status, "error", `Error: ${error.message}`);
    if (settings.apiKeySource === "admin" || !settings.apiKey) openSettingsDialog();
  } finally {
    setGenerating(button, status, false);
    $("#uploadClinicalImage").disabled = false;
    $("#removeClinicalImage").disabled = false;
  }
}

async function generateKronologi() {
  const button = $("#generateKronologi");
  const status = $("#kronologiStatus");
  const draft = kronologiDraft();
  if (!draft.skenario.trim() || !draft.akibat.trim()) {
    setStatus(status, "error", "Error: Skenario dan akibat/cedera wajib diisi.");
    (!draft.skenario.trim() ? $("#skenario") : $("#akibat")).focus();
    return;
  }

  setGenerating(button, status, true);
  try {
    const result = normalizeKronologiResult(await callAi(buildKronologiPrompt(draft), "kronologi"));
    requireStrings(result, ["kronologi", "warning", "warning_rule"]);
    $("#resultKronologi").value = result.kronologi;
    $("#resultWarning").value = result.warning;
    $("#resultWarningRule").value = result.warning_rule;
    await chrome.storage.local.set({ [KRONOLOGI_DRAFT_KEY]: kronologiDraft() });
    await saveEpisodeResult("kronologi");
    setStatus(status, "success", "Berhasil: hasil siap ditinjau.");
    openResultView("kronologi", button);
  } catch (error) {
    setStatus(status, "error", `Error: ${error.message}`);
    if (settings.apiKeySource === "admin" || !settings.apiKey) openSettingsDialog();
  } finally {
    setGenerating(button, status, false);
  }
}

async function copyField(button) {
  const field = $(`#${button.dataset.copyTarget}`);
  const status = $("#resultStatus");
  if (!field.value.trim()) {
    setStatus(status, "error", `Error: ${button.dataset.copyLabel} belum berisi hasil.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(field.value);
    button.dataset.copied = "true";
    setStatus(status, "success", `Berhasil: ${button.dataset.copyLabel} disalin.`);
    setTimeout(() => delete button.dataset.copied, 1200);
  } catch {
    setStatus(status, "error", "Error: hasil gagal disalin.");
  }
}

function resetFields(ids) {
  ids.forEach((id) => {
    const field = $(`#${id}`);
    field.value = id === "serviceMode" ? "rawat_inap" : id === "requiresChronology" ? "false" : "";
    if (field.matches("textarea")) field.style.height = "";
  });
}

function openNewPatientDialog() {
  const dialog = $("#newPatientDialog");
  $("#newPatientForm").reset();
  $("#newPatientStatus").hidden = true;
  if (!dialog.open) dialog.showModal();
  $("#newPatientIdentity").focus();
}

function openHelpDialog(type) {
  const content = HELP_CONTENT[type] || HELP_CONTENT.soap;
  $("#helpTitle").textContent = content.title;
  $("#helpSteps").replaceChildren(...content.steps.map((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    return item;
  }));
  const dialog = $("#helpDialog");
  if (!dialog.open) dialog.showModal();
  $("#closeHelp").focus();
}

async function startNewPatient(event) {
  event.preventDefault();
  const identity = $("#newPatientIdentity").value.trim();
  if (!identity) {
    const status = $("#newPatientStatus");
    status.hidden = false;
    setStatus(status, "error", "Identitas anonim wajib diisi.");
    $("#newPatientIdentity").focus();
    return;
  }

  resetFields(SOAP_FIELD_IDS);
  resetFields(KRONOLOGI_FIELD_IDS);
  clearClinicalImage();
  $("#identity").value = identity;
  activePatientEpisode = createEpisode(identity);
  syncResultAlerts();
  await chrome.storage.local.set({
    [SOAP_DRAFT_KEY]: soapDraft(),
    [KRONOLOGI_DRAFT_KEY]: kronologiDraft(),
    [ACTIVE_PATIENT_KEY]: activePatientEpisode
  });
  setStatus($("#soapStatus"), "ready", `Pasien baru: ${identity}`);
  setStatus($("#kronologiStatus"), "ready", `Pasien baru: ${identity}`);
  $("#newPatientDialog").close();
  $("main").scrollTo({ top: 0, behavior: "auto" });
  ($("#soapPanel").hidden ? $("#skenario") : $("#subjektif")).focus();
}

function activateTab(name) {
  const soapActive = name === "soap";
  $("#soapPanel").hidden = !soapActive;
  $("#kronologiPanel").hidden = soapActive;
  $("#soapTab").classList.toggle("active", soapActive);
  $("#kronologiTab").classList.toggle("active", !soapActive);
  $("#soapTab").setAttribute("aria-selected", String(soapActive));
  $("#kronologiTab").setAttribute("aria-selected", String(!soapActive));
  $("#soapTab").tabIndex = soapActive ? 0 : -1;
  $("#kronologiTab").tabIndex = soapActive ? -1 : 0;
  $(".tabs").dataset.activeTab = name;
}

function normalizeStoredSettings(stored = {}) {
  if (stored.apiKey && !stored.provider) {
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      provider: "custom",
      customProviderLabel: "OpenAI",
      customBaseUrl: "https://api.openai.com/v1/chat/completions",
      validated: false,
      validatedAt: ""
    };
  }
  return { ...DEFAULT_SETTINGS, ...stored };
}

function updateApiStatus() {
  const useAdmin = settings.apiKeySource === "admin";
  const personalReady = Boolean(settings.apiKey && settings.model);
  const adminReady = Boolean(adminPublicConfig?.hasApiKey && adminUserSession);
  const ready = useAdmin ? adminReady : personalReady;
  const state = !ready ? "empty" : useAdmin || settings.validated ? "success" : "warning";
  const label = useAdmin ? (adminPublicConfig?.providerLabel || adminPublicConfig?.provider || "Admin") : getProviderLabel(settings);
  const message = useAdmin
    ? adminReady
      ? `${label} admin aktif`
      : adminPublicConfig?.hasApiKey
        ? "API admin tersedia, login diperlukan"
        : "API admin belum tersedia"
    : !personalReady
      ? "API pribadi belum diatur"
      : settings.validated
        ? `${label} aktif`
        : `${label} tersimpan, belum divalidasi`;
  const connection = $("#apiConnection");
  connection.dataset.state = ready ? "success" : "empty";
  $("#apiConnectionText").textContent = message;
  $("#activeApiKeyStatus").dataset.state = state;
  $("#activeApiKeyText").textContent = ready
    ? `${message} · ${useAdmin ? adminPublicConfig?.model || "" : settings.model}`
    : message;
  $("#deleteApiKey").hidden = useAdmin;
  $("#deleteApiKey").disabled = useAdmin || !personalReady;
}

function syncApiSourceFields() {
  const useAdmin = $("#apiKeySource").value === "admin";
  $("#personalApiFields").hidden = useAdmin;
  $("#adminApiFields").hidden = !useAdmin;
  $("#saveSettings").querySelector("span").textContent = useAdmin ? "Gunakan API admin" : "Simpan";
  updateApiStatus();
}

function syncAdminSessionUi() {
  $("#adminLoggedIn").hidden = !adminUserSession;
  $("#adminLoginFields").hidden = Boolean(adminUserSession);
  $("#adminSessionUsername").textContent = adminUserSession?.username || "";
  updateApiStatus();
}

function syncAdminPublicStatus(error = "") {
  const status = $("#adminPublicStatus");
  if (error) {
    status.dataset.state = "warning";
    $("#adminPublicStatusText").textContent = error;
  } else if (adminPublicConfig?.hasApiKey) {
    status.dataset.state = "success";
    $("#adminPublicStatusText").textContent = `${adminPublicConfig.providerLabel || adminPublicConfig.provider} · ${adminPublicConfig.model}`;
  } else {
    status.dataset.state = "empty";
    $("#adminPublicStatusText").textContent = "API admin Magic SOAP belum dikonfigurasi";
  }
  updateApiStatus();
}

function syncOwnerProviderFields(resetModel = false) {
  const provider = $("#ownerProvider").value;
  $("#ownerCustomFields").hidden = provider !== "custom";
  if (resetModel && !$("#ownerModel").value.trim()) {
    $("#ownerModel").value = PROVIDERS[provider]?.defaultModel || "";
  }
}

function fillOwnerConfig(config = adminPublicConfig) {
  if (!config) return;
  $("#ownerProvider").value = PROVIDERS[config.provider] ? config.provider : "custom";
  $("#ownerProviderLabel").value = config.providerLabel || "";
  $("#ownerBaseUrl").value = config.baseUrl || "";
  $("#ownerModel").value = config.model || "gemini-2.0-flash";
  $("#ownerApiKey").value = "";
  syncOwnerProviderFields();
}

async function refreshAdminSettings() {
  try {
    const [config, session] = await Promise.all([fetchAdminPublicConfig(), validateStoredAdminSession()]);
    adminPublicConfig = config;
    adminUserSession = session;
    syncAdminPublicStatus();
    syncAdminSessionUi();
    fillOwnerConfig();
  } catch (error) {
    syncAdminPublicStatus(`Gagal memeriksa API admin: ${error.message}`);
    syncAdminSessionUi();
  }
}

function syncProviderFields(resetModel = false) {
  const provider = $("#provider").value;
  const previousProvider = $("#provider").dataset.previous || "gemini";
  const custom = provider === "custom";
  $("#customProviderFields").hidden = !custom;
  $("#apiKeyLabel").textContent = `${getProviderLabel({
    provider,
    customProviderLabel: $("#customProviderLabel").value.trim()
  })} API key`;
  if (resetModel) {
    const currentModel = $("#model").value.trim();
    const previousDefault = PROVIDERS[previousProvider]?.defaultModel || "";
    if (!currentModel || currentModel === previousDefault) {
      $("#model").value = PROVIDERS[provider]?.defaultModel || "";
    }
  }
  $("#provider").dataset.previous = provider;
}

function fillSettingsForm() {
  $("#apiKeySource").value = settings.apiKeySource;
  $("#provider").value = settings.provider;
  $("#customProviderLabel").value = settings.customProviderLabel;
  $("#customBaseUrl").value = settings.customBaseUrl;
  $("#apiKey").value = settings.apiKey;
  $("#apiKey").type = "password";
  $("#model").value = settings.model;
  $("#validateBeforeSave").checked = true;
  $("#settingsStatus").hidden = true;
  $("#provider").dataset.previous = settings.provider;
  syncProviderFields();
  syncApiKeyVisibility(false);
  syncApiSourceFields();
  syncAdminSessionUi();
  updateApiStatus();
}

function openSettingsDialog() {
  fillSettingsForm();
  const dialog = $("#settingsDialog");
  if (!dialog.open) dialog.showModal();
  $("#apiKeySource").focus();
  refreshAdminSettings();
}

function syncApiKeyVisibility(visible) {
  $("#apiKey").type = visible ? "text" : "password";
  $("#toggleApiKey").setAttribute("aria-label", visible ? "Sembunyikan API key" : "Tampilkan API key");
  $("#toggleApiKey").title = visible ? "Sembunyikan API key" : "Tampilkan API key";
  $(".eye-open").hidden = visible;
  $(".eye-closed").hidden = !visible;
}

function collectSettingsForm() {
  return {
    apiKeySource: $("#apiKeySource").value,
    provider: $("#provider").value,
    apiKey: $("#apiKey").value.trim(),
    model: $("#model").value.trim(),
    customProviderLabel: $("#customProviderLabel").value.trim(),
    customBaseUrl: $("#customBaseUrl").value.trim(),
    validated: false,
    validatedAt: ""
  };
}

function setSettingsBusy(active, message = "Simpan") {
  const button = $("#saveSettings");
  button.disabled = active;
  button.querySelector("span").textContent = !active && message === "Simpan" && $("#apiKeySource").value === "admin"
    ? "Gunakan API admin"
    : message;
  $("#deleteApiKey").disabled = active || settings.apiKeySource === "admin" || !settings.apiKey;
  $("#cancelSettings").disabled = active;
}

async function saveApiSettings(event) {
  event.preventDefault();
  const candidate = collectSettingsForm();
  const shouldValidate = $("#validateBeforeSave").checked;
  const status = $("#settingsStatus");
  status.hidden = false;
  try {
    if (candidate.apiKeySource === "admin") {
      setSettingsBusy(true, "Memeriksa...");
      setStatus(status, "loading", "Memeriksa API admin dan sesi pengguna...");
      const config = await fetchAdminPublicConfig();
      if (!config?.hasApiKey) throw new Error("API key admin untuk Magic SOAP belum diset.");
      let session = await validateStoredAdminSession();
      if (!session && ($("#adminUsername").value.trim() || $("#adminPassword").value)) {
        session = await loginAdminAccess($("#adminUsername").value, $("#adminPassword").value);
      }
      if (!session) throw new Error("Login API admin terlebih dahulu.");
      candidate.validated = true;
      candidate.validatedAt = new Date().toISOString();
      await chrome.storage.local.set({ [SETTINGS_KEY]: candidate });
      settings = candidate;
      syncAdminPublicStatus();
      syncAdminSessionUi();
      updateApiStatus();
      setStatus(status, "success", `API admin aktif sebagai ${session.username}.`);
      setSettingsBusy(false, "Gunakan API admin");
      return;
    }

    validateSettingsShape(candidate);
    await ensureCustomProviderPermission(candidate);
    if (shouldValidate) {
      setSettingsBusy(true, "Memvalidasi...");
      setStatus(status, "loading", `Memvalidasi ${getProviderLabel(candidate)}...`);
      await validateApiSettings(candidate);
      candidate.validated = true;
      candidate.validatedAt = new Date().toISOString();
    } else {
      setSettingsBusy(true, "Menyimpan...");
      setStatus(status, "loading", "Menyimpan API key pribadi...");
    }
    await chrome.storage.local.set({ [SETTINGS_KEY]: candidate });
    settings = candidate;
    updateApiStatus();
    setStatus(status, "success", candidate.validated ? `${getProviderLabel(candidate)} aktif.` : "API key tersimpan tanpa validasi.");
    setSettingsBusy(false);
  } catch (error) {
    setSettingsBusy(false);
    setStatus(status, "error", `Validasi gagal: ${error.message} Pengaturan lama tetap digunakan.`);
  }
}

async function loginAdminUserFromSettings() {
  const status = $("#settingsStatus");
  status.hidden = false;
  $("#loginAdminUser").disabled = true;
  setStatus(status, "loading", "Login API admin...");
  try {
    await loginAdminAccess($("#adminUsername").value, $("#adminPassword").value);
    $("#adminPassword").value = "";
    syncAdminSessionUi();
    setStatus(status, "success", `Login berhasil sebagai ${adminUserSession.username}.`);
  } catch (error) {
    setStatus(status, "error", `Login gagal: ${error.message}`);
  } finally {
    $("#loginAdminUser").disabled = false;
  }
}

async function logoutAdminUserFromSettings() {
  await logoutAdminAccess();
  syncAdminSessionUi();
  const status = $("#settingsStatus");
  status.hidden = false;
  setStatus(status, "success", "Logout API admin berhasil.");
}

function collectOwnerConfig() {
  const provider = $("#ownerProvider").value;
  return {
    provider,
    provider_label: provider === "custom" ? $("#ownerProviderLabel").value.trim() : getProviderLabel({ provider }),
    base_url: provider === "custom" ? $("#ownerBaseUrl").value.trim() : "",
    api_key: $("#ownerApiKey").value.trim(),
    model: $("#ownerModel").value.trim(),
    gemini_fallback_api_key: "",
    gemini_fallback_model: "gemini-2.0-flash"
  };
}

function collectOwnerAuth() {
  if (!ownerAdminAuth?.username || !ownerAdminAuth?.password) {
    throw new Error("Login Panel Admin terlebih dahulu.");
  }
  return { ...ownerAdminAuth };
}

function activateOwnerAdminTab(name) {
  document.querySelectorAll(".owner-admin-tab").forEach((button) => {
    const active = button.dataset.ownerTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".owner-admin-section").forEach((section) => {
    section.hidden = section.dataset.ownerPanel !== name;
  });
}

function exitOwnerAdminMode() {
  ownerAdminAuth = null;
  ownerUserResetTarget = "";
  $("#ownerUsername").value = "";
  $("#ownerPassword").value = "";
  $("#ownerApiKey").value = "";
  $("#newAdminUsername").value = "";
  $("#newAdminPassword").value = "";
  cancelAdminUserReset();
  $("#ownerAdminPanel").hidden = true;
  $("#ownerAdminLogin").hidden = false;
  $("#ownerAdminStatus").hidden = true;
  $("#ownerLoginStatus").hidden = true;
  $("#adminUserList").textContent = "";
  activateOwnerAdminTab("apikey");
}

async function loginOwnerAdmin() {
  const username = $("#ownerUsername").value.trim();
  const password = $("#ownerPassword").value;
  const status = $("#ownerLoginStatus");
  status.hidden = false;
  if (!username || !password) {
    setStatus(status, "error", "Username dan password wajib diisi.");
    return;
  }

  $("#loginOwnerAdmin").disabled = true;
  $("#loginOwnerAdmin span").textContent = "Memeriksa...";
  setStatus(status, "loading", "Memeriksa login admin...");
  try {
    await knowledgeApi("login", { username, password });
    ownerAdminAuth = { username, password };
    $("#ownerUsername").value = "";
    $("#ownerPassword").value = "";
    $("#ownerAdminLogin").hidden = true;
    $("#ownerAdminPanel").hidden = false;
    activateOwnerAdminTab("apikey");
    const config = await fetchAdminPublicConfig();
    fillOwnerConfig(config);
    await loadAdminUsers();
    setStatus($("#ownerAdminStatus"), "success", "Panel admin aktif.");
  } catch (error) {
    ownerAdminAuth = null;
    setStatus(status, "error", `Login gagal: ${error.message}`);
  } finally {
    $("#loginOwnerAdmin").disabled = false;
    $("#loginOwnerAdmin span").textContent = "Login Panel Admin";
  }
}

async function submitOwnerConfig(action) {
  const status = $("#ownerAdminStatus");
  const validateOnly = action === "validate_ai_config";
  status.hidden = false;
  $("#resetOwnerConfig").disabled = true;
  $("#validateOwnerConfig").disabled = true;
  $("#saveOwnerConfig").disabled = true;
  setStatus(status, "loading", validateOnly ? "Memvalidasi konfigurasi admin..." : "Menyimpan konfigurasi admin...");
  try {
    const data = await knowledgeApi(action, { ...collectOwnerAuth(), config: collectOwnerConfig() });
    if (!validateOnly) {
      adminPublicConfig = data.config || await fetchAdminPublicConfig();
      fillOwnerConfig();
      syncAdminPublicStatus();
      $("#ownerApiKey").value = "";
    }
    setStatus(status, "success", validateOnly ? "Konfigurasi API admin valid." : "API admin Magic SOAP berhasil disimpan.");
  } catch (error) {
    setStatus(status, "error", `${validateOnly ? "Validasi" : "Penyimpanan"} gagal: ${error.message}`);
  } finally {
    $("#resetOwnerConfig").disabled = false;
    $("#validateOwnerConfig").disabled = false;
    $("#saveOwnerConfig").disabled = false;
  }
}

async function resetOwnerConfig() {
  const provider = $("#ownerProvider").value;
  const providerLabel = getProviderLabel({
    provider,
    customProviderLabel: $("#ownerProviderLabel").value.trim()
  });
  if (!window.confirm(`Reset API key ${providerLabel} untuk Magic SOAP? Pengguna API admin tidak dapat generate sampai key baru disimpan.`)) return;

  const status = $("#ownerAdminStatus");
  status.hidden = false;
  $("#resetOwnerConfig").disabled = true;
  $("#validateOwnerConfig").disabled = true;
  $("#saveOwnerConfig").disabled = true;
  setStatus(status, "loading", `Mereset ${providerLabel}...`);
  try {
    const data = await knowledgeApi("reset_ai_config", { ...collectOwnerAuth(), provider });
    adminPublicConfig = data.config || await fetchAdminPublicConfig();
    fillOwnerConfig();
    syncAdminPublicStatus();
    setStatus(status, "success", "API key admin berhasil dikosongkan. Isi key baru untuk mengaktifkannya kembali.");
  } catch (error) {
    setStatus(status, "error", `Reset gagal: ${error.message}`);
  } finally {
    $("#resetOwnerConfig").disabled = false;
    $("#validateOwnerConfig").disabled = false;
    $("#saveOwnerConfig").disabled = false;
  }
}

function renderAdminUsers(users = []) {
  const list = $("#adminUserList");
  list.textContent = "";
  if (!users.length) {
    const empty = document.createElement("p");
    empty.className = "field-hint";
    empty.textContent = "Belum ada pengguna terdaftar.";
    list.append(empty);
    return;
  }

  for (const user of users) {
    const row = document.createElement("div");
    row.className = "admin-user-row";
    const main = document.createElement("div");
    main.className = "admin-user-main";
    const username = document.createElement("strong");
    username.textContent = user.username;
    const meta = document.createElement("span");
    meta.className = "field-hint";
    meta.textContent = user.hasActiveDevice ? "Perangkat aktif" : "Belum ada perangkat aktif";
    main.append(username, meta);

    const actions = document.createElement("div");
    actions.className = "admin-user-actions";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "button";
    reset.textContent = "Reset";
    reset.addEventListener("click", () => openAdminUserReset(user.username));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button delete-user-button";
    remove.title = `Hapus ${user.username}`;
    remove.setAttribute("aria-label", `Hapus pengguna ${user.username}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg>';
    remove.addEventListener("click", () => deleteAdminUser(user.username));
    actions.append(reset, remove);
    row.append(main, actions);
    list.append(row);
  }
}

async function loadAdminUsers() {
  const status = $("#ownerAdminStatus");
  status.hidden = false;
  $("#refreshAdminUsers").disabled = true;
  setStatus(status, "loading", "Memuat pengguna API admin...");
  try {
    const data = await knowledgeApi("list_users", collectOwnerAuth());
    renderAdminUsers(data.users || []);
    setStatus(status, "success", `${data.users?.length || 0} pengguna dimuat.`);
  } catch (error) {
    setStatus(status, "error", `Gagal memuat pengguna: ${error.message}`);
  } finally {
    $("#refreshAdminUsers").disabled = false;
  }
}

async function createAdminUser() {
  const username = $("#newAdminUsername").value.trim();
  const password = $("#newAdminPassword").value;
  const status = $("#ownerAdminStatus");
  status.hidden = false;
  if (!username || password.trim().length < 4) {
    setStatus(status, "error", "Username wajib diisi dan password minimal 4 karakter.");
    return;
  }
  $("#createAdminUser").disabled = true;
  setStatus(status, "loading", `Menambahkan ${username}...`);
  try {
    await knowledgeApi("create_user", { ...collectOwnerAuth(), user: { username, password } });
    $("#newAdminUsername").value = "";
    $("#newAdminPassword").value = "";
    await loadAdminUsers();
    setStatus(status, "success", `Pengguna ${username} berhasil ditambahkan.`);
  } catch (error) {
    setStatus(status, "error", `Gagal menambah pengguna: ${error.message}`);
  } finally {
    $("#createAdminUser").disabled = false;
  }
}

function openAdminUserReset(username) {
  ownerUserResetTarget = username;
  $("#resetAdminUserTarget").textContent = `Reset password ${username}`;
  $("#resetAdminUserPassword").value = "";
  $("#newAdminUserFields").hidden = true;
  $("#resetAdminUserFields").hidden = false;
  $("#resetAdminUserPassword").focus();
}

function cancelAdminUserReset() {
  ownerUserResetTarget = "";
  $("#resetAdminUserPassword").value = "";
  $("#resetAdminUserFields").hidden = true;
  $("#newAdminUserFields").hidden = false;
}

async function confirmAdminUserReset() {
  const password = $("#resetAdminUserPassword").value;
  const status = $("#ownerAdminStatus");
  status.hidden = false;
  if (!ownerUserResetTarget || password.trim().length < 4) {
    setStatus(status, "error", "Password baru minimal 4 karakter.");
    return;
  }
  $("#confirmResetAdminUser").disabled = true;
  setStatus(status, "loading", `Mereset password ${ownerUserResetTarget}...`);
  try {
    await knowledgeApi("reset_user_password", {
      ...collectOwnerAuth(),
      user: { username: ownerUserResetTarget, password }
    });
    const username = ownerUserResetTarget;
    cancelAdminUserReset();
    await loadAdminUsers();
    setStatus(status, "success", `Password ${username} berhasil diperbarui.`);
  } catch (error) {
    setStatus(status, "error", `Reset password gagal: ${error.message}`);
  } finally {
    $("#confirmResetAdminUser").disabled = false;
  }
}

async function deleteAdminUser(username) {
  if (!window.confirm(`Hapus pengguna ${username}? Sesi aktif pengguna akan dihentikan.`)) return;
  const status = $("#ownerAdminStatus");
  status.hidden = false;
  setStatus(status, "loading", `Menghapus ${username}...`);
  try {
    await knowledgeApi("delete_user", { ...collectOwnerAuth(), user: { username } });
    await loadAdminUsers();
    setStatus(status, "success", `Pengguna ${username} berhasil dihapus.`);
  } catch (error) {
    setStatus(status, "error", `Gagal menghapus pengguna: ${error.message}`);
  }
}

async function deleteApiSettings() {
  if (!settings.apiKey || !window.confirm("Hapus API key pribadi dari browser ini?")) return;
  await chrome.storage.local.remove(SETTINGS_KEY);
  settings = { ...DEFAULT_SETTINGS };
  fillSettingsForm();
  const status = $("#settingsStatus");
  status.hidden = false;
  setStatus(status, "success", "API key pribadi telah dihapus.");
}

async function initialize() {
  const saved = await chrome.storage.local.get([SETTINGS_KEY, SOAP_DRAFT_KEY, KRONOLOGI_DRAFT_KEY, HISTORY_KEY, ACTIVE_PATIENT_KEY]);
  settings = normalizeStoredSettings(saved[SETTINGS_KEY]);
  const hadHistoryStorage = Array.isArray(saved[HISTORY_KEY]);
  const storedHistory = hadHistoryStorage ? saved[HISTORY_KEY] : [];
  historyEntries = pruneExpiredHistory(storedHistory);
  activePatientEpisode = saved[ACTIVE_PATIENT_KEY]?.id ? saved[ACTIVE_PATIENT_KEY] : null;
  const historyWasPruned = historyEntries.length !== storedHistory.length;
  if (activePatientEpisode && !historyEntries.some(({ id }) => id === activePatientEpisode.id)) {
    activePatientEpisode = null;
    await chrome.storage.local.remove(ACTIVE_PATIENT_KEY);
  }
  if (historyWasPruned) await chrome.storage.local.set({ [HISTORY_KEY]: historyEntries });
  restoreDraft(saved[SOAP_DRAFT_KEY]);
  restoreDraft(saved[KRONOLOGI_DRAFT_KEY]);
  fillSettingsForm();
  if (settings.apiKeySource === "admin") await refreshAdminSettings();
  syncResultAlerts();
  if (!hadHistoryStorage && (hasResult("soap") || hasResult("kronologi"))) {
    if (hasResult("soap")) await saveEpisodeResult("soap");
    if (hasResult("kronologi")) await saveEpisodeResult("kronologi");
  }
  renderHistoryList();
}

if (typeof document !== "undefined") {
  SOAP_FIELD_IDS.forEach((id) => $(`#${id}`).addEventListener("input", scheduleSoapSave));
  KRONOLOGI_FIELD_IDS.forEach((id) => $(`#${id}`).addEventListener("input", scheduleKronologiSave));
  $("#soapTab").addEventListener("click", () => activateTab("soap"));
  $("#kronologiTab").addEventListener("click", () => activateTab("kronologi"));
  $(".tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = $("#soapPanel").hidden ? "soap" : "kronologi";
    activateTab(next);
    $(`#${next}Tab`).focus();
  });
  $("#generateSoap").addEventListener("click", generateSoap);
  $("#generateKronologi").addEventListener("click", generateKronologi);
  $("#uploadClinicalImage").addEventListener("click", () => $("#clinicalImageInput").click());
  $("#clinicalImageInput").addEventListener("change", selectClinicalImage);
  $("#removeClinicalImage").addEventListener("click", () => {
    clearClinicalImage();
    setStatus($("#soapStatus"), "ready", "Foto klinis dihapus.");
  });
  $("#createChronology").addEventListener("click", createChronologyFromSoap);
  $("#backToForm").addEventListener("click", closeResultView);
  $("#resultDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeResultView();
  });
  document.querySelectorAll(".copy-field").forEach((button) => {
    button.addEventListener("click", () => copyField(button));
  });
  document.querySelectorAll(".result-panel textarea").forEach((field) => {
    field.addEventListener("input", () => resizeResultTextareas(field.closest(".result-panel")));
  });
  $("#openHistory").addEventListener("click", openHistoryDialog);
  $("#closeHistory").addEventListener("click", closeHistoryDialog);
  $("#backToHistoryList").addEventListener("click", showHistoryList);
  $("#historyDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeHistoryDialog();
  });
  $("#historyDialog").addEventListener("click", (event) => {
    if (event.target === $("#historyDialog")) closeHistoryDialog();
  });
  $("#newPatient").addEventListener("click", openNewPatientDialog);
  $("#closeNewPatient").addEventListener("click", () => $("#newPatientDialog").close());
  $("#cancelNewPatient").addEventListener("click", () => $("#newPatientDialog").close());
  $("#newPatientForm").addEventListener("submit", startNewPatient);
  $("#newPatientDialog").addEventListener("click", (event) => {
    if (event.target === $("#newPatientDialog")) $("#newPatientDialog").close();
  });
  document.querySelectorAll(".help-button").forEach((button) => {
    button.addEventListener("click", () => openHelpDialog(button.dataset.helpType));
  });
  $("#closeHelp").addEventListener("click", () => $("#helpDialog").close());
  $("#dismissHelp").addEventListener("click", () => $("#helpDialog").close());
  $("#helpDialog").addEventListener("click", (event) => {
    if (event.target === $("#helpDialog")) $("#helpDialog").close();
  });
  $("#openSettings").addEventListener("click", openSettingsDialog);
  $("#closeSettings").addEventListener("click", () => $("#settingsDialog").close());
  $("#cancelSettings").addEventListener("click", () => $("#settingsDialog").close());
  $("#provider").addEventListener("change", () => syncProviderFields(true));
  $("#apiKeySource").addEventListener("change", () => {
    syncApiSourceFields();
    if ($("#apiKeySource").value === "admin") refreshAdminSettings();
  });
  $("#customProviderLabel").addEventListener("input", () => syncProviderFields());
  $("#toggleApiKey").addEventListener("click", () => syncApiKeyVisibility($("#apiKey").type === "password"));
  $("#deleteApiKey").addEventListener("click", deleteApiSettings);
  $("#loginAdminUser").addEventListener("click", loginAdminUserFromSettings);
  $("#logoutAdminUser").addEventListener("click", logoutAdminUserFromSettings);
  $("#ownerProvider").addEventListener("change", () => syncOwnerProviderFields(true));
  $("#loginOwnerAdmin").addEventListener("click", loginOwnerAdmin);
  $("#exitOwnerAdmin").addEventListener("click", exitOwnerAdminMode);
  ["ownerUsername", "ownerPassword"].forEach((id) => {
    $(`#${id}`).addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      loginOwnerAdmin();
    });
  });
  document.querySelectorAll(".owner-admin-tab").forEach((button) => {
    button.addEventListener("click", () => activateOwnerAdminTab(button.dataset.ownerTab));
    button.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const next = button.dataset.ownerTab === "apikey" ? "user" : "apikey";
      activateOwnerAdminTab(next);
      $(`.owner-admin-tab[data-owner-tab="${next}"]`).focus();
    });
  });
  $("#resetOwnerConfig").addEventListener("click", resetOwnerConfig);
  $("#validateOwnerConfig").addEventListener("click", () => submitOwnerConfig("validate_ai_config"));
  $("#saveOwnerConfig").addEventListener("click", () => submitOwnerConfig("save_ai_config"));
  $("#refreshAdminUsers").addEventListener("click", loadAdminUsers);
  $("#createAdminUser").addEventListener("click", createAdminUser);
  $("#cancelResetAdminUser").addEventListener("click", cancelAdminUserReset);
  $("#confirmResetAdminUser").addEventListener("click", confirmAdminUserReset);
  $("#settingsForm").addEventListener("submit", saveApiSettings);
  $("#settingsDialog").addEventListener("click", (event) => {
    if (event.target === $("#settingsDialog")) $("#settingsDialog").close();
  });
  $("#settingsDialog").addEventListener("close", exitOwnerAdminMode);

  initialize().catch((error) => setStatus($("#soapStatus"), "error", `Error: ${error.message}`));
}

if (typeof module !== "undefined") {
  module.exports = {
    buildMagicSoapPrompt,
    buildKronologiPrompt,
    parseAiJson,
    requireStrings,
    normalizeSoapResult,
    normalizeKronologiResult,
    contentToText,
    extractOpenAiContent,
    parseProviderPayload,
    embeddedProviderError,
    pruneExpiredHistory
  };
  if (require.main === module) {
    const assert = require("node:assert/strict");
    const crypto = require("node:crypto");
    const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
    assert.equal(parseAiJson('```json\n{"s":"ok"}\n```').s, "ok");
    assert.equal(parseAiJson('Jawaban:\n{"s":"baris 1\nbaris 2",}').s, "baris 1\nbaris 2");
    assert.equal(parseAiJson(JSON.stringify('{"s":"double encoded"}')).s, "double encoded");
    assert.equal(contentToText([{ type: "text", text: "{\"s\":" }, { type: "text", text: "\"array\"}" }]), '{"s":"array"}');
    assert.equal(extractOpenAiContent({ choices: [{ message: { content: "", reasoning_content: "hasil reasoning" } }] }), "hasil reasoning");
    assert.equal(extractOpenAiContent({ output: [{ content: [{ type: "output_text", text: "hasil responses" }] }] }), "hasil responses");
    assert.equal(parseProviderPayload('data: {"choices":[{"delta":{"content":"{\\\"s\\\":"}}]}\n\ndata: {"choices":[{"delta":{"content":"\\\"ok\\\"}"}}]}\n\ndata: [DONE]'), '{"s":"ok"}');
    assert.equal(embeddedProviderError({ success: false, message: "Model tidak tersedia" }), "Model tidak tersedia");
    assert.equal(normalizeSoapResult({ S: "Keluhan", O: "Temuan", A: "Diagnosis", P: "Terapi", requiresChronology: "false" }).requires_chronology, false);
    assert.equal(normalizeKronologiResult({ chronology: "Kejadian" }).kronologi, "Kejadian");
    const retentionNow = Date.UTC(2026, 7, 12);
    assert.deepEqual(pruneExpiredHistory([
      { id: "expired", updatedAt: new Date(retentionNow - (61 * 24 * 60 * 60 * 1000)).toISOString() },
      { id: "boundary", updatedAt: new Date(retentionNow - HISTORY_RETENTION_MS).toISOString() },
      { id: "recent", createdAt: new Date(retentionNow - (59 * 24 * 60 * 60 * 1000)).toISOString() }
    ], retentionNow).map(({ id }) => id), ["boundary", "recent"]);
    assert.throws(() => parseAiJson("bukan json"), /bukan JSON valid/);
    assert.match(buildMagicSoapPrompt({ identity: "Laki-laki 45 tahun", serviceMode: "rawat_jalan", subjektif: "Nyeri", objektif: "", assessment: "", planning: "" }), /RAWAT JALAN/);
    assert.match(buildKronologiPrompt({ skenario: "Jatuh", akibat: "Fraktur" }), /\[Akibat\]: Fraktur/);
    assert.equal(hash(buildMagicSoapPrompt({
      identity: "Laki-laki 45 tahun",
      serviceMode: "rawat_jalan",
      subjektif: "Subjektif uji",
      objektif: "Objektif uji",
      assessment: "Assessment uji",
      planning: "Planning uji"
    })), "225f05388231a2f9b5f629c451d7a7af1d29716fa7c5b8aa5bbc40cfefedfbdd");
    assert.equal(hash(buildKronologiPrompt({
      skenario: "Skenario uji",
      akibat: "Akibat uji"
    })), "774d698b71de19bec4a3fce633c7fa9a8a75411e2fc5f878ef765c0d39b15b0d");
    console.log("self-check ok");
  }
}
