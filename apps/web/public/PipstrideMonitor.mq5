//+------------------------------------------------------------------+
//|                                           PipstrideMonitor.mq5   |
//|                                  Copyright 2026, Pipstride       |
//|                                  https://pipstride.com           |
//+------------------------------------------------------------------+
#property copyright "Pipstride"
#property link      "https://pipstride.com"
#property version   "1.00"
#property description "Pipstride Pure Read-Only MT5 Telemetry & Account Analytics Monitor v1.00 (Zero Trade Execution - 100% Safe)"

//--- Inputs
input group "--- Pipstride Telemetry Settings ---"
input string InpBackendUrl        = "http://localhost:8089";                    // Backend API URL
input string InpBridgeToken       = "";                                        // Pipstride Connection Token (from Web Dashboard)
input string InpMonitoredSymbols  = "XAUUSD,EURUSD,GBPUSD,USDJPY,BTCUSD";      // Watchlist symbols (comma-separated)
input int    InpHistoryDays       = 90;                                        // History lookback days (0 = All History)
input int    InpHeartbeatInterval = 1;                                         // Heartbeat interval in seconds
input bool   InpVerboseLog        = false;                                     // Print detailed logs to Experts tab

//--- Global Variables
datetime g_last_heartbeat = 0;
int      g_consecutive_errors = 0;
string   g_status_msg = "Initializing...";

// Forward Declarations
void SendHeartbeat();
void UpdateChartHUD(string status_text);
string FindBrokerSymbol(string baseSym);
void GetDealPositionOpenDetails(ulong posId, double &openPrice, long &openTime);

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   Print(">>> [PipstrideMonitor] Initializing Pure Read-Only MT5 Telemetry Monitor v1.00...");
   Print(">>> [PipstrideMonitor] NOTICE: This EA is 100% READ-ONLY. It possesses ZERO order execution capability.");
   Print(">>> [PipstrideMonitor] Target Backend: ", InpBackendUrl);

   // Set timer for periodic telemetry heartbeat
   EventSetTimer(MathMax(1, InpHeartbeatInterval));

   g_status_msg = "Started - Connecting to Backend...";
   UpdateChartHUD(g_status_msg);

   // Send initial heartbeat immediately
   SendHeartbeat();

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
   SendHeartbeat();
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
   string symbols[];
   int totalSym = StringSplit(InpMonitoredSymbols, ',', symbols);
   string json = "[";
   int count = 0;

   for(int i = 0; i < totalSym; i++)
   {
      string baseSym = symbols[i];
      StringTrimLeft(baseSym);
      StringTrimRight(baseSym);
      if(baseSym == "") continue;

      string actualSym = FindBrokerSymbol(baseSym);
      SymbolSelect(actualSym, true);

      double bid = SymbolInfoDouble(actualSym, SYMBOL_BID);
      double ask = SymbolInfoDouble(actualSym, SYMBOL_ASK);
      if(bid <= 0.0) continue;

      int digits = (int)SymbolInfoInteger(actualSym, SYMBOL_DIGITS);
      int spread = (int)SymbolInfoInteger(actualSym, SYMBOL_SPREAD);

      double changePct = 0.0;
      double high = bid;
      double low = bid;

      MqlRates d1Rates[];
      ArraySetAsSeries(d1Rates, true);
      if(CopyRates(actualSym, PERIOD_D1, 0, 1, d1Rates) > 0)
      {
         if(d1Rates[0].open > 0.0)
         {
            changePct = ((bid - d1Rates[0].open) / d1Rates[0].open) * 100.0;
         }
         high = d1Rates[0].high;
         low = d1Rates[0].low;
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

   double initial_deposit = GetAccountInitialDeposit();
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
   string closedTradesJson = BuildClosedTradesJson();
   string candlesM15Json = BuildCandlesJson(PERIOD_M15);
   string candlesM5Json = BuildCandlesJson(PERIOD_M5);

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
      + "\"closed_trades\":" + closedTradesJson + ","
      + "\"candles\":" + candlesM15Json + ","
      + "\"candles_m5\":" + candlesM5Json + ","
      + "\"chart_symbol\":\"" + EscapeJsonString(_Symbol) + "\","
      + "\"bridge_token\":\"" + EscapeJsonString(InpBridgeToken) + "\","
      + StringFormat("\"timestamp\":%I64d", timestamp)
      + "}";

   return json;
}

//+------------------------------------------------------------------+
//| Send HTTP POST heartbeat to FastAPI backend                      |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   string endpoint = InpBackendUrl + "/api/v1/bridge/heartbeat";
   string json = BuildHeartbeatJson();

   char postData[];
   char resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, WHOLE_ARRAY, CP_UTF8);
   int postLen = ArraySize(postData);
   if(postLen > 0 && postData[postLen - 1] == 0)
   {
      ArrayResize(postData, postLen - 1);
   }

   string headers = "Content-Type: application/json\r\n";
   if(StringLen(InpBridgeToken) > 0)
   {
      headers += "X-Bridge-Token: " + InpBridgeToken + "\r\n";
   }
   ResetLastError();

   int res = WebRequest("POST", endpoint, headers, 3000, postData, resultData, resultHeaders);

   if(res == 200)
   {
      g_last_heartbeat = TimeLocal();
      g_consecutive_errors = 0;
      g_status_msg = "Connected (Read-Only OK - 200)";

      if(InpVerboseLog)
      {
         string responseStr = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
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
   string hud = "========================================\n"
              + "  TRADEGEAR MONITOR - 100% READ-ONLY   \n"
              + "========================================\n"
              + "Backend URL    : " + InpBackendUrl + "\n"
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
