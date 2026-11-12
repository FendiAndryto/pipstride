import React, { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { updateEntitlement } from './api';
import { AlertCircle, Sliders } from 'lucide-react';

export function UserEntitlementModal({
  isOpen,
  onClose,
  user,
  onSuccess,
}) {
  const [planCode, setPlanCode] = useState(user?.plan_code || 'free');
  const [maxConnections, setMaxConnections] = useState(String(user?.max_connections || 1));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!planCode.trim()) {
      setError('Plan code is required.');
      return;
    }
    const maxConnsNum = parseInt(maxConnections, 10);
    if (Number.isNaN(maxConnsNum) || maxConnsNum < 1 || maxConnsNum > 100) {
      setError('Max connections must be between 1 and 100.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const updated = await updateEntitlement(user.id, {
        plan_code: planCode.trim().toLowerCase(),
        max_connections: maxConnsNum,
      });
      onSuccess(updated);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update user entitlement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Update Entitlement: ${user?.username}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            icon={Sliders}
          >
            Save Changes
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error ? (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="form-group">
          <label className="form-label" htmlFor="plan-select">Plan Tier</label>
          <select
            id="plan-select"
            className="form-input"
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
          >
            <option value="free">FREE — 1 Connection default</option>
            <option value="core">CORE — 1 Connection default</option>
            <option value="plus">PLUS — 3 Connections default</option>
            <option value="pro">PRO — 5 Connections default</option>
          </select>
        </div>

        <Input
          label="Max Connections Override"
          type="number"
          min="1"
          max="100"
          value={maxConnections}
          onChange={(e) => setMaxConnections(e.target.value)}
          mono
          helperText="Direct connection limit ceiling for this user (1–100)"
          required
        />
      </form>
    </Modal>
  );
}
