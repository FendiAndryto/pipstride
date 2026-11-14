//+------------------------------------------------------------------+
//|                                           PipstrideMonitor.mq5   |
//|                                  Copyright 2026, Pipstride       |
//|                                  https://pipstride.com           |
//+------------------------------------------------------------------+
#property service
#property copyright "Pipstride"
#property link      "https://pipstride.com"
#property version   "2.00"
#property description "Pipstride Pure Read-Only MT5 Telemetry Background Service (Zero Trade Execution - Tamper Proof)"

//--- Compile-time configuration
// A Service is configured from the Navigator, not from a chart, so every
// technical value is baked in at compile time. The dashboard only ever asks
// the user for the bridge token.
const string InpBackendUrl        = "https://app-pipstride.homever.my.id";      // Backend API URL
const int    InpHeartbeatInterval = 5;                                          // Heartbeat interval in seconds
const int    InpHistoryDays       = 90;                                         // History lookback days (0 = all)
const bool   InpVerboseLog        = false;                                      // Print detailed logs

// The watchlist is no longer a compile-time list: the dashboard owns it and
// pushes it through the heartbeat response (ticket 13-04). Until the first
// response arrives the service falls back to one resolved symbol.
#define MAX_CONTROL_SYMBOLS 32

//--- The only user-facing input
input string InpBridgeToken = "";                       // Pipstride Connection Token (from Web Dashboard)

//--- Global Variables
datetime g_last_heartbeat = 0;
int      g_consecutive_errors = 0;

// Cached heavy payload parts: rebuilt only when fresh, otherwise reused so the
// service loop stays cheap. Trade history is polled per tick.
string   g_cached_candles_m15 = "[]";
string   g_cached_candles_m5 = "[]";
string   g_cached_candles_h1 = "[]";
string   g_cached_candles_h4 = "[]";
datetime g_candles_built_at = 0;
double   g_cached_initial_deposit = 0.0;
datetime g_deposit_cached_at = 0;
long     g_cached_deposit_login = 0;
bool     g_trades_dirty = true;
datetime g_last_sync_attempt = 0;
datetime g_last_full_sync = 0;
string   g_bridge_token = "";
string   g_backend_url = "";

// A Service has no chart, so _Symbol is meaningless here. One real broker
// symbol is resolved at startup and used for the default candle feed.
string   g_default_symbol = "";

// Dashboard control state (ticket 13-04). Both values arrive inside the
// heartbeat response and are applied before the next payload is built.
string   g_active_symbol = "";   // base symbol the dashboard asked for
string   g_active_broker = "";   // resolved broker name for g_active_symbol
string   g_watchlist[MAX_CONTROL_SYMBOLS];
int      g_watchlist_count = 0;

// Polling replacement for OnTradeTransaction, which is never delivered to a
// service. See PollDealChanges().
ulong    g_last_deal_ticket = 0;
int      g_last_deal_count = -1;
datetime g_last_deal_poll = 0;

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
string FindBrokerSymbol(string baseSym);
void GetDealPositionOpenDetails(ulong posId, double &openPrice, long &openTime);
void InvalidateDerivedCaches();
void EnsureWatchlistCache();
void PollDealChanges();
void RunPendingTradeSync();
void ResetCandleCache();
void ResolveDefaultSymbol();
void ApplyServerControl(const string response);
string ActiveBrokerSymbol();
bool JsonStringValue(const string json, const string key, string &out);
int JsonStringArray(const string json, const string key, string &out[]);

//+------------------------------------------------------------------+
//| Strip clipboard artifacts from the pasted bridge token.          |
//| A trailing newline/space inside the header breaks WebRequest so   |
//| the request silently degrades to GET (API answers 405).          |
//+------------------------------------------------------------------+
string SanitizeBridgeToken(string raw)
{
   string clean = raw;
   StringReplace(clean, "\r\n", "");
   StringReplace(clean, "\r", "");
   StringReplace(clean, "\n", "");
   StringReplace(clean, "\t", "");
   StringReplace(clean, " ", "");
   StringTrimLeft(clean);
   StringTrimRight(clean);
   return clean;
}

//+------------------------------------------------------------------+
//| Strip whitespace, trailing slashes, and auto-upgrade http to     |
//| https for remote endpoints. A 301 redirect from Cloudflare/Nginx |
//| makes WebRequest convert POST into GET (API answers 405).        |
//+------------------------------------------------------------------+
string SanitizeBackendUrl(string raw)
{
   string clean = raw;
   StringReplace(clean, "\r\n", "");
   StringReplace(clean, "\r", "");
   StringReplace(clean, "\n", "");
   StringReplace(clean, "\t", "");
   StringReplace(clean, " ", "");
   StringTrimLeft(clean);
   StringTrimRight(clean);

   // Fall back to default production server if left empty
   if(StringLen(clean) == 0)
   {
      clean = "https://app-pipstride.homever.my.id";
   }

   // Auto-upgrade remote HTTP to HTTPS to prevent 301 redirect method degradation to GET
   if(StringFind(clean, "http://") == 0)
   {
      if(StringFind(clean, "http://localhost") != 0 && StringFind(clean, "http://127.0.0.1") != 0)
      {
         clean = "https://" + StringSubstr(clean, 7);
      }
   }

   // Strip trailing slash so endpoint paths don't double-slash (which causes 404)
   while(StringLen(clean) > 0 && StringSubstr(clean, StringLen(clean) - 1, 1) == "/")
   {
      clean = StringSubstr(clean, 0, StringLen(clean) - 1);
   }

   return clean;
}

//+------------------------------------------------------------------+
//| Service entry point. Runs in the terminal's service thread and    |
//| owns everything OnTimer() used to do. There is no chart, no       |
//| EventSetTimer, and no trade transaction event.                    |
//+------------------------------------------------------------------+
void OnStart()
{
   if(!InitService())
   {
      Print(">>> [PipstrideMonitor] Service stopped: initialization failed.");
      return;
   }

   while(!IsStopped())
   {
      PollDealChanges();
      RunPendingTradeSync();
      SendHeartbeat();
      Sleep(MathMax(1, InpHeartbeatInterval) * 1000);
   }

   CleanupService();
}

//+------------------------------------------------------------------+
//| One-time setup (the old OnInit body).                             |
//+------------------------------------------------------------------+
bool InitService()
{
   Print(">>> [PipstrideMonitor] Starting Pure Read-Only MT5 Telemetry Service v2.00...");
   Print(">>> [PipstrideMonitor] NOTICE: This service is 100% READ-ONLY. It possesses ZERO order execution capability.");

   // Clipboard-pasted tokens often keep trailing newlines/spaces, which break
   // the header line and degrade the POST into a GET.
   g_bridge_token = SanitizeBridgeToken(InpBridgeToken);
   g_backend_url  = SanitizeBackendUrl(InpBackendUrl);

   if(StringLen(g_bridge_token) == 0)
   {
      Print(">>> [PipstrideMonitor] ERROR: InpBridgeToken is empty. Open Pipstride -> Connections, copy the token into the service inputs, then restart it.");
      return false;
   }

   // Globals survive a restart, so caches derived from settings or from a
   // previous account must never be reused.
   InvalidateDerivedCaches();
   ResolveDefaultSymbol();
   EnsureWatchlistCache();
   ResetCandleCache();

   Print(">>> [PipstrideMonitor] Target Backend: ", g_backend_url);
   Print(">>> [PipstrideMonitor] Default Symbol: ", (g_default_symbol == "" ? "(unresolved)" : g_default_symbol));

   SendHeartbeat();

   // Seed full trade history once at startup; afterwards only deal polling
   // (and the 30-minute safety net) trigger a sync.
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

   // Baseline the deal counter so the very first poll does not look like a
   // burst of new deals.
   HistorySelect(TimeCurrent() - 86400, TimeCurrent());
   g_last_deal_count = HistoryDealsTotal();
   g_last_deal_ticket = (g_last_deal_count > 0 ? HistoryDealGetTicket(g_last_deal_count - 1) : 0);
   g_last_deal_poll = TimeCurrent();

   Print(">>> [PipstrideMonitor] Service started. Heartbeat interval: ", InpHeartbeatInterval, "s.");
   return true;
}

//+------------------------------------------------------------------+
//| Service shutdown.                                                 |
//+------------------------------------------------------------------+
void CleanupService()
{
   Print(">>> [PipstrideMonitor] Service stopped.");
}

//+------------------------------------------------------------------+
//| Resolve one real broker symbol. A service has no chart symbol, so |
//| FindBrokerSymbol() and the candle feed need a concrete default.   |
//+------------------------------------------------------------------+
void ResolveDefaultSymbol()
{
   g_default_symbol = "";
   if(SymbolsTotal(false) > 0)
      g_default_symbol = SymbolName(0, false);
}

//+------------------------------------------------------------------+
//| Drop the cached candle payload so the next heartbeat rebuilds it. |
//+------------------------------------------------------------------+
void ResetCandleCache()
{
   g_candles_built_at = 0;
}

//+------------------------------------------------------------------+
//| Polling replacement for OnTradeTransaction.                       |
//|                                                                   |
//| MQL5 Services never receive trade transaction events, so the old   |
//| event-driven sync would silently die and the journal would only    |
//| refresh on the 30-minute safety net. Diffing the deal count and    |
//| newest ticket over the last 24h is far cheaper than replaying the  |
//| whole InpHistoryDays window, and caps sync latency at roughly one  |
//| heartbeat interval.                                                |
//+------------------------------------------------------------------+
void PollDealChanges()
{
   datetime now = TimeCurrent();
   if(g_last_deal_poll != 0 && (now - g_last_deal_poll) < 1) return;
   g_last_deal_poll = now;

   HistorySelect(TimeCurrent() - 86400, now);
   int total = HistoryDealsTotal();
   ulong newest = (total > 0 ? HistoryDealGetTicket(total - 1) : 0);

   if(total != g_last_deal_count || newest != g_last_deal_ticket)
   {
      g_last_deal_count = total;
      g_last_deal_ticket = newest;
      g_trades_dirty = true;
   }
}

//+------------------------------------------------------------------+
//| Trade-sync dispatch, moved verbatim out of OnTimer().             |
//+------------------------------------------------------------------+
void RunPendingTradeSync()
{
   datetime now = TimeCurrent();

   // Full replay safety net: heals a journal reset, a missed deal while the
   // terminal was offline, and any dropped batch. Cheap (one request per
   // 30 min) and bounded by the 100-deal window.
   bool periodic = (now - g_last_full_sync) >= 1800;

   // After a failure, back off to one attempt per 30s so a dead backend
   // cannot turn every tick into a 3-second blocking request.
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

   // No chart to fall back to in a service: hand back the resolved default
   // symbol and let callers skip an empty result.
   return g_default_symbol;
}

//+------------------------------------------------------------------+
//| Drop every cache derived from inputs or quotes. Reinit-safe.     |
//+------------------------------------------------------------------+
void InvalidateDerivedCaches()
{
   g_watch_count = -1;                       // forces EnsureWatchlistCache to re-resolve
   g_active_broker = "";                     // re-resolve the streamed symbol too
   for(int i = 0; i < MAX_WATCH_SYMBOLS; i++)
      g_d1_cache[i].valid = false;           // stale symbol data must not survive a re-init
}

//+------------------------------------------------------------------+
//| Resolve the watchlist once. FindBrokerSymbol walks every symbol  |
//| in the terminal, which is far too expensive for a timer tick.    |
//|                                                                  |
//| Source of truth is the dashboard (heartbeat response). Before     |
//| the first response arrives the list is just the default symbol,   |
//| which is all a chartless service can resolve on its own.          |
//+------------------------------------------------------------------+
void EnsureWatchlistCache()
{
   if(g_watch_count >= 0) return;

   int count = 0;
   if(g_watchlist_count > 0)
   {
      for(int i = 0; i < g_watchlist_count && count < MAX_WATCH_SYMBOLS; i++)
      {
         string baseSym = g_watchlist[i];
         StringTrimLeft(baseSym);
         StringTrimRight(baseSym);
         if(baseSym == "") continue;

         string brokerSym = FindBrokerSymbol(baseSym);
         if(brokerSym == "") continue;

         g_watch_base[count] = baseSym;
         g_watch_broker[count] = brokerSym;
         SymbolSelect(g_watch_broker[count], true);
         count++;
      }
   }
   else if(g_default_symbol != "")
   {
      g_watch_base[0] = g_default_symbol;
      g_watch_broker[0] = g_default_symbol;
      SymbolSelect(g_watch_broker[0], true);
      count = 1;
   }
   g_watch_count = count;
}

//+------------------------------------------------------------------+
//| Minimal JSON readers. MQL5 ships no JSON parser and the heartbeat |
//| response is a flat object plus one string array, so a targeted    |
//| extractor is enough and stays allocation-free on the hot path.    |
//+------------------------------------------------------------------+
bool JsonStringValue(const string json, const string key, string &out)
{
   string needle = "\"" + key + "\"";
   int pos = StringFind(json, needle);
   if(pos < 0) return false;

   int colon = StringFind(json, ":", pos + StringLen(needle));
   if(colon < 0) return false;

   int cursor = colon + 1;
   int len = StringLen(json);
   while(cursor < len)
   {
      ushort ch = StringGetCharacter(json, cursor);
      // 32 space, 9 tab, 13 CR, 10 LF
      if(ch != 32 && ch != 9 && ch != 13 && ch != 10) break;
      cursor++;
   }
   // null / number / bool: the field is present but not a string
   if(cursor >= len || StringGetCharacter(json, cursor) != 34) return false;

   int quoteClose = StringFind(json, "\"", cursor + 1);
   if(quoteClose < 0) return false;

   out = StringSubstr(json, cursor + 1, quoteClose - cursor - 1);
   return true;
}

int JsonStringArray(const string json, const string key, string &out[])
{
   ArrayResize(out, 0);

   string needle = "\"" + key + "\"";
   int pos = StringFind(json, needle);
   if(pos < 0) return 0;

   int open = StringFind(json, "[", pos + StringLen(needle));
   if(open < 0) return 0;
   int close = StringFind(json, "]", open + 1);
   if(close < 0) return 0;

   string body = StringSubstr(json, open + 1, close - open - 1);
   int count = 0;
   int cursor = 0;
   while(count < MAX_CONTROL_SYMBOLS)
   {
      int quoteOpen = StringFind(body, "\"", cursor);
      if(quoteOpen < 0) break;
      int quoteClose = StringFind(body, "\"", quoteOpen + 1);
      if(quoteClose < 0) break;

      string value = StringSubstr(body, quoteOpen + 1, quoteClose - quoteOpen - 1);
      if(value != "")
      {
         ArrayResize(out, count + 1);
         out[count] = value;
         count++;
      }
      cursor = quoteClose + 1;
   }
   return count;
}

//+------------------------------------------------------------------+
//| Apply dashboard control state from the heartbeat response.        |
//| A symbol change drops the candle cache immediately; waiting the   |
//| usual 30 s window would make the web UI look frozen.              |
//+------------------------------------------------------------------+
void ApplyServerControl(const string response)
{
   if(StringLen(response) == 0) return;

   string active = "";
   if(JsonStringValue(response, "active_market_symbol", active))
   {
      StringTrimLeft(active);
      StringTrimRight(active);
      StringToUpper(active);
      if(active != "" && active != g_active_symbol)
      {
         g_active_symbol = active;
         g_active_broker = "";                // resolve on the next payload
         ResetCandleCache();                  // rebuild now, not in 30 s
      }
   }

   string list[];
   int count = JsonStringArray(response, "watchlist", list);
   if(count <= 0) return;                      // empty/unparsable: keep the old list

   bool changed = (count != g_watchlist_count);
   for(int i = 0; i < count && !changed; i++)
   {
      if(StringCompare(list[i], g_watchlist[i], false) != 0) changed = true;
   }
   if(!changed) return;

   g_watchlist_count = 0;
   for(int i = 0; i < count && i < MAX_CONTROL_SYMBOLS; i++)
   {
      string sym = list[i];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(sym == "") continue;
      g_watchlist[g_watchlist_count] = sym;
      g_watchlist_count++;
   }
   InvalidateDerivedCaches();                  // quote list and D1 caches are stale
}

//+------------------------------------------------------------------+
//| Broker name of the symbol the dashboard streamed.                 |
//| Cached because FindBrokerSymbol scans every symbol in the         |
//| terminal and this runs on every heartbeat.                        |
//+------------------------------------------------------------------+
string ActiveBrokerSymbol()
{
   if(g_active_broker != "") return g_active_broker;

   string base = (g_active_symbol == "" ? g_default_symbol : g_active_symbol);
   if(base == "") return "";

   g_active_broker = FindBrokerSymbol(base);
   if(g_active_broker == "") g_active_broker = g_default_symbol;
   return g_active_broker;
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

      // Only position deals belong in closed_trades. A balance/credit deal
      // carries no position and must never reach the trade table (13-02).
      long dealType = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

      string dealSymbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
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
//| Append one balance deal to the JSON array being built.           |
//+------------------------------------------------------------------+
void AppendCashFlowRecord(string &json, const int count, const ulong dealTicket,
                          const double amount, const long dealTime)
{
   if(count > 0) json += ",";
   json += StringFormat(
      "{\"ticket\":%I64u,\"category\":\"%s\",\"profit\":%.2f,\"time\":%I64d}",
      dealTicket,
      (amount >= 0.0 ? "DEPOSIT" : "WITHDRAWAL"),
      amount,
      dealTime
   );
}

//+------------------------------------------------------------------+
//| Build JSON array of balance deals: deposits and withdrawals.     |
//| A balance deal has no symbol, no volume and no prices, and no     |
//| position id. Sending it on its own stream keeps it out of every   |
//| trade aggregate (win rate, volume, source) by construction.       |
//+------------------------------------------------------------------+
string BuildCashFlowJson()
{
   datetime fromTime = (InpHistoryDays > 0 ? (TimeCurrent() - InpHistoryDays * 86400) : 0);

   // The server anchors the equity curve on the account's very first deposit,
   // and that deposit may be far older than the reporting window. Balance deals
   // are sparse, so one full scan is cheap and keeps the baseline exact.
   ulong baselineTicket = 0;
   double baselineAmount = 0.0;
   long baselineTime = 0;
   if(fromTime > 0)
   {
      HistorySelect(0, TimeCurrent());
      int allDeals = HistoryDealsTotal();
      for(int i = 0; i < allDeals; i++)
      {
         ulong t = HistoryDealGetTicket(i);
         if(t <= 0) continue;
         if(HistoryDealGetInteger(t, DEAL_TYPE) != DEAL_TYPE_BALANCE) continue;

         double p = HistoryDealGetDouble(t, DEAL_PROFIT)
                  + HistoryDealGetDouble(t, DEAL_SWAP)
                  + HistoryDealGetDouble(t, DEAL_COMMISSION);
         if(p <= 0.0) continue;

         baselineTicket = t;
         baselineAmount = p;
         baselineTime = HistoryDealGetInteger(t, DEAL_TIME);
         break;
      }
   }

   HistorySelect(fromTime, TimeCurrent());
   int totalDeals = HistoryDealsTotal();

   string json = "[";
   int count = 0;
   int maxRecords = 200;

   for(int i = totalDeals - 1; i >= 0 && count < maxRecords; i--)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket <= 0) continue;

      // TODO(013+): DEAL_TYPE_CREDIT is deliberately out of scope for Fase 013.
      // It is a cash movement too, but it is not a deposit or a withdrawal and
      // the dashboard has no category for it yet.
      if(HistoryDealGetInteger(dealTicket, DEAL_TYPE) != DEAL_TYPE_BALANCE) continue;

      double amount = HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
                    + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                    + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      long dealTime = HistoryDealGetInteger(dealTicket, DEAL_TIME);

      AppendCashFlowRecord(json, count, dealTicket, amount, dealTime);
      count++;
   }

   // An opening deposit older than the window must still reach the server, or
   // the baseline becomes a later top-up and the curve starts too low.
   if(baselineTicket > 0 && baselineTime < fromTime)
   {
      AppendCashFlowRecord(json, count, baselineTicket, baselineAmount, baselineTime);
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
//| The symbol is explicit: a service cannot read a chart's _Symbol. |
//| bars: 35 for the M5/M15 chart, 24 for H1/H4 structure (egress).   |
//+------------------------------------------------------------------+
string BuildCandlesJson(string symbol, ENUM_TIMEFRAMES tf, int bars = 35)
{
   if(symbol == "") return "[]";

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(symbol, tf, 0, bars, rates);
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
   // Two clocks, deliberately kept apart:
   //   timestamp  = TimeLocal()   -> wall clock of the PC running the terminal
   //   broker_time = TimeCurrent() -> trade server clock, which defines the day
   // Sending only the local clock made the API anchor the daily drawdown at the
   // trader's midnight (UTC+7) instead of the broker's (spec 003, ticket 09-01).
   long timestamp = (long)TimeLocal();
   long broker_time = (long)TimeCurrent();

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
   // The streamed symbol comes from the dashboard, not from a chart: a Service
   // has no _Symbol, and ApplyServerControl() resets this cache on a change.
   string candleSymbol = ActiveBrokerSymbol();
   if(g_candles_built_at == 0 || (TimeCurrent() - g_candles_built_at) >= 30)
   {
      g_cached_candles_m15 = BuildCandlesJson(candleSymbol, PERIOD_M15, 35);
      g_cached_candles_m5 = BuildCandlesJson(candleSymbol, PERIOD_M5, 35);
      // H1/H4 feed the market-structure panel. 24 bars is the minimum the
      // structure read needs, and keeps the heartbeat payload small.
      g_cached_candles_h1 = BuildCandlesJson(candleSymbol, PERIOD_H1, 24);
      g_cached_candles_h4 = BuildCandlesJson(candleSymbol, PERIOD_H4, 24);
      g_candles_built_at = TimeCurrent();
   }
   string candlesM15Json = g_cached_candles_m15;
   string candlesM5Json = g_cached_candles_m5;
   string candlesH1Json = g_cached_candles_h1;
   string candlesH4Json = g_cached_candles_h4;

   // Host environment is no longer an input: a service cannot be configured
   // from a chart, so detect the MT5 VPS flag and nothing else.
   bool isMqlVps = (bool)TerminalInfoInteger(TERMINAL_VPS);
   string host_type = (isMqlVps ? "vps" : "local");

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
      + "\"candles_h1\":" + candlesH1Json + ","
      + "\"candles_h4\":" + candlesH4Json + ","
      + "\"chart_symbol\":\"" + EscapeJsonString(candleSymbol) + "\","
      + "\"bridge_token\":\"" + EscapeJsonString(g_bridge_token) + "\","
      + "\"host_type\":\"" + host_type + "\","
      + StringFormat("\"timestamp\":%I64d", timestamp)
      + StringFormat(",\"broker_time\":%I64d", broker_time)
      + "}";

   return json;
}

//+------------------------------------------------------------------+
//| Send a dedicated trade-sync request (only on deal events)        |
//+------------------------------------------------------------------+
bool SendTradeSync(bool silent)
{
   if(StringLen(g_bridge_token) == 0)
   {
      // Same network degradation as the heartbeat: without the bridge token
      // header a POST can arrive as GET. Do not attempt the request.
      g_consecutive_errors++;
      if(g_consecutive_errors % 10 == 1)
         Print(">>> [PipstrideMonitor] Trade sync skipped: InpBridgeToken is empty.");
      return false;
   }

   string closedTradesJson = BuildClosedTradesJson();
   string cashFlowJson = BuildCashFlowJson();
   // Avoid the network round-trip when nothing changed (both streams empty).
   if(closedTradesJson == "[]" && cashFlowJson == "[]") return true;

   string body = "{"
      + StringFormat("\"account_number\":%I64d,", (long)AccountInfoInteger(ACCOUNT_LOGIN))
      + "\"closed_trades\":" + closedTradesJson + ","
      + "\"cash_flow\":" + cashFlowJson
      + "}";

   string endpoint = g_backend_url + "/api/v1/bridge/sync-trades";
   char postData[];
   char resultData[];
   string resultHeaders;
   // Ensure non-empty body and complete UTF-8 bytes without trailing NUL
   if(StringLen(body) == 0) body = "{\"closed_trades\":[]}";
   StringToCharArray(body, postData, 0, WHOLE_ARRAY, CP_UTF8);
   int postLen = ArraySize(postData);
   if(postLen > 0 && postData[postLen - 1] == 0) ArrayResize(postData, postLen - 1);

   string headers = "Content-Type: application/json\r\nX-Bridge-Token: " + g_bridge_token + "\r\n";
   ResetLastError();
   // Keep a generous budget: trade-sync carries closed deals and runs rarely.
   int res = WebRequest("POST", endpoint, headers, 5000, postData, resultData, resultHeaders);
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
   if(StringLen(g_bridge_token) == 0)
   {
      g_consecutive_errors++;
      if(g_consecutive_errors % 5 == 1)
      {
         Print(">>> [PipstrideMonitor] ERROR: InpBridgeToken is empty. Open Pipstride -> Connections, copy the token into the service inputs.");
      }
      return;
   }

   string endpoint = g_backend_url + "/api/v1/bridge/heartbeat";
   string json = BuildHeartbeatJson();

   // MQL5 quirk: WebRequest with a zero-size body sends a GET regardless of
   // the method parameter. Never hand it an empty array.
   if(StringLen(json) == 0)
      json = StringFormat("{\"account_number\":%I64d}", (long)AccountInfoInteger(ACCOUNT_LOGIN));

   char postData[];
   char resultData[];
   string resultHeaders;

   // Safely encode entire UTF-8 payload (including multi-byte characters) and strip terminating NUL
   StringToCharArray(json, postData, 0, WHOLE_ARRAY, CP_UTF8);
   int postLen = ArraySize(postData);
   if(postLen > 0 && postData[postLen - 1] == 0)
   {
      ArrayResize(postData, postLen - 1);
   }

   string headers = "Content-Type: application/json\r\n";
   headers += "X-Bridge-Token: " + g_bridge_token + "\r\n";
   ResetLastError();

   // 4000ms timeout provides ample headroom for Cloudflare Tunnel latency without timing out (err 5203)
   int res = WebRequest("POST", endpoint, headers, 4000, postData, resultData, resultHeaders);

   if(res == 200)
   {
      g_last_heartbeat = TimeLocal();
      g_consecutive_errors = 0;

      string responseStr = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
      // Server wiped the journal (reset) or has no rows: replay history.
      if(StringFind(responseStr, "\"resync_trades\":true") >= 0)
      {
         g_trades_dirty = true;
      }

      // Dashboard control channel: symbol to stream + quote watchlist.
      ApplyServerControl(responseStr);

      if(InpVerboseLog)
      {
         Print(">>> [PipstrideMonitor] Telemetry OK: ", responseStr);
      }
      return;
   }

   if(res == 401)
   {
      g_consecutive_errors++;
      if(g_consecutive_errors % 5 == 1)
      {
         Print(">>> [PipstrideMonitor] ERROR 401: Unauthorized! Set valid 'InpBridgeToken' from Pipstride Web.");
      }
      return;
   }

   int err = GetLastError();
   g_consecutive_errors++;
   if(g_consecutive_errors % 10 == 1)
   {
      if(err == 4014)
      {
         Print(">>> [PipstrideMonitor] ERROR 4014: URL not allowed! Add '", g_backend_url, "' to Tools -> Options -> Expert Advisors -> Allow WebRequest.");
      }
      else
      {
         Print(">>> [PipstrideMonitor] Telemetry failed. HTTP: ", res, ", WebRequest Err: ", err);
      }
   }
}
//+------------------------------------------------------------------+
