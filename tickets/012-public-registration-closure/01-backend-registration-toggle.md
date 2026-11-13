# Ticket 01: Backend Public Registration Toggle & 403 Guard

## Goal
Menambahkan sakelar konfigurasi `ENABLE_PUBLIC_REGISTRATION` pada backend (`services/api`), mengunci endpoint publik `POST /api/v1/auth/register` dengan HTTP `403 Forbidden` saat konfigurasi bernilai `False`, mengizinkan override melalui environment variable, dan memastikan test suite pytest tetap 100% lulus termasuk pengujian eksplisit perilaku 403.

---

## Scope

1. **Konfigurasi Global (`services/api/app/core/config.py`)**:
   - Tambahkan atribut pada kelas `Settings`:
     ```python
     # Public self-registration toggle (SPEC-006). If False, POST /api/v1/auth/register returns 403.
     ENABLE_PUBLIC_REGISTRATION: bool = False
     ```
   - Nilai default diatur `False` agar aman secara bawaan di mode produksi.

2. **Route Guard pada `POST /api/v1/auth/register` (`services/api/app/api/v1/auth.py`)**:
   - Di awal handler `register()`, sebelum rate limiter atau pembuatan user:
     ```python
     if not settings.ENABLE_PUBLIC_REGISTRATION:
         raise HTTPException(
             status_code=status.HTTP_403_FORBIDDEN,
             detail="Public registration is currently disabled. Please contact the administrator via Discord.",
         )
     ```

3. **Integritas Test Suite & Pengujian 403 (`services/api/tests`)**:
   - Pada fixture test global (`conftest.py` / `test_settings`), pastikan environment testing mengaktifkan `ENABLE_PUBLIC_REGISTRATION = True` sehingga pengujian registrasi akun di `test_account_lifecycle.py`, `test_connections.py`, dll. tetap berjalan lancar.
   - Tambahkan test case eksplisit di `tests/test_api_baseline.py` atau `tests/test_account_lifecycle.py` untuk menguji skenario negatif:
     - Ketika `ENABLE_PUBLIC_REGISTRATION = False`, request `POST /api/v1/auth/register` wajib mengembalikan `403 Forbidden` dan detail pesan yang sesuai.

---

## Files to Touch
- `services/api/app/core/config.py`
- `services/api/app/api/v1/auth.py`
- `services/api/tests/conftest.py`
- `services/api/tests/test_account_lifecycle.py`

---

## Verification
```bash
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe
```
Ekspektasi: Seluruh test pass (177+ passed), 6 contract arsitektur terjaga (0 broken).

---

## Hasil Verifikasi (2026-11-13)

- `pytest` → **177 passed**, 1 warning (Starlette `httpx` deprecation, pre-existing).
- `lint-imports` → **Contracts: 6 kept, 0 broken.**
- Test negatif baru: `tests/test_api_baseline.py::test_register_is_forbidden_when_public_registration_is_disabled`
  memakai `monkeypatch.setattr(settings, "ENABLE_PUBLIC_REGISTRATION", False)` dan memastikan `403`
  + detail `"Public registration is currently disabled..."`. Flag dibaca per-request sehingga
  override env `ENABLE_PUBLIC_REGISTRATION=true` langsung membuka kembali endpoint.
- Flag diteruskan ke runtime: `.env.example` (`ENABLE_PUBLIC_REGISTRATION=false`) dan
  `infra/docker-compose.yml` (`ENABLE_PUBLIC_REGISTRATION=${ENABLE_PUBLIC_REGISTRATION:-false}`).

## Status
done

