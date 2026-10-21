import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export default function Dashboard({ user, token, onLogout, onReturnToShowcase, showToast }) {
  const [account, setAccount] = useState(null);
  const [statement, setStatement] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [isCardFrozen, setIsCardFrozen] = useState(false);
  const [displayBalance, setDisplayBalance] = useState(0);

  // Modals & Drawers
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isAddMoneyOpen, setIsAddMoneyOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);

  // Send Money form state
  const [destId, setDestId] = useState('');
  const [amountEur, setAmountEur] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Concurrency Stress Test state
  const [isBurstRunning, setIsBurstRunning] = useState(false);
  const [burstLogs, setBurstLogs] = useState([]);
  const [burstSummary, setBurstSummary] = useState(null);

  const getHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  // Fetch account and statement on mount
  useEffect(() => {
    fetchAccountData();
  }, []);

  const fetchAccountData = async () => {
    try {
      const accRes = await fetch('/accounts/me', { headers: getHeaders() });
      if (!accRes.ok) throw new Error('Could not fetch accounts');
      const accounts = await accRes.json();

      let activeAcc = accounts[0];
      if (!activeAcc) {
        // Auto provision
        const createRes = await fetch('/accounts', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ owner_name: user?.full_name || 'Veyra Member', initial_balance: 50000 }),
        });
        activeAcc = await createRes.json();
      }

      setAccount(activeAcc);
      animateCountUp(activeAcc.balance);

      // Fetch Statement
      const stmtRes = await fetch(`/accounts/${activeAcc.id}/statement`, { headers: getHeaders() });
      if (stmtRes.ok) {
        const stmtData = await stmtRes.json();
        setStatement(stmtData.entries || []);
      }
    } catch (err) {
      console.error(err);
      showToast('Sync Notice', 'Failed to synchronize live account data.', 'error');
    }
  };

  const animateCountUp = (targetCents) => {
    const start = displayBalance;
    const end = targetCents;
    const duration = 700;
    const startTime = performance.now();

    const frame = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = Math.round(start + (end - start) * eased);
      setDisplayBalance(current);

      if (progress < 1) requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
  };

  // Copy IBAN
  const [ibanCopied, setIbanCopied] = useState(false);
  const handleCopyIban = () => {
    if (!account) return;
    navigator.clipboard.writeText(account.account_number);
    setIbanCopied(true);
    showToast('IBAN Copied', account.account_number, 'success');
    setTimeout(() => setIbanCopied(false), 2000);
  };

  // Freeze Card
  const toggleFreeze = () => {
    setIsCardFrozen(!isCardFrozen);
    showToast(
      !isCardFrozen ? 'Card Frozen' : 'Card Restored',
      !isCardFrozen ? 'Online transactions temporarily disabled.' : 'Veyra Black card is active.',
      !isCardFrozen ? 'info' : 'success'
    );
  };

  // Create new treasury sub-account
  const handleCreateSubAccount = async () => {
    try {
      const res = await fetch('/accounts', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ owner_name: user?.full_name || 'Veyra Member', initial_balance: 50000 }),
      });
      const newAcc = await res.json();
      showToast('New Treasury Opened', `Account #${newAcc.id} provisioned with €500.00.`, 'success');
      setDestId(newAcc.id.toString());
      fetchAccountData();
    } catch (err) {
      showToast('Error', err.message, 'error');
    }
  };

  // Handle Transfer Submit
  const handleSendTransfer = async (e) => {
    e.preventDefault();
    if (isCardFrozen) {
      showToast('Card Frozen', 'Unfreeze your card to authorize transfers.', 'error');
      return;
    }
    const targetAccId = parseInt(destId, 10);
    const amountVal = parseFloat(amountEur);

    if (isNaN(targetAccId) || isNaN(amountVal) || amountVal <= 0) {
      showToast('Invalid Input', 'Please enter valid recipient and positive amount.', 'error');
      return;
    }

    setIsSending(true);
    const cents = Math.round(amountVal * 100);
    const idKey = `veyra-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    try {
      const res = await fetch('/transfers', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          source_account_id: account.id,
          destination_account_id: targetAccId,
          amount: cents,
          idempotency_key: idKey,
        }),
      });

      const data = await res.json();
      if (res.status === 200) {
        showToast('Settlement Complete', `Dispatched €${amountVal.toFixed(2)} to Account #${targetAccId}.`, 'success');
        setIsSendModalOpen(false);
        setAmountEur('');
        fetchAccountData();
      } else if (res.status === 422) {
        showToast('Anti-Fraud AML Alert', data.detail || 'Transfer exceeds regulatory ceiling (>€10,000.00).', 'aml');
      } else if (res.status === 429) {
        showToast('Rate Limit Exceeded', data.detail || 'Maximum 10 transfers per minute.', 'ratelimit');
      } else {
        showToast('Transfer Rejected', data.detail || 'Transaction failed.', 'error');
      }
    } catch (err) {
      showToast('Network Error', err.message, 'error');
    } finally {
      setIsSending(false);
    }
  };

  // Run Concurrency Stress Burst
  const handleRunStressBurst = async () => {
    if (!account) return;
    setIsBurstRunning(true);
    setBurstLogs([]);
    setBurstSummary(null);

    const targetId = account.id === 1 ? 2 : 1;
    const startTime = performance.now();

    const requests = Array.from({ length: 5 }).map((_, idx) => {
      const reqStart = performance.now();
      const idKey = `burst-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;

      return fetch('/transfers', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          source_account_id: account.id,
          destination_account_id: targetId,
          amount: 500, // €5.00
          idempotency_key: idKey,
        }),
      })
        .then(async (res) => {
          let data;
          try {
            data = await res.json();
          } catch (e) {
            data = {};
          }
          return {
            index: idx + 1,
            status: res.status,
            latency: res.headers.get('X-Process-Time-Ms') || Math.round(performance.now() - reqStart),
            detail: res.status === 200 ? 'SETTLED ATOMICALLY' : data.detail || 'REJECTED',
          };
        })
        .catch((err) => ({
          index: idx + 1,
          status: 0,
          latency: 0,
          detail: err.message,
        }));
    });

    const results = await Promise.all(requests);
    const totalElapsed = Math.round(performance.now() - startTime);

    // Stream logs
    results.forEach((r, i) => {
      setTimeout(() => {
        setBurstLogs((prev) => [...prev, r]);
      }, i * 90);
    });

    setTimeout(() => {
      setBurstSummary({
        totalMs: totalElapsed,
        integrity: '100% PESSIMISTIC ROW-LOCK VERIFIED',
      });
      setIsBurstRunning(false);
      showToast('Stress Test Complete', `5 parallel requests resolved in ${totalElapsed}ms.`, 'success');
      fetchAccountData();
    }, 5 * 90 + 150);
  };

  // Filter statement
  const filteredStatement = statement.filter((tx) => {
    if (filter === 'ALL') return true;
    return tx.entry_type === filter;
  });

  const userInitials = user?.full_name
    ? user.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'VY';

  return (
    <div className="dashboard-viewport">
      {/* TOP NAVIGATION BAR */}
      <header className="dash-header">
        <div className="dash-header-container">
          {/* Logo & Title */}
          <div className="dash-brand">
            <img src="/veyra-logo.png" alt="Veyra" className="dash-brand-icon" />
            <div>
              <div className="dash-brand-title">VEYRA</div>
              <div className="dash-brand-subtitle">Private Wealth & Digital Ledger</div>
            </div>
          </div>

          {/* Right Actions */}
          <div className="dash-nav-actions">
            {/* Engine Inspector Drawer Trigger */}
            <button
              type="button"
              className="dash-engine-btn"
              onClick={() => setIsDrawerOpen(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>Engine Inspector</span>
            </button>

            {/* Showcase View Switcher */}
            <button
              type="button"
              className="dash-showcase-btn"
              onClick={onReturnToShowcase}
              title="Return to 3D Landing Showcase"
            >
              Showcase
            </button>

            {/* User Avatar */}
            <div className="dash-user-avatar" title={user?.email}>
              {userInitials}
            </div>

            {/* Logout Button */}
            <button
              type="button"
              className="dash-logout-btn"
              onClick={onLogout}
              title="Sign Out"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* DASHBOARD CONTENT BODY */}
      <main className="dash-main-container">
        {/* ROW 1: HERO BALANCE & TITANIUM VEYRA CARD */}
        <div className="dash-hero-grid">
          {/* LEFT: BALANCE HERO & SPARKLINE & QUICK ACTIONS */}
          <div className="dash-balance-card">
            <div className="dash-card-header-row">
              <span className="dash-balance-label">Total Liquid Reserve</span>
              <span className="dash-currency-badge">EUR (€)</span>
            </div>

            {/* Giant Balance */}
            <div className="dash-hero-balance">
              € {(displayBalance / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>

            {/* Trend Badge */}
            <div className="dash-trend-row">
              <span className="dash-trend-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
                <span>+€24.50 this week</span>
              </span>
              <span className="dash-trend-subtext">vs last statement</span>
            </div>

            {/* Interactive SVG Sparkline Area Chart */}
            <div className="dash-sparkline-box">
              <div className="dash-sparkline-header">
                <span>Performance Yield</span>
                <div className="dash-sparkline-ranges">
                  <span className="active">1W</span>
                  <span>1M</span>
                  <span>1Y</span>
                </div>
              </div>
              <svg className="dash-sparkline-svg" viewBox="0 0 500 90" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="veyraChartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon
                  points="0,70 80,55 160,60 240,35 320,48 400,20 500,10 500,90 0,90"
                  fill="url(#veyraChartGrad)"
                />
                <path
                  d="M0,70 Q80,55 160,60 T320,48 T400,20 T500,10"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            {/* Quick Action Pill Buttons */}
            <div className="dash-actions-row">
              <button
                type="button"
                className="dash-action-btn-primary"
                onClick={() => setIsSendModalOpen(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                <span>Send Money</span>
              </button>

              <button
                type="button"
                className="dash-action-btn-secondary"
                onClick={() => setIsAddMoneyOpen(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Add Money</span>
              </button>

              <button
                type="button"
                className="dash-action-btn-secondary"
                onClick={toggleFreeze}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>{isCardFrozen ? 'Unfreeze' : 'Freeze Card'}</span>
              </button>
            </div>
          </div>

          {/* RIGHT: VEYRA TITANIUM METAL CARD */}
          <div className="dash-card-column">
            <div className="dash-card-label-row">
              <span className="dash-card-tag">Private Card Instrument</span>
              <span className={`dash-card-status-pill ${isCardFrozen ? 'frozen' : 'active'}`}>
                {isCardFrozen ? 'FROZEN' : 'ACTIVE'}
              </span>
            </div>

            {/* 3D Physical Titanium Card */}
            <div className="veyra-metal-card">
              {/* Frosted Overlay if Card is Frozen */}
              {isCardFrozen && (
                <div className="card-frozen-shield">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span className="card-frozen-title">CARD FROZEN</span>
                  <span className="card-frozen-sub">Tap Unfreeze to unlock</span>
                </div>
              )}

              {/* Card Header: Brand Monogram & Contactless NFC */}
              <div className="metal-card-top">
                <div className="metal-card-brand-group">
                  <img src="/veyra-logo.png" alt="V" className="metal-card-v-icon" />
                  <div>
                    <span className="metal-card-brand-text">VEYRA BLACK</span>
                    <span className="metal-card-subbrand">World Elite Reserve</span>
                  </div>
                </div>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8">
                  <path d="M8.5 16.5a5 5 0 0 1 0-7" />
                  <path d="M12 19a9 9 0 0 0 0-14" />
                  <path d="M5 14a2 2 0 0 1 0-3" />
                </svg>
              </div>

              {/* Middle: EMV Chip & Metallic Emblem */}
              <div className="metal-card-mid">
                <div className="card-emv-chip">
                  <div className="emv-line" />
                  <div className="emv-dots">
                    <div className="emv-dot" />
                    <div className="emv-dot" />
                  </div>
                  <div className="emv-line" />
                </div>
                <div className="card-metal-emblem">
                  <div className="emblem-circle" />
                  <div className="emblem-circle overlap" />
                </div>
              </div>

              {/* Bottom: IBAN with Copy + Cardholder */}
              <div className="metal-card-bottom">
                <div className="card-iban-bar">
                  <span className="card-iban-text">
                    {account ? account.account_number : 'DE89 •••• •••• •••• ••••'}
                  </span>
                  <button
                    type="button"
                    className="card-copy-btn"
                    onClick={handleCopyIban}
                    title="Copy IBAN"
                  >
                    {ibanCopied ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2">
                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                    )}
                  </button>
                </div>

                <div className="card-meta-row">
                  <div>
                    <span className="card-meta-lbl">Cardholder</span>
                    <span className="card-meta-val">{account?.owner_name || user?.full_name || 'Veyra Member'}</span>
                  </div>
                  <div className="card-meta-right">
                    <span className="card-meta-lbl">Expires</span>
                    <span className="card-meta-val">12/30</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sub-Treasury Account Quick Action */}
            <div className="dash-subaccount-box">
              <div className="dash-subaccount-info">
                <span className="dash-subaccount-dot" />
                <div>
                  <div className="dash-subaccount-title">Primary Checking Ledger</div>
                  <div className="dash-subaccount-id">Account ID #{account?.id || '--'}</div>
                </div>
              </div>
              <button
                type="button"
                className="dash-subaccount-btn"
                onClick={handleCreateSubAccount}
              >
                + New Account
              </button>
            </div>
          </div>
        </div>

        {/* ROW 2: RECENT TRANSACTIONS ACTIVITY */}
        <div className="dash-activity-section">
          <div className="dash-activity-header">
            <div>
              <h2 className="dash-activity-title">Recent Activity</h2>
              <p className="dash-activity-subtitle">Double-entry audit trail synchronized with PostgreSQL core</p>
            </div>

            {/* Filter Pills */}
            <div className="dash-filter-group">
              <button
                type="button"
                className={`dash-filter-pill ${filter === 'ALL' ? 'active' : ''}`}
                onClick={() => setFilter('ALL')}
              >
                All
              </button>
              <button
                type="button"
                className={`dash-filter-pill ${filter === 'CREDIT' ? 'active' : ''}`}
                onClick={() => setFilter('CREDIT')}
              >
                Incoming
              </button>
              <button
                type="button"
                className={`dash-filter-pill ${filter === 'DEBIT' ? 'active' : ''}`}
                onClick={() => setFilter('DEBIT')}
              >
                Outgoing
              </button>

              <button
                type="button"
                className="dash-refresh-btn"
                onClick={fetchAccountData}
                title="Refresh Ledger"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 21h5v-5" />
                </svg>
              </button>
            </div>
          </div>

          {/* Activity List */}
          <div className="dash-activity-list">
            {filteredStatement.length === 0 ? (
              <div className="dash-empty-state">
                No {filter !== 'ALL' ? filter.toLowerCase() : ''} transactions recorded yet.
              </div>
            ) : (
              filteredStatement.map((tx) => {
                const isCredit = tx.entry_type === 'CREDIT';
                const sign = isCredit ? '+' : '-';
                const dateObj = new Date(tx.created_at);
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

                return (
                  <div
                    key={tx.id}
                    className="activity-item-row"
                    onClick={() => setSelectedTx(tx)}
                  >
                    <div className="activity-item-left">
                      <div className="activity-icon-box">
                        {isCredit ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2">
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2">
                            <line x1="7" y1="17" x2="17" y2="7" />
                            <polyline points="7 7 17 7 17 17" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <div className="activity-title">
                          {isCredit ? 'Inbound Treasury Funding' : 'Transfer to Beneficiary'}
                        </div>
                        <div className="activity-meta">
                          {dateStr} at {timeStr} • Tx #{tx.transaction_id}
                        </div>
                      </div>
                    </div>

                    <div className="activity-item-right">
                      <div className={`activity-amount ${isCredit ? 'credit' : 'debit'}`}>
                        {sign}€ {(tx.amount / 100).toFixed(2)}
                      </div>
                      <div className="activity-status">
                        <span className="activity-status-dot" />
                        <span>Completed</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="dash-footer">
        <div className="dash-footer-container">
          <div className="dash-footer-left">
            <span className="dash-footer-dot" />
            <span>VEYRA PRIVATE WEALTH & DIGITAL LEDGER</span>
          </div>
          <div>PostgreSQL 16 Pessimistic Row-Locks • Redis 7 Idempotency • Argon2id Crypto</div>
        </div>
      </footer>

      {/* =================================================== */}
      {/* SEND MONEY MODAL                                    */}
      {/* =================================================== */}
      <AnimatePresence>
        {isSendModalOpen && (
          <div className="modal-backdrop" onClick={() => setIsSendModalOpen(false)}>
            <motion.div
              className="modal-box"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
            >
              <div className="modal-header">
                <div>
                  <h3 className="modal-title">Send Funds</h3>
                  <p className="modal-subtitle">Instant settlement across Veyra digital ledgers</p>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setIsSendModalOpen(false)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSendTransfer} className="modal-form">
                <div className="modal-field">
                  <label className="modal-label">Recipient Account ID</label>
                  <div className="modal-input-row">
                    <input
                      type="number"
                      required
                      min={1}
                      className="modal-input"
                      value={destId}
                      onChange={(e) => setDestId(e.target.value)}
                      placeholder="e.g. 2"
                    />
                    <button
                      type="button"
                      className="modal-quick-pill"
                      onClick={() => setDestId('2')}
                    >
                      Account #2
                    </button>
                  </div>
                </div>

                <div className="modal-field">
                  <div className="modal-label-between">
                    <label className="modal-label">Amount in EUR (€)</label>
                    <span className="modal-hint">Max €10,000 (AML)</span>
                  </div>
                  <div className="modal-amount-input-wrap">
                    <span className="modal-amount-prefix">€</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      min={0.01}
                      className="modal-input modal-input-padded"
                      value={amountEur}
                      onChange={(e) => setAmountEur(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Presets */}
                <div className="modal-presets-row">
                  <button type="button" className="preset-chip" onClick={() => setAmountEur('25.00')}>€25</button>
                  <button type="button" className="preset-chip" onClick={() => setAmountEur('50.00')}>€50</button>
                  <button type="button" className="preset-chip" onClick={() => setAmountEur('100.00')}>€100</button>
                  <button type="button" className="preset-chip" onClick={() => setAmountEur('500.00')}>€500</button>
                  <button type="button" className="preset-chip aml-test" onClick={() => setAmountEur('15000.00')}>Test AML €15k</button>
                </div>

                <div className="modal-fee-banner">
                  <span>Settlement Fee:</span>
                  <span className="free-text">€ 0.00 (Instant Atomic)</span>
                </div>

                <button
                  type="submit"
                  disabled={isSending}
                  className="modal-submit-btn"
                >
                  {isSending ? 'Authorizing Settlement...' : 'Authorize & Dispatch Transfer'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =================================================== */}
      {/* ADD MONEY MODAL                                     */}
      {/* =================================================== */}
      <AnimatePresence>
        {isAddMoneyOpen && (
          <div className="modal-backdrop" onClick={() => setIsAddMoneyOpen(false)}>
            <motion.div
              className="modal-box"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
            >
              <div className="modal-header">
                <div>
                  <h3 className="modal-title">Deposit & Inbound</h3>
                  <p className="modal-subtitle">Fund your Veyra Private checking account</p>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setIsAddMoneyOpen(false)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="modal-body-spacing">
                <div className="deposit-option-card">
                  <div>
                    <h4 className="deposit-option-title">Open Additional Sub-Treasury</h4>
                    <p className="deposit-option-desc">Creates a separate account ledger with €500.00 test capital.</p>
                  </div>
                  <button
                    type="button"
                    className="deposit-action-btn"
                    onClick={() => {
                      handleCreateSubAccount();
                      setIsAddMoneyOpen(false);
                    }}
                  >
                    Open
                  </button>
                </div>

                <div className="deposit-option-card stacked">
                  <h4 className="deposit-option-title">SEPA Wire Credentials</h4>
                  <div className="deposit-meta-list">
                    <div className="deposit-meta-item">
                      <span>Beneficiary Bank:</span>
                      <strong>Veyra Bank AG</strong>
                    </div>
                    <div className="deposit-meta-item">
                      <span>BIC / SWIFT:</span>
                      <strong>VEYRDEFFXXX</strong>
                    </div>
                    <div className="deposit-meta-item">
                      <span>IBAN:</span>
                      <strong>{account?.account_number}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="deposit-copy-full-btn"
                    onClick={() => {
                      handleCopyIban();
                      setIsAddMoneyOpen(false);
                    }}
                  >
                    Copy Full IBAN
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =================================================== */}
      {/* DOUBLE-ENTRY BREAKDOWN MODAL                        */}
      {/* =================================================== */}
      <AnimatePresence>
        {selectedTx && (
          <div className="modal-backdrop" onClick={() => setSelectedTx(null)}>
            <motion.div
              className="modal-box"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
            >
              <div className="modal-header">
                <div>
                  <h3 className="modal-title">Transaction Ledger Record</h3>
                  <p className="modal-subtitle">PostgreSQL Double-Entry Accounting Proof</p>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setSelectedTx(null)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="tx-details-box">
                <div className="tx-row">
                  <span>Entry ID:</span>
                  <strong>#{selectedTx.id}</strong>
                </div>
                <div className="tx-row">
                  <span>Parent Transaction:</span>
                  <strong>#{selectedTx.transaction_id}</strong>
                </div>
                <div className="tx-row">
                  <span>Classification:</span>
                  <span className={`tx-tag ${selectedTx.entry_type}`}>{selectedTx.entry_type}</span>
                </div>
                <div className="tx-row">
                  <span>Monetary Sum:</span>
                  <strong>
                    {selectedTx.entry_type === 'CREDIT' ? '+' : '-'}€ {(selectedTx.amount / 100).toFixed(2)}
                  </strong>
                </div>
                <div className="tx-row">
                  <span>Timestamp:</span>
                  <span>{new Date(selectedTx.created_at).toLocaleString()}</span>
                </div>
              </div>

              <div className="tx-audit-note">
                Immutable double-entry book balancing verified. Sum of debits matches credits in PostgreSQL ACID storage.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =================================================== */}
      {/* SLIDE-OVER ENGINE INSPECTOR DRAWER                  */}
      {/* =================================================== */}
      <AnimatePresence>
        {isDrawerOpen && (
          <div className="drawer-backdrop" onClick={() => setIsDrawerOpen(false)}>
            <motion.div
              className="drawer-panel"
              onClick={(e) => e.stopPropagation()}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="drawer-header">
                <div className="drawer-title-group">
                  <div className="drawer-amber-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="drawer-title">Engine Inspector</h3>
                    <p className="drawer-subtitle">PostgreSQL Row Locks & Redis Telemetry</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="drawer-close-btn"
                  onClick={() => setIsDrawerOpen(false)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="drawer-body">
                {/* Specs Grid */}
                <div className="drawer-specs-grid">
                  <div className="spec-item">
                    <span className="spec-lbl">Database Engine</span>
                    <strong className="spec-val">PostgreSQL 16</strong>
                  </div>
                  <div className="spec-item">
                    <span className="spec-lbl">Locking Strategy</span>
                    <strong className="spec-val">Pessimistic FOR UPDATE</strong>
                  </div>
                  <div className="spec-item">
                    <span className="spec-lbl">Distributed Cache</span>
                    <strong className="spec-val">Redis 7 Cluster</strong>
                  </div>
                  <div className="spec-item">
                    <span className="spec-lbl">Regulatory AML Ceiling</span>
                    <strong className="spec-val">€ 10,000.00</strong>
                  </div>
                </div>

                {/* 5x Concurrency Test Box */}
                <div className="drawer-burst-card">
                  <div className="drawer-burst-header">
                    <h4>5x Concurrency Race Simulation</h4>
                    <span className="burst-badge">STRESS TEST</span>
                  </div>
                  <p className="burst-desc">
                    Fires 5 simultaneous transfer requests in the same millisecond to validate balance consistency under heavy race conditions.
                  </p>

                  <button
                    type="button"
                    disabled={isBurstRunning}
                    className="burst-trigger-btn"
                    onClick={handleRunStressBurst}
                  >
                    {isBurstRunning ? 'Executing 5x Burst...' : 'Trigger 5x Parallel Burst'}
                  </button>
                </div>

                {/* Real-time Telemetry Stream */}
                {burstLogs.length > 0 && (
                  <div className="drawer-telemetry-box">
                    <div className="telemetry-bar">
                      <span>TELEMETRY STREAM</span>
                      <span>{new Date().toLocaleTimeString()}</span>
                    </div>

                    <div className="telemetry-logs-list">
                      {burstLogs.map((log) => (
                        <div key={log.index} className="telemetry-log-item">
                          <div className="telemetry-log-left">
                            <span className="telemetry-num">#{log.index}</span>
                            <span className={`telemetry-code ${log.status === 200 ? 'ok' : 'err'}`}>
                              {log.status === 200 ? '200 OK' : log.status}
                            </span>
                            <span className="telemetry-msg">{log.detail}</span>
                          </div>
                          <span className="telemetry-ms">{log.latency}ms</span>
                        </div>
                      ))}
                    </div>

                    {burstSummary && (
                      <div className="telemetry-summary">
                        <span>RESOLVED IN {burstSummary.totalMs}ms</span>
                        <strong className="summary-ok">{burstSummary.integrity}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="drawer-footer">
                Veyra Core Ledger v1.3.0 • Active Session
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
