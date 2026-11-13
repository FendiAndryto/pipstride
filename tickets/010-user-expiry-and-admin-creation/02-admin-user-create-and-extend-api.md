# Ticket 02: Admin User Creation & Expiry Management API

## Goal
Membuka jalur API bagi admin untuk membuat akun pengguna baru (HTTP 201) dan memperpanjang masa aktif akun (HTTP 200), dengan validasi ketat (termasuk validator timezone-aware eksplisit), batas transaksi atomik via public `prepare_user` (user + entitlement + audit dalam satu `session_scope`), response metadata-only, duplikat username → 409 Conflict, serta pencatatan audit terstandarisasi.

## Scope
1. **Schema Input & Response Admin (`services/api/app/models/admin.py`)**:
   - `AdminCreateUserRequest`:
     - `username: str = Field(..., min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.-]+$")`
     - `password: str = Field(..., min_length=8)`
     - `email: Optional[str] = None`
     - `role: Literal["trader"] = "trader"` (whitelist ketat)
     - `plan_code: str = "free"` (divalidasi terhadap database `Plan`)
     - `duration_days: Optional[int] = Field(None, ge=1)`
     - `exact_expires_at: Optional[datetime] = None`
     - `set_lifetime: bool = False`
     - `@field_validator("exact_expires_at")`:
       ```python
       @field_validator("exact_expires_at")
       @classmethod
       def validate_tz_aware(cls, v: Optional[datetime]) -> Optional[datetime]:
           if v is not None and v.tzinfo is None:
               raise ValueError("exact_expires_at must be timezone-aware (e.g. ISO-8601 with offset or 'Z')")
           return v
       ```
   - `AdminExtendExpiryRequest`:
     - `duration_days: Optional[int] = Field(None, ge=1)`
     - `exact_expires_at: Optional[datetime] = None`
     - `set_lifetime: bool = False`
     - Menggunakan `@field_validator("exact_expires_at")` yang sama (menolak naive datetime).
   - Update `AdminUserItem` & `AdminUserDetailResponse`:
     - Tambah field `expires_at: Optional[str] = None`
     - Tambah field `is_expired: bool = False`
2. **Public Method `prepare_user` (`services/api/app/services/user_service.py`)**:
   Pecah `register()` menjadi dua fungsi:
   ```python
   def prepare_user(
       self,
       db: Session,
       username: str,
       plain_password: str,
       role: str = "trader",
       email: Optional[str] = None,
       plan_code: str = "free",
       expires_at: Optional[datetime] = None,
   ) -> User:
       """Validate, create User + Entitlement, flush only (no commit).
       Caller must wrap in session_scope. Public method for use by admin_service."""
       cleaned = validate_username(username)
       validate_password_complexity(plain_password)
       normalized_email = normalize_email(email)
       if self.get_user(db, cleaned):
           raise ValueError("Username already registered")
       if normalized_email and self.get_user_by_email(db, normalized_email):
           raise ValueError("Email already registered")
       plan = db.get(Plan, plan_code)
       if plan is None:
           raise ValueError(f"Unknown plan code '{plan_code}'")
       user = User(
           username=cleaned,
           email=normalized_email,
           password_hash=hash_password(plain_password),
           role=role,
           expires_at=expires_at,
       )
       db.add(user)
       db.flush()
       db.add(Entitlement(user_id=user.id, plan_code=plan.code,
                          max_connections=plan.max_connections))
       return user

   def register(
       self,
       db: Session,
       username: str,
       plain_password: str,
       role: str = "trader",
       email: Optional[str] = None,
       plan_code: str = "free",
       expires_at: Optional[datetime] = None,
   ) -> User:
       """Public registration path — owns the commit."""
       with session_scope(db):
           user = self.prepare_user(
               db, username, plain_password, role, email,
               plan_code, expires_at)
       db.refresh(user)
       return user
   ```
   - `prepare_user` adalah method public (tanpa leading underscore) sehingga tidak melanggar konvensi saat dipanggil dari `admin_service`.
   - `register()` tetap bekerja identik untuk alur publik (commit sendiri).
   - Validasi (username, password, email, duplikat, plan) terpusat di `prepare_user` — single source of truth.
3. **Logika Admin Service (`services/api/app/services/admin_service.py`)**:
   - Helper kalkulasi masa aktif dengan parameter `now=None` opsional:
     ```python
     def _resolve_expiry(
         duration_days: Optional[int],
         exact_expires_at: Optional[datetime],
         set_lifetime: bool,
         current_expires_at: Optional[datetime] = None,
         now: Optional[datetime] = None,
     ) -> Optional[datetime]:
         """Return computed expires_at or raise ValueError.
         Accepts optional 'now' for deterministic testing."""
         if set_lifetime:
             return None
         now_utc = as_utc(now) or datetime.now(timezone.utc)
         if exact_expires_at is not None:
             target = as_utc(exact_expires_at)
             if target <= now_utc:
                 raise ValueError("exact_expires_at must be in the future")
             return target
         if duration_days is not None and duration_days > 0:
             base = current_expires_at if (current_expires_at and as_utc(current_expires_at) > now_utc) else now_utc
             return as_utc(base) + timedelta(days=duration_days)
         raise ValueError("Provide duration_days, exact_expires_at, or set_lifetime")
     ```
   - `create_user(db, *, actor, req, ip_address) -> User`:
     - Hitung `expires_at` via `_resolve_expiry(req.duration_days, req.exact_expires_at, req.set_lifetime)`.
     - Satu `with session_scope(db):` membungkus `user_service.prepare_user(...)` + `_audit(...)` **secara atomik** (ADR 0008 §4).
     - Audit: `action="admin.user.created"`, `target_user_id=user.id`, `detail=f"plan={plan_code}, expires_at={expires_at}"`. **Password tidak pernah masuk audit detail.**
   - `extend_user_expiry(db, *, actor, target, req, ip_address) -> User`:
     - Hitung `new_expires_at` via `_resolve_expiry(req.duration_days, req.exact_expires_at, req.set_lifetime, current_expires_at=target.expires_at)`.
     - `with session_scope(db):` membungkus update `target.expires_at` + `_audit(...)`.
     - Audit: `action="admin.user.expiry_updated"`, `target_user_id=target.id`, `detail=f"{previous_expiry} -> {new_expiry}"`.
4. **Admin Routers & Projections**:
   - Di `services/api/app/api/v1/admin/users.py`:
     - `POST /admin/users` (status `201`, guard `require_role("admin")`, return `AdminUserItem`).
       Duplikat username: catch `ValueError("...already registered")` → **409 Conflict** (konsisten dengan publik `/auth/register`).
     - `POST /admin/users/{user_id}/extend-expiry` (status `200`, guard `require_role("admin")`, return `AdminUserItem`).
   - Di `services/api/app/api/v1/admin/projections.py`:
     - Petakan `expires_at` (ISO-8601 string jika ada, via `as_utc`) dan `is_expired`:
       `is_expired = (as_utc(user.expires_at) <= datetime.now(timezone.utc)) if user.expires_at else False`.
5. **Automated Tests (`services/api/tests/test_admin_user_creation.py`)**:
   - Admin sukses membuat user baru → status **201**, `AdminUserItem` valid, tanpa field password, `target_user_id` di audit log benar.
   - Entitlement user baru sesuai `plan_code` dan `max_connections` dari catalog.
   - User + entitlement + audit dalam satu transaksi (simulasi: audit yang gagal → user tidak tersimpan).
   - Validasi:
     - Username tidak valid → **400**.
     - Username duplikat → **409 Conflict**.
     - Password tanpa angka → **400**.
     - Role selain "trader" → **422** (Pydantic `Literal` rejection).
     - Plan tidak terdaftar → **400**.
     - `exact_expires_at` naive datetime → **422** (validator menolak).
     - Ketiganya kosong → **400** (`"Provide duration_days, exact_expires_at, or set_lifetime"`).
   - Non-admin mencoba memanggil → **403**.
   - Extend expiry:
     - Tambah hari saat masih aktif: menambah dari `as_utc(expires_at)` lama.
     - Tambah hari saat sudah expired: menambah dari `now_utc`.
     - Set lifetime: `expires_at` menjadi `None`.
     - `exact_expires_at` di masa lalu → **400**.
     - Audit log `admin.user.expiry_updated` tercatat.
   - **Proyeksi `is_expired`**:
     - User dengan `expires_at` di masa lalu → `GET /admin/users` dan `GET /admin/users/{id}` menghasilkan `is_expired: true`.
     - User dengan `expires_at` di masa depan atau `None` → menghasilkan `is_expired: false`.

## Files to Touch
- `services/api/app/models/admin.py`
- `services/api/app/services/user_service.py`
- `services/api/app/services/admin_service.py`
- `services/api/app/api/v1/admin/users.py`
- `services/api/app/api/v1/admin/projections.py`
- `services/api/tests/test_admin_user_creation.py`

## Verification
```powershell
cd services/api
$env:ENVIRONMENT="test"; $env:SECRET_KEY="ci-secret-key-not-for-production"
../../.venv/Scripts/python.exe -m pytest tests/test_admin_user_creation.py -v
../../.venv/Scripts/python.exe -m pytest
../../.venv/Scripts/lint-imports.exe
```
Expected: Test lulus, full suite hijau, lint-imports 6 kept 0 broken.

## Depends on
- `01-user-expiry-schema-and-policy.md`

## Unblocks
- `03-admin-frontend-create-user-modal.md`
- `04-admin-frontend-user-expiry-management.md`

## Status
todo
