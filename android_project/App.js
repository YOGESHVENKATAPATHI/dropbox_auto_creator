import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  ActivityIndicator,
  Modal,
  Pressable
} from 'react-native';
import { WebView } from 'react-native-webview';

import { pingBackend, saveCredentials } from './src/api';
import { getInjectionScript } from './src/automationScripts';
import { CHROME_DESKTOP_UA, FLOW, URLS } from './src/constants';
import {
  defaultFlowData,
  enqueuePendingCredential,
  loadFlowData,
  loadPendingCredentials,
  patchFlowData,
  resetFlowData,
  setPendingCredentials
} from './src/storage';
import { theme } from './src/theme';

const initialLogs = [
  {
    at: new Date().toISOString(),
    level: 'info',
    message: 'Automation console initialized.'
  }
];

const STEP_DELAY_MS = 1200;
const SCALE_GUARD_SCRIPT = `
(function() {
  try {
    function enforceScale() {
      var head = document.head || document.getElementsByTagName('head')[0];
      if (head) {
        var viewport = document.querySelector('meta[name="viewport"]');
        var content = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, viewport-fit=cover';
        if (!viewport) {
          viewport = document.createElement('meta');
          viewport.name = 'viewport';
          head.appendChild(viewport);
        }
        viewport.setAttribute('content', content);
      }

      if (document.documentElement) {
        document.documentElement.style.zoom = '1';
        document.documentElement.style.webkitTextSizeAdjust = '100%';
      }

      if (document.body) {
        document.body.style.zoom = '1';
        document.body.style.webkitTextSizeAdjust = '100%';
      }
    }

    enforceScale();

    var attempts = 0;
    var timer = setInterval(function() {
      attempts += 1;
      enforceScale();
      if (attempts >= 25) clearInterval(timer);
    }, 300);

    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener('resize', enforceScale);
    }
  } catch (e) {}
})();
true;
`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextUrlForFlow(flowState) {
  if (flowState === FLOW.GET_EMAIL || flowState === FLOW.WAIT_VERIFICATION || flowState === FLOW.DELETE_EMAIL) return URLS.TEMP_MAIL;
  if (flowState === FLOW.FILL_DROPBOX) return URLS.DROPBOX_REGISTER;
  if (flowState === FLOW.CREATE_DROPBOX_APP || flowState === FLOW.CONFIGURE_DROPBOX_APP) return URLS.DROPBOX_DEV_APPS;
  if (flowState === FLOW.OAUTH_BRIDGE || flowState === FLOW.OAUTH_AUTHORIZE) return URLS.BRIDGE;
  if (flowState === FLOW.LOGOUT_DROPBOX) return URLS.DROPBOX_HOME;
  return URLS.TEMP_MAIL;
}

export default function App() {
  const tabRefs = useRef({});
  const nextTabIdRef = useRef(1);
  const pendingEmailVerifyRef = useRef(false);
  const signupToTempTimeoutRef = useRef(null);
  const [flowData, setFlowData] = useState(defaultFlowData);
  const [tabs, setTabs] = useState([{ id: 'tab-1', url: URLS.TEMP_MAIL, title: 'temp-mail.io' }]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [pendingCount, setPendingCount] = useState(0);
  const [logs, setLogs] = useState(initialLogs);
  const [loadingApp, setLoadingApp] = useState(true);
  const [backendStatus, setBackendStatus] = useState('unknown');
  const [menuOpen, setMenuOpen] = useState(false);

  const activeTab = useMemo(() => {
    return tabs.find((tab) => tab.id === activeTabId) || tabs[0] || null;
  }, [tabs, activeTabId]);

  const currentUrl = activeTab?.url || URLS.TEMP_MAIL;
  const activeWebViewKey = activeTab?.id || 'active-tab';

  const getHostLabel = useCallback((url) => {
    try {
      return new URL(url).host;
    } catch (error) {
      return 'tab';
    }
  }, []);

  const resetTabsTo = useCallback((url) => {
    if (signupToTempTimeoutRef.current) {
      clearTimeout(signupToTempTimeoutRef.current);
      signupToTempTimeoutRef.current = null;
    }
    nextTabIdRef.current += 1;
    const id = `tab-${nextTabIdRef.current}`;
    setTabs([{ id, url, title: getHostLabel(url) }]);
    setActiveTabId(id);
  }, [getHostLabel]);

  const continueFromStep = useCallback(async (targetFlow) => {
    if (!targetFlow) return;

    if (signupToTempTimeoutRef.current) {
      clearTimeout(signupToTempTimeoutRef.current);
      signupToTempTimeoutRef.current = null;
    }

    pendingEmailVerifyRef.current = false;

    addLog('info', `Continue requested from step: ${targetFlow}`);
    const patch = {
      flowState: targetFlow,
      isRunning: true
    };

    if (targetFlow === FLOW.DELETE_EMAIL) {
      // Force cleanup prerequisites so Step 8 always executes delete logic.
      patch.getEmailDeleteDone = false;
      patch.email = '';
    }

    const updated = await syncFlowData(patch);
    setFlowData(updated);
    setMenuOpen(false);

    const nextUrl = nextUrlForFlow(targetFlow);
    if (nextUrl) {
      await openTabWithDelay(nextUrl, { activate: true, reuseHost: true }, 300);
    }
  }, [addLog, openTabWithDelay, syncFlowData]);

  const openTab = useCallback((url, options = {}) => {
    const { activate = true, reuseHost = false } = options;

    if (reuseHost) {
      const incomingHost = getHostLabel(url);
      const existing = tabs.find((tab) => getHostLabel(tab.url) === incomingHost);
      if (existing) {
        setTabs((prev) => prev.map((tab) => (
          tab.id === existing.id
            ? { ...tab, url, title: getHostLabel(url) }
            : tab
        )));
        if (activate) setActiveTabId(existing.id);
        return existing.id;
      }
    }

    nextTabIdRef.current += 1;
    const id = `tab-${nextTabIdRef.current}`;
    setTabs((prev) => [...prev, { id, url, title: getHostLabel(url) }]);
    if (activate) setActiveTabId(id);
    return id;
  }, [getHostLabel, tabs]);

  const switchToTab = useCallback((tabId) => {
    setActiveTabId(tabId);
  }, []);

  const closeTab = useCallback((tabId) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter((tab) => tab.id !== tabId);
      if (!filtered.length) return prev;
      if (activeTabId === tabId) {
        setActiveTabId(filtered[filtered.length - 1].id);
      }
      return filtered;
    });
    delete tabRefs.current[tabId];
  }, [activeTabId]);

  const updateTabUrl = useCallback((tabId, url) => {
    setTabs((prev) => prev.map((tab) => (
      tab.id === tabId ? { ...tab, url, title: getHostLabel(url) } : tab
    )));
  }, [getHostLabel]);

  const addLog = useCallback((level, message) => {
    setLogs((prev) => {
      const next = [{ at: new Date().toISOString(), level, message }, ...prev];
      return next.slice(0, 120);
    });
  }, []);

  const refreshPendingCount = useCallback(async () => {
    const pending = await loadPendingCredentials();
    setPendingCount(pending.length);
  }, []);

  const syncFlowData = useCallback(async (patch) => {
    const updated = await patchFlowData(patch);
    setFlowData(updated);
    return updated;
  }, []);

  const runAutomationNow = useCallback(() => {
    const ref = tabRefs.current[activeTabId];
    if (!ref) return;
    const script = getInjectionScript(currentUrl, flowData);
    if (!script) return;
    ref.injectJavaScript(script);
  }, [activeTabId, currentUrl, flowData]);

  const openTabWithDelay = useCallback(
    async (url, options = {}, delayMs = STEP_DELAY_MS) => {
      await wait(delayMs);
      return openTab(url, options);
    },
    [openTab]
  );

  const persistCredentials = useCallback(
    async (payload) => {
      try {
        await saveCredentials(payload);
        addLog('success', 'Credentials stored in backend successfully.');
        await syncFlowData({
          flowState: FLOW.DONE,
          latestTokenPayload: payload,
          oauthRetryCount: 0
        });

        await syncFlowData({
          flowState: FLOW.LOGOUT_DROPBOX,
          email: '',
          getEmailDeleteDone: false,
          logoutRetryCount: 0
        });
        await openTabWithDelay(URLS.DROPBOX_HOME, { activate: true, reuseHost: true });
      } catch (error) {
        const msg = error?.response?.data?.error || error.message || 'Unknown backend error';
        addLog('error', `Backend save failed, queued locally: ${msg}`);

        await enqueuePendingCredential({
          ...payload,
          queuedAt: Date.now(),
          error: msg
        });
        await refreshPendingCount();
      }
    },
    [addLog, openTabWithDelay, refreshPendingCount, syncFlowData]
  );

  const flushQueuedCredentials = useCallback(async () => {
    const pending = await loadPendingCredentials();
    if (!pending.length) return;

    const remaining = [];
    for (let i = 0; i < pending.length; i += 1) {
      const item = pending[i];
      try {
        await saveCredentials(item);
      } catch (error) {
        remaining.push(item);
      }
    }

    await setPendingCredentials(remaining);
    setPendingCount(remaining.length);
    if (!remaining.length) {
      addLog('success', 'All locally queued credentials were synced.');
    }
  }, [addLog]);

  const checkBackend = useCallback(async () => {
    try {
      await pingBackend();
      setBackendStatus('online');
      await flushQueuedCredentials();
    } catch (error) {
      setBackendStatus('offline');
    }
  }, [flushQueuedCredentials]);

  const startAutomation = useCallback(async () => {
    addLog('info', 'Starting new automation cycle.');
    if (signupToTempTimeoutRef.current) {
      clearTimeout(signupToTempTimeoutRef.current);
      signupToTempTimeoutRef.current = null;
    }
    pendingEmailVerifyRef.current = false;
    const updated = await syncFlowData({
      flowState: FLOW.GET_EMAIL,
      email: '',
      getEmailDeleteDone: false,
      oauthRetryCount: 0,
      logoutRetryCount: 0,
      isRunning: true
    });
    setFlowData(updated);
    await openTabWithDelay(URLS.TEMP_MAIL, { activate: true, reuseHost: false }, 700);
  }, [addLog, openTabWithDelay, syncFlowData]);

  const stopAutomation = useCallback(async () => {
    addLog('warn', 'Automation paused by operator.');
    if (signupToTempTimeoutRef.current) {
      clearTimeout(signupToTempTimeoutRef.current);
      signupToTempTimeoutRef.current = null;
    }
    const updated = await syncFlowData({ isRunning: false });
    setFlowData(updated);
  }, [addLog, syncFlowData]);

  const resetAutomation = useCallback(async () => {
    addLog('info', 'Resetting flow state and local queue.');
    if (signupToTempTimeoutRef.current) {
      clearTimeout(signupToTempTimeoutRef.current);
      signupToTempTimeoutRef.current = null;
    }
    pendingEmailVerifyRef.current = false;
    const reset = await resetFlowData();
    setFlowData(reset);
    setPendingCount(0);
    resetTabsTo(URLS.TEMP_MAIL);
  }, [addLog, resetTabsTo]);

  const onBridgeMessage = useCallback(
    async (event) => {
      let message;
      try {
        message = JSON.parse(event.nativeEvent.data);
      } catch (error) {
        addLog('warn', 'Received non-JSON message from WebView.');
        return;
      }

      if (!message || !message.type) return;

      if (message.type === 'LOG') {
        addLog(message.level || 'info', message.message || 'WebView log event.');
        return;
      }

      if (message.type === 'PATCH_STATE') {
        const updated = await syncFlowData(message.patch || {});
        setFlowData(updated);
        return;
      }

      if (message.type === 'EMAIL_COPIED') {
        addLog('info', `Temp email captured: ${message.email}`);
        await syncFlowData({
          email: message.email,
          flowState: FLOW.FILL_DROPBOX
        });
        await openTabWithDelay(URLS.DROPBOX_REGISTER, { activate: true, reuseHost: false });
        return;
      }

      if (message.type === 'SIGNUP_COMPLETED') {
        addLog('info', 'Signup form submitted. Waiting for verification email.');
        await syncFlowData({ flowState: FLOW.WAIT_VERIFICATION });

        if (signupToTempTimeoutRef.current) {
          clearTimeout(signupToTempTimeoutRef.current);
        }

        signupToTempTimeoutRef.current = setTimeout(() => {
          openTab(URLS.TEMP_MAIL, { activate: true, reuseHost: true });
          signupToTempTimeoutRef.current = null;
        }, 5000 + STEP_DELAY_MS);
        return;
      }

      if (message.type === 'EMAIL_VERIFIED') {
        addLog('success', 'Verification link found. Opening Dropbox verification page...');
        pendingEmailVerifyRef.current = true;

        // Open the verification link in a new tab inside the app.
        // We continue only after navigation reaches Dropbox /emailverified.
        if (message.href) {
          openTab(message.href, { activate: true, reuseHost: true });
          addLog('info', 'Waiting for Dropbox email verification confirmation page...');
        } else {
          addLog('warn', 'Verification URL missing from temp-mail message payload.');
          pendingEmailVerifyRef.current = false;
        }

        return;
      }

      if (message.type === 'APP_CREATED') {
        addLog('info', 'Dropbox app creation submitted; configuring app details and scopes.');
        const patch = { flowState: FLOW.CONFIGURE_DROPBOX_APP };
        if (message.appName) patch.appName = message.appName;
        await syncFlowData(patch);
        return;
      }

      if (message.type === 'OAUTH_BRIDGE_READY') {
        const alreadyInOauthFlow =
          flowData.flowState === FLOW.OAUTH_BRIDGE || flowData.flowState === FLOW.OAUTH_AUTHORIZE;
        const sameBridgeCreds =
          flowData.appKey === message.appKey && flowData.appSecret === message.appSecret;

        if (alreadyInOauthFlow && sameBridgeCreds) {
          addLog('info', 'OAuth bridge already started. Skipping duplicate bridge trigger.');
          return;
        }

        addLog('info', 'App key and secret captured. Starting OAuth bridge token flow.');
        await syncFlowData({
          appKey: message.appKey,
          appSecret: message.appSecret,
          flowState: FLOW.OAUTH_BRIDGE
        });
        await openTabWithDelay(URLS.BRIDGE, { activate: true, reuseHost: true }, 400);
        return;
      }

      if (message.type === 'TOKEN_CAPTURED') {
        addLog('success', 'Refresh token captured from bridge callback. Persisting now.');
        const payload = {
          appKey: flowData.appKey,
          appSecret: flowData.appSecret,
          appName: flowData.appName || null,
          ...message.payload
        };
        await persistCredentials(payload);
        return;
      }

      if (message.type === 'LOGOUT_COMPLETED') {
        addLog('success', 'Logout completed. Moving to Step 8: delete temp-mail inbox before next cycle.');
        if (signupToTempTimeoutRef.current) {
          clearTimeout(signupToTempTimeoutRef.current);
          signupToTempTimeoutRef.current = null;
        }
        pendingEmailVerifyRef.current = false;
        await syncFlowData({
          flowState: FLOW.DELETE_EMAIL,
          email: '',
          getEmailDeleteDone: false,
          oauthRetryCount: 0,
          logoutRetryCount: 0
        });
        await wait(STEP_DELAY_MS);
        resetTabsTo(URLS.TEMP_MAIL);
      }
    },
    [
      addLog,
      flowData.appKey,
      flowData.appName,
      flowData.appSecret,
      openTabWithDelay,
      openTab,
      persistCredentials,
      resetTabsTo,
      syncFlowData
    ]
  );

  useEffect(() => {
    StatusBar.setHidden(true, 'none');
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const saved = await loadFlowData();
        if (!mounted) return;
        setFlowData(saved);
        resetTabsTo(nextUrlForFlow(saved.flowState));
        await refreshPendingCount();
      } finally {
        if (mounted) setLoadingApp(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [refreshPendingCount]);

  useEffect(() => {
    checkBackend();
    const timer = setInterval(checkBackend, 45000);
    return () => clearInterval(timer);
  }, [checkBackend]);

  useEffect(() => {
    if (!flowData.isRunning) return;
    const expected = nextUrlForFlow(flowData.flowState);
    if (!expected) return;

    const activeHost = getHostLabel(currentUrl);
    const expectedHost = getHostLabel(expected);

    const normalizedCurrent = String(currentUrl || '').toLowerCase();
    const normalizedExpected = String(expected || '').toLowerCase();
    const requiresPathMatch = flowData.flowState === FLOW.LOGOUT_DROPBOX;
    const pathMismatch = requiresPathMatch && !normalizedCurrent.startsWith(normalizedExpected);
    const shouldAllowVerificationNavigation =
      flowData.flowState === FLOW.WAIT_VERIFICATION && pendingEmailVerifyRef.current;
    const shouldAllowOAuthAuthorizeNavigation =
      flowData.flowState === FLOW.OAUTH_AUTHORIZE;

    if (!shouldAllowVerificationNavigation && !shouldAllowOAuthAuthorizeNavigation && (activeHost !== expectedHost || pathMismatch)) {
      openTab(expected, { activate: true, reuseHost: true });
    }
  }, [currentUrl, flowData.flowState, flowData.isRunning, getHostLabel, openTab]);

  useEffect(() => {
    return () => {
      if (signupToTempTimeoutRef.current) {
        clearTimeout(signupToTempTimeoutRef.current);
        signupToTempTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!flowData.isRunning || !activeTabId) return;
    const t = setTimeout(runAutomationNow, 1500);
    return () => clearTimeout(t);
  }, [activeTabId, currentUrl, flowData, runAutomationNow]);

  const statusColor = useMemo(() => {
    if (backendStatus === 'online') return theme.colors.success;
    if (backendStatus === 'offline') return theme.colors.danger;
    return theme.colors.muted;
  }, [backendStatus]);

  if (loadingApp) {
    return (
      <SafeAreaView style={styles.loaderWrap}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loaderText}>Loading automation workspace...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar hidden translucent backgroundColor="transparent" />
      <View style={styles.activityArea}>
        {activeTab ? (
          <WebView
            key={activeWebViewKey}
            ref={(ref) => {
              if (ref && activeTab?.id) tabRefs.current[activeTab.id] = ref;
            }}
            source={{ uri: activeTab.url }}
            userAgent={CHROME_DESKTOP_UA}
            javaScriptEnabled
            domStorageEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            allowsInlineMediaPlayback
            scalesPageToFit={false}
            textZoom={100}
            setBuiltInZoomControls={false}
            setDisplayZoomControls={false}
            injectedJavaScriptBeforeContentLoaded={SCALE_GUARD_SCRIPT}
            onShouldStartLoadWithRequest={(request) => {
              if (!activeTab?.url) return true;
              if (request.url === activeTab.url) return true;

              const isHttp = request.url.startsWith('http');
              if (!isHttp) return true;

              try {
                const currentHost = (new URL(activeTab.url).hostname || '').toLowerCase();
                const targetHost = (new URL(request.url).hostname || '').toLowerCase();

                if (currentHost && targetHost && currentHost !== targetHost) {
                  openTab(request.url, { activate: true, reuseHost: true });
                  return false;
                }
              } catch (err) {
                return true;
              }

              return true;
            }}
            onMessage={(event) => onBridgeMessage(event)}
            onLoadEnd={() => {
              if (flowData.isRunning) {
                runAutomationNow();
              }
            }}
            onNavigationStateChange={(state) => {
              if (state?.url && activeTab?.id) {
                updateTabUrl(activeTab.id, state.url);

                if (flowData.isRunning && flowData.flowState === FLOW.FILL_DROPBOX) {
                  const normalizedUrl = state.url.toLowerCase();
                  const isDropboxTrialRedirect =
                    normalizedUrl.includes('dropbox.com/trial_first') ||
                    normalizedUrl.includes('dropbox.com/home') ||
                    normalizedUrl.includes('dropbox.com/account');

                  if (isDropboxTrialRedirect) {
                    addLog('info', 'Detected post-signup Dropbox redirect. Switching to temp-mail verification.');
                    syncFlowData({ flowState: FLOW.WAIT_VERIFICATION })
                      .then(() => openTab(URLS.TEMP_MAIL, { activate: true, reuseHost: true }))
                      .catch(() => {});
                  }
                }

                if (flowData.isRunning && flowData.flowState === FLOW.WAIT_VERIFICATION && pendingEmailVerifyRef.current) {
                  const normalizedUrl = state.url.toLowerCase();
                  const isEmailVerifiedPage =
                    normalizedUrl.includes('dropbox.com/emailverified');

                  if (isEmailVerifiedPage) {
                    pendingEmailVerifyRef.current = false;
                    addLog('success', 'Dropbox email verified page detected. Continuing to app creation.');
                    syncFlowData({ flowState: FLOW.CREATE_DROPBOX_APP })
                      .then(() => openTab(URLS.DROPBOX_DEV_APPS, { activate: true, reuseHost: true }))
                      .catch(() => {});
                  }
                }
              }
            }}
            style={styles.webViewVisible}
          />
        ) : null}

        <View style={styles.urlBadgeWrap}>
          <Text numberOfLines={1} style={styles.urlBadgeText}>{currentUrl}</Text>
        </View>

        <TouchableOpacity style={styles.menuFab} onPress={() => setMenuOpen(true)}>
          <Text style={styles.menuFabIcon}>Menu</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuLayer}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />
          <View style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Automation Menu</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setMenuOpen(false)}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.statusBlock}>
              <Text style={styles.menuStatusText}>Flow: {flowData.flowState}</Text>
              <Text style={styles.menuStatusText}>Backend: <Text style={{ color: statusColor }}>{backendStatus}</Text></Text>
              <Text style={styles.menuStatusText}>Queued credentials: {pendingCount}</Text>
            </View>

            <View style={styles.menuActionsRow}>
              <TouchableOpacity style={[styles.button, styles.start]} onPress={startAutomation}>
                <Text style={styles.buttonText}>Start</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.pause]} onPress={stopAutomation}>
                <Text style={styles.buttonText}>Pause</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.reset]} onPress={resetAutomation}>
                <Text style={styles.buttonText}>Reset</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.runStepBtn} onPress={runAutomationNow}>
              <Text style={styles.runStepText}>Run Current Step</Text>
            </TouchableOpacity>

            <Text style={styles.logTitle}>Continue From Step</Text>
            <View style={styles.continueWrap}>
              <TouchableOpacity style={styles.continueBtn} onPress={() => continueFromStep(FLOW.GET_EMAIL)}>
                <Text style={styles.continueBtnText}>1. Get Email</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.continueBtn} onPress={() => continueFromStep(FLOW.FILL_DROPBOX)}>
                <Text style={styles.continueBtnText}>2. Fill Dropbox</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.continueBtn} onPress={() => continueFromStep(FLOW.WAIT_VERIFICATION)}>
                <Text style={styles.continueBtnText}>3. Verify Email</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.continueBtn} onPress={() => continueFromStep(FLOW.CREATE_DROPBOX_APP)}>
                <Text style={styles.continueBtnText}>4. Create App</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.continueBtn} onPress={() => continueFromStep(FLOW.CONFIGURE_DROPBOX_APP)}>
                <Text style={styles.continueBtnText}>5. Configure App</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.continueBtn} onPress={() => continueFromStep(FLOW.OAUTH_BRIDGE)}>
                <Text style={styles.continueBtnText}>6. OAuth Bridge</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.continueBtn} onPress={() => continueFromStep(FLOW.LOGOUT_DROPBOX)}>
                <Text style={styles.continueBtnText}>7. Logout</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.continueBtn} onPress={() => continueFromStep(FLOW.DELETE_EMAIL)}>
                <Text style={styles.continueBtnText}>8. Delete Email</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.logTitle}>Tabs</Text>
            <ScrollView style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <View key={tab.id} style={[styles.tabRow, isActive ? styles.tabRowActive : null]}>
                    <View style={styles.tabMeta}>
                      <Text numberOfLines={1} style={styles.tabTitle}>{tab.title}</Text>
                      <Text numberOfLines={1} style={styles.tabUrl}>{tab.url}</Text>
                    </View>
                    <View style={styles.tabActions}>
                      <TouchableOpacity
                        style={[styles.tabActionBtn, styles.tabSwitchBtn]}
                        onPress={() => switchToTab(tab.id)}
                      >
                        <Text style={styles.tabActionText}>Open</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.tabActionBtn, styles.tabCloseBtn]}
                        onPress={() => closeTab(tab.id)}
                        disabled={tabs.length === 1}
                      >
                        <Text style={styles.tabActionText}>X</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <Text style={styles.logTitle}>Live automation logs</Text>
            <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}>
              {logs.map((entry) => (
                <Text key={`${entry.at}-${entry.message}`} style={styles.logLine}>
                  [{new Date(entry.at).toLocaleTimeString()}] {entry.level.toUpperCase()}: {entry.message}
                </Text>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.bg
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg
  },
  loaderText: {
    marginTop: 12,
    color: theme.colors.text,
    fontSize: 15
  },
  activityArea: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  webViewVisible: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    opacity: 1,
    backgroundColor: '#ffffff'
  },
  button: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11
  },
  start: {
    backgroundColor: theme.colors.success
  },
  pause: {
    backgroundColor: '#334155'
  },
  reset: {
    backgroundColor: theme.colors.danger
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    letterSpacing: 0.2
  },
  urlBadgeWrap: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 86,
    backgroundColor: 'rgba(248, 250, 252, 0.94)',
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  urlBadgeText: {
    color: '#1f2937',
    fontSize: 12
  },
  menuFab: {
    position: 'absolute',
    top: 10,
    right: 12,
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    elevation: 4
  },
  menuFabIcon: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12
  },
  menuLayer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end'
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.34)'
  },
  menuPanel: {
    width: '84%',
    maxWidth: 420,
    backgroundColor: theme.colors.card,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 16
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.colors.text
  },
  closeBtn: {
    backgroundColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  closeBtnText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '700'
  },
  statusBlock: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 10,
    backgroundColor: '#f8fafc'
  },
  menuStatusText: {
    color: theme.colors.text,
    fontSize: 13,
    marginBottom: 5
  },
  menuActionsRow: {
    flexDirection: 'row',
    marginTop: 10,
    marginBottom: 10,
    gap: 8
  },
  runStepBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10
  },
  runStepText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13
  },
  continueWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10
  },
  continueBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  continueBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700'
  },
  tabsScroll: {
    maxHeight: 180,
    borderRadius: theme.radius.md,
    borderColor: theme.colors.border,
    borderWidth: 1,
    backgroundColor: '#f8fafc',
    marginBottom: 10
  },
  tabsContent: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dbe3ee',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#ffffff'
  },
  tabRowActive: {
    borderColor: theme.colors.primary,
    backgroundColor: '#eff6ff'
  },
  tabMeta: {
    flex: 1,
    marginRight: 8
  },
  tabTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a'
  },
  tabUrl: {
    fontSize: 11,
    color: '#334155',
    marginTop: 2
  },
  tabActions: {
    flexDirection: 'row',
    gap: 6
  },
  tabActionBtn: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tabSwitchBtn: {
    backgroundColor: '#0f766e'
  },
  tabCloseBtn: {
    backgroundColor: '#b91c1c'
  },
  tabActionText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700'
  },
  logTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 6
  },
  logScroll: {
    flex: 1,
    borderRadius: theme.radius.md,
    borderColor: theme.colors.border,
    borderWidth: 1,
    backgroundColor: '#f8fafc'
  },
  logContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 24
  },
  logLine: {
    fontSize: 12,
    color: '#1f2937',
    marginBottom: 8
  }
});
