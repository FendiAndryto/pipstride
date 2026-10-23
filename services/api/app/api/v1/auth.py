from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.core.config import settings
from app.core.security import create_access_token, rate_limiter
from app.core.deps import get_current_user
from app.models.auth import (
    LoginRequest,
    RegisterRequest,
    ChangePasswordRequest,
    TokenResponse,
    UserResponse,
    BridgeTokenResponse
)
from app.services.user_service import user_service

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account"
)
async def register(req: RegisterRequest, request: Request):
    client_ip = request.client.host if request.client else "127.0.0.1"
    rate_key = f"reg:{client_ip}"
    is_limited, retry_after = rate_limiter.is_rate_limited(rate_key)
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many registration attempts. Please try again in {retry_after} seconds."
        )

    try:
        new_user = user_service.register(
            username=req.username,
            plain_password=req.password,
            role="trader"
        )
    except ValueError as e:
        rate_limiter.record_failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    rate_limiter.record_success(rate_key)
    token = create_access_token(
        subject=new_user["username"],
        token_version=new_user.get("token_version", 1)
    )
    expires_in_seconds = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in_seconds,
        username=new_user["username"],
        role=new_user.get("role", "trader"),
        bridge_token=new_user.get("bridge_token")
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="User login with credentials to receive JWT bearer token"
)
async def login(credentials: LoginRequest, request: Request):
    username = credentials.username.strip()
    client_ip = request.client.host if request.client else "127.0.0.1"
    rate_key = f"{client_ip}:{username.lower()}"

    # Rate limiting check
    is_limited, retry_after = rate_limiter.is_rate_limited(rate_key)
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Please try again in {retry_after} seconds."
        )

    user = user_service.authenticate(username, credentials.password)

    if not user:
        rate_limiter.record_failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Clear rate limit failures on success
    rate_limiter.record_success(rate_key)

    token = create_access_token(
        subject=user["username"],
        token_version=user.get("token_version", 1)
    )
    expires_in_seconds = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in_seconds,
        username=user["username"],
        role=user.get("role", "trader"),
        bridge_token=user.get("bridge_token")
    )


@router.post(
    "/change-password",
    status_code=status.HTTP_200_OK,
    summary="Change password for current logged-in user and revoke old sessions"
)
async def change_password(
    req: ChangePasswordRequest,
    current_user: str = Depends(get_current_user)
):
    try:
        success = user_service.change_password(
            username=current_user,
            old_password=req.old_password,
            new_password=req.new_password
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password verification failed"
        )

    return {
        "status": "ok",
        "message": "Password changed successfully. All previous sessions have been revoked."
    }


@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current authenticated user profile"
)
async def get_me(current_user: str = Depends(get_current_user)):
    user_record = user_service.get_user(current_user)
    if not user_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User record not found"
        )

    return UserResponse(
        username=user_record["username"],
        is_authenticated=True,
        role=user_record.get("role", "trader"),
        bridge_token=user_record.get("bridge_token")
    )


@router.get(
    "/bridge-token",
    response_model=BridgeTokenResponse,
    status_code=status.HTTP_200_OK,
    summary="Get the bridge authentication token for the current user"
)
async def get_bridge_token(current_user: str = Depends(get_current_user)):
    user_record = user_service.get_user(current_user)
    if not user_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User record not found"
        )

    return BridgeTokenResponse(
        username=user_record["username"],
        bridge_token=user_record["bridge_token"]
    )


@router.post(
    "/bridge-token/regenerate",
    response_model=BridgeTokenResponse,
    status_code=status.HTTP_200_OK,
    summary="Regenerate a new bridge authentication token for the current user"
)
async def regenerate_bridge_token(current_user: str = Depends(get_current_user)):
    try:
        new_token = user_service.regenerate_bridge_token(current_user)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    return BridgeTokenResponse(
        username=current_user,
        bridge_token=new_token
    )


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Client session logout and server-side token revocation"
)
async def logout(current_user: str = Depends(get_current_user)):
    user_service.increment_token_version(current_user)
    return {
        "status": "ok",
        "message": "Logged out successfully and session revoked"
    }
