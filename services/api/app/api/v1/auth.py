from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.rate_limit import consume, get_client_ip, rate_limiter
from app.core.security import create_access_token
from app.core.tokens import hash_token
from app.db.base import get_db
from app.db.models import User
from app.domain.time import as_utc
from app.models.auth import (
    ChangePasswordRequest,
    EmailStatusResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SetEmailRequest,
    TokenResponse,
    TotpEnrollStartRequest,
    TotpEnrollStartResponse,
    TotpEnrollVerifyRequest,
    TotpEnrollVerifyResponse,
    UserResponse,
    VerifyEmailRequest,
)
from app.services.auth_token_service import (
    PURPOSE_RESET,
    PURPOSE_VERIFY,
    auth_token_service,
)
from app.services.email_service import email_service
from app.services.totp_service import requires_totp, totp_service
from app.services.user_service import user_service, validate_password_complexity

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _client_ip(request: Request) -> str:
    return get_client_ip(request)


def _app_base(request: Request) -> str:
    """Public dashboard origin used to build links inside emails."""
    configured = (settings.PUBLIC_APP_URL or settings.PUBLIC_BASE_URL or "").strip().rstrip("/")
    return configured or str(request.base_url).rstrip("/")


def _token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(subject=user.username, token_version=user.token_version),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        username=user.username,
        role=user.role,
        totp_enrolled=totp_service.is_enrolled(user),
    )


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        username=user.username,
        role=user.role,
        email=user.email,
        email_verified=user.email_verified_at is not None,
        totp_enrolled=totp_service.is_enrolled(user),
    )


def _send_verification_email(request: Request, background: BackgroundTasks, user: User, db: Session) -> None:
    if not user.email:
        return
    raw = auth_token_service.issue(
        db, user, PURPOSE_VERIFY, timedelta(hours=settings.EMAIL_VERIFY_TTL_HOURS)
    )
    link = f"{_app_base(request)}/?verify_email={raw}"
    background.add_task(
        email_service.send_email_verification,
        user.email,
        link,
        settings.EMAIL_VERIFY_TTL_HOURS,
    )


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
def register(
    req: RegisterRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    rate_key = f"reg:{_client_ip(request)}"
    is_limited, retry_after = rate_limiter.is_rate_limited(rate_key)
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many registration attempts. Please try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    try:
        user = user_service.register(
            db, req.username, req.password, role="trader", email=req.email
        )
    except ValueError as exc:
        rate_limiter.record_failure(rate_key)
        duplicate = "already registered" in str(exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT if duplicate else status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    rate_limiter.record_success(rate_key)
    _send_verification_email(request, background, user, db)
    return _token_response(user)


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="User login with credentials to receive JWT bearer token",
)
def login(credentials: LoginRequest, request: Request, db: Session = Depends(get_db)):
    username = credentials.username.strip()
    rate_key = f"{_client_ip(request)}:{username.lower()}"

    is_limited, retry_after = rate_limiter.is_rate_limited(rate_key)
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Please try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    user = user_service.authenticate(db, username, credentials.password)
    if not user:
        rate_limiter.record_failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Privileged accounts must present a verified TOTP code (ADR 0008 §5). A
    # pending enrollment does not unlock login; the enrollment endpoints accept
    # the password instead, so a locked-out admin can still pair a device.
    if requires_totp(user):
        if not totp_service.is_enrolled(user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Two-factor enrollment required before signing in.",
            )
        if not totp_service.verify_code(user, credentials.totp_code):
            rate_limiter.record_failure(rate_key)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing two-factor code",
                headers={"WWW-Authenticate": "Bearer"},
            )

    rate_limiter.record_success(rate_key)
    return _token_response(user)


def _enrollment_user(db: Session, username: str, password: str) -> User:
    """Password-only authentication for TOTP enrollment.

    An admin without a paired device cannot obtain a session (login is gated),
    so the enrollment flow re-authenticates with the password instead. It never
    applies to trader accounts: TOTP is mandatory only for admin/support.
    """
    user = user_service.authenticate(db, (username or "").strip(), password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not requires_totp(user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account does not require two-factor authentication.",
        )
    return user


@router.post(
    "/totp/enroll/start",
    response_model=TotpEnrollStartResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a TOTP seed for an admin/support account (shown once)",
)
def totp_enroll_start(
    req: TotpEnrollStartRequest, request: Request, db: Session = Depends(get_db)
):
    limited, retry_after = consume(
        f"totp-start:{_client_ip(request)}", limit=10, window_seconds=900
    )
    if limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many enrollment attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    user = _enrollment_user(db, req.username, req.password)
    try:
        secret, uri = totp_service.start_enrollment(db, user)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        )

    return TotpEnrollStartResponse(
        secret=secret, otpauth_uri=uri, issuer=settings.TOTP_ISSUER
    )


@router.post(
    "/totp/enroll/verify",
    response_model=TotpEnrollVerifyResponse,
    status_code=status.HTTP_200_OK,
    summary="Confirm a TOTP code and activate two-factor for the account",
)
def totp_enroll_verify(
    req: TotpEnrollVerifyRequest, request: Request, db: Session = Depends(get_db)
):
    limited, retry_after = consume(
        f"totp-verify:{_client_ip(request)}:{req.username.strip().lower()}",
        limit=10,
        window_seconds=900,
    )
    if limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    user = _enrollment_user(db, req.username, req.password)
    if not totp_service.verify_enrollment(db, user, req.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is not valid. Check the device clock and try again.",
        )

    return TotpEnrollVerifyResponse(
        status="ok",
        enrolled_at=(
            as_utc(user.totp_enrolled_at).isoformat()
            if user.totp_enrolled_at is not None
            else None
        ),
        message="Two-factor authentication is now active.",
    )


@router.post(
    "/forgot-password",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Request a password reset link (response never reveals whether the email exists)",
)
def forgot_password(
    req: ForgotPasswordRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    is_limited, retry_after = consume(f"forgot:{_client_ip(request)}", limit=5, window_seconds=900)
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many reset requests. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    generic = {
        "status": "ok",
        "message": "If that email is registered, a reset link has been sent.",
    }

    try:
        user = user_service.get_user_by_email(db, req.email) if req.email.strip() else None
    except ValueError:
        user = None
    if user is None or not user.email or not user.is_active:
        return generic

    # Protect the recipient's inbox from repeated requests for the same address.
    email_limited, _ = consume(f"forgot-email:{hash_token(user.email)}", limit=3, window_seconds=3600)
    if email_limited:
        return generic

    raw = auth_token_service.issue(
        db, user, PURPOSE_RESET, timedelta(minutes=settings.EMAIL_RESET_TTL_MINUTES)
    )
    link = f"{_app_base(request)}/?reset_token={raw}"
    background.add_task(
        email_service.send_password_reset,
        user.email,
        link,
        settings.EMAIL_RESET_TTL_MINUTES,
    )
    return generic


@router.post(
    "/reset-password",
    status_code=status.HTTP_200_OK,
    summary="Set a new password using a single-use reset token",
)
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    # Validate before consuming so a weak password does not burn the link.
    try:
        validate_password_complexity(req.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    user = auth_token_service.consume(db, req.token, PURPOSE_RESET)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link is invalid or has expired.",
        )

    user_service.reset_password(db, user, req.new_password)
    return {
        "status": "ok",
        "message": "Password updated. Sign in with your new password; all old sessions were revoked.",
    }


@router.post(
    "/verify-email",
    response_model=EmailStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Confirm an email address using a single-use verification token",
)
def verify_email(req: VerifyEmailRequest, db: Session = Depends(get_db)):
    user = auth_token_service.consume(db, req.token, PURPOSE_VERIFY)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This verification link is invalid or has expired.",
        )

    if user.email_verified_at is None:
        user_service.mark_email_verified(db, user)
    # Nothing to persist: consume() already burned the token inside its own
    # unit of work, and the address is already verified. No route-level commit.

    return EmailStatusResponse(
        email=user.email,
        email_verified=True,
        message="Email verified.",
    )


@router.post(
    "/email",
    response_model=EmailStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Attach or change the account email; sends a verification link",
)
def set_email(
    req: SetEmailRequest,
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        user = user_service.set_email(db, user, req.email)
    except ValueError as exc:
        duplicate = "already registered" in str(exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT if duplicate else status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    _send_verification_email(request, background, user, db)
    return EmailStatusResponse(
        email=user.email,
        email_verified=False,
        message="Verification link sent. Check your inbox to confirm the address.",
    )


@router.post(
    "/change-password",
    status_code=status.HTTP_200_OK,
    summary="Change password for current user and revoke old sessions",
)
def change_password(
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
def get_me(user: User = Depends(get_current_user)):
    return _user_response(user)


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Client session logout and server-side token revocation",
)
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_service.increment_token_version(db, user)
    return {"status": "ok", "message": "Logged out successfully and session revoked"}
