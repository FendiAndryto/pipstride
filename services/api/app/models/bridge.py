from typing import Optional, List, Any
from pydantic import BaseModel, Field


class PositionItem(BaseModel):
    ticket: int = Field(..., description="MT5 Position Ticket ID")
    symbol: str = Field(..., description="Trading Instrument Symbol (e.g. EURUSD)")
    type: str = Field(..., description="Position Type: BUY or SELL")
    volume: float = Field(..., ge=0, description="Position Lot Size")
    open_price: float = Field(..., description="Order Open Price")
    current_price: float = Field(0.0, description="Current Market Price")
    sl: float = Field(0.0, description="Stop Loss Price")
    tp: float = Field(0.0, description="Take Profit Price")
    pnl: float = Field(0.0, description="Floating Profit and Loss")
    profit: Optional[float] = Field(None, description="Floating Profit and Loss alias")
    open_time: int = Field(0, description="Unix timestamp when order was opened")
    magic: int = Field(0, description="Expert Advisor Magic Number")

    def model_post_init(self, __context: Any) -> None:
        if self.profit is None:
            self.profit = self.pnl
        elif self.pnl == 0.0 and self.profit != 0.0:
            self.pnl = self.profit


class MarketQuoteItem(BaseModel):
    symbol: str = Field(..., description="Instrument symbol (e.g. XAUUSD, EURUSD)")
    bid: float = Field(0.0, description="Current bid price")
    ask: float = Field(0.0, description="Current ask price")
    spread: int = Field(0, description="Current spread in points")
    digits: int = Field(5, description="Instrument decimal digits")
    daily_change_pct: float = Field(0.0, description="24h or daily percentage change")
    high: float = Field(0.0, description="Daily high price")
    low: float = Field(0.0, description="Daily low price")


class ClosedTradeItem(BaseModel):
    ticket: int = Field(..., description="MT5 Deal or Position Ticket ID")
    symbol: str = Field(..., description="Trading Instrument Symbol")
    type: str = Field(..., description="Order Direction: BUY or SELL")
    volume: float = Field(..., ge=0, description="Closed Lot Size")
    open_price: float = Field(..., description="Entry Open Price")
    close_price: float = Field(..., description="Close Exit Price")
    profit: float = Field(..., description="Realized Net Profit / Loss")
    open_time: int = Field(0, description="Unix timestamp when trade opened")
    close_time: int = Field(0, description="Unix timestamp when trade closed")
    magic: int = Field(0, description="Magic number (0=Manual, >0=EA)")


class TradeHistoryResponse(BaseModel):
    trades: List[ClosedTradeItem] = Field(default_factory=list, description="List of closed deals")
    net_pnl: float = Field(0.0, description="Total realized net profit/loss")
    win_rate: float = Field(0.0, description="Win rate percentage (0-100%)")
    profit_factor: float = Field(0.0, description="Gross profit divided by gross loss")
    total_trades: int = Field(0, description="Total closed trades count")
    winning_trades: int = Field(0, description="Winning trades count")
    losing_trades: int = Field(0, description="Losing trades count")
    gross_profit: float = Field(0.0, description="Sum of positive trades")
    gross_loss: float = Field(0.0, description="Sum of negative trades")
    account_number: Optional[int] = Field(None, description="Active MT5 Account Login Number")
    server: Optional[str] = Field(None, description="Active Broker Server Name")


class EquityPointItem(BaseModel):
    timestamp: int
    equity: float
    balance: float


class EquityCurveResponse(BaseModel):
    starting_equity: float = 0.0
    initial_deposit: Optional[float] = None
    current_equity: float = 0.0
    peak_equity: float = 0.0
    all_time_pnl: Optional[float] = None
    roi_percent: Optional[float] = None
    account_number: Optional[int] = None
    server: Optional[str] = None
    points: List[EquityPointItem] = Field(default_factory=list)


class HeartbeatPayload(BaseModel):
    account_number: int = Field(..., description="MT5 Account Login Number")
    server: str = Field(..., description="Broker Server Name")
    currency: str = Field("USD", description="Account Base Currency")
    balance: float = Field(..., ge=0, description="Current Account Balance")
    equity: float = Field(..., ge=0, description="Current Account Equity")
    initial_deposit: Optional[float] = Field(None, ge=0, description="Initial funding deposit from MT5 deal history")
    margin: float = Field(0.0, ge=0, description="Current Margin")
    free_margin: float = Field(0.0, ge=0, description="Current Free Margin")
    margin_level: float = Field(0.0, ge=0, description="Current Margin Level Percentage")
    floating_pnl: float = Field(0.0, description="Current Floating Profit and Loss")
    terminal_connected: bool = Field(True, description="Whether MT5 terminal is connected to broker")
    open_positions: int = Field(0, ge=0, description="Total active open positions")
    positions: List[PositionItem] = Field(default_factory=list, max_length=200, description="Active open positions list")
    market_quotes: List[MarketQuoteItem] = Field(default_factory=list, max_length=100, description="Live quotes for monitored symbols")
    closed_trades: List[ClosedTradeItem] = Field(default_factory=list, max_length=2000, description="Recent closed trades from MT5 history")
    candles: List[Any] = Field(default_factory=list, max_length=500, description="Recent M15 candles for trend bias")
    candles_m5: List[Any] = Field(default_factory=list, max_length=500, description="Recent M5 candles for scalping trigger")
    chart_symbol: Optional[str] = Field(None, description="Current symbol on active MT5 chart")
    bridge_token: Optional[str] = Field(None, description="Pipstride User Bridge Token")
    timestamp: int = Field(..., description="Unix timestamp sent from terminal")


class HeartbeatResponse(BaseModel):
    status: str = "ok"
    server_time: int


class InitialDepositRequest(BaseModel):
    initial_deposit: Optional[float] = Field(None, description="Custom deposit baseline amount, or null/0 to reset to auto MT5")


class InitialDepositResponse(BaseModel):
    status: str = "success"
    initial_deposit: Optional[float] = None
    is_overridden: bool = False
    source: str = "mt5"
    settled_pnl: Optional[float] = None
    settled_pnl_percent: Optional[float] = None
    all_time_pnl: Optional[float] = None
    all_time_pnl_percent: Optional[float] = None
    message: str = "Initial deposit setting updated."


class BridgeStatusResponse(BaseModel):
    is_connected: bool
    terminal_connected: bool = False
    last_heartbeat_at: Optional[int] = None
    seconds_since_last_heartbeat: Optional[float] = None
    metrics: Optional[HeartbeatPayload] = None
    initial_deposit: Optional[float] = None
    is_deposit_overridden: bool = False
    settled_pnl: Optional[float] = None
    settled_pnl_percent: Optional[float] = None
    all_time_pnl: Optional[float] = None
    all_time_pnl_percent: Optional[float] = None
    positions: List[PositionItem] = []
    market_quotes: List[MarketQuoteItem] = []
    chart_symbol: Optional[str] = None
    closed_trades_count: int = 0

