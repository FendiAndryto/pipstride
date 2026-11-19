import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { AuditTable } from '../features/audit/AuditTable';
import { fetchAuditLogs } from '../features/audit/api';
import { auditDateBounds } from '../features/audit/auditDates';
import { RefreshCw, Filter, X } from 'lucide-react';

const PAGE_SIZE = 100;
const EMPTY_FILTERS = { action: '', user_id: '', target_user_id: '', from: '', through: '' };

export function AuditPage() {
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState({});
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [actions, setActions] = useState([]);
  const [dateError, setDateError] = useState('');

  const requestKey = JSON.stringify([applied, offset, refresh]);
  const currentResult = result?.key === requestKey ? result : null;
  const hasFilters = Object.values(applied).some(Boolean);

  useEffect(() => {
    const controller = new AbortController();
    fetchAuditLogs({ ...applied, limit: PAGE_SIZE, offset, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setActions(data.actions || []);
        setResult({ key: requestKey, data });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, error: err.message || 'Failed to load audit logs.' });
      });
    return () => controller.abort();
  }, [applied, offset, requestKey]);

  const updateDraft = (field) => (event) => {
    const value = event.target.value;
    setDraft((previous) => ({ ...previous, [field]: value }));
    if (field === 'from' || field === 'through') setDateError('');
  };

  const handleApplyFilters = (event) => {
    event.preventDefault();
    try {
      const bounds = auditDateBounds(draft.from, draft.through);
      setDateError('');
      setOffset(0);
      setApplied({
        action: draft.action,
        user_id: draft.user_id.trim(),
        target_user_id: draft.target_user_id.trim(),
        ...bounds,
      });
    } catch (error) {
      setDateError(error.message);
    }
  };

  const handleClearFilters = () => {
    setDateError('');
    setDraft(EMPTY_FILTERS);
    setOffset(0);
    setApplied({});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1>Security Audit Trail</h1>
          <div className="page-subtitle">
            Administrative actions, authentication events, and support access
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          loading={!currentResult}
          onClick={() => setRefresh((previous) => previous + 1)}
          className="btn-refresh"
          aria-label="Refresh logs"
        >
          <span className="btn-label">Refresh</span>
        </Button>
      </div>

      <Card>
        <form
          onSubmit={handleApplyFilters}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            gap: '12px',
            marginBottom: '16px',
            alignItems: 'end',
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="audit-action">Action</label>
            <select
              id="audit-action"
              className="form-input"
              value={draft.action}
              onChange={updateDraft('action')}
            >
              <option value="">All actions</option>
              {actions.map((action) => <option value={action} key={action}>{action}</option>)}
            </select>
          </div>

          <Input
            label="Related User ID"
            placeholder="UUID of actor or affected user"
            value={draft.user_id}
            onChange={updateDraft('user_id')}
            mono
          />

          <Input
            label="Target User ID"
            placeholder="UUID of affected user"
            value={draft.target_user_id}
            onChange={updateDraft('target_user_id')}
            mono
          />

          <Input label="From date (UTC)" type="date" value={draft.from} onChange={updateDraft('from')} />
          <Input label="Through date (UTC)" type="date" value={draft.through} onChange={updateDraft('through')} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <Button type="submit" variant="primary" icon={Filter}>Apply Filters</Button>
            {hasFilters || Object.values(draft).some(Boolean) ? (
              <Button type="button" variant="ghost" icon={X} onClick={handleClearFilters}>
                Clear
              </Button>
            ) : null}
          </div>
        </form>

        {dateError || currentResult?.error ? (
          <div className="alert alert-danger" role="alert" style={{ marginBottom: '16px' }}>
            {dateError || currentResult.error}
          </div>
        ) : null}

        {!currentResult?.error ? (
          <AuditTable
            logs={currentResult?.data?.items}
            total={currentResult?.data?.total}
            limit={PAGE_SIZE}
            offset={offset}
            onOffsetChange={setOffset}
            loading={!currentResult}
          />
        ) : null}
      </Card>
    </div>
  );
}
