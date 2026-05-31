import React, { useState, useEffect, useMemo } from 'react';

import { initializeApp } from 'firebase/app';
import { getAnalytics } from "firebase/analytics";
import {
  getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signOut,
  linkWithPopup, signInWithCredential, // ★ 改动:新增 link/credential
} from 'firebase/auth';

import {
  getFirestore, doc, onSnapshot, setDoc, getDoc, deleteDoc, // ★ 改动:新增 getDoc/deleteDoc
} from 'firebase/firestore';

import {
  Wallet, Settings, History, Box, Search, Scan, Loader2, AlertCircle, X,
  PieChart, DollarSign, Coins, ChevronLeft, ChevronRight, Clock,
  ArrowDownRight, ArrowUpRight, Copy, ExternalLink, Check, Edit2,
} from 'lucide-react';

const firebaseConfig = {
  apiKey: "AIzaSyBfLcdkM6CntqcPbOX42p8QXwmpsHnaKAs",
  authDomain: "wallet-checker-34d3d.firebaseapp.com",
  projectId: "wallet-checker-34d3d",
  storageBucket: "wallet-checker-34d3d.firebasestorage.app",
  messagingSenderId: "602662340957",
  appId: "1:602662340957:web:f948ddace43f16927c80b4",
  measurementId: "G-S04WZ58MFJ"
};


const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const FETCH_LIMIT = 50;
const PAGE_SIZE = 20;
const shortenAddress = (address) => {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};
const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(parseInt(timestamp));
  return date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};
const copyToClipboard = (text) => {
  try {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  } catch (err) {
    console.error('复制失败', err);
  }
};
const formatAmount = (value, decimals = 18) => {
  if (!value) return '0';
  const num = parseFloat(value) / Math.pow(10, parseInt(decimals || 18));
  if (num === 0) return '0';
  if (num < 0.000001) return '<0.000001';
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
};
const parseQrAddress = (text) => {
  let addr = text;
  if (addr.toLowerCase().startsWith('ethereum:')) {
    addr = addr.substring(9).split('@')[0];
  } else if (addr.toLowerCase().startsWith('tron:')) {
    addr = addr.substring(5);
  }
  return addr.trim();
};
// ★ 改动:统一的历史文档路径工具,避免到处手写
const historyRef = (uid) =>
  doc(db, 'artifacts', appId, 'users', uid, 'wallet_data', 'history');
export default function App() {
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState('AUTO');
  const [allTransactions, setAllTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [apiPage, setApiPage] = useState(1);
  const [hasMoreData, setHasMoreData] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentQuery, setCurrentQuery] = useState({ address: '', chain: '' });
  const [walletInfo, setWalletInfo] = useState(null);
  const [fetchingBalance, setFetchingBalance] = useState(false);
  const [history, setHistory] = useState([]);
  const [ethApiKey, setEthApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [filterType, setFilterType] = useState('ALL');
  const [isMobile, setIsMobile] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  // 初始化 Auth:优先自定义 token,否则匿名登录
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("认证初始化失败", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);
  // 云端历史记录同步(按 UID 隔离)
  useEffect(() => {
    try {
      const savedKey = localStorage.getItem('eth_api_key');
      if (savedKey) setEthApiKey(savedKey);
    } catch (e) {}
    if (!user) return;
    const ref = historyRef(user.uid);
    const unsubscribe = onSnapshot(ref, (docSnap) => {
      if (docSnap.exists()) {
        setHistory(docSnap.data().items || []);
      } else {
        // 云端无数据时,尝试平滑迁移本地缓存历史
        try {
          const savedHistory = localStorage.getItem('wallet_history');
          if (savedHistory) {
            const parsed = JSON.parse(savedHistory);
            setHistory(parsed);
            setDoc(ref, { items: parsed }).catch(console.error);
            localStorage.removeItem('wallet_history');
          }
        } catch (e) {}
      }
    }, (err) => console.error("云端同步异常:", err));
    return () => unsubscribe();
  }, [user]);
  // ★ 改动:历史合并迁移(用于"该 Google 账号已存在"的场景)
  const migrateHistory = async (newUid, localHistory) => {
    try {
      const newRef = historyRef(newUid);
      const newSnap = await getDoc(newRef);
      const existing = newSnap.exists() ? (newSnap.data().items || []) : [];
      // 以 address 去重合并:保留较新的 lastQueried 与非空 remark
      const map = new Map();
      [...existing, ...localHistory].forEach(item => {
        if (!item || !item.address) return;
        const key = item.address.toLowerCase();
        const prev = map.get(key);
        if (!prev) {
          map.set(key, item);
        } else {
          map.set(key, {
            ...prev,
            ...item,
            remark: item.remark || prev.remark || '',
            lastQueried: Math.max(prev.lastQueried || 0, item.lastQueried || 0),
          });
        }
      });
      const merged = Array.from(map.values())
        .sort((a, b) => (b.lastQueried || 0) - (a.lastQueried || 0));
      await setDoc(newRef, { items: merged });
      // 注:旧匿名账号的孤儿文档因安全规则(uid 不匹配)无法删除,留存无害
    } catch (e) {
      console.error('历史迁移失败', e);
    }
  };
  // ★ 改动:Google 登录改为"匿名账号链接升级",保证 UID 不变、历史不丢
  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const current = auth.currentUser;
      // 情况1:当前是匿名用户 → 用 link 升级,UID 保持不变,历史自动继承
      if (current && current.isAnonymous) {
        try {
          await linkWithPopup(current, provider);
          return; // 成功:同一 UID,匿名期间的 history 直接归属 Google 账号 ✅
        } catch (linkErr) {
          // 情况2:该 Google 账号此前已注册(别处登录过)
          if (linkErr.code === 'auth/credential-already-in-use') {
            const cred = GoogleAuthProvider.credentialFromError(linkErr);
            const pendingHistory = history; // 暂存匿名期间的历史
            const result = await signInWithCredential(auth, cred);
            await migrateHistory(result.user.uid, pendingHistory); // 合并进已存在账号
            return;
          }
          throw linkErr;
        }
      }
      // 情况3:没有当前用户(兜底)→ 直接登录
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google 登录失败", error);
      if (error.code === 'auth/unauthorized-domain') {
        setAuthError('当前域名未加入 Firebase 授权白名单。请在 Authentication → Settings → Authorized domains 添加你的域名后重试。');
      } else if (error.code === 'auth/popup-closed-by-user') {
        setAuthError('登录窗口被关闭,请重试。');
      } else {
        setAuthError('登录失败,请稍后重试或检查网络环境。');
      }
      setTimeout(() => setAuthError(''), 5000);
    }
  };
  // 退出登录,恢复匿名状态(登出 = 开启新的空白匿名会话,属预期行为)
  const handleLogout = async () => {
    try {
      await signOut(auth);
      await signInAnonymously(auth);
    } catch (e) {
      console.error('登出失败', e);
    }
  };
  // 检测设备并动态加载扫码库
  useEffect(() => {
    const checkMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(checkMobile);
    if (checkMobile && !document.getElementById('html5-qrcode-script')) {
      const script = document.createElement('script');
      script.id = 'html5-qrcode-script';
      script.src = 'https://unpkg.com/html5-qrcode';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);
  // 构建全局备注字典
  const remarkMap = useMemo(() => {
    const map = {};
    history.forEach(item => {
      if (item.remark) {
        map[item.address.toLowerCase()] = item.remark;
      }
    });
    return map;
  }, [history]);
  const detectChain = (addr) => {
    if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return 'ETH';
    if (/^T[a-zA-Z0-9]{33}$/.test(addr)) return 'TRX';
    return null;
  };
  const fetchWalletBalance = async (addr, targetChain) => {
    let native = 0, usdt = 0, price = 0;
    try {
      if (targetChain === 'ETH') {
        const apiKeyParam = ethApiKey ? `&apikey=${ethApiKey}` : '&apikey=YourApiKeyToken';
        const [ethRes, usdtRes, priceRes] = await Promise.all([
          fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${addr}&tag=latest${apiKeyParam}`).then(r => r.json()),
          fetch(`https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=0xdAC17F958D2ee523a2206206994597C13D831ec7&address=${addr}&tag=latest${apiKeyParam}`).then(r => r.json()),
          fetch(`https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT`).then(r => r.json()).catch(() => ({ price: 0 }))
        ]);
        native = (parseFloat(ethRes.result) || 0) / 1e18;
        usdt = (parseFloat(usdtRes.result) || 0) / 1e6;
        price = parseFloat(priceRes.price || 0);
      } else if (targetChain === 'TRX') {
        const [accountRes, priceRes] = await Promise.all([
          fetch(`https://apilist.tronscanapi.com/api/account?address=${addr}`).then(r => r.json()),
          fetch(`https://api.binance.com/api/v3/ticker/price?symbol=TRXUSDT`).then(r => r.json()).catch(() => ({ price: 0 }))
        ]);
        native = (accountRes.balance || 0) / 1e6;
        if (accountRes.trc20token_balances) {
          const usdtToken = accountRes.trc20token_balances.find(t => t.tokenId === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' || t.tokenSymbol === 'USDT');
          if (usdtToken) usdt = parseFloat(usdtToken.balance) / Math.pow(10, usdtToken.tokenDecimal || 6);
        }
        price = parseFloat(priceRes.price || 0);
      }
    } catch (e) {
      console.error('获取资产余额失败:', e);
    }
    const totalUsd = (native * price) + usdt;
    return { native, usdt, price, totalUsd, chain: targetChain };
  };
  const fetchEthData = async (queryAddress, pageNum) => {
    const apiKeyParam = ethApiKey ? `&apikey=${ethApiKey}` : '&apikey=YourApiKeyToken';
    const baseUrl = 'https://api.etherscan.io/api?module=account';
    const [normalRes, tokenRes] = await Promise.all([
      fetch(`${baseUrl}&action=txlist&address=${queryAddress}&startblock=0&endblock=99999999&page=${pageNum}&offset=${FETCH_LIMIT}&sort=desc${apiKeyParam}`),
      fetch(`${baseUrl}&action=tokentx&address=${queryAddress}&startblock=0&endblock=99999999&page=${pageNum}&offset=${FETCH_LIMIT}&sort=desc${apiKeyParam}`)
    ]);
    const [normalData, tokenData] = await Promise.all([normalRes.json(), tokenRes.json()]);
    if (normalData.status === '0' && normalData.message !== 'No transactions found' && !normalData.result.includes('Rate limit')) {
      throw new Error(`Etherscan API: ${normalData.result}`);
    }
    let txs = [];
    if (normalData.status === '1' && Array.isArray(normalData.result)) {
      txs = txs.concat(normalData.result.map(tx => ({
        hash: tx.hash,
        timestamp: parseInt(tx.timeStamp) * 1000,
        from: tx.from,
        to: tx.to,
        amount: formatAmount(tx.value, 18),
        symbol: 'ETH',
        type: 'NATIVE',
        status: tx.isError === '0' ? '成功' : '失败',
        explorerUrl: `https://etherscan.io/tx/${tx.hash}`
      })));
    }
    if (tokenData.status === '1' && Array.isArray(tokenData.result)) {
      txs = txs.concat(tokenData.result.map(tx => ({
        hash: tx.hash,
        timestamp: parseInt(tx.timeStamp) * 1000,
        from: tx.from,
        to: tx.to,
        amount: formatAmount(tx.value, tx.tokenDecimal),
        symbol: tx.tokenSymbol || 'ERC20',
        type: 'TOKEN',
        status: '成功',
        explorerUrl: `https://etherscan.io/tx/${tx.hash}`
      })));
    }
    const normalCount = Array.isArray(normalData.result) ? normalData.result.length : 0;
    const tokenCount = Array.isArray(tokenData.result) ? tokenData.result.length : 0;
    return { txs, hasMore: normalCount === FETCH_LIMIT || tokenCount === FETCH_LIMIT };
  };
  const fetchTrxData = async (queryAddress, pageNum) => {
    const startOffset = (pageNum - 1) * FETCH_LIMIT;
    const [normalRes, tokenRes] = await Promise.all([
      fetch(`https://apilist.tronscanapi.com/api/transaction?sort=-timestamp&count=true&limit=${FETCH_LIMIT}&start=${startOffset}&address=${queryAddress}`),
      fetch(`https://apilist.tronscanapi.com/api/token_trc20/transfers?limit=${FETCH_LIMIT}&start=${startOffset}&sort=-timestamp&count=true&relatedAddress=${queryAddress}`)
    ]);
    if (!normalRes.ok || !tokenRes.ok) throw new Error('Tronscan API 请求失败');
    const normalData = await normalRes.json();
    const tokenData = await tokenRes.json();
    let txs = [];
    let normalCount = 0;
    let tokenCount = 0;
    if (normalData.data && Array.isArray(normalData.data)) {
      normalCount = normalData.data.length;
      txs = txs.concat(normalData.data
        .filter(tx => tx.amount && parseFloat(tx.amount) > 0)
        .map(tx => ({
          hash: tx.hash,
          timestamp: tx.timestamp,
          from: tx.ownerAddress,
          to: tx.toAddress,
          amount: formatAmount(tx.amount, 6),
          symbol: 'TRX',
          type: 'NATIVE',
          status: tx.contractRet === 'SUCCESS' ? '成功' : '失败',
          explorerUrl: `https://tronscan.org/#/transaction/${tx.hash}`
        })));
    }
    const trc20List = tokenData.token_transfers || tokenData.data;
    if (trc20List && Array.isArray(trc20List)) {
      tokenCount = trc20List.length;
      txs = txs.concat(trc20List.map(tx => {
        const tokenInfo = tx.token_info || tx.tokenInfo || {};
        const decimals = tokenInfo.decimals || tokenInfo.tokenDecimal || 6;
        const symbol = tokenInfo.symbol || tokenInfo.tokenAbbr || 'TRC20';
        return {
          hash: tx.transaction_id,
          timestamp: tx.block_ts,
          from: tx.from_address,
          to: tx.to_address,
          amount: formatAmount(tx.quant, decimals),
          symbol: symbol,
          type: 'TOKEN',
          status: tx.status === 1 || tx.status === undefined ? '成功' : '失败',
          explorerUrl: `https://tronscan.org/#/transaction/${tx.transaction_id}`
        };
      }));
    }
    return { txs, hasMore: normalCount === FETCH_LIMIT || tokenCount === FETCH_LIMIT };
  };
  const handleSearch = async (searchAddress, isLoadMore = false) => {
    const addr = searchAddress.trim();
    if (!addr) return;
    let targetChain = chain;
    if (targetChain === 'AUTO') {
      targetChain = detectChain(addr);
      if (!targetChain) {
        setError('无法自动识别网络，请确认地址格式正确。');
        return;
      }
    }
    if (!isLoadMore) {
      setLoading(true);
      setFetchingBalance(true);
      setWalletInfo(null);
      setError(null);
      setFilterType('ALL');
      setCurrentPage(1);
      setApiPage(1);
    } else {
      setLoadingMore(true);
    }
    const targetApiPage = isLoadMore ? apiPage + 1 : 1;
    try {
      if (!isLoadMore) {
        fetchWalletBalance(addr, targetChain).then(info => {
          setWalletInfo(info);
          setFetchingBalance(false);
        });
      }
      let result = { txs: [], hasMore: false };
      if (targetChain === 'ETH') {
        result = await fetchEthData(addr, targetApiPage);
      } else if (targetChain === 'TRX') {
        result = await fetchTrxData(addr, targetApiPage);
      }
      const mergedTxs = isLoadMore ? [...allTransactions, ...result.txs] : result.txs;
      const uniqueTxs = Array.from(new Map(mergedTxs.map(item => [item.hash + item.type, item])).values());
      uniqueTxs.sort((a, b) => b.timestamp - a.timestamp);
      setAllTransactions(uniqueTxs);
      setHasMoreData(result.hasMore);
      setApiPage(targetApiPage);
      setCurrentQuery({ address: addr.toLowerCase(), chain: targetChain });
      if (!isLoadMore) {
        setHistory(prev => {
          const existing = prev.find(item => item.address.toLowerCase() === addr.toLowerCase());
          let newHistory;
          if (existing) {
            newHistory = [{ ...existing, lastQueried: Date.now() }, ...prev.filter(item => item.address.toLowerCase() !== addr.toLowerCase())];
          } else {
            newHistory = [{ address: addr, chain: targetChain, remark: '', lastQueried: Date.now() }, ...prev];
          }
          // 保存至云端(按当前 UID)
          if (user) setDoc(historyRef(user.uid), { items: newHistory }).catch(console.error);
          return newHistory;
        });
      }
    } catch (err) {
      if (!isLoadMore) {
        setError(err.message || '查询失败，请检查地址或网络状态。');
        setFetchingBalance(false);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };
  const jumpToAddress = (targetAddress) => {
    setAddress(targetAddress);
    const detected = detectChain(targetAddress);
    if (detected) setChain(detected);
    handleSearch(targetAddress, false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const handleScan = (scannedText) => {
    const parsedAddress = parseQrAddress(scannedText);
    setShowScanner(false);
    jumpToAddress(parsedAddress);
  };
  const saveApiKey = (key) => {
    setEthApiKey(key);
    localStorage.setItem('eth_api_key', key);
    setShowSettings(false);
  };
  const filteredTransactions = useMemo(() => {
    return allTransactions.filter(tx => {
      const isOut = tx.from.toLowerCase() === currentQuery.address;
      const isIn = tx.to && tx.to.toLowerCase() === currentQuery.address;
      switch (filterType) {
        case 'IN': return isIn;
        case 'OUT': return isOut;
        case 'TOKEN': return tx.type === 'TOKEN';
        case 'NATIVE': return tx.type === 'NATIVE';
        default: return true;
      }
    });
  }, [allTransactions, currentQuery.address, filterType]);
  const totalPages = Math.ceil(filteredTransactions.length / PAGE_SIZE) || 1;
  const paginatedTransactions = filteredTransactions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-900 pb-10">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-20 border-b border-slate-200/60 px-4 md:px-6 py-3 md:py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2.5 md:gap-3">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-indigo-600 rounded-lg md:rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <Wallet className="w-4 h-4 md:w-5 md:h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold text-slate-900 leading-tight">Web3 交易查询</h1>
            <p className="text-[10px] md:text-xs text-slate-500">支持 多币种 & 实时余额折算</p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {user && !user.isAnonymous ? (
            <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100">
              {user.photoURL ? (
                <img src={user.photoURL} alt="avatar" className="w-5 h-5 md:w-6 md:h-6 rounded-full shadow-sm" />
              ) : (
                <div className="w-5 h-5 md:w-6 md:h-6 bg-indigo-200 rounded-full flex items-center justify-center text-indigo-700 font-bold text-xs">
                  {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <span className="hidden sm:inline text-xs font-semibold text-indigo-700 max-w-[90px] truncate">
                {user.displayName || user.email}
              </span>
              <button onClick={handleLogout} className="text-xs text-indigo-400 hover:text-indigo-600 ml-1 font-medium transition-colors">退出</button>
            </div>
          ) : (
            <button
              onClick={handleGoogleLogin}
              className="flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 bg-white border border-slate-200 hover:border-indigo-200 rounded-full shadow-sm text-[12px] md:text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-50 transition-all"
            >
              <svg className="w-3.5 h-3.5 md:w-4 md:h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="hidden sm:inline">登录同步</span>
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 md:p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-all duration-200"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>
      {authError && (
        <div className="fixed top-20 right-4 md:right-6 z-[60] p-4 bg-white border-l-4 border-rose-500 rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.15)] flex items-start gap-3 w-[300px] md:w-[340px] animate-[slideIn_0.3s_ease-out]">
          <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-bold text-slate-800 mb-1">登录提示</h4>
            <p className="text-xs text-slate-500 leading-relaxed">{authError}</p>
          </div>
          <button onClick={() => setAuthError('')} className="p-1 -mr-2 -mt-1 text-slate-400 hover:text-rose-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="max-w-[1400px] mx-auto flex flex-col-reverse lg:flex-row gap-4 md:gap-6 p-4 md:p-6">
        <aside className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/30 border border-slate-100 flex flex-col overflow-hidden max-h-[400px] lg:max-h-none lg:h-[calc(100vh-120px)]">
            <div className="p-4 md:p-5 border-b border-slate-100 flex items-center gap-2 sticky top-0 bg-white z-10">
              <History className="w-4 h-4 md:w-5 md:h-5 text-indigo-500" />
              <h2 className="font-bold text-slate-800 text-sm md:text-base">查询记录</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2 md:p-3 space-y-2">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 md:h-40 text-slate-400 text-xs md:text-sm">
                  <Box className="w-6 h-6 md:w-8 md:h-8 mb-2 opacity-20" />
                  暂无历史
                </div>
              ) : (
                history.map((item) => (
                  <HistoryCard
                    key={item.address}
                    item={item}
                    onSelect={() => jumpToAddress(item.address)}
                    onUpdateRemark={(addr, rmk) => {
                      setHistory(h => {
                        const newH = h.map(i => i.address === addr ? { ...i, remark: rmk } : i);
                        if (user) setDoc(historyRef(user.uid), { items: newH }).catch(console.error);
                        return newH;
                      });
                    }}
                    onRemove={(addr) => {
                      setHistory(h => {
                        const newH = h.filter(i => i.address !== addr);
                        if (user) setDoc(historyRef(user.uid), { items: newH }).catch(console.error);
                        return newH;
                      });
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </aside>
        <main className="flex-1 flex flex-col gap-4 md:gap-6">
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/30 border border-slate-100 p-2 md:pl-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 focus-within:ring-4 focus-within:ring-indigo-50/50 transition-all">
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="px-3 py-3 bg-transparent text-slate-700 font-medium focus:outline-none w-full sm:w-28 cursor-pointer border-b sm:border-b-0 sm:border-r border-slate-200"
            >
              <option value="AUTO">自动识别</option>
              <option value="ETH">ETH 链</option>
              <option value="TRX">TRX 链</option>
            </select>
            <div className="flex-1 flex w-full relative">
              <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 hidden sm:block" />
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x... (以太坊) 或 T... (波场)"
                className={`flex-1 px-3 sm:pl-10 ${isMobile ? 'pr-12' : 'pr-3'} py-3 bg-transparent focus:outline-none font-mono text-[14px] md:text-[15px] w-full text-slate-700 placeholder:text-slate-400 placeholder:font-sans`}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(address, false)}
              />
              {isMobile && (
                <button
                  onClick={() => {
                    if (!window.Html5Qrcode) {
                      alert('扫码组件正在加载中，请稍后几秒再试');
                      return;
                    }
                    setShowScanner(true);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-indigo-600 bg-white rounded-md shadow-[0_2px_4px_rgba(0,0,0,0.05)] border border-slate-100 transition-colors"
                  title="扫码识别地址"
                >
                  <Scan className="w-4.5 h-4.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => handleSearch(address, false)}
              disabled={loading || !address}
              className="w-full sm:w-auto px-6 md:px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-indigo-200 text-sm md:text-base"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? '检索中...' : '立即查询'}
            </button>
          </div>
          {error && (
            <div className="p-3 md:p-4 bg-red-50 text-red-700 border border-red-100 rounded-xl flex items-center gap-2 md:gap-3">
              <AlertCircle className="w-4 h-4 md:w-5 md:h-5 text-red-500 flex-shrink-0" />
              <span className="font-medium text-xs md:text-sm break-all">{error}</span>
            </div>
          )}
          {currentQuery.address && !error && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-1">
              {fetchingBalance ? (
                <>
                  <div className="h-24 md:h-28 bg-slate-100 animate-pulse rounded-2xl border border-slate-200"></div>
                  <div className="h-24 md:h-28 bg-slate-100 animate-pulse rounded-2xl border border-slate-200 hidden sm:block"></div>
                  <div className="h-24 md:h-28 bg-slate-100 animate-pulse rounded-2xl border border-slate-200 hidden sm:block"></div>
                </>
              ) : walletInfo ? (
                <>
                  <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl p-4 md:p-5 text-white shadow-lg shadow-indigo-200 flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10"><PieChart className="w-16 h-16" /></div>
                    <div className="text-indigo-100 text-xs md:text-sm font-medium flex items-center gap-1.5 mb-2 relative z-10">
                      <DollarSign className="w-4 h-4" /> 预估总资产 (USD)
                    </div>
                    <div className="text-2xl md:text-3xl font-bold tracking-tight relative z-10 break-all">
                      ${walletInfo.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5 shadow-xl shadow-slate-200/20 flex flex-col justify-between relative overflow-hidden group hover:border-emerald-200 transition-colors">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><DollarSign className="w-16 h-16 text-emerald-500" /></div>
                    <div className="text-slate-500 text-xs md:text-sm font-medium flex items-center gap-1.5 mb-2 relative z-10">
                      <div className="w-2 h-2 rounded-full bg-emerald-400"></div> USDT 余额
                    </div>
                    <div className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight relative z-10 break-all">
                      {walletInfo.usdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5 shadow-xl shadow-slate-200/20 flex flex-col justify-between relative overflow-hidden group hover:border-blue-200 transition-colors">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><Coins className="w-16 h-16 text-blue-500" /></div>
                    <div className="text-slate-500 text-xs md:text-sm font-medium flex items-center gap-1.5 mb-2 relative z-10">
                      <div className={`w-2 h-2 rounded-full ${walletInfo.chain === 'ETH' ? 'bg-blue-500' : 'bg-red-500'}`}></div> {walletInfo.chain} 余额
                    </div>
                    <div className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight relative z-10 break-all">
                      {walletInfo.native.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/30 border border-slate-100 flex-1 flex flex-col overflow-hidden min-h-[400px] md:min-h-[500px]">
            {currentQuery.address && !error && (
              <div className="px-4 md:px-6 py-3 md:py-4 border-b border-slate-100 flex flex-col gap-3 md:gap-4 bg-slate-50/50">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 md:gap-4 w-full">
                  <div className="flex gap-2 w-full overflow-x-auto pb-1 md:pb-0 hide-scrollbar" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                    {['ALL', 'TOKEN', 'NATIVE', 'IN', 'OUT'].map(type => {
                      const labels = { ALL: '全部', TOKEN: '代币 (USDT等)', NATIVE: '主网币', IN: '转入', OUT: '转出' };
                      return (
                        <button
                          key={type}
                          onClick={() => { setFilterType(type); setCurrentPage(1); }}
                          className={`whitespace-nowrap px-3 md:px-4 py-1.5 rounded-full text-[12px] md:text-sm font-medium transition-colors ${
                            filterType === type
                              ? 'bg-slate-800 text-white shadow-sm'
                              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {labels[type]}
                        </button>
                      )
                    })}
                  </div>
                  <div className="text-[12px] md:text-sm font-medium text-slate-500 flex items-center gap-2 flex-shrink-0">
                    <div className={`w-2 h-2 rounded-full ${currentQuery.chain === 'ETH' ? 'bg-blue-500' : 'bg-red-500'}`}></div>
                    当前地址: <span className="font-mono text-slate-700">{shortenAddress(currentQuery.address)}</span>
                  </div>
                </div>
              </div>
            )}
            <div className="hidden md:block overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-slate-50/80 text-slate-500 text-[13px] uppercase tracking-wider">
                    <th className="px-6 py-4 font-semibold border-b border-slate-200 w-48">时间</th>
                    <th className="px-6 py-4 font-semibold border-b border-slate-200 w-32">类型</th>
                    <th className="px-6 py-4 font-semibold border-b border-slate-200 min-w-[200px]">交易方 (点击穿梭)</th>
                    <th className="px-6 py-4 font-semibold border-b border-slate-200">金额 & 币种</th>
                    <th className="px-6 py-4 font-semibold border-b border-slate-200 w-24 text-right">状态/操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {!currentQuery.address ? (
                     <EmptyState isMobile={false} />
                  ) : loading ? (
                     <LoadingSkeleton isMobile={false} />
                  ) : paginatedTransactions.length === 0 ? (
                     <NoDataState isMobile={false} />
                  ) : (
                    paginatedTransactions.map((tx, idx) => (
                      <DesktopTableRow key={`${tx.hash}-${idx}`} tx={tx} currentAddress={currentQuery.address} remarkMap={remarkMap} onAddressClick={jumpToAddress} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="block md:hidden flex-1 bg-white">
                <div className="flex flex-col divide-y divide-slate-100">
                  {!currentQuery.address ? (
                     <EmptyState isMobile={true} />
                  ) : loading ? (
                     <LoadingSkeleton isMobile={true} />
                  ) : paginatedTransactions.length === 0 ? (
                     <NoDataState isMobile={true} />
                  ) : (
                    paginatedTransactions.map((tx, idx) => (
                      <MobileTransactionCard key={`m-${tx.hash}-${idx}`} tx={tx} currentAddress={currentQuery.address} remarkMap={remarkMap} onAddressClick={jumpToAddress} />
                    ))
                  )}
                </div>
            </div>
            {currentQuery.address && !loading && totalPages > 0 && (
              <div className="border-t border-slate-100 p-3 md:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white mt-auto sticky bottom-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <div className="flex items-center justify-between w-full sm:w-auto gap-4">
                  <span className="text-[12px] md:text-[13px] font-medium text-slate-500">
                    {currentPage} / {totalPages} 页 (共 {filteredTransactions.length} 条)
                  </span>
                  {currentPage === totalPages && hasMoreData && (
                    <button
                      onClick={() => handleSearch(currentQuery.address, true)}
                      disabled={loadingMore}
                      className="text-[12px] text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
                    >
                      {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {loadingMore ? '拉取中...' : '加载更早的链上记录'}
                    </button>
                  )}
                </div>
                <div className="flex gap-2 w-full sm:w-auto justify-end">
                  <button
                    onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({top: 0, behavior: 'smooth'}); }}
                    disabled={currentPage === 1}
                    className="p-2 md:p-2 border border-slate-200 rounded-lg md:rounded-xl bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); window.scrollTo({top: 0, behavior: 'smooth'}); }}
                    disabled={currentPage === totalPages}
                    className="p-2 md:p-2 border border-slate-200 rounded-lg md:rounded-xl bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 md:p-6 relative">
            <button
              onClick={() => setShowSettings(false)}
              className="absolute top-3 right-3 md:top-4 md:right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base md:text-lg font-bold text-slate-800 mb-4 md:mb-6 flex items-center gap-2">
              <Settings className="w-4 h-4 md:w-5 md:h-5 text-indigo-500" /> API 配置
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs md:text-sm font-semibold text-slate-700 mb-2">
                  Etherscan API Key <span className="text-slate-400 font-normal">(仅 ETH 需配置)</span>
                </label>
                <input
                  type="text"
                  value={ethApiKey}
                  onChange={(e) => setEthApiKey(e.target.value)}
                  placeholder="留空则使用公共节点"
                  className="w-full px-3 py-2.5 md:px-4 md:py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm bg-slate-50"
                />
                <p className="text-[11px] md:text-[13px] text-slate-500 mt-2 leading-relaxed">
                  为保障获取主网币与代币(ERC20)数据的稳定性，建议配置 API Key。波场网络默认无限制。
                </p>
              </div>
              <button
                onClick={() => saveApiKey(ethApiKey)}
                className="w-full bg-slate-900 text-white font-medium py-2.5 md:py-3 rounded-xl hover:bg-slate-800 transition-colors mt-2 md:mt-4 text-sm md:text-base"
              >
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}
      {showScanner && (
        <QrScannerModal
          onClose={() => setShowScanner(false)}
          onScan={handleScan}
        />
      )}
    </div>
  );
}
function QrScannerModal({ onClose, onScan }) {
  useEffect(() => {
    if (!window.Html5Qrcode) return;
    const html5QrCode = new window.Html5Qrcode("qr-reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        html5QrCode.stop().then(() => {
          onScan(decodedText);
        }).catch(err => {
          console.error("停止扫描失败", err);
          onScan(decodedText);
        });
      },
      (errorMessage) => {}
    ).catch(err => {
      console.error("启动摄像头失败", err);
      alert("无法访问摄像头，请检查浏览器的摄像头权限设置。");
      onClose();
    });
    return () => {
      if (html5QrCode.isScanning) {
        html5QrCode.stop().catch(console.error);
      }
    };
  }, [onClose, onScan]);
  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm flex flex-col items-center">
        <h3 className="text-white text-lg font-bold mb-4">扫描钱包二维码</h3>
        <div className="relative w-full aspect-square bg-slate-900 rounded-2xl overflow-hidden shadow-[0_0_0_4px_rgba(255,255,255,0.15)]">
          <div id="qr-reader" className="w-full h-full object-cover"></div>
          <div className="absolute top-0 left-0 w-full h-[3px] bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,1)] animate-[scan_2s_ease-in-out_infinite]"></div>
        </div>
        <p className="text-slate-300 text-sm mt-6 mb-8 text-center leading-relaxed">
          请将二维码对准扫描框内 <br/>
          <span className="text-slate-500 text-xs">支持 ETH 与 TRX 地址</span>
        </p>
        <button
          onClick={onClose}
          className="p-3.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-md"
        >
          <X className="w-6 h-6" />
        </button>
      </div>
      <style>{`
        @keyframes scan {
          0%, 100% { top: 0; }
          50% { top: 100%; }
        }
      `}</style>
    </div>
  );
}
function AddressDisplay({ address, currentAddress, remarkMap, onAddressClick }) {
  if (!address) return <span>-</span>;
  const isMe = address.toLowerCase() === currentAddress.toLowerCase();
  const remark = remarkMap[address.toLowerCase()];
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 flex-wrap">
      {remark && (
        <span
          onClick={(e) => {
            if (!isMe) { e.stopPropagation(); onAddressClick(address); }
          }}
          className={`px-1.5 py-0.5 rounded text-[10px] md:text-[11px] font-bold w-fit ${
            isMe ? 'bg-indigo-100 text-indigo-700 cursor-default' : 'bg-amber-100 text-amber-700 hover:bg-amber-200 cursor-pointer shadow-sm transition-colors'
          }`}
          title={address}
        >
          {remark}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <span
          onClick={(e) => {
            if (!isMe) { e.stopPropagation(); onAddressClick(address); }
          }}
          className={`font-mono text-[12px] md:text-[13px] ${
            isMe ? 'text-slate-800 font-semibold cursor-default' : 'text-indigo-600 hover:text-indigo-800 cursor-pointer underline decoration-indigo-200 underline-offset-2'
          }`}
          title={address}
        >
          {shortenAddress(address)}
        </span>
        {isMe && <span className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[9px] md:text-[10px] font-bold">ME</span>}
      </div>
    </div>
  );
}
function DesktopTableRow({ tx, currentAddress, remarkMap, onAddressClick }) {
  const isOut = tx.from.toLowerCase() === currentAddress.toLowerCase();
  const isIn = tx.to && tx.to.toLowerCase() === currentAddress.toLowerCase();
  const txDirection = isOut ? 'OUT' : (isIn ? 'IN' : 'OTHER');
  return (
    <tr className="hover:bg-slate-50/80 transition-colors group">
      <td className="px-6 py-4">
        <div className="flex items-center gap-2 text-slate-500 text-[13px]">
          <Clock className="w-3.5 h-3.5" />
          {formatTime(tx.timestamp)}
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide border ${
          tx.type === 'TOKEN' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
        }`}>
          {tx.type}
        </span>
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium w-8">FROM</span>
            <AddressDisplay address={tx.from} currentAddress={currentAddress} remarkMap={remarkMap} onAddressClick={onAddressClick} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium w-8">TO</span>
            <AddressDisplay address={tx.to} currentAddress={currentAddress} remarkMap={remarkMap} onAddressClick={onAddressClick} />
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          {txDirection === 'IN' ? <ArrowDownRight className="w-4 h-4 text-emerald-500" /> : txDirection === 'OUT' ? <ArrowUpRight className="w-4 h-4 text-rose-500" /> : <div className="w-4 h-4" />}
          <span className={`font-bold text-[15px] ${txDirection === 'IN' ? 'text-emerald-600' : txDirection === 'OUT' ? 'text-rose-600' : 'text-slate-700'}`}>
            {txDirection === 'IN' ? '+' : txDirection === 'OUT' ? '-' : ''} {tx.amount}
          </span>
          <span className="font-semibold text-[13px] text-slate-500 ml-1">{tx.symbol}</span>
        </div>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-3">
          <span className={`w-2 h-2 rounded-full ${tx.status === '成功' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-rose-400'}`} title={tx.status}></span>
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => copyToClipboard(tx.hash)} className="p-1.5 text-slate-400 hover:text-indigo-600 bg-white shadow-sm border border-slate-200 rounded-md" title="复制 Hash"><Copy className="w-3.5 h-3.5" /></button>
            <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="p-1.5 text-slate-400 hover:text-indigo-600 bg-white shadow-sm border border-slate-200 rounded-md" title="浏览器查看"><ExternalLink className="w-3.5 h-3.5" /></a>
          </div>
        </div>
      </td>
    </tr>
  );
}
function MobileTransactionCard({ tx, currentAddress, remarkMap, onAddressClick }) {
  const isOut = tx.from.toLowerCase() === currentAddress.toLowerCase();
  const isIn = tx.to && tx.to.toLowerCase() === currentAddress.toLowerCase();
  const txDirection = isOut ? 'OUT' : (isIn ? 'IN' : 'OTHER');
  return (
    <div className="p-4 flex flex-col gap-3 hover:bg-slate-50 transition-colors">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${tx.type === 'TOKEN' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>
            {tx.type}
          </span>
          <span className="text-slate-500 text-xs flex items-center gap-1"><Clock className="w-3 h-3"/> {formatTime(tx.timestamp)}</span>
        </div>
        <div className="flex gap-3">
          <button onClick={() => copyToClipboard(tx.hash)} className="text-slate-400 active:text-indigo-600"><Copy className="w-4 h-4"/></button>
          <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="text-slate-400 active:text-indigo-600"><ExternalLink className="w-4 h-4"/></a>
        </div>
      </div>
      <div className="flex items-center gap-2 py-1">
        {txDirection === 'IN' ? <ArrowDownRight className="w-5 h-5 text-emerald-500" /> : txDirection === 'OUT' ? <ArrowUpRight className="w-5 h-5 text-rose-500" /> : <div className="w-5 h-5" />}
        <span className={`text-xl font-bold tracking-tight ${txDirection === 'IN' ? 'text-emerald-600' : txDirection === 'OUT' ? 'text-rose-600' : 'text-slate-700'}`}>
          {txDirection === 'IN' ? '+' : txDirection === 'OUT' ? '-' : ''} {tx.amount}
        </span>
        <span className="text-sm font-semibold text-slate-500">{tx.symbol}</span>
        <span className={`ml-auto w-2 h-2 rounded-full ${tx.status === '成功' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-rose-400'}`}></span>
      </div>
      <div className="flex flex-col gap-2.5 bg-slate-50/80 border border-slate-100 p-3 rounded-lg text-[13px]">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1.5">
          <span className="text-slate-400 text-xs font-medium">FROM</span>
          <AddressDisplay address={tx.from} currentAddress={currentAddress} remarkMap={remarkMap} onAddressClick={onAddressClick} />
        </div>
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1.5 border-t border-slate-100 pt-1.5">
          <span className="text-slate-400 text-xs font-medium">TO</span>
          <AddressDisplay address={tx.to} currentAddress={currentAddress} remarkMap={remarkMap} onAddressClick={onAddressClick} />
        </div>
      </div>
    </div>
  );
}
function EmptyState({ isMobile }) {
  const content = (
    <div className="inline-flex flex-col items-center justify-center text-slate-400">
      <Search className="w-10 h-10 md:w-12 md:h-12 mb-3 md:mb-4 opacity-20" />
      <p className="font-medium text-sm md:text-base">输入地址开始检索链上数据</p>
    </div>
  );
  if (isMobile) return <div className="py-20 md:py-32 text-center">{content}</div>;
  return <tr><td colSpan="5" className="px-6 py-20 md:py-32 text-center">{content}</td></tr>;
}
function NoDataState({ isMobile }) {
  if (isMobile) return <div className="py-16 md:py-24 text-center text-slate-500 text-sm md:text-base">该分类下未找到交易记录</div>;
  return <tr><td colSpan="5" className="px-6 py-16 md:py-24 text-center text-slate-500 text-sm md:text-base">该分类下未找到交易记录</td></tr>;
}
function LoadingSkeleton({ isMobile }) {
  if (isMobile) {
    return (
      <>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="p-4 flex flex-col gap-4 animate-pulse border-b border-slate-100">
             <div className="flex justify-between"><div className="h-4 bg-slate-100 rounded w-16"></div><div className="h-4 bg-slate-100 rounded w-24"></div></div>
             <div className="h-6 bg-slate-100 rounded w-32"></div>
             <div className="h-14 bg-slate-100 rounded-lg w-full"></div>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <tr key={i} className="animate-pulse">
          <td className="px-6 py-5"><div className="h-4 bg-slate-100 rounded w-24"></div></td>
          <td className="px-6 py-5"><div className="h-5 bg-slate-100 rounded-full w-16"></div></td>
          <td className="px-6 py-5"><div className="h-4 bg-slate-100 rounded w-48 mb-2"></div><div className="h-4 bg-slate-100 rounded w-32"></div></td>
          <td className="px-6 py-5"><div className="h-5 bg-slate-100 rounded w-24"></div></td>
          <td className="px-6 py-5 text-right"><div className="h-4 bg-slate-100 rounded w-8 ml-auto"></div></td>
        </tr>
      ))}
    </>
  );
}
function HistoryCard({ item, onSelect, onUpdateRemark, onRemove }) {
  const [isEditing, setIsEditing] = useState(false);
  const [remarkInput, setRemarkInput] = useState(item.remark);
  const handleSaveRemark = (e) => {
    e.stopPropagation();
    onUpdateRemark(item.address, remarkInput);
    setIsEditing(false);
  };
  return (
    <div
      className="group bg-white border border-slate-100 rounded-xl p-3 md:p-3.5 hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-100/50 cursor-pointer transition-all relative"
      onClick={onSelect}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(item.address); }}
        className="absolute top-2 right-2 md:top-3 md:right-3 p-1.5 bg-rose-50 text-rose-400 hover:text-rose-600 hover:bg-rose-100 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all scale-95 md:group-hover:scale-100"
        title="删除记录"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-center gap-2 mb-2 pr-6">
        <span className={`text-[9px] md:text-[10px] px-1.5 md:px-2 py-0.5 rounded-md font-bold tracking-wider ${item.chain === 'ETH' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
          {item.chain}
        </span>
        <span className="font-mono text-[12px] md:text-[13px] text-slate-700 font-medium truncate">
          {shortenAddress(item.address)}
        </span>
      </div>
      <div className="flex items-center mt-2.5 md:mt-3 pt-2.5 md:pt-3 border-t border-slate-50 h-8" onClick={e => e.stopPropagation()}>
        {isEditing ? (
          <div className="flex items-center w-full gap-2">
            <input
              type="text"
              autoFocus
              value={remarkInput}
              onChange={(e) => setRemarkInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveRemark(e)}
              placeholder="输入标签..."
              className="flex-1 text-[12px] md:text-[13px] px-2 md:px-2.5 py-1 md:py-1.5 border border-indigo-200 bg-indigo-50/30 rounded-lg focus:outline-none focus:border-indigo-400"
            />
            <button onClick={handleSaveRemark} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100">
              <Check className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full group/remark">
            <span className={`text-[12px] md:text-[13px] truncate pr-2 md:pr-4 ${item.remark ? 'text-slate-600 font-medium' : 'text-slate-400'}`}>
              {item.remark || '点击添加备注/标签'}
            </span>
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg opacity-100 md:opacity-0 md:group-hover/remark:opacity-100 transition-all"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}