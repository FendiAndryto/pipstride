import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { UsersTable } from '../features/users/UsersTable';
import { fetchUsers } from '../features/users/api';
import { Search, RefreshCw, X } from 'lucide-react';

export function UsersPage({ onNavigate }) {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchUsers({
        search: activeSearch,
        limit,
        offset,
      });
      setUsers(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load user accounts.');
    } finally {
      setLoading(false);
    }
  }, [activeSearch, limit, offset]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadUsers();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setOffset(0);
    setActiveSearch(search.trim());
  };

  const handleClearSearch = () => {
    setSearch('');
    setActiveSearch('');
    setOffset(0);
  };

  const handleSelectUser = (user) => {
    onNavigate('users', user.id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1>User Accounts</h1>
          <div className="page-subtitle">
            Manage trader accounts, MT5 connection allocations, and entitlement tiers
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          loading={loading}
          onClick={loadUsers}
          className="btn-refresh"
          aria-label="Refresh directory"
        >
          <span className="btn-label">Refresh</span>
        </Button>
      </div>

      <Card>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' }}>
          <form
            onSubmit={handleSearchSubmit}
            style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '240px' }}
          >
            <div style={{ flex: 1, position: 'relative' }}>
              <Input
                placeholder="Search username or user ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                mono
              />
              {search ? (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <Button type="submit" variant="primary" icon={Search}>
              Search
            </Button>
          </form>
        </div>

        {error ? (
          <div className="alert alert-danger" role="alert" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        ) : null}

        <UsersTable
          users={users}
          total={total}
          limit={limit}
          offset={offset}
          onOffsetChange={setOffset}
          onSelectUser={handleSelectUser}
          loading={loading}
        />
      </Card>
    </div>
  );
}
