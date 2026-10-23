"""Read-only journal analytics schemas."""

from typing import List, Optional

from pydantic import BaseModel, Field


class JournalTotals(BaseModel):
    trades: int = 0
    wins: int = 0
    losses: int = 0
    breakeven: int = 0
    win_rate: float = Field(0.0, description="Wins as a percentage of all trades")
    net_profit: float = 0.0
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    profit_factor: Optional[float] = Field(
        None, description="Gross profit / |gross loss|; null when there are no losses"
    )
    expectancy: float = Field(0.0, description="Average net result per trade")
    avg_win: float = 0.0
    avg_loss: float = 0.0
    payoff_ratio: Optional[float] = Field(
        None, description="Average win / |average loss|; null when there are no losses"
    )
    best_trade: float = 0.0
    worst_trade: float = 0.0
    max_win_streak: int = 0
    max_loss_streak: int = 0
    avg_hold_minutes: Optional[float] = Field(
        None, description="Mean time between open and close; null when unknown"
    )
    total_volume: float = 0.0


class JournalBucket(BaseModel):
    key: str
    trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    net_profit: float = 0.0
    profit_factor: Optional[float] = None


class JournalStatsResponse(BaseModel):
    range: str = Field(..., description="Requested window: 1M, 3M, 1Y, or ALL")
    source: str = Field(..., description="all, ea, or manual")
    start: Optional[int] = Field(None, description="Window start (unix seconds), null for ALL")
    end: int = Field(..., description="Window end (unix seconds)")
    totals: JournalTotals = Field(default_factory=JournalTotals)
    by_symbol: List[JournalBucket] = Field(default_factory=list)
    by_weekday: List[JournalBucket] = Field(default_factory=list)
    by_hour: List[JournalBucket] = Field(default_factory=list)
    by_direction: List[JournalBucket] = Field(default_factory=list)
    by_source: List[JournalBucket] = Field(default_factory=list)
    account_number: Optional[int] = None
    server: Optional[str] = None
