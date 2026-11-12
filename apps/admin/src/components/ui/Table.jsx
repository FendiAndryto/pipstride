import React from 'react';
import { Loader2 } from 'lucide-react';

export function Table({
  columns = [],
  data = [],
  keyExtractor,
  onRowClick,
  loading = false,
  emptyText = 'No records found',
}) {
  return (
    <div className="table-container">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((col, idx) => (
              <th
                key={col.key || idx}
                style={col.width ? { width: col.width } : undefined}
                className={col.headerClassName || ''}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{ textAlign: 'center', padding: '36px 14px' }}
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Loading telemetry data...</span>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{ textAlign: 'center', padding: '36px 14px', color: 'var(--text-muted)' }}
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((item, index) => {
              const rowKey = keyExtractor ? keyExtractor(item, index) : item.id || index;
              const isClickable = Boolean(onRowClick);

              return (
                <tr
                  key={rowKey}
                  className={isClickable ? 'clickable' : ''}
                  onClick={isClickable ? () => onRowClick(item) : undefined}
                >
                  {columns.map((col, cIdx) => (
                    <td key={col.key || cIdx} className={col.className || ''}>
                      {col.render ? col.render(item, index) : item[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
