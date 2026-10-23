from typing import Optional
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., description="Username", min_length=1)
    password: str = Field(..., description="Password", min_length=1)


class RegisterRequest(BaseModel):
    username: str = Field(..., description="Desired username", min_length=3, max_length=50)
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
    bridge_token: Optional[str] = None


class UserResponse(BaseModel):
    username: str
    is_authenticated: bool = True
    role: Optional[str] = "trader"
    bridge_token: Optional[str] = None


class BridgeTokenResponse(BaseModel):
    username: str
    bridge_token: str
    status: str = "ok"
