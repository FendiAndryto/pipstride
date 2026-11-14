# Ticket 13-05: Heartbeat Timeout Jitter Tolerance & Flapping Elimination

**Status:** done  
**Prasyarat:** 13-01, 13-02, 13-04  
**Membuka:** —  
**Spesifikasi:** [`docs/specs/007-mql5-service-cashflow-and-dynamic-market.md`](../../docs/specs/007-mql5-service-cashflow-and-dynamic-market.md)

---

## Goal
Mengeliminasi status flapping (kedap-kedip *Bridge Offline* dan *Live*) pada Web Dashboard dengan meningkatkan ambang batas `HEARTBEAT_TIMEOUT_SECONDS` dari **10 detik menjadi 25 detik** (headroom ~4× interval sensor 5s + network overhead WAN/Cloudflare), serta memastikan parameter ini dapat dikonfigurasi melalui environment variable di Docker dan Ansible.

---

## Konteks & Problem (terverifikasi 2026-11-15)

1. `services/api/app/core/config.py:50` menetapkan `HEARTBEAT_TIMEOUT_SECONDS: int = 10`.
2. MQL5 Background Service (`mt5-ea/PipstrideMonitor.mq5`) mengirim heartbeat dalam loop:
   ```mql5
   Sleep(MathMax(1, InpHeartbeatInterval) * 1000); // 5000ms
   ```
   Ditambah serialisasi payload JSON dan round-trip HTTPS melalui Cloudflare Tunnel, heartbeat tiba di server setiap **~5.5 – 6.0 detik**.
3. Dashboard Web (`apps/web/src/components/Dashboard.jsx:35`) melakukan polling `getBridgeStatus()` setiap **10 detik** (`pollInterval = 10000`).
4. Di `services/api/app/services/bridge_status_service.py`:
   ```python
   def _is_fresh(self, live: Optional[dict]) -> bool:
       return (time.time() - float(live.get("captured_at", 0))) <= settings.HEARTBEAT_TIMEOUT_SECONDS
   ```
   Dua siklus pengiriman heartbeat memakan waktu `2 × 5.6s = 11.2 detik` (> 10.0 detik).
5. Ketika terjadi sedikit saja network jitter (misal latensi internet seluler/Wi-Fi bertambah 400ms) atau polling web tiba di detik ke-10.1 sebelum heartbeat berikutnya dicatat, `_is_fresh(live)` langsung bernilai `False`:
   - `is_connected` menjadi `False`.
   - `terminal_connected` menjadi `False`.
   - `positions` menjadi `[]`.
   - Indikator web berubah menjadi merah: **Bridge Offline**.
6. Pada polling berikutnya (atau saat heartbeat baru masuk), status kembali **Live**. Flapping ini berulang terus-menerus setiap beberapa detik meskipun terminal MT5 sebenarnya berjalan normal.

---

## Scope

### 1. Backend Core Config (`services/api/app/core/config.py`)
- Ubah default `HEARTBEAT_TIMEOUT_SECONDS` dari `10` menjadi `25`:
  ```python
  HEARTBEAT_TIMEOUT_SECONDS: int = 25
  ```
  Nilai 25 detik memberikan toleransi aman (~4-5× siklus heartbeat 5s) terhadap latensi internet WAN/Cloudflare Tunnel tanpa menunda deteksi offline secara berlebihan.

### 2. Infra & Environment Configuration
- `infra/docker-compose.yml`:
  ```yaml
  - HEARTBEAT_TIMEOUT_SECONDS=${HEARTBEAT_TIMEOUT_SECONDS:-25}
  ```
- `.env.example` & `infra/.env.example`:
  ```env
  HEARTBEAT_TIMEOUT_SECONDS=25
  ```
- Ansible Task (`/home/fendian/ansible/roles/apps/tasks/projects/pipstride.yml`):
  Tambahkan variabel `HEARTBEAT_TIMEOUT_SECONDS={{ pipstride_heartbeat_timeout | default('25') }}` pada task generate `.env`.

### 3. Automated Testing (`services/api/tests/test_connections.py`)
- Tambahkan test unit `test_status_reports_offline_after_timeout` yang memvalidasi bahwa koneksi tetap `is_connected: True` dalam rentang waktu toleransi timeout, dan bertransisi ke `is_connected: False` saat ambang batas timeout terlampaui.

### 4. Deploy & Verifikasi Live
- Jalankan test suite backend `pytest` dan architecture gate `lint-imports`.
- Commit dan push ke `main`.
- Deploy via Ansible playbook (`site.yml --tags pipstride`).
- Periksa log live container `pipstride_api` di homeserver untuk memastikan status stabil dan tidak ada lagi flapping.

---

## Verification
- [x] `services/api/tests/test_connections.py` lulus test offline transition (`test_status_reports_offline_after_timeout`).
- [x] `pytest` penuh lulus (30 passed di `test_connections.py`).
- [x] `lint-imports` 6 kept, 0 broken.
- [x] Ansible playbook deploy sukses di homeserver (`ok=11, changed=...`).
- [x] `docker logs pipstride_api` di homeserver menunjukkan telemetri stabil tanpa status drop (`HEARTBEAT_TIMEOUT_SECONDS=25` aktif).
