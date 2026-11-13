# SPEC-006: Public Self-Registration Closure & Direct Discord Contact Onboarding

## 1. Problem & Context

Saat ini pada platform Pipstride di `app-pipstride.homever.my.id` (`apps/web`), antarmuka autentikasi (`LoginPage.jsx`) menyediakan tab *switcher* dan formulir pendaftaran mandiri publik (*self-registration*) yang memanggil endpoint `POST /api/v1/auth/register`.

Berdasarkan strategi operasional dan bisnis saat ini:
1. **Registrasi Publik Ditutup Sementara**: Platform belum dibuka untuk pendaftaran publik bebas/anonim. Akun pengguna hanya boleh dibuatkan secara terkontrol oleh administrator melalui **Dashboard Admin** (`apps/admin`) via `UserCreateModal` dan endpoint backend `POST /api/v1/admin/users`.
2. **Kode Registrasi Tidak Boleh Dihapus**: Seluruh kode formulir pendaftaran, validasi username/email/password, dan penanganan submit di `LoginPage.jsx` harus dipertahankan 100% utuh agar dapat diaktifkan kembali sewaktu-waktu tanpa perlu menulis ulang (*non-destructive toggle*).
3. **Onboarding Calon Pengguna via Discord**: Calon pengguna yang tiba di halaman login tidak boleh dibiarkan bingung tanpa opsi. Karena server komunitas Discord resmi Pipstride belum dibuat, jalur komunikasi langsung diarahkan ke akun Discord personal administrator (`ID: 757954690037186580` / `https://discord.com/users/757954690037186580`).
4. **Proteksi Backend API 2 Lapis**: Menutup tampilan UI saja tidak cukup, karena pengguna teknis atau bot masih dapat mengirim request `POST /api/v1/auth/register` secara langsung melalui cURL/Postman. Backend wajib dilengkapi sakelar konfigurasi (`ENABLE_PUBLIC_REGISTRATION`) yang menolak upaya registrasi mandiri dengan HTTP `403 Forbidden`.

---

## 2. Goals & Constraints

### Goals
- **Goal 1 (Backend Protection)**: Endpoint `POST /api/v1/auth/register` menolak registrasi mandiri dengan HTTP `403 Forbidden` ketika `ENABLE_PUBLIC_REGISTRATION` bernilai `False`. Konfigurasi dapat dikontrol melalui *environment variable*.
- **Goal 2 (Frontend Non-Destructive Closure)**: Di `LoginPage.jsx`, tab *switcher* registrasi disembunyikan dan mode formulir default dikunci ke Sign In. Kode form dan logika registrasi tetap dipertahankan utuh dalam komponen.
- **Goal 3 (Discord Onboarding CTA)**: Di bawah form Sign In, disematkan kartu informasi bergaya Pipstride dark-emerald yang menjelaskan bahwa pendaftaran saat ini bersifat *Private Access / By Invitation*, dilengkapi tombol CTA menuju profil Discord admin (`https://discord.com/users/757954690037186580`).
- **Goal 4 (Bilingual Parity & Test Suite)**: Seluruh string teks baru tersedia dalam Bahasa Indonesia dan Bahasa Inggris pada `translations.js` (lolos audit `check-i18n.cjs`), serta seluruh automated tests backend (176 tests) dan web (88 tests) tetap lulus 100%.

### Constraints
- Jangan menghapus deklarasi state (`regUsername`, `regEmail`, `regPassword`, `regConfirmPassword`, dll.) atau fungsi `handleRegisterSubmit`.
- Jangan mengubah endpoint `POST /api/v1/admin/users` atau modal `UserCreateModal` di `apps/admin` (alur pembuatan akun oleh admin tetap berjalan normal).
- Test suite backend tidak boleh pecah: default test environment mengizinkan registrasi agar pengujian siklus hidup akun tetap berjalan normal.

---

## 3. Detailed Technical Design

### 3.1. Backend API: Toggle & Guard HTTP 403 (`services/api`)

1. **Konfigurasi (`services/api/app/core/config.py`)**:
   Tambahkan konfigurasi boolean pada kelas `Settings`:
   ```python
   # Public self-registration toggle (SPEC-006). If False, POST /api/v1/auth/register returns 403.
   ENABLE_PUBLIC_REGISTRATION: bool = False
   ```
   Secara default bernilai `False` untuk produksi. Dapat di-override melalui environment variable `ENABLE_PUBLIC_REGISTRATION=true` jika ingin dibuka kembali.

2. **Route Guard (`services/api/app/api/v1/auth.py`)**:
   Di dalam endpoint `register()` sebelum proses pemanggilan `user_service.register`:
   ```python
   if not settings.ENABLE_PUBLIC_REGISTRATION:
       raise HTTPException(
           status_code=status.HTTP_403_FORBIDDEN,
           detail="Public registration is currently disabled. Please contact the administrator via Discord.",
       )
   ```

3. **Integritas Test Suite (`services/api/tests/conftest.py`)**:
   Di fixture `test_settings` atau initialization test di `conftest.py`:
   Pastikan `settings.ENABLE_PUBLIC_REGISTRATION = True` pada saat pengujian dijalankan, agar modul tes yang menguji pendaftaran (seperti `test_account_lifecycle.py`, `test_connections.py`, dll.) tidak mengalami penolakan 403.
   Tambahkan juga tes unit spesifik yang memvalidasi bahwa ketika flag diset `False`, panggilan ke `/register` mengembalikan 403 Forbidden.

---

### 3.2. Frontend Web: Feature Flag, Notice Card & Discord CTA (`apps/web`)

1. **Variabel Konfigurasi di `apps/web/src/components/LoginPage.jsx`**:
   Tambahkan konstanta yang mudah di-toggle:
   ```javascript
   // Set to true to re-enable the public self-registration tab and form (SPEC-006)
   const PUBLIC_REGISTRATION_ENABLED = false;
   const DISCORD_ADMIN_URL = 'https://discord.com/users/757954690037186580';
   ```

2. **Kondisional Tab Switcher**:
   Tab switcher hanya dirender jika `PUBLIC_REGISTRATION_ENABLED === true` dan `activeTab !== 'forgot'`:
   ```jsx
   {PUBLIC_REGISTRATION_ENABLED && activeTab !== 'forgot' && (
     <div className="auth-tab-bar" ...>
       ...
     </div>
   )}
   ```
   Jika `PUBLIC_REGISTRATION_ENABLED === false`, `activeTab` dipastikan selalu `'login'` (atau `'forgot'` saat user melakukan pemulihan sandi).

3. **Form Registrasi Dipertahankan**:
   Struktur form registrasi (`activeTab === 'register' ? (...) : null`) tetap berada di JSX, namun dibungkus dengan guard `PUBLIC_REGISTRATION_ENABLED && activeTab === 'register'`.

4. **Notice Box & Tombol Discord**:
   Ketika `!PUBLIC_REGISTRATION_ENABLED`, di bawah form Sign In (sebelum atau setelah quick demo dev button), tampilkan kartu informasi:
   ```jsx
   {!PUBLIC_REGISTRATION_ENABLED && (
     <div
       className="auth-private-notice"
       style={{
         marginTop: '18px',
         padding: '12px 14px',
         borderRadius: '12px',
         background: 'rgba(15, 34, 28, 0.65)',
         border: '1px solid rgba(69, 224, 173, 0.22)',
         textAlign: 'center'
       }}
     >
       <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--g)', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
         <ShieldCheck size={14} />
         <span>{t('auth_private_access_title')}</span>
       </div>
       <p style={{ fontSize: '10.5px', color: 'var(--muted)', margin: '0 0 10px 0', lineHeight: 1.4 }}>
         {t('auth_private_access_desc')}
       </p>
       <a
         href={DISCORD_ADMIN_URL}
         target="_blank"
         rel="noopener noreferrer"
         className="btn alt"
         style={{
           display: 'inline-flex',
           alignItems: 'center',
           justifyContent: 'center',
           gap: '6px',
           width: '100%',
           padding: '8px 12px',
           fontSize: '11px',
           fontWeight: 700,
           color: '#ffffff',
           background: '#5865F2',
           border: '1px solid #4752c4',
           borderRadius: '8px',
           textDecoration: 'none',
           cursor: 'pointer',
           transition: 'background 0.2s ease'
         }}
         id="discord-admin-contact-btn"
       >
         <MessageSquare size={13} />
         <span>{t('auth_contact_discord_btn')}</span>
       </a>
     </div>
   )}
   ```

5. **Kamus Bahasa (`apps/web/src/constants/translations.js`)**:
   Tambahkan key berikut pada kamus `en` dan `id`:
   - `auth_private_access_title`:
     - EN: `Early Access / Invitation Only`
     - ID: `Akses Terbatas / Melalui Undangan`
   - `auth_private_access_desc`:
     - EN: `Public registration is currently closed. New accounts are provisioned directly by the administrator.`
     - ID: `Pendaftaran publik saat ini ditutup. Akun baru dibuatkan langsung oleh administrator.`
   - `auth_contact_discord_btn`:
     - EN: `Request Account via Discord`
     - ID: `Hubungi Admin via Discord`

---

## 4. Verification & Testing Plan

1. **Paritas i18n**:
   ```bash
   node apps/web/scripts/check-i18n.cjs
   ```
   Wajib menghasilkan 0 key yatim (*all keys resolved and identical count*).

2. **Web Linting & Arsitektur**:
   ```bash
   npm --prefix apps/web run lint
   npm --prefix apps/web run lint:arch
   ```
   Wajib exit 0 dengan 0 warnings / 0 violations.

3. **Web Tests & Production Build**:
   ```bash
   npm --prefix apps/web test
   npm --prefix apps/web run build
   ```
   Seluruh unit test lulus dan bundle `dist/` ter-generate tanpa kompilasi error.

4. **Backend Test Suite & Architecture Gate**:
   ```bash
   cd services/api
   $env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
   ../../.venv/Scripts/python.exe -m pytest
   ../../.venv/Scripts/lint-imports.exe
   ```
   Seluruh test backend (176+) lulus dan 6 arsitektur contract tetap terjaga.
