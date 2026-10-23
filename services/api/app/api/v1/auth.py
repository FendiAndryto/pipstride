from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.security import create_access_token, rate_limiter
from app.db.base import get_db
from app.db.models import User
from app.models.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services.user_service import user_service

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _client_ip(request: Request) -> str:
    # Trust Cloudflare / reverse-proxy forwarding headers first.
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"


def _token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(subject=user.username, token_version=user.token_version),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        username=user.username,
        role=user.role,
    )


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
async def register(req: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    rate_key = f"reg:{_client_ip(request)}"
    is_limited, retry_after = rate_limiter.is_rate_limited(rate_key)
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many registration attempts. Please try again in {retry_after} seconds.",
        )

    try:
        user = user_service.register(db, req.username, req.password, role="trader")
    except ValueError as exc:
        rate_limiter.record_failure(rate_key)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    rate_limiter.record_success(rate_key)
    return _token_response(user)


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="User login with credentials to receive JWT bearer token",
)
async def login(credentials: LoginRequest, request: Request, db: Session = Depends(get_db)):
    username = credentials.username.strip()
    rate_key = f"{_client_ip(request)}:{username.lower()}"

    is_limited, retry_after = rate_limiter.is_rate_limited(rate_key)
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Please try again in {retry_after} seconds.",
        )

    user = user_service.authenticate(db, username, credentials.password)
    if not user:
        rate_limiter.record_failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    rate_limiter.record_success(rate_key)
    return _token_response(user)


@router.post(
    "/change-password",
    status_code=status.HTTP_200_OK,
    summary="Change password for current user and revoke old sessions",
)
async def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        success = user_service.change_password(db, user, req.old_password, req.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password verification failed",
        )

    return {
        "status": "ok",
        "message": "Password changed successfully. All previous sessions have been revoked.",
    }


@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current authenticated user profile",
)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse(username=user.username, role=user.role)


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Client session logout and server-side token revocation",
)
async def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_service.increment_token_version(db, user)
    return {"status": "ok", "message": "Logged out successfully and session revoked"}
