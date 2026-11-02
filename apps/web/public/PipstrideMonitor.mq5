//+------------------------------------------------------------------+
//|                                           PipstrideMonitor.mq5   |
//|                                  Copyright 2026, Pipstride       |
//|                                  https://pipstride.com           |
//+------------------------------------------------------------------+
#property copyright "Pipstride"
#property link      "https://pipstride.com"
#property version   "1.00"
#property description "Pipstride Pure Read-Only MT5 Telemetry & Account Analytics Monitor v1.00 (Zero Trade Execution - 100% Safe)"

//--- Host Environment Enum
enum ENUM_HOST_ENV
{
   HOST_ENV_AUTO  = 0, // Auto Detect (Local vs VPS)
   HOST_ENV_LOCAL = 1, // Local PC / Laptop
   HOST_ENV_VPS   = 2  // VPS / Cloud Server
};

//--- Inputs
input group "--- Pipstride Telemetry Settings ---"
input string        InpBackendUrl        = "http://localhost:8089";                    // Backend API URL
input string        InpBridgeToken       = "";                                        // Pipstride Connection Token (from Web Dashboard)
input ENUM_HOST_ENV InpHostEnv           = HOST_ENV_AUTO;                             // Host Environment (Auto/Local/VPS)
input string        InpMonitoredSymbols  = "XAUUSD,EURUSD,GBPUSD,USDJPY,BTCUSD";      // Watchlist symbols (comma-separated)
input int           InpHistoryDays       = 90;                                        // History lookback days (0 = All History)
input int           InpHeartbeatInterval = 5;                                         // Heartbeat interval in seconds (5 recommended)
input bool          InpVerboseLog        = false;                                     // Print detailed logs to Experts tab

//--- Global Variables
datetime g_last_heartbeat = 0;
int      g_consecutive_errors = 0;
string   g_status_msg = "Initializing...";

// Cached heavy payload parts: rebuilt only when fresh, otherwise reused so
// OnTimer stays cheap. Trade history is event-driven (OnTradeTransaction).
string   g_cached_candles_m15 = "[]";
string   g_cached_candles_m5 = "[]";
datetime g_candles_built_at = 0;
double   g_cached_initial_deposit = 0.0;
datetime g_deposit_cached_at = 0;
long     g_cached_deposit_login = 0;
bool     g_trades_dirty = true;
datetime g_last_sync_attempt = 0;
datetime g_last_full_sync = 0;

// Watchlist and D1 quote caches. FindBrokerSymbol scans every symbol in the
// terminal and CopyRates has real terminal overhead, so neither belongs on a
// 5-second heartbeat path.
#define MAX_WATCH_SYMBOLS 64
#define D1_REFRESH_SECONDS 60

struct D1BarCache
{
   datetime day;
   datetime refreshed_at;
   double   open;
   double   high;
   double   low;
   bool     valid;
};

string    g_watch_base[MAX_WATCH_SYMBOLS];
string    g_watch_broker[MAX_WATCH_SYMBOLS];
int       g_watch_count = -1;
D1BarCache g_d1_cache[MAX_WATCH_SYMBOLS];

// Forward Declarations
void SendHeartbeat();
bool SendTradeSync(bool silent);
void UpdateChartHUD(string status_text);
string FindBrokerSymbol(string baseSym);
void GetDealPositionOpenDetails(ulong posId, double &openPrice, long &openTime);
void InvalidateDerivedCaches();

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   Print(">>> [PipstrideMonitor] Initializing Pure Read-Only MT5 Telemetry Monitor v1.00...");
   Print(">>> [PipstrideMonitor] NOTICE: This EA is 100% READ-ONLY. It possesses ZERO order execution capability.");
   Print(">>> [PipstrideMonitor] Target Backend: ", InpBackendUrl);

   // Globals survive a reinit without a full reload (input edits, chart
   // changes), so caches derived from the settings must be rebuilt here or an
   // edited InpMonitoredSymbols would never take effect.
   InvalidateDerivedCaches();

   // Set timer for periodic telemetry heartbeat
   EventSetTimer(MathMax(1, InpHeartbeatInterval));

   g_status_msg = "Started - Connecting to Backend...";
   UpdateChartHUD(g_status_msg);

   // Send initial heartbeat immediately
   SendHeartbeat();

   // Seed full trade history once at startup; afterwards only deal events (and
   // a 30-minute safety net) trigger a sync.
   g_last_sync_attempt = TimeCurrent();
   if(SendTradeSync(false))
   {
      g_trades_dirty = false;
      g_last_full_sync = TimeCurrent();
   }
   else
   {
      g_trades_dirty = true;
   }

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
   Print(">>> [PipstrideMonitor] Deinitialized. Reason code: ", reason);
}

//+------------------------------------------------------------------+
//| Timer event function (pure telemetry heartbeat dispatch)         |
//+------------------------------------------------------------------+
void OnTimer()
{
   datetime now = TimeCurrent();

   // Full replay safety net: heals a journal reset, a missed DEAL_ADD while
   // the terminal was offline, and any dropped batch. Cheap (one request per
   // 30 min) and bounded by the 100-deal window.
   bool periodic = (now - g_last_full_sync) >= 1800;

   // Event-driven sync. After a failure, back off to one attempt per 30s so a
   // dead backend cannot turn every tick into a 3-second blocking request.
   if((g_trades_dirty || periodic) && (now - g_last_sync_attempt) >= 30)
   {
      g_last_sync_attempt = now;
      if(periodic) g_last_full_sync = now;
      if(SendTradeSync(true))
      {
         g_trades_dirty = false;
         g_last_full_sync = now;
      }
   }

   SendHeartbeat();
}

//+------------------------------------------------------------------+
//| Trade transaction event: only mark trade history dirty            |
//+------------------------------------------------------------------+
void OnTradeTransaction(
   const MqlTradeTransaction &trans,
   const MqlTradeRequest &request,
   const MqlTradeResult &result
)
{
   // DEAL_ADD signals a new deal (balance, in, or out). Full trade detail is
   // fetched lazily in the next timer tick, so this handler never blocks.
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      g_trades_dirty = true;
   }
}

//+------------------------------------------------------------------+
//| Escape special characters for strict JSON compliance             |
//+------------------------------------------------------------------+
string EscapeJsonString(string src)
{
   string res = src;
   StringReplace(res, "\\", "\\\\");
   StringReplace(res, "\"", "\\\"");
   StringReplace(res, "\r", "\\r");
   StringReplace(res, "\n", "\\n");
   StringReplace(res, "\t", "\\t");
   return res;
}

//+------------------------------------------------------------------+
//| Find real broker symbol matching base symbol (handles suffixes)  |
//+------------------------------------------------------------------+
string FindBrokerSymbol(string baseSym)
{
   if(SymbolSelect(baseSym, true)) return baseSym;

   string upperTarget = baseSym;
   StringToUpper(upperTarget);

   string coreSym = upperTarget;
   if(StringLen(coreSym) > 6)
   {
      string s6 = StringSubstr(coreSym, 0, 6);
      if(s6 == "XAUUSD" || s6 == "EURUSD" || s6 == "GBPUSD" || s6 == "USDJPY" || s6 == "BTCUSD" || s6 == "ETHUSD")
      {
         coreSym = s6;
      }
   }

   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string sName = SymbolName(i, false);
      string upperS = sName;
      StringToUpper(upperS);
      if(upperS == upperTarget)
      {
         SymbolSelect(sName, true);
         return sName;
      }
   }

   for(int i = 0; i < total; i++)
   {
      string sName = SymbolName(i, false);
      string upperS = sName;
      StringToUpper(upperS);
      if(StringFind(upperS, coreSym) == 0 && StringLen(upperS) <= StringLen(coreSym) + 4)
      {
         SymbolSelect(sName, true);
         return sName;
      }
   }

   return _Symbol;
}

//+------------------------------------------------------------------+
//| Drop every cache derived from inputs or quotes. Reinit-safe.     |
//+------------------------------------------------------------------+
void InvalidateDerivedCaches()
{
   g_watch_count = -1;                       // forces EnsureWatchlistCache to re-resolve
   for(int i = 0; i < MAX_WATCH_SYMBOLS; i++)
      g_d1_cache[i].valid = false;           // stale symbol data must not survive a re-init
}

//+------------------------------------------------------------------+
//| Resolve the watchlist once. FindBrokerSymbol walks every symbol  |
//| in the terminal, which is far too expensive for a timer tick.    |
//+------------------------------------------------------------------+
void EnsureWatchlistCache()
{
   if(g_watch_count >= 0) return;

   string symbols[];
   int total = StringSplit(InpMonitoredSymbols, ',', symbols);
   int count = 0;

   for(int i = 0; i < total && count < MAX_WATCH_SYMBOLS; i++)
   {
      string baseSym = symbols[i];
      StringTrimLeft(baseSym);
      StringTrimRight(baseSym);
      if(baseSym == "") continue;

      g_watch_base[count] = baseSym;
      g_watch_broker[count] = FindBrokerSymbol(baseSym);
      SymbolSelect(g_watch_broker[count], true);
      count++;
   }
   g_watch_count = count;
}

//+------------------------------------------------------------------+
//| Refresh one symbol's D1 bar at most once per minute.             |
//| The open is pinned to the first bar seen for that trading day;   |
//| only high/low move intraday, so the expensive history call is    |
//| amortised across many heartbeats.                                |
//+------------------------------------------------------------------+
bool RefreshD1Cache(int idx, string symbol)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   if(CopyRates(symbol, PERIOD_D1, 0, 1, rates) <= 0)
      return g_d1_cache[idx].valid;

   if(!g_d1_cache[idx].valid || g_d1_cache[idx].day != rates[0].time)
   {
      g_d1_cache[idx].day = rates[0].time;
      g_d1_cache[idx].open = rates[0].open;
   }
   g_d1_cache[idx].high = rates[0].high;
   g_d1_cache[idx].low = rates[0].low;
   g_d1_cache[idx].refreshed_at = TimeCurrent();
   g_d1_cache[idx].valid = true;
   return true;
}

//+------------------------------------------------------------------+
//| Get Entry Price and Entry Time for a closed position's deals     |
//+------------------------------------------------------------------+
void GetDealPositionOpenDetails(ulong posId, double &openPrice, long &openTime)
{
   if(posId <= 0) return;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t > 0 && (ulong)HistoryDealGetInteger(t, DEAL_POSITION_ID) == posId)
      {
         long entry = HistoryDealGetInteger(t, DEAL_ENTRY);
         if(entry == DEAL_ENTRY_IN)
         {
            openPrice = HistoryDealGetDouble(t, DEAL_PRICE);
            openTime = HistoryDealGetInteger(t, DEAL_TIME);
            return;
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Get Initial Deposit from MT5 balance deals history               |
//+------------------------------------------------------------------+
double GetAccountInitialDeposit()
{
   HistorySelect(0, TimeCurrent());
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t > 0)
      {
         long type = HistoryDealGetInteger(t, DEAL_TYPE);
         if(type == DEAL_TYPE_BALANCE)
         {
            double p = HistoryDealGetDouble(t, DEAL_PROFIT);
            if(p > 0.0) return p;
         }
      }
   }
   return 0.0;
}

//+------------------------------------------------------------------+
//| Build JSON array of closed trade history from MT5 deals          |
//+------------------------------------------------------------------+
string BuildClosedTradesJson()
{
   datetime fromTime = (InpHistoryDays > 0 ? (TimeCurrent() - InpHistoryDays * 86400) : 0);

   HistorySelect(fromTime, TimeCurrent());
   int totalDeals = HistoryDealsTotal();

   string json = "[";
   int count = 0;
   int maxRecords = 100;

   for(int i = totalDeals - 1; i >= 0 && count < maxRecords; i--)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket <= 0) continue;

      long entryType = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entryType != DEAL_ENTRY_OUT) continue;

      string dealSymbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      long dealType = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      double dealVol = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
      double dealPrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      double dealProfit = HistoryDealGetDouble(dealTicket, DEAL_PROFIT) + 
                          HistoryDealGetDouble(dealTicket, DEAL_SWAP) + 
                          HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      long dealTime = HistoryDealGetInteger(dealTicket, DEAL_TIME);
      long dealMagic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);

      ulong posId = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      double openPrice = dealPrice;
      long openTime = dealTime;
      if(posId > 0)
      {
         GetDealPositionOpenDetails(posId, openPrice, openTime);
      }

      string origType = (dealType == DEAL_TYPE_SELL ? "BUY" : "SELL");

      if(count > 0) json += ",";
      json += StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"type\":\"%s\",\"volume\":%.2f,\"open_price\":%.5f,\"close_price\":%.5f,\"profit\":%.2f,\"open_time\":%I64d,\"close_time\":%I64d,\"magic\":%I64d}",
         dealTicket,
         EscapeJsonString(dealSymbol),
         origType,
         dealVol,
         openPrice,
         dealPrice,
         dealProfit,
         openTime,
         dealTime,
         dealMagic
      );
      count++;
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Build JSON array of live quotes for monitored symbols            |
//+------------------------------------------------------------------+
string BuildMarketQuotesJson()
{
   EnsureWatchlistCache();

   datetime now = TimeCurrent();
   string json = "[";
   int count = 0;

   for(int i = 0; i < g_watch_count; i++)
   {
      string baseSym = g_watch_base[i];
      string actualSym = g_watch_broker[i];
      if(actualSym == "") continue;

      double bid = SymbolInfoDouble(actualSym, SYMBOL_BID);
      double ask = SymbolInfoDouble(actualSym, SYMBOL_ASK);
      if(bid <= 0.0) continue;

      int digits = (int)SymbolInfoInteger(actualSym, SYMBOL_DIGITS);
      int spread = (int)SymbolInfoInteger(actualSym, SYMBOL_SPREAD);

      double changePct = 0.0;
      double high = bid;
      double low = bid;

      if(!g_d1_cache[i].valid || (now - g_d1_cache[i].refreshed_at) >= D1_REFRESH_SECONDS)
      {
         RefreshD1Cache(i, actualSym);
      }

      if(g_d1_cache[i].valid && g_d1_cache[i].open > 0.0)
      {
         changePct = ((bid - g_d1_cache[i].open) / g_d1_cache[i].open) * 100.0;
         high = g_d1_cache[i].high;
         low = g_d1_cache[i].low;
      }

      if(count > 0) json += ",";
      json += StringFormat(
         "{\"symbol\":\"%s\",\"bid\":%.*f,\"ask\":%.*f,\"spread\":%d,\"digits\":%d,\"daily_change_pct\":%.2f,\"high\":%.*f,\"low\":%.*f}",
         EscapeJsonString(baseSym),
         digits, bid,
         digits, ask,
         spread,
         digits,
         changePct,
         digits, high,
         digits, low
      );
      count++;
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Build JSON array of recent candles for specified timeframe       |
//+------------------------------------------------------------------+
string BuildCandlesJson(ENUM_TIMEFRAMES tf = PERIOD_M15)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(_Symbol, tf, 0, 35, rates);
   if(copied <= 0) return "[]";

   string json = "[";
   int count = 0;
   for(int i = copied - 1; i >= 0; i--)
   {
      if(count > 0) json += ",";
      json += StringFormat(
         "{\"time\":%I64d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%.1f}",
         (long)rates[i].time,
         rates[i].open,
         rates[i].high,
         rates[i].low,
         rates[i].close,
         (double)rates[i].tick_volume
      );
      count++;
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Cached wrapper for the one-time initial-deposit scan.            |
//| The first balance deal of a live account never changes, so once  |
//| found the value is kept for the lifetime of the EA. If history   |
//| was not ready yet, retry at most once every five minutes.        |
//+------------------------------------------------------------------+
double GetAccountInitialDepositCached()
{
   long login = (long)AccountInfoInteger(ACCOUNT_LOGIN);
   if(login != g_cached_deposit_login)
   {
      // Account switched without a full reinitialisation: discard the old
      // account's baseline instead of reporting it for the new one.
      g_cached_initial_deposit = 0.0;
      g_deposit_cached_at = 0;
      g_cached_deposit_login = login;
   }

   if(g_cached_initial_deposit > 0.0)
      return g_cached_initial_deposit;

   datetime now = TimeCurrent();
   if(g_deposit_cached_at != 0 && (now - g_deposit_cached_at) < 300)
      return g_cached_initial_deposit;

   double scanned = GetAccountInitialDeposit();
   g_deposit_cached_at = now;
   if(scanned > 0.0)
      g_cached_initial_deposit = scanned;

   return g_cached_initial_deposit;
}

//+------------------------------------------------------------------+
//| Build JSON telemetry payload with live positions list            |
//+------------------------------------------------------------------+
string BuildHeartbeatJson()
{
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string server = EscapeJsonString(AccountInfoString(ACCOUNT_SERVER));
   string currency = EscapeJsonString(AccountInfoString(ACCOUNT_CURRENCY));
   if(currency == "") currency = "USD";

   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   if(!MathIsValidNumber(balance)) balance = 0.0;

   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(!MathIsValidNumber(equity)) equity = balance;

   double margin = AccountInfoDouble(ACCOUNT_MARGIN);
   if(!MathIsValidNumber(margin) || margin < 0.0) margin = 0.0;

   double free_margin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(!MathIsValidNumber(free_margin)) free_margin = equity;

   double margin_level = 0.0;
   if(margin > 0.0001)
   {
      margin_level = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
      if(!MathIsValidNumber(margin_level)) margin_level = 0.0;
   }

   double profit = AccountInfoDouble(ACCOUNT_PROFIT);
   if(!MathIsValidNumber(profit)) profit = 0.0;

   double initial_deposit = GetAccountInitialDepositCached();
   if(!MathIsValidNumber(initial_deposit) || initial_deposit <= 0.0)
   {
      initial_deposit = balance;
   }

   bool connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   int positions = PositionsTotal();
   long timestamp = (long)TimeLocal();

   // Build Open Positions Array
   string positionsJson = "[";
   int count = 0;

   for(int i = 0; i < positions; i++)
   {
      ulong posTicket = PositionGetTicket(i);
      if(posTicket > 0)
      {
         string posSymbol = PositionGetString(POSITION_SYMBOL);
         long posType = PositionGetInteger(POSITION_TYPE);
         double posVol = PositionGetDouble(POSITION_VOLUME);
         double posOpenPrice = PositionGetDouble(POSITION_PRICE_OPEN);
         double posCurrentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
         double posSL = PositionGetDouble(POSITION_SL);
         double posTP = PositionGetDouble(POSITION_TP);
         double posProfit = PositionGetDouble(POSITION_PROFIT);
         long posTime = PositionGetInteger(POSITION_TIME);
         long posMagic = PositionGetInteger(POSITION_MAGIC);

         if(count > 0) positionsJson += ",";

         positionsJson += StringFormat(
            "{\"ticket\":%I64u,\"symbol\":\"%s\",\"type\":\"%s\",\"volume\":%.2f,\"open_price\":%.5f,\"current_price\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"pnl\":%.2f,\"open_time\":%I64d,\"magic\":%I64d}",
            posTicket,
            EscapeJsonString(posSymbol),
            (posType == POSITION_TYPE_BUY ? "BUY" : "SELL"),
            posVol,
            posOpenPrice,
            posCurrentPrice,
            posSL,
            posTP,
            posProfit,
            posTime,
            posMagic
         );
         count++;
      }
   }
   positionsJson += "]";

   string quotesJson = BuildMarketQuotesJson();

   // Rebuild candles at most once per 30s; the chart shows the freshest bar
   // from market quotes anyway. Trade history is sent only on deal events
   // via SendTradeSync(), never on every heartbeat.
   if(g_candles_built_at == 0 || (TimeCurrent() - g_candles_built_at) >= 30)
   {
      g_cached_candles_m15 = BuildCandlesJson(PERIOD_M15);
      g_cached_candles_m5 = BuildCandlesJson(PERIOD_M5);
      g_candles_built_at = TimeCurrent();
   }
   string candlesM15Json = g_cached_candles_m15;
   string candlesM5Json = g_cached_candles_m5;

   string host_type = "local";
   if(InpHostEnv == HOST_ENV_VPS)
      host_type = "vps";
   else if(InpHostEnv == HOST_ENV_LOCAL)
      host_type = "local";
   else
   {
      bool isMqlVps = (bool)TerminalInfoInteger(TERMINAL_VPS);
      host_type = (isMqlVps ? "vps" : "local");
   }

   string json = "{"
      + StringFormat("\"account_number\":%I64d,", login)
      + "\"server\":\"" + server + "\","
      + "\"currency\":\"" + currency + "\","
      + StringFormat("\"balance\":%.2f,", balance)
      + StringFormat("\"equity\":%.2f,", equity)
      + StringFormat("\"initial_deposit\":%.2f,", initial_deposit)
      + StringFormat("\"margin\":%.2f,", margin)
      + StringFormat("\"free_margin\":%.2f,", free_margin)
      + StringFormat("\"margin_level\":%.2f,", margin_level)
      + StringFormat("\"floating_pnl\":%.2f,", profit)
      + "\"terminal_connected\":" + (connected ? "true," : "false,")
      + StringFormat("\"open_positions\":%d,", positions)
      + "\"positions\":" + positionsJson + ","
      + "\"market_quotes\":" + quotesJson + ","
      + "\"closed_trades\":[],"
      + "\"candles\":" + candlesM15Json + ","
      + "\"candles_m5\":" + candlesM5Json + ","
      + "\"chart_symbol\":\"" + EscapeJsonString(_Symbol) + "\","
      + "\"bridge_token\":\"" + EscapeJsonString(InpBridgeToken) + "\","
      + "\"host_type\":\"" + host_type + "\","
      + StringFormat("\"timestamp\":%I64d", timestamp)
      + "}";

   return json;
}

//+------------------------------------------------------------------+
//| Send a dedicated trade-sync request (only on deal events)        |
//+------------------------------------------------------------------+
bool SendTradeSync(bool silent)
{
   if(StringLen(InpBridgeToken) == 0)
   {
      // Same network degradation as the heartbeat: without the bridge token
      // header a POST can arrive as GET. Do not attempt the request.
      g_consecutive_errors++;
      if(g_consecutive_errors % 10 == 1)
         Print(">>> [PipstrideMonitor] Trade sync skipped: InpBridgeToken is empty.");
      return false;
   }

   string closedTradesJson = BuildClosedTradesJson();
   // Avoid the network round-trip when nothing changed (empty payload).
   if(closedTradesJson == "[]") return true;

   string body = "{"
      + StringFormat("\"account_number\":%I64d,", (long)AccountInfoInteger(ACCOUNT_LOGIN))
      + "\"closed_trades\":" + closedTradesJson
      + "}";

   string endpoint = InpBackendUrl + "/api/v1/bridge/sync-trades";
   char postData[];
   char resultData[];
   string resultHeaders;
   // Same empty-body guard as SendHeartbeat: zero-size data would turn the
   // request into a GET.
   if(StringLen(body) == 0) body = "{\"closed_trades\":[]}";
   StringToCharArray(body, postData, 0, StringLen(body), CP_UTF8);

   string headers = "Content-Type: application/json\r\nX-Bridge-Token: " + InpBridgeToken + "\r\n";
   ResetLastError();
   // Keep a larger budget than the heartbeat: this request carries the whole
   // history window in one body and runs at most once per 30s, so a tight
   // 1.5s cap could fail the sync forever on a slow uplink.
   int res = WebRequest("POST", endpoint, headers, 3000, postData, resultData, resultHeaders);
   if(res == 200)
   {
      if(!silent && InpVerboseLog)
         Print(">>> [PipstrideMonitor] Trade sync OK: ", CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8));
      return true;
   }
   g_consecutive_errors++;
   if(g_consecutive_errors % 10 == 1)
      Print(">>> [PipstrideMonitor] Trade sync failed. HTTP: ", res, ", Err: ", GetLastError());
   return false;
}

//+------------------------------------------------------------------+
//| Send HTTP POST heartbeat to FastAPI backend                      |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   // Without the custom X-Bridge-Token header, this terminal/network path
   // degrades the heartbeat POST into a bare GET the API answers with 405.
   // Fail fast with an actionable message instead of sending broken telemetry.
   if(StringLen(InpBridgeToken) == 0)
   {
      g_consecutive_errors++;
      g_status_msg = "Token kosong - Set InpBridgeToken dari halaman Pipstride";
      if(g_consecutive_errors % 5 == 1)
      {
         Print(">>> [PipstrideMonitor] ERROR: InpBridgeToken is empty. Open Pipstride -> Connections, copy the token into the EA inputs.");
      }
      UpdateChartHUD(g_status_msg);
      return;
   }

   string endpoint = InpBackendUrl + "/api/v1/bridge/heartbeat";
   string json = BuildHeartbeatJson();

   // MQL5 quirk: WebRequest with a zero-size body sends a GET regardless of
   // the method parameter. Never hand it an empty array.
   if(StringLen(json) == 0)
      json = StringFormat("{\"account_number\":%I64d}", (long)AccountInfoInteger(ACCOUNT_LOGIN));

   char postData[];
   char resultData[];
   string resultHeaders;

   // StringLen-based copy: exact bytes, no trailing NUL, no manual trim.
   StringToCharArray(json, postData, 0, StringLen(json), CP_UTF8);

   string headers = "Content-Type: application/json\r\n";
   headers += "X-Bridge-Token: " + InpBridgeToken + "\r\n";
   ResetLastError();

   int res = WebRequest("POST", endpoint, headers, 1500, postData, resultData, resultHeaders);

   if(res == 200)
   {
      g_last_heartbeat = TimeLocal();
      g_consecutive_errors = 0;
      g_status_msg = "Connected (Read-Only OK - 200)";

      string responseStr = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
      // Server wiped the journal (reset) or has no rows: replay history.
      if(StringFind(responseStr, "\"resync_trades\":true") >= 0)
      {
         g_trades_dirty = true;
      }

      if(InpVerboseLog)
      {
         Print(">>> [PipstrideMonitor] Telemetry OK: ", responseStr);
      }
      UpdateChartHUD(g_status_msg);
      return;
   }

   if(res == 401)
   {
      g_consecutive_errors++;
      g_status_msg = "Unauthorized (Invalid/Missing Connection Token)";
      if(g_consecutive_errors % 5 == 1)
      {
         Print(">>> [PipstrideMonitor] ERROR 401: Unauthorized! Set valid 'InpBridgeToken' from Pipstride Web.");
      }
      UpdateChartHUD(g_status_msg);
      return;
   }

   int err = GetLastError();
   g_consecutive_errors++;
   g_status_msg = StringFormat("Connection Failed (HTTP %d, Err %d)", res, err);
   if(g_consecutive_errors % 10 == 1)
   {
      if(err == 4014)
      {
         Print(">>> [PipstrideMonitor] ERROR 4014: URL not allowed! Add '", InpBackendUrl, "' to Tools -> Options -> Expert Advisors -> Allow WebRequest.");
      }
      else
      {
         Print(">>> [PipstrideMonitor] Telemetry failed. HTTP: ", res, ", WebRequest Err: ", err);
      }
   }
   UpdateChartHUD(g_status_msg);
}

//+------------------------------------------------------------------+
//| Update onscreen HUD commentary                                   |
//+------------------------------------------------------------------+
void UpdateChartHUD(string status_text)
{
   string host_desc = (InpHostEnv == HOST_ENV_VPS ? "VPS / Cloud" : (InpHostEnv == HOST_ENV_LOCAL ? "Local PC" : "Auto (" + ((bool)TerminalInfoInteger(TERMINAL_VPS) ? "VPS" : "Local") + ")"));
   string hud = "========================================\n"
              + "  PIPSTRIDE MONITOR - 100% READ-ONLY   \n"
              + "========================================\n"
              + "Backend URL    : " + InpBackendUrl + "\n"
              + "Host Env       : " + host_desc + "\n"
              + "Monitor Status : " + status_text + "\n"
              + "Execution Mode : READ-ONLY (No Orders Executed)\n"
              + "Last Telemetry : " + (g_last_heartbeat > 0 ? TimeToString(g_last_heartbeat, TIME_DATE|TIME_SECONDS) : "None") + "\n"
              + "Server Name    : " + AccountInfoString(ACCOUNT_SERVER) + "\n"
              + "Account Login  : " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + " (" + AccountInfoString(ACCOUNT_CURRENCY) + ")\n"
              + "Balance        : " + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + "\n"
              + "Equity         : " + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + "\n"
              + "Floating PnL   : " + DoubleToString(AccountInfoDouble(ACCOUNT_PROFIT), 2) + "\n"
              + "Open Positions : " + IntegerToString(PositionsTotal()) + "\n"
              + "========================================";
   Comment(hud);
}
//+------------------------------------------------------------------+
