"""Schemas for the internal admin surface (ADR 0008).

Every projection here is **metadata-only**. There is deliberately no field for
a raw connection token: ``token_prefix`` is the only part of a token the admin
console can ever see. Trade contents and account settings appear exclusively in
the elevated support-mode response.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class AdminUserItem(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    role: str
    is_active: bool
    created_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    plan_code: str = "free"
    max_connections: int = 1
    connection_count: int = 0
    active_connection_count: int = 0
    trade_count: int = 0
    last_trade_at: Optional[str] = None


class AdminUserListResponse(BaseModel):
    items: List[AdminUserItem]
    total: int
    limit: int
    offset: int


class AdminConnectionItem(BaseModel):
    id: str
    user_id: str
    username: Optional[str] = None
    label: str
    token_prefix: str
    status: str
    account_number: Optional[int] = None
    broker_server: Optional[str] = None
    account_currency: Optional[str] = None
    last_seen_at: Optional[str] = None
    created_at: Optional[str] = None
    revoked_at: Optional[str] = None
    trade_count: int = 0


class AdminConnectionListResponse(BaseModel):
    items: List[AdminConnectionItem]
    total: int
    limit: int
    offset: int


class AdminUserDetailResponse(AdminUserItem):
    connections: List[AdminConnectionItem] = Field(default_factory=list)


class AdminAuditItem(BaseModel):
    id: int
    user_id: Optional[str] = None
    actor_username: Optional[str] = None
    target_user_id: Optional[str] = None
    target_username: Optional[str] = None
    connection_id: Optional[str] = None
    action: str
    detail: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: Optional[str] = None


class AdminAuditListResponse(BaseModel):
    items: List[AdminAuditItem]
    total: int
    limit: int
    offset: int


class AdminMetricGroup(BaseModel):
    total: int = 0
    active: int = 0


class AdminMetricsResponse(BaseModel):
    users: dict
    connections: dict
    trades: dict
    audit_logs: dict
    support_sessions: dict


class EntitlementUpdateRequest(BaseModel):
    plan_code: str = Field(..., min_length=1, max_length=32)
    max_connections: Optional[int] = Field(None, ge=1, le=100)


class SupportSessionCreateRequest(BaseModel):
    target_user_id: str = Field(..., min_length=1, max_length=36)
    reason: str = Field(..., min_length=3, max_length=512)


class SupportSessionItem(BaseModel):
    id: str
    admin_id: str
    admin_username: Optional[str] = None
    target_user_id: str
    target_username: Optional[str] = None
    reason: str
    granted_at: Optional[str] = None
    expires_at: Optional[str] = None
    revoked_at: Optional[str] = None
    active: bool = False
    seconds_remaining: int = 0


class SupportSessionListResponse(BaseModel):
    items: List[SupportSessionItem]


class ElevatedTradeItem(BaseModel):
    id: int
    ticket: int
    symbol: str
    direction: str
    volume: float
    profit: float
    opened_at: Optional[str] = None
    closed_at: Optional[str] = None


class ElevatedAccountSettingsItem(BaseModel):
    connection_id: str
    custom_initial_deposit: Optional[float] = None
    updated_at: Optional[str] = None


class ElevatedUserDetailResponse(BaseModel):
    user_id: str
    username: str
    support_session: SupportSessionItem
    trades: List[ElevatedTradeItem] = Field(default_factory=list)
    account_settings: List[ElevatedAccountSettingsItem] = Field(default_factory=list)


class AccessLogItem(BaseModel):
    id: int
    action: str
    actor_username: Optional[str] = None
    detail: Optional[str] = None
    created_at: Optional[str] = None


class AccessLogListResponse(BaseModel):
    items: List[AccessLogItem]
