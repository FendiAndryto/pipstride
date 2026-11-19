import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { UsersTable } from '../features/users/UsersTable';
import { UserCreateModal } from '../features/users/UserCreateModal';
import { UserCredentialsModal } from '../features/users/UserCredentialsModal';
import { fetchUsers } from '../features/users/api';
import { Search, RefreshCw, X, UserPlus } from 'lucide-react';

export function UsersPage({ canMutate, initialStatus = '' }) {
  const limit = 50;
  const [search, setSearch] = useState('');
  const searchInput = useRef(null);
  const [query, setQuery] = useState({ search: '', status: initialStatus, offset: 0 });
  const [result, setResult] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false);
  const [newCredentials, setNewCredentials] = useState(null);
  const loading = result?.query !== query;
  const error = loading ? '' : result.error;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    fetchUsers({ ...query, limit, signal })
      .then((data) => {
        if (!signal.aborted) setResult({ query, ...data });
      })
      .catch((err) => {
        if (!signal.aborted) setResult({ query, error: err.message || 'Failed to load user accounts.' });
      });

    return () => controller.abort();
  }, [query]);

  const refreshUsers = () => setQuery((current) => ({ ...current }));

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setQuery((current) => ({ ...current, search: search.trim(), offset: 0 }));
  };

  const handleClearSearch = () => {
    searchInput.current?.focus();
    setSearch('');
    setQuery((current) => ({ ...current, search: '', offset: 0 }));
  };

  const handleCreateSuccess = (_createdUser, creds) => {
    setNewCredentials(creds);
    setCredentialsModalOpen(true);
    refreshUsers();
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

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {canMutate ? (
            <Button
              variant="primary"
              size="sm"
              icon={UserPlus}
              onClick={() => setCreateModalOpen(true)}
            >
              Tambah Pengguna
            </Button>
          ) : null}

          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={loading}
            onClick={refreshUsers}
            className="btn-refresh"
            aria-label="Refresh directory"
          >
            <span className="btn-label">Refresh</span>
          </Button>
        </div>
      </div>

      <Card>
        <div className="users-filters">
          <form className="users-search" onSubmit={handleSearchSubmit}>
            <div className="users-search-field">
              <Input
                ref={searchInput}
                label="Username or user ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                mono
              />
              {search ? (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="users-search-clear"
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
          <div className="form-group">
            <label className="form-label" htmlFor="users-status">Status</label>
            <select
              id="users-status"
              className="form-input"
              value={query.status}
              onChange={(e) => {
                const status = e.target.value;
                setQuery((current) => ({ ...current, status, offset: 0 }));
              }}
            >
              <option value="">All users</option>
              <option value="expiring">Expiring soon</option>
              <option value="pending_connection">Pending connection</option>
            </select>
          </div>
        </div>

        {error ? (
          <div className="alert alert-danger" role="alert" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        ) : null}

        <UsersTable
          users={loading ? undefined : result.items}
          total={result?.total}
          limit={limit}
          offset={query.offset}
          onOffsetChange={(offset) => setQuery((current) => ({ ...current, offset }))}
          loading={loading}
        />
      </Card>

      {canMutate ? (
        <>
          <UserCreateModal
            isOpen={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            onSuccess={handleCreateSuccess}
          />

          <UserCredentialsModal
            isOpen={credentialsModalOpen}
            onClose={() => {
              setCredentialsModalOpen(false);
              setNewCredentials(null);
            }}
            credentials={newCredentials}
          />
        </>
      ) : null}
    </div>
  );
}
