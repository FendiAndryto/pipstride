"""Typed domain errors.

Services raise these; the HTTP boundary maps them to status codes. No module
in ``app.domain`` imports a web framework.
"""


class ConnectionLimitReached(Exception):
    """The user's plan does not allow another MT5 connection."""


class ConnectionBindingError(Exception):
    """A token is already bound to a different MT5 account."""


class RiskThresholdBreached(Exception):
    """A passive risk policy crossed its configured threshold."""
