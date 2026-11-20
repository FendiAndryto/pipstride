/**
 * Paper Ledger Accounting Module for Replay Strategy Simulator (Fase 4: T-SIM-07).
 *
 * Implements isolated financial accounting, spread deduction, compounding equity,
 * drawdown tracking, and performance statistics.
 *
 * Fully decoupled from legacy replay_engine.js.
 */
(function (global) {
  'use strict';

  var CONTRACT_SIZE = 100; // 1 Lot XAUUSD = 100 oz
  var DEFAULT_SPREAD_PER_OZ = 0.20; // $0.20/oz ($20 per 1.0 lot)
  var INITIAL_BALANCE = 10000.0;
  var MIN_LOT = 0.01;
  var MAX_LOT = 5.00;
  var DEFAULT_LOT = 0.10;

  function validateLot(lot) {
    if (typeof lot !== 'number' || isNaN(lot) || !isFinite(lot)) return null;
    if (lot < MIN_LOT || lot > MAX_LOT) return null;
    return Number(lot.toFixed(2));
  }

  function calculatePnl(params) {
    params = params || {};
    var side = String(params.side || 'BUY').toUpperCase();
    var isBuy = side === 'BUY' || side === 'LONG';
    var entryPrice = Number(params.entryPrice);
    var exitPrice = Number(params.exitPrice);
    var lot = validateLot(Number(params.lot)) || DEFAULT_LOT;
    var spreadPerOz = (params.spreadPerOz != null && !isNaN(params.spreadPerOz))
      ? Number(params.spreadPerOz)
      : DEFAULT_SPREAD_PER_OZ;

    var priceDiff = isBuy ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
    var grossPnl = priceDiff * lot * CONTRACT_SIZE;
    var spreadCost = spreadPerOz * lot * CONTRACT_SIZE;
    var netPnl = grossPnl - spreadCost;

    return {
      priceDiff: Number(priceDiff.toFixed(3)),
      grossPnl: Number(grossPnl.toFixed(2)),
      spreadCost: Number(spreadCost.toFixed(2)),
      netPnl: Number(netPnl.toFixed(2)),
      pips: Number((priceDiff / 0.10).toFixed(1))
    };
  }

  function calculateRiskReward(params) {
    params = params || {};
    var entryPrice = Number(params.entryPrice);
    var sl = Number(params.sl);
    var tp = Number(params.tp);
    var lot = validateLot(Number(params.lot)) || DEFAULT_LOT;

    var riskPerOz = Math.abs(entryPrice - sl);
    var rewardPerOz = Math.abs(tp - entryPrice);
    var riskUsd = riskPerOz * lot * CONTRACT_SIZE;
    var rewardUsd = rewardPerOz * lot * CONTRACT_SIZE;
    var ratio = riskPerOz > 0.0001 ? (rewardPerOz / riskPerOz) : 0;

    return {
      riskPerOz: Number(riskPerOz.toFixed(3)),
      rewardPerOz: Number(rewardPerOz.toFixed(3)),
      riskUsd: Number(riskUsd.toFixed(2)),
      rewardUsd: Number(rewardUsd.toFixed(2)),
      riskPips: Number((riskPerOz / 0.10).toFixed(1)),
      rewardPips: Number((rewardPerOz / 0.10).toFixed(1)),
      ratio: Number(ratio.toFixed(2))
    };
  }

  function createLedger(options) {
    options = options || {};
    var initialBalance = (options.initialBalance != null && options.initialBalance > 0)
      ? Number(options.initialBalance)
      : INITIAL_BALANCE;
    var spreadPerOz = (options.spreadPerOz != null && !isNaN(options.spreadPerOz))
      ? Number(options.spreadPerOz)
      : DEFAULT_SPREAD_PER_OZ;

    var balance = initialBalance;
    var equity = initialBalance;
    var peakEquity = initialBalance;
    var maxDrawdownPct = 0.0;
    var trades = [];
    var listeners = [];

    function notify() {
      var summary = getSummary();
      for (var i = 0; i < listeners.length; i += 1) {
        try {
          listeners[i](summary);
        } catch (e) {
          if (global.console && global.console.error) {
            global.console.error('Ledger listener error:', e);
          }
        }
      }
    }

    function recordTrade(trade) {
      if (!trade) return null;
      var side = String(trade.side || 'BUY').toUpperCase();
      var entryPrice = Number(trade.entryPrice);
      var exitPrice = Number(trade.exitPrice);
      var lot = validateLot(Number(trade.lot)) || DEFAULT_LOT;
      var pnl = calculatePnl({
        side: side,
        entryPrice: entryPrice,
        exitPrice: exitPrice,
        lot: lot,
        spreadPerOz: spreadPerOz
      });

      var record = {
        id: trade.id || ('trade_' + Date.now() + '_' + (trades.length + 1)),
        side: side,
        lot: lot,
        entryPrice: entryPrice,
        exitPrice: exitPrice,
        sl: Number(trade.sl),
        tp: Number(trade.tp),
        entryTime: trade.entryTime,
        exitTime: trade.exitTime,
        priceDiff: pnl.priceDiff,
        pips: pnl.pips,
        grossPnl: pnl.grossPnl,
        spreadCost: pnl.spreadCost,
        netPnl: pnl.netPnl,
        outcome: trade.outcome || (pnl.netPnl >= 0 ? 'WIN' : 'LOSS'),
        reason: trade.reason || 'EXIT'
      };

      trades.push(record);
      balance = Number((balance + pnl.netPnl).toFixed(2));
      equity = balance;

      if (equity > peakEquity) {
        peakEquity = equity;
      }
      var dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      if (dd > maxDrawdownPct) {
        maxDrawdownPct = Number(dd.toFixed(2));
      }

      notify();
      return record;
    }

    function updateFloating(activePosition, currentPrice) {
      if (!activePosition || currentPrice == null || isNaN(currentPrice)) {
        equity = balance;
        return {
          floatingGross: 0,
          floatingNet: 0,
          equity: balance,
          maxDrawdown: maxDrawdownPct
        };
      }

      var pnl = calculatePnl({
        side: activePosition.side,
        entryPrice: activePosition.entryPrice,
        exitPrice: currentPrice,
        lot: activePosition.lot,
        spreadPerOz: spreadPerOz
      });

      equity = Number((balance + pnl.netPnl).toFixed(2));
      if (equity > peakEquity) {
        peakEquity = equity;
      }
      var dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      if (dd > maxDrawdownPct) {
        maxDrawdownPct = Number(dd.toFixed(2));
      }

      return {
        floatingGross: pnl.grossPnl,
        floatingNet: pnl.netPnl,
        floatingPips: pnl.pips,
        equity: equity,
        maxDrawdown: maxDrawdownPct
      };
    }

    function checkpoint() {
      return [balance, equity, peakEquity, maxDrawdownPct, trades.length];
    }

    function rewind(point) {
      balance = point[0];
      equity = point[1];
      peakEquity = point[2];
      maxDrawdownPct = point[3];
      trades.length = point[4];
      notify();
    }

    function restore(summary) {
      if (!summary || typeof summary !== 'object') {
        reset();
        return getSummary();
      }

      var initBal = Number(summary.initialBalance);
      if (isFinite(initBal) && initBal > 0) {
        initialBalance = Number(initBal.toFixed(2));
      }

      var nextBalance = Number(summary.balance);
      balance = isFinite(nextBalance) ? Number(nextBalance.toFixed(2)) : initialBalance;
      equity = balance;

      var nextPeak = Number(summary.peakEquity);
      peakEquity = (isFinite(nextPeak) && nextPeak >= balance)
        ? Number(nextPeak.toFixed(2))
        : balance;

      var nextDd = Number(summary.maxDrawdownPct);
      maxDrawdownPct = (isFinite(nextDd) && nextDd >= 0) ? Number(nextDd.toFixed(2)) : 0.0;

      // Persisted summaries include the full trade list, so derived stats
      // (wins/losses/gross/net/profit factor) are recomputed consistently.
      trades = Array.isArray(summary.trades) ? summary.trades.slice() : [];

      notify();
      return getSummary();
    }

    function trimLegacyTrades(time) {
      var retained = trades.filter(function (trade) { return trade.exitTime <= time; });
      var realized = initialBalance;
      var peak = realized;
      var drawdown = 0;
      retained.forEach(function (trade) {
        realized = Number((realized + trade.netPnl).toFixed(2));
        peak = Math.max(peak, realized);
        drawdown = Math.max(drawdown, (peak - realized) / peak * 100);
      });
      restore({
        initialBalance: initialBalance,
        balance: realized,
        peakEquity: peak,
        maxDrawdownPct: drawdown,
        trades: retained
      });
    }

    function getSummary() {
      var totalTrades = trades.length;
      var wins = 0;
      var losses = 0;
      var grossProfit = 0.0;
      var grossLoss = 0.0;

      for (var i = 0; i < trades.length; i += 1) {
        var t = trades[i];
        if (t.netPnl > 0) {
          wins += 1;
          grossProfit += t.netPnl;
        } else {
          losses += 1;
          grossLoss += Math.abs(t.netPnl);
        }
      }

      grossProfit = Number(grossProfit.toFixed(2));
      grossLoss = Number(grossLoss.toFixed(2));
      var netProfit = Number((grossProfit - grossLoss).toFixed(2));
      var winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0.0;
      var profitFactor = grossLoss > 0.0001
        ? Number((grossProfit / grossLoss).toFixed(2))
        : (grossProfit > 0 ? 999.0 : 1.0);

      var returnPct = initialBalance > 0
        ? Number((((balance - initialBalance) / initialBalance) * 100).toFixed(2))
        : 0.0;

      return {
        initialBalance: initialBalance,
        balance: balance,
        equity: equity,
        peakEquity: peakEquity,
        maxDrawdownPct: maxDrawdownPct,
        totalTrades: totalTrades,
        winningTrades: wins,
        losingTrades: losses,
        winRate: winRate,
        grossProfit: grossProfit,
        grossLoss: grossLoss,
        netProfit: netProfit,
        profitFactor: profitFactor,
        returnPct: returnPct,
        trades: trades.slice()
      };
    }

    function reset() {
      balance = initialBalance;
      equity = initialBalance;
      peakEquity = initialBalance;
      maxDrawdownPct = 0.0;
      trades = [];
      notify();
    }

    function subscribe(fn) {
      if (typeof fn === 'function') {
        listeners.push(fn);
        return function () {
          var idx = listeners.indexOf(fn);
          if (idx !== -1) listeners.splice(idx, 1);
        };
      }
      return function () {};
    }

    return {
      recordTrade: recordTrade,
      updateFloating: updateFloating,
      getSummary: getSummary,
      reset: reset,
      checkpoint: checkpoint,
      rewind: rewind,
      trimLegacyTrades: trimLegacyTrades,
      restore: restore,
      subscribe: subscribe,
      getBalance: function () { return balance; },
      getEquity: function () { return equity; },
      getTrades: function () { return trades.slice(); }
    };
  }

  var SmcReplayLedger = {
    create: createLedger,
    calculatePnl: calculatePnl,
    calculateRiskReward: calculateRiskReward,
    validateLot: validateLot,
    CONTRACT_SIZE: CONTRACT_SIZE,
    DEFAULT_SPREAD_PER_OZ: DEFAULT_SPREAD_PER_OZ,
    INITIAL_BALANCE: INITIAL_BALANCE,
    MIN_LOT: MIN_LOT,
    MAX_LOT: MAX_LOT,
    DEFAULT_LOT: DEFAULT_LOT
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SmcReplayLedger;
  }
  global.SmcReplayLedger = SmcReplayLedger;
})(typeof window !== 'undefined' ? window : globalThis);
