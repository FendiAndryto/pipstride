"""Symmetric encryption for secrets that must be recoverable at rest.

Only TOTP seeds use this today. Unlike passwords and bridge tokens (which are
one-way hashes), a TOTP seed must be decrypted on every login to derive the
expected code, so it is encrypted with a key derived from configuration.

The key material is ``TOTP_ENCRYPTION_KEY`` when set, otherwise ``SECRET_KEY``.
Deriving through SHA-256 means any sufficiently long passphrase is usable;
operators are not forced to generate a raw fernet key.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _fernet() -> Fernet:
    material = (settings.TOTP_ENCRYPTION_KEY or "").strip() or settings.SECRET_KEY
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a stored secret; raises ``ValueError`` when it is unreadable.

    A wrong key (for example after rotating ``SECRET_KEY`` without setting
    ``TOTP_ENCRYPTION_KEY``) must surface as a re-enrollment path, not a 500.
    """
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise ValueError("Stored TOTP secret cannot be decrypted") from exc
