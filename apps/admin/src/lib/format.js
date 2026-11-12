// Re-export pure domain formatters for UI/pages through lib (ADR 0009 §2).
export {
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatNumber,
  formatCurrency,
  truncateId,
} from '../domain/format';
