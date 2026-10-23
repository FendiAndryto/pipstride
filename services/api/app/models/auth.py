from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., description="Username", min_length=1)
    password: str = Field(..., description="Password", min_length=1)


class RegisterRequest(BaseModel):
    username: str = Field(..., description="Desired username", min_length=3, max_length=32)
    password: str = Field(..., description="Account password (min 8 chars, alphanumeric)", min_length=8)
    role: Optional[str] = Field("trader", description="User role (admin or trader)")


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., description="Current password")
    new_password: str = Field(..., description="New password (min 8 chars, alphanumeric)", min_length=8)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    username: Optional[str] = None
    role: Optional[str] = "trader"


class UserResponse(BaseModel):
    username: str
    is_authenticated: bool = True
    role: Optional[str] = "trader"


class ConnectionResponse(BaseModel):
    """Safe projection of a connection. Raw tokens are never returned here."""

    id: str
    label: str
    token_prefix: str
    status: str
    account_number: Optional[int] = None
    broker_server: Optional[str] = None
    account_currency: Optional[str] = None
    last_seen_at: Optional[str] = None
    created_at: str


class PresetFileResponse(BaseModel):
    """Ready-to-import MT5 preset. Contains the raw token, so it is returned once."""

    filename: str
    content: str
    backend_url: str


class ConnectionCreatedResponse(ConnectionResponse):
    """Returned exactly once, at creation or rotation time."""

    token: str
    preset: Optional[PresetFileResponse] = None
