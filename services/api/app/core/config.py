from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Pipstride Journal Bridge"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"

    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    SECRET_KEY: str = "default_insecure_secret_key_change_in_production"
    ALLOWED_HOSTS: str = "*"

    CORS_ORIGINS: str = ""

    DATABASE_URL: str = "sqlite:///./data/pipstride.db"
    REDIS_URL: str = ""

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "change_this_password"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    JWT_ALGORITHM: str = "HS256"
    
    MT5_MAGIC_NUMBER: int = 778899
    BRIDGE_POLL_INTERVAL_MS: int = 500
    HEARTBEAT_TIMEOUT_SECONDS: int = 10

    # Onboarding package. PUBLIC_BASE_URL should be the public API/dashboard
    # origin (e.g. https://pipstride.app). Empty means "derive from the request",
    # which is correct for local development and single-origin deployments.
    PUBLIC_BASE_URL: str = ""
    MT5_MONITORED_SYMBOLS: str = "XAUUSD,EURUSD,GBPUSD,USDJPY,BTCUSD"
    MT5_HEARTBEAT_INTERVAL_SECONDS: int = 1
    MT5_HISTORY_DAYS: int = 90

    # Public dashboard origin used in emailed links. Falls back to
    # PUBLIC_BASE_URL and then to the inbound request origin.
    PUBLIC_APP_URL: str = ""

    # Transactional email. Without SMTP_HOST, messages are logged instead of
    # sent (development only; production logs the fact but never the link).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "Pipstride <no-reply@pipstride.local>"
    SMTP_STARTTLS: bool = True
    EMAIL_RESET_TTL_MINUTES: int = 30
    EMAIL_VERIFY_TTL_HOURS: int = 24

    # Raw telemetry snapshots are pruned by scripts/prune_snapshots.py.
    SNAPSHOT_RETENTION_DAYS: int = 180

    # Abuse protection
    RATE_LIMIT_ENABLED: bool = True
    HEARTBEAT_RATE_LIMIT: int = 120
    HEARTBEAT_RATE_WINDOW_SECONDS: int = 10
    
    # Risk Watchdog & Account Safeguard Defaults
    DEFAULT_RISK_PER_TRADE_PERCENT: float = 1.0
    MAX_RISK_PER_TRADE_PERCENT: float = 10.0
    MAX_DAILY_DRAWDOWN_PERCENT: float = 3.0
    MAX_SPREAD_POINTS: int = 35
    MIN_LOT_SIZE: float = 0.01
    MAX_LOT_SIZE: float = 100.0

    # Telegram Push Notifications
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""
    TELEGRAM_NOTIFICATIONS_ENABLED: bool = True
    
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )
    
    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() in {"production", "prod"}

    def validate_runtime(self) -> None:
        """Refuse to boot with insecure defaults outside development."""
        if not self.is_production:
            return

        problems = []
        insecure_secrets = {
            "default_insecure_secret_key_change_in_production",
            "default_secret_key_12345",
            "change-me-to-a-secure-random-32-byte-hex",
            "dev-only-secret-key-change-me-please",
        }
        if self.SECRET_KEY in insecure_secrets or len(self.SECRET_KEY) < 32:
            problems.append("SECRET_KEY is insecure or too short (need ≥32 chars)")
        if self.ADMIN_PASSWORD in {"change_this_password", "AdminPass123"} or len(self.ADMIN_PASSWORD) < 12:
            problems.append("ADMIN_PASSWORD is insecure or too short (need ≥12 chars)")
        if self.ALLOWED_HOSTS == "*":
            problems.append("ALLOWED_HOSTS must be restricted in production")
        if self.DATABASE_URL.startswith("sqlite"):
            problems.append("DATABASE_URL must point to PostgreSQL in production")

        if problems:
            raise RuntimeError(
                "Refusing to start in production with insecure configuration: "
                + "; ".join(problems)
            )

    @property
    def cors_origins(self) -> List[str]:
        origins: list[str] = []

        # Dev-only convenience origins — excluded in production.
        if not self.is_production:
            origins.extend([
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:8080",
                "http://localhost:8089",
            ])

        if self.CORS_ORIGINS:
            custom = [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
            origins.extend(custom)
            
        if self.ALLOWED_HOSTS and self.ALLOWED_HOSTS != "*":
            for host in self.ALLOWED_HOSTS.split(","):
                h = host.strip()
                if h:
                    if not h.startswith("http://") and not h.startswith("https://"):
                        origins.append(f"https://{h}")
                        if not self.is_production:
                            origins.append(f"http://{h}")
                            origins.append(f"http://{h}:5173")
                            origins.append(f"http://{h}:3000")
                    else:
                        origins.append(h)
                        
        return list(dict.fromkeys(origins))


settings = Settings()
