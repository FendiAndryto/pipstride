// Re-export pure domain support session helpers for UI/pages through lib (ADR 0009 §2).
export {
  calculateRemainingSeconds,
  formatCountdown,
  isSessionActive,
  isSessionExpiringSoon,
} from '../domain/supportSession';
