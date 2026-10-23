import re
from typing import Optional
from fastapi import HTTPException, status
from app.core.config import settings
from app.models.risk import LotCalculationRequest, LotCalculationResponse


class RiskService:
    @staticmethod
    def get_pip_size(symbol: str) -> float:
        sym = symbol.upper().strip()
        if "JPY" in sym:
            return 0.01
        elif "XAU" in sym or "GOLD" in sym:
            return 0.10
        elif "XAG" in sym or "SILVER" in sym:
            return 0.01
        elif "BTC" in sym:
            return 1.00
        return 0.0001

    @staticmethod
    def calculate_pip_value_per_lot(
        symbol: str,
        market_price: Optional[float] = None,
        account_currency: str = "USD"
    ) -> float:
        """
        Calculate the value of 1 pip for 1.0 standard lot denominated in account currency (default USD).
        """
        sym = symbol.upper().strip()

        # Crypto (BTCUSD, etc.)
        if "BTC" in sym:
            return 1.00

        # Commodities / Metals
        if "XAU" in sym or "GOLD" in sym:
            # 1 Standard lot = 100 oz. 1 pip = $0.10 price movement -> 100 * 0.10 = $10.00
            return 10.00
        if "XAG" in sym or "SILVER" in sym:
            # 1 Standard lot = 5000 oz. 1 pip = $0.01 -> 5000 * 0.01 = $50.00
            return 50.00

        # JPY Pairs (USDJPY, EURJPY, etc.)
        if "JPY" in sym:
            # 1 Standard lot = 100,000 units. 1 pip = 0.01 JPY -> 1,000 JPY per lot.
            # Convert to USD: 1000 / USDJPY_rate
            price = market_price if (market_price and market_price > 0) else 150.0
            return round(1000.0 / price, 4)

        # Standard Forex Pairs where USD is quote (EURUSD, GBPUSD, AUDUSD, NZDUSD)
        if sym.endswith("USD"):
            # 1 Standard lot = 100,000 units. 1 pip = 0.0001 -> $10.00 USD
            return 10.00

        # Forex pairs where USD is base (USDCAD, USDCHF)
        if sym.startswith("USD"):
            # Pip value in quote is 10 units. Convert to USD by dividing by exchange rate.
            price = market_price if (market_price and market_price > 0) else 1.35
            return round(10.0 / price, 4)

        # Default fallback for standard cross pairs
        return 10.00

    def calculate_lot(
        self,
        req: LotCalculationRequest,
        live_equity: Optional[float] = None
    ) -> LotCalculationResponse:
        if req.stop_loss_pips <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stop loss distance in pips must be greater than 0."
            )

        # Determine risk percent
        risk_pct = req.risk_percent if req.risk_percent is not None else settings.DEFAULT_RISK_PER_TRADE_PERCENT
        if risk_pct <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Risk percentage must be greater than 0%."
            )
        if risk_pct > settings.MAX_RISK_PER_TRADE_PERCENT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Risk percentage ({risk_pct}%) exceeds maximum allowed safety ceiling of {settings.MAX_RISK_PER_TRADE_PERCENT}%."
            )

        # Determine equity: explicit request equity -> live equity -> default 10,000
        equity_to_use = req.equity
        if equity_to_use is None or equity_to_use <= 0:
            equity_to_use = live_equity
        if equity_to_use is None or equity_to_use <= 0:
            equity_to_use = 10000.0

        risk_amount = equity_to_use * (risk_pct / 100.0)
        pip_val = self.calculate_pip_value_per_lot(
            symbol=req.symbol,
            market_price=req.market_price,
            account_currency=req.account_currency or "USD"
        )

        # Position size formula: Lot = Risk Amount / (SL Pips * Pip Value per Lot)
        raw_lot = risk_amount / (req.stop_loss_pips * pip_val)
        clamped_lot = round(max(settings.MIN_LOT_SIZE, min(raw_lot, settings.MAX_LOT_SIZE)), 2)

        return LotCalculationResponse(
            symbol=req.symbol.upper().strip(),
            equity=round(equity_to_use, 2),
            risk_percent=round(risk_pct, 2),
            risk_amount=round(risk_amount, 2),
            stop_loss_pips=round(req.stop_loss_pips, 2),
            pip_value_per_lot=round(pip_val, 4),
            calculated_lot=clamped_lot,
            raw_lot=round(raw_lot, 4),
            min_lot=settings.MIN_LOT_SIZE,
            max_lot=settings.MAX_LOT_SIZE,
            currency=req.account_currency or "USD"
        )


risk_service = RiskService()
