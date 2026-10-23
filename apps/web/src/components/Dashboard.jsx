import React, { useCallback, useEffect, useRef, useState } from 'react';
import PipstrideHeader from './PipstrideHeader';
import PipstrideBottomNav from './PipstrideBottomNav';
import HomeTab from './HomeTab';
import JournalTab from './JournalTab';
import MarketTab from './MarketTab';
import ComingSoonTab from './ComingSoonTab';
import ProfileTab from './ProfileTab';
import Mt5ConnectModal from './Mt5ConnectModal';
import {
  api,
  getActiveConnectionId,
  setActiveConnectionId as persistActiveConnectionId
} from '../services/api';

export default function Dashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('home');
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const [riskStatus, setRiskStatus] = useState(null);
  const [connections, setConnections] = useState([]);
  const [activeConnectionId, setActiveConnectionId] = useState(getActiveConnectionId());
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [pollInterval, setPollInterval] = useState(1000);

  // Modals state
  const [isMt5ModalOpen, setIsMt5ModalOpen] = useState(false);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramStatusMsg, setTelegramStatusMsg] = useState(null);
  const timerRef = useRef(null);

  const loadConnections = useCallback(async () => {
    try {
      const list = await api.getConnections();
      setConnections(list);
      setConnectionsLoaded(true);

      const stored = getActiveConnectionId();
      const stillValid = stored && list.some((c) => c.id === stored);
      if (!stillValid) {
        const fallback = list[0]?.id || null;
        persistActiveConnectionId(fallback);
        setActiveConnectionId(fallback);
      }
      return list;
    } catch {
      setConnectionsLoaded(true);
      return [];
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!activeConnectionId) {
      setBridgeStatus(null);
      setRiskStatus(null);
      return;
    }

    try {
      const [status, risk] = await Promise.all([
        api.getBridgeStatus(),
        api.getRiskStatus().catch(() => null)
      ]);
      setBridgeStatus(status);
      setRiskStatus(risk);
    } catch {
      setBridgeStatus((prev) => ({
        ...prev,
        is_connected: false,
        terminal_connected: false,
        seconds_since_last_heartbeat: null
      }));
    }
  }, [activeConnectionId]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    let isMounted = true;
    const runPoll = async () => {
      if (!isMounted) return;
      await fetchStatus();
    };

    runPoll();
    timerRef.current = setInterval(runPoll, pollInterval);

    return () => {
      isMounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchStatus, pollInterval]);

  const handleSelectConnection = (connectionId) => {
    persistActiveConnectionId(connectionId);
    setActiveConnectionId(connectionId);
    setBridgeStatus(null);
    setRiskStatus(null);
  };

  const handleConnectionsChanged = async () => {
    const list = await loadConnections();
    await fetchStatus();
    return list;
  };

  const handleTestTelegram = async () => {
    setIsTestingTelegram(true);
    setTelegramStatusMsg(null);
    try {
      const res = await api.sendTelegramTestAlert();
      if (res.delivered) {
        setTelegramStatusMsg({ type: 'success', text: 'Telegram alert sent successfully!' });
      } else {
        setTelegramStatusMsg({ type: 'warning', text: 'Telegram bot not configured or disabled.' });
      }
    } catch (err) {
      setTelegramStatusMsg({ type: 'error', text: err.message || 'Telegram test failed.' });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const metrics = bridgeStatus?.metrics || {};
  const isConnected = bridgeStatus?.is_connected || false;
  const secondsSinceHeartbeat = bridgeStatus?.seconds_since_last_heartbeat ?? null;

  return (
    <div className="app-shell" id="pipstride-dashboard">
      {/* Sticky Header with Logo, Navigation Tabs & Status */}
      <PipstrideHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isConnected={isConnected}
        latency={secondsSinceHeartbeat}
        connections={connections}
        activeConnectionId={activeConnectionId}
        onSelectConnection={handleSelectConnection}
        onOpenMt5Modal={() => setIsMt5ModalOpen(true)}
      />

      {/* Main Container */}
      <main className="app-main">
        {/* Tab 1: Home Command Center */}
        <div className={`page-container ${activeTab === 'home' ? 'active' : ''}`} id="tab-home">
          <HomeTab
            bridgeStatus={bridgeStatus}
            riskStatus={riskStatus}
            hasConnection={connections.length > 0}
            onNavigateJournal={() => setActiveTab('journal')}
            onNavigateAI={() => setActiveTab('ai')}
            onNavigateMarket={() => setActiveTab('market')}
            onOpenConnect={() => setIsMt5ModalOpen(true)}
            onRefresh={fetchStatus}
          />
        </div>

        {/* Tab 2: Trading Journal */}
        <div className={`page-container ${activeTab === 'journal' ? 'active' : ''}`} id="tab-journal">
          <JournalTab
            activeTab={activeTab}
            closedTradesCount={bridgeStatus?.closed_trades_count}
            bridgeStatus={bridgeStatus}
            onNavigateAI={() => setActiveTab('ai')}
          />
        </div>

        {/* Tab 3: Market Overview */}
        <div className={`page-container ${activeTab === 'market' ? 'active' : ''}`} id="tab-market">
          <MarketTab bridgeStatus={bridgeStatus} />
        </div>

        {/* Tab 4: AI Assistant (Coming Soon) */}
        <div className={`page-container ${activeTab === 'ai' ? 'active' : ''}`} id="tab-ai">
          <ComingSoonTab type="ai" onBackToHome={() => setActiveTab('home')} />
        </div>

        {/* Tab 5: Replay & Backtest (Coming Soon) */}
        <div className={`page-container ${activeTab === 'replay' ? 'active' : ''}`} id="tab-replay">
          <ComingSoonTab type="replay" onBackToHome={() => setActiveTab('home')} />
        </div>

        {/* Tab 6: Profile & Settings */}
        <div className={`page-container ${activeTab === 'profile' ? 'active' : ''}`} id="tab-profile">
          <ProfileTab
            user={user}
            onLogout={onLogout}
            bridgeStatus={bridgeStatus}
            riskStatus={riskStatus}
            connections={connections}
            activeConnectionId={activeConnectionId}
            onSelectConnection={handleSelectConnection}
            onConnectionsChanged={handleConnectionsChanged}
            pollInterval={pollInterval}
            onPollIntervalChange={setPollInterval}
            onOpenMt5Modal={() => setIsMt5ModalOpen(true)}
            onTestTelegram={handleTestTelegram}
            isTestingTelegram={isTestingTelegram}
            telegramStatusMsg={telegramStatusMsg}
          />
        </div>
      </main>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <PipstrideBottomNav activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* MT5 Connect & Broker Screen Modal */}
      <Mt5ConnectModal
        isOpen={isMt5ModalOpen}
        onClose={() => setIsMt5ModalOpen(false)}
        isConnected={isConnected}
        accountNumber={metrics.account_number}
        connections={connections}
        connectionsLoaded={connectionsLoaded}
        activeConnectionId={activeConnectionId}
        onSelectConnection={handleSelectConnection}
        onConnectionsChanged={handleConnectionsChanged}
        onCheckStatus={fetchStatus}
      />
    </div>
  );
}
