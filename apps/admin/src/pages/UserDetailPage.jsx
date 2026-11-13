import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { UserConnectionsTable } from '../features/users/UserConnectionsTable';
import { UserEntitlementModal } from '../features/users/UserEntitlementModal';
import { UserExtendExpiryModal } from '../features/users/UserExtendExpiryModal';
import { UserActionConfirmModal } from '../features/users/UserActionConfirmModal';
import { ElevatedDetailPanel } from '../features/support/ElevatedDetailPanel';
import { SupportGrantModal } from '../features/support/SupportGrantModal';
import {
  fetchUser,
  activateUser,
  deactivateUser,
  revokeConnection,
} from '../features/users/api';
import {
  formatDateTime,
  formatRelativeTime,
  formatNumber,
  formatExpiryStatus,
} from '../lib/format';
import {
  ArrowLeft,
  RefreshCw,
  Sliders,
  UserX,
  UserCheck,
  LifeBuoy,
  Clock,
} from 'lucide-react';

export function UserDetailPage({
  userId,
  canMutate = false,
  onNavigate,
  activeSupportSession,
  onSessionGranted,
}) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Modals state
  const [entitlementOpen, setEntitlementOpen] = useState(false);
  const [extendExpiryOpen, setExtendExpiryOpen] = useState(false);
  const [supportGrantOpen, setSupportGrantOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    danger: true,
    action: null,
  });

  const loadUser = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchUser(userId);
      setUser(data);
    } catch (err) {
      setError(err.message || 'Failed to load user detail.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadUser();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadUser]);

  const notifySuccess = (msg) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(''), 4000);
  };

  const handleToggleActive = () => {
    if (!user) return;
    const isDeactivating = user.is_active;
    setConfirmModal({
      isOpen: true,
      title: isDeactivating ? `Deactivate User: ${user.username}` : `Activate User: ${user.username}`,
      message: isDeactivating
        ? 'Deactivating this user will revoke current API sessions and suspend bridge connectivity immediately.'
        : 'Reactivating this user will allow new logins and bridge connections.',
      confirmLabel: isDeactivating ? 'Deactivate Account' : 'Activate Account',
      danger: isDeactivating,
      action: async () => {
        if (isDeactivating) {
          await deactivateUser(user.id);
          notifySuccess(`User ${user.username} deactivated.`);
        } else {
          await activateUser(user.id);
          notifySuccess(`User ${user.username} activated.`);
        }
        await loadUser();
      },
    });
  };

  const handleRevokeConnectionPrompt = (connection) => {
    setConfirmModal({
      isOpen: true,
      title: `Revoke MT5 Connection: ${connection.label}`,
      message: `Are you sure you want to revoke connection token for account ${connection.account_number || connection.label}? The user will need to generate a new token to resume telemetry.`,
      confirmLabel: 'Revoke Token Immediately',
      danger: true,
      action: async () => {
        await revokeConnection(connection.id);
        notifySuccess(`Connection ${connection.label} revoked.`);
        await loadUser();
      },
    });
  };

  const handleConfirmExecute = async () => {
    if (!confirmModal.action) return;
    setLoading(true);
    try {
      await confirmModal.action();
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
    } catch (err) {
      setError(err.message || 'Operation failed.');
    } finally {
      setLoading(false);
    }
  };

  const isCurrentSessionTarget =
    activeSupportSession?.active && activeSupportSession?.target_user_id === userId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', minWidth: 0 }}>
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            onClick={() => onNavigate('users')}
          >
            Back to Users
          </Button>
          <div style={{ minWidth: 0 }}>
            <h1>{user?.username || 'User Detail'}</h1>
            <div className="page-subtitle font-mono" style={{ overflowWrap: 'anywhere' }}>
              ID: {user?.id}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={loading}
            onClick={loadUser}
          >
            Refresh
          </Button>

          {user ? (
            <>
              {canMutate ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Clock}
                    onClick={() => setExtendExpiryOpen(true)}
                  >
                    Edit Masa Aktif
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Sliders}
                    onClick={() => setEntitlementOpen(true)}
                  >
                    Edit Entitlement
                  </Button>

                  <Button
                    variant={user.is_active ? 'danger' : 'secondary'}
                    size="sm"
                    icon={user.is_active ? UserX : UserCheck}
                    onClick={handleToggleActive}
                  >
                    {user.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </>
              ) : null}

              {!isCurrentSessionTarget ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={LifeBuoy}
                  onClick={() => setSupportGrantOpen(true)}
                >
                  Open Support Session
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {actionSuccess ? (
        <div className="alert alert-info" role="status">
          {actionSuccess}
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      ) : null}

      {/* Account Metadata Card */}
      {user ? (
        <Card title="Account Metadata" subtitle="User state and billing entitlement">
          <div className="metadata-grid">
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ROLE</div>
              <div style={{ marginTop: '4px' }}>
                <Badge variant={user.role === 'admin' ? 'danger' : user.role === 'support' ? 'warning' : 'neutral'}>
                  {user.role}
                </Badge>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ACCOUNT STATUS</div>
              <div style={{ marginTop: '4px' }}>
                <Badge variant={user.is_active ? 'success' : 'neutral'}>
                  {user.is_active ? 'Active' : 'Deactivated'}
                </Badge>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>MASA AKTIF</div>
              <div style={{ marginTop: '4px' }}>
                {(() => {
                  const status = formatExpiryStatus(user.expires_at, user.is_active, user.is_expired);
                  return <Badge variant={status.variant}>{status.label}</Badge>;
                })()}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>KEDALUWARSA (EXPIRES AT)</div>
              <div className="font-mono" style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-secondary)' }}>
                {user.expires_at ? formatDateTime(user.expires_at) : 'Permanen (Lifetime)'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>PLAN TIER</div>
              <div style={{ marginTop: '4px' }}>
                <Badge variant={user.plan_code === 'pro' ? 'purple' : user.plan_code === 'plus' ? 'info' : 'neutral'}>
                  {user.plan_code?.toUpperCase() || 'FREE'}
                </Badge>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>MAX CONNECTIONS</div>
              <div className="font-mono" style={{ fontSize: '15px', fontWeight: 600, marginTop: '2px' }}>
                {user.connection_count || 0} used / {user.max_connections} allowed
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>RECORDED TRADES</div>
              <div className="font-mono" style={{ fontSize: '15px', fontWeight: 600, marginTop: '2px' }}>
                {formatNumber(user.trade_count)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>EMAIL</div>
              <div style={{ fontSize: '13px', marginTop: '2px' }}>
                {user.email || 'None registered'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>REGISTERED</div>
              <div className="font-mono" style={{ fontSize: '12px', marginTop: '2px', color: 'var(--text-secondary)' }}>
                {formatDateTime(user.created_at)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>LAST SEEN</div>
              <div style={{ fontSize: '12px', marginTop: '2px', color: 'var(--text-secondary)' }}>
                {formatRelativeTime(user.last_seen_at)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>LAST TRADE ACTIVITY</div>
              <div style={{ fontSize: '12px', marginTop: '2px', color: 'var(--text-secondary)' }}>
                {formatRelativeTime(user.last_trade_at)}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Elevated Financial Detail (Protected by ADR 0008 Support Mode) */}
      <ElevatedDetailPanel
        userId={userId}
        isActiveSession={Boolean(isCurrentSessionTarget)}
      />

      {/* Connected MT5 Terminals Card */}
      <Card
        title="MT5 Bridge Connections"
        subtitle="Monitored terminals (token credentials are safe & redacted)"
        badge={<Badge variant="neutral">{user?.connections?.length || 0}</Badge>}
      >
        <UserConnectionsTable
          connections={user?.connections || []}
          canRevoke={canMutate}
          onRevokeConnection={handleRevokeConnectionPrompt}
          loading={loading}
        />
      </Card>

      {/* Modals */}
      {extendExpiryOpen && user ? (
        <UserExtendExpiryModal
          isOpen={extendExpiryOpen}
          onClose={() => setExtendExpiryOpen(false)}
          user={user}
          onSuccess={(updated) => {
            setUser((prev) => ({ ...prev, ...updated }));
            notifySuccess('Masa aktif pengguna berhasil diperbarui.');
          }}
        />
      ) : null}

      {entitlementOpen && user ? (
        <UserEntitlementModal
          isOpen={entitlementOpen}
          onClose={() => setEntitlementOpen(false)}
          user={user}
          onSuccess={(updated) => {
            setUser((prev) => ({ ...prev, ...updated }));
            notifySuccess('Entitlement limits updated.');
          }}
        />
      ) : null}

      {confirmModal.isOpen ? (
        <UserActionConfirmModal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          loading={loading}
          onConfirm={handleConfirmExecute}
        />
      ) : null}

      {supportGrantOpen && user ? (
        <SupportGrantModal
          isOpen={supportGrantOpen}
          onClose={() => setSupportGrantOpen(false)}
          targetUser={user}
          onSuccess={(newSession) => {
            onSessionGranted(newSession);
            notifySuccess(`Elevated support session granted for ${user.username}.`);
          }}
        />
      ) : null}
    </div>
  );
}
