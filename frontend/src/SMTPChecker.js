import React, { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import SMTPChecker from './SMTPChecker';
function SMTPChecker() {
  const [smtpList, setSmtpList] = useState([]);
  const [checking, setChecking] = useState(false);
  const [currentCheck, setCurrentCheck] = useState(null);
  const [results, setResults] = useState([]);
  const [batchSize, setBatchSize] = useState(5);
  const [delayBetweenChecks, setDelayBetweenChecks] = useState(1000);
  const [showOnlyFailed, setShowOnlyFailed] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all'); // all, success, failed

  // Parse SMTP from text input
  const parseSMTPList = (text) => {
    const lines = text.split('\n');
    const smtps = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Support multiple formats:
      // Format 1: host:port:username:password
      // Format 2: host,port,username,password
      // Format 3: host|port|username|password
      let parts;
      if (trimmed.includes(':')) {
        parts = trimmed.split(':');
      } else if (trimmed.includes(',')) {
        parts = trimmed.split(',');
      } else if (trimmed.includes('|')) {
        parts = trimmed.split('|');
      } else {
        // Try to parse as CSV with spaces
        parts = trimmed.split(/\s+/);
      }
      
      if (parts.length >= 4) {
        smtps.push({
          id: Date.now() + Math.random(),
          host: parts[0].trim(),
          port: parseInt(parts[1].trim()),
          username: parts[2].trim(),
          password: parts[3].trim(),
          status: 'pending',
          message: 'Waiting to check...',
          responseTime: null
        });
      }
    }
    
    return smtps;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      const smtps = parseSMTPList(content);
      if (smtps.length > 0) {
        setSmtpList(smtps);
        setResults([]);
        toast.success(`Loaded ${smtps.length} SMTP servers`);
      } else {
        toast.error('No valid SMTP servers found in file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleTextInput = (e) => {
    const content = e.target.value;
    const smtps = parseSMTPList(content);
    if (smtps.length > 0) {
      setSmtpList(smtps);
      setResults([]);
      toast.success(`Loaded ${smtps.length} SMTP servers`);
    } else if (content.trim()) {
      toast.error('No valid SMTP servers found');
    }
  };

  const checkSingleSMTP = async (smtp, index) => {
    const startTime = Date.now();
    
    try {
      fetch('http://localhost:3001/api/smtp-servers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: smtp.host,
          port: smtp.port,
          username: smtp.username,
          password: smtp.password
        })
      });
      
      const result = await response.json();
      const responseTime = Date.now() - startTime;
      
      if (result.success) {
        return {
          ...smtp,
          status: 'success',
          message: `Connected successfully (${responseTime}ms)`,
          responseTime,
          error: null
        };
      } else {
        return {
          ...smtp,
          status: 'failed',
          message: result.error || result.details || 'Connection failed',
          responseTime,
          error: result.details
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        ...smtp,
        status: 'failed',
        message: error.message || 'Connection error',
        responseTime,
        error: error.message
      };
    }
  };

  const checkAllSMTP = async () => {
    if (smtpList.length === 0) {
      toast.error('No SMTP servers to check');
      return;
    }
    
    setChecking(true);
    setResults([]);
    
    const updatedList = smtpList.map(smtp => ({
      ...smtp,
      status: 'checking',
      message: 'Checking...'
    }));
    setSmtpList(updatedList);
    
    const resultsList = [];
    const batchCount = Math.ceil(smtpList.length / batchSize);
    
    for (let batch = 0; batch < batchCount; batch++) {
      const start = batch * batchSize;
      const end = Math.min(start + batchSize, smtpList.length);
      const batchItems = smtpList.slice(start, end);
      
      const batchPromises = batchItems.map(async (smtp, idx) => {
        const result = await checkSingleSMTP(smtp, start + idx);
        resultsList.push(result);
        
        // Update UI
        setSmtpList(prev => prev.map((item, i) => 
          i === start + idx ? { ...item, status: result.status, message: result.message, responseTime: result.responseTime } : item
        ));
        
        return result;
      });
      
      await Promise.all(batchPromises);
      
      // Add delay between batches
      if (batch < batchCount - 1 && delayBetweenChecks > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenChecks));
      }
    }
    
    setResults(resultsList);
    setChecking(false);
    
    const successCount = resultsList.filter(r => r.status === 'success').length;
    const failedCount = resultsList.filter(r => r.status === 'failed').length;
    
    toast.success(`Check complete: ${successCount} working, ${failedCount} failed`);
  };

  const handleExportResults = () => {
    const dataToExport = filteredResults.map(r => ({
      host: r.host,
      port: r.port,
      username: r.username,
      status: r.status,
      responseTime: r.responseTime,
      message: r.message
    }));
    
    const csv = [
      ['Host', 'Port', 'Username', 'Status', 'Response Time (ms)', 'Message'],
      ...dataToExport.map(r => [r.host, r.port, r.username, r.status, r.responseTime, r.message])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smtp_check_results_${new Date().toISOString().slice(0,19)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Results exported to CSV');
  };

  const handleAddWorkingToAccounts = async () => {
    const workingSMTPS = results.filter(r => r.status === 'success');
    if (workingSMTPS.length === 0) {
      toast.error('No working SMTP servers to add');
      return;
    }
    
    setChecking(true);
    let added = 0;
    
    for (const smtp of workingSMTPS) {
      try {
        fetch('http://localhost:3001/api/smtp-servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${smtp.host}_${smtp.port}`,
            host: smtp.host,
            port: smtp.port,
            username: smtp.username,
            password: smtp.password,
            fromEmail: smtp.username,
            dailyLimit: 500,
            priority: 10
          })
        });
        
        if (response.ok) {
          added++;
        }
      } catch (error) {
        console.error('Error adding SMTP:', error);
      }
    }
    
    setChecking(false);
    toast.success(`Added ${added} working SMTP servers to your account`);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success': return '✅';
      case 'failed': return '❌';
      case 'checking': return '🔄';
      default: return '⏳';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success': return '#10B981';
      case 'failed': return '#EF4444';
      case 'checking': return '#F59E0B';
      default: return '#6B7280';
    }
  };

  const filteredResults = results.filter(r => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'success') return r.status === 'success';
    if (filterStatus === 'failed') return r.status === 'failed';
    return true;
  });

  return (
    <div className="smtp-checker">
      <div className="page-header">
        <h1>SMTP Server Checker</h1>
        <div>
          <button 
            onClick={handleExportResults} 
            className="btn-secondary"
            disabled={results.length === 0}
            style={{ marginRight: '12px' }}
          >
            📥 Export Results
          </button>
          <button 
            onClick={handleAddWorkingToAccounts} 
            className="btn-primary"
            disabled={results.filter(r => r.status === 'success').length === 0 || checking}
          >
            ➕ Add Working to Accounts
          </button>
        </div>
      </div>

      <div className="checker-layout">
        {/* Left Panel - Input */}
        <div className="checker-input-panel">
          <div className="input-methods">
            <h3>Import SMTP Servers</h3>
            
            <div className="method-tabs">
              <button className="method-tab active">📝 Paste List</button>
              <button className="method-tab">📁 Upload File</button>
            </div>
            
            <div className="input-area">
              <label className="form-label">SMTP List Format:</label>
              <textarea
                rows="10"
                placeholder="host:port:username:password&#10;smtp.gmail.com:587:user@gmail.com:password&#10;smtp.mail.yahoo.com:465:user@yahoo.com:password&#10;&#10;Or use CSV format:&#10;smtp.gmail.com,587,user@gmail.com,password"
                className="form-textarea"
                onChange={(e) => handleTextInput(e)}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
              <div className="form-hint">
                One SMTP per line. Format: host:port:username:password or host,port,username,password
              </div>
            </div>
            
            <div className="upload-area">
              <label className="form-label">Or Upload File:</label>
              <div className="file-upload-zone">
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  id="smtp-file-upload"
                  style={{ display: 'none' }}
                />
                <label htmlFor="smtp-file-upload" style={{ cursor: 'pointer' }}>
                  <div className="file-upload-icon">📁</div>
                  <p>Click to select CSV or TXT file</p>
                  <small>CSV format: host,port,username,password</small>
                </label>
              </div>
            </div>
          </div>
          
          <div className="checker-settings">
            <h3>Checker Settings</h3>
            <div className="settings-grid">
              <div className="form-group">
                <label className="form-label">Batch Size</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={batchSize}
                  onChange={(e) => setBatchSize(parseInt(e.target.value))}
                  className="form-input"
                />
                <small>How many to check at once</small>
              </div>
              
              <div className="form-group">
                <label className="form-label">Delay Between Batches (ms)</label>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  value={delayBetweenChecks}
                  onChange={(e) => setDelayBetweenChecks(parseInt(e.target.value))}
                  className="form-input"
                />
                <small>Wait between batches to avoid rate limiting</small>
              </div>
            </div>
            
            <button
              onClick={checkAllSMTP}
              disabled={checking || smtpList.length === 0}
              className="btn-primary"
              style={{ width: '100%', marginTop: '16px' }}
            >
              {checking ? `Checking ${currentCheck || smtpList.length} servers...` : `🚀 Check ${smtpList.length} SMTP Servers`}
            </button>
          </div>
        </div>
        
        {/* Right Panel - Results */}
        <div className="checker-results-panel">
          <div className="results-header">
            <h3>Results</h3>
            <div className="results-stats">
              <span className="stat-good">✅ Working: {results.filter(r => r.status === 'success').length}</span>
              <span className="stat-bad">❌ Failed: {results.filter(r => r.status === 'failed').length}</span>
              <span className="stat-total">📊 Total: {results.length}</span>
            </div>
            <div className="filter-controls">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="form-select-small"
              >
                <option value="all">All Results</option>
                <option value="success">Working Only</option>
                <option value="failed">Failed Only</option>
              </select>
            </div>
          </div>
          
          <div className="results-list">
            {filteredResults.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">🖥️</div>
                <div className="empty-title">No Results Yet</div>
                <div className="empty-description">
                  Paste your SMTP servers above and click "Check SMTP Servers" to test them.
                </div>
              </div>
            )}
            
            {filteredResults.map((result, idx) => (
              <div key={idx} className={`result-item result-${result.status}`}>
                <div className="result-status" style={{ color: getStatusColor(result.status) }}>
                  {getStatusIcon(result.status)}
                </div>
                <div className="result-details">
                  <div className="result-server">
                    <strong>{result.host}:{result.port}</strong>
                    <span className="result-username">{result.username}</span>
                  </div>
                  <div className="result-message">{result.message}</div>
                  {result.responseTime && (
                    <div className="result-time">⏱️ {result.responseTime}ms</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Sample Format Helper */}
      <div className="sample-format">
        <details>
          <summary>📋 Sample SMTP Formats</summary>
          <div className="sample-content">
            <h4>Format 1 (colon separated):</h4>
            <pre>
smtp.gmail.com:587:user@gmail.com:password123
smtp.mail.yahoo.com:465:user@yahoo.com:password456
mail.yourdomain.com:587:admin@yourdomain.com:securepass
            </pre>
            
            <h4>Format 2 (comma separated CSV):</h4>
            <pre>
smtp.gmail.com,587,user@gmail.com,password123
smtp.mail.yahoo.com,465,user@yahoo.com,password456
mail.yourdomain.com,587,admin@yourdomain.com,securepass
            </pre>
            
            <h4>Format 3 (space separated):</h4>
            <pre>
smtp.gmail.com 587 user@gmail.com password123
smtp.mail.yahoo.com 465 user@yahoo.com password456
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

export default SMTPChecker;