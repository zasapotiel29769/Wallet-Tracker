import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import {
  getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signOut,
  linkWithPopup, signInWithCredential,
} from 'firebase/auth';
import {
  getFirestore, doc, onSnapshot, setDoc, getDoc,
} from 'firebase/firestore';
import {
  Wallet, Settings, History, Search, Scan, Loader2, AlertCircle, X,
  DollarSign, ChevronLeft, ChevronRight, Clock, ArrowDownRight, ArrowUpRight,
  Copy, ExternalLink, Check, Edit2, Sun, Moon, Monitor, Image as ImageIcon,
  LogOut, Eye, EyeOff, Trash2, FileText, Network, Calculator, Download,
} from 'lucide-react';

// ⚠️ 换回你自己的 firebaseConfig
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
let analytics; try { analytics = getAnalytics(app); } catch (e) {}
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const FETCH_LIMIT = 50;
const PAGE_SIZE = 20;
const ENS_RPC = 'https://cloudflare-eth.com';

// ============ 工具函数 ============
const shortenAddress = (a) => (!a ? '' : `${a.slice(0, 6)}...${a.slice(-4)}`);
const shortenHash = (h) => (!h ? '' : `${h.slice(0, 10)}...${h.slice(-8)}`);

const formatTime = (ts) => {
  if (!ts) return '';
  return new Date(parseInt(ts)).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
};

const formatDate = (ts) => {
  if (!ts) return '';
  return new Date(parseInt(ts)).toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
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
  } catch (err) { console.error('复制失败', err); }
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
  if (addr.toLowerCase().startsWith('ethereum:')) addr = addr.substring(9).split('@')[0];
  else if (addr.toLowerCase().startsWith('tron:')) addr = addr.substring(5);
  return addr.trim();
};

const cleanForFirestore = (items) =>
  items.map((item) => {
    const o = {};
    Object.keys(item).forEach((k) => { if (item[k] !== undefined) o[k] = item[k]; });
    return o;
  });

const detectInputType = (raw) => {
  const v = raw.trim();
  if (!v) return { type: 'EMPTY' };
  if (/\.eth$/i.test(v)) return { type: 'ENS', chain: 'ETH' };
  if (/^0x[a-fA-F0-9]{64}$/.test(v)) return { type: 'TX', chain: 'ETH' };
  if (/^0x[a-fA-F0-9]{40}$/.test(v)) return { type: 'ADDRESS', chain: 'ETH' };
  if (/^T[a-zA-Z0-9]{33}$/.test(v)) return { type: 'ADDRESS', chain: 'TRX' };
  if (/^[a-fA-F0-9]{64}$/.test(v)) return { type: 'TX', chain: 'TRX' };
  return { type: 'UNKNOWN' };
};

const resolveEns = async (name) => {
  try {
    const namehash = await ensNamehash(name);
    const registry = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
    const resolverData = '0x0178b8bf' + namehash.slice(2);
    const resolverAddr = await ethCall(registry, resolverData);
    const resolver = '0x' + resolverAddr.slice(-40);
    if (/^0x0+$/.test(resolver)) return null;
    const addrData = '0x3b3b57de' + namehash.slice(2);
    const addrRes = await ethCall(resolver, addrData);
    const addr = '0x' + addrRes.slice(-40);
    return /^0x0+$/.test(addr) ? null : addr;
  } catch (e) {
    console.error('ENS 解析失败', e);
    return null;
  }
};

const ethCall = async (to, data) => {
  const res = await fetch(ENS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  const json = await res.json();
  return json.result || '0x';
};

const ensNamehash = async (name) => {
  let node = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const labels = name.toLowerCase().split('.');
  for (let i = labels.length - 1; i >= 0; i--) {
    const labelHash = await keccak256(new TextEncoder().encode(labels[i]));
    node = await keccak256(hexToBytes(node + labelHash.slice(2)));
  }
  return node;
};

const keccak256 = (() => {
  const RC = [
    [0,1],[0x8082,0],[0x808a,0x80000000],[0x80008000,0x80000000],[0x808b,0],[0x80000001,0],
    [0x80008081,0x80000000],[0x8009,0x80000000],[0x8a,0],[0x88,0],[0x80008009,0],[0x8000000a,0],
    [0x8000808b,0],[0x8b,0x80000000],[0x8089,0x80000000],[0x8003,0x80000000],[0x8002,0x80000000],
    [0x80,0x80000000],[0x800a,0],[0x8000000a,0x80000000],[0x80008081,0x80000000],[0x8080,0x80000000],
    [0x80000001,0],[0x80008008,0x80000000],
  ];
  const r = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
  function keccakF(s) {
    for (let round = 0; round < 24; round++) {
      const c = [];
      for (let x = 0; x < 5; x++) {
        c[x*2] = s[x*2]^s[(x+5)*2]^s[(x+10)*2]^s[(x+15)*2]^s[(x+20)*2];
        c[x*2+1] = s[x*2+1]^s[(x+5)*2+1]^s[(x+10)*2+1]^s[(x+15)*2+1]^s[(x+20)*2+1];
      }
      for (let x = 0; x < 5; x++) {
        const d0 = c[((x+4)%5)*2] ^ rotl1(c[((x+1)%5)*2], c[((x+1)%5)*2+1])[0];
        const d1 = c[((x+4)%5)*2+1] ^ rotl1(c[((x+1)%5)*2], c[((x+1)%5)*2+1])[1];
        for (let y = 0; y < 5; y++) { s[(x+y*5)*2]^=d0; s[(x+y*5)*2+1]^=d1; }
      }
      let b = new Array(50).fill(0);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        const idx=(x+y*5)*2, off=r[x+y*5];
        const [lo,hi]=rotl(s[idx],s[idx+1],off);
        const nx=y, ny=(2*x+3*y)%5, nidx=(nx+ny*5)*2;
        b[nidx]=lo; b[nidx+1]=hi;
      }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        const idx=(x+y*5)*2;
        s[idx]=b[idx]^((~b[((x+1)%5+y*5)*2])&b[((x+2)%5+y*5)*2]);
        s[idx+1]=b[idx+1]^((~b[((x+1)%5+y*5)*2+1])&b[((x+2)%5+y*5)*2+1]);
      }
      s[0]^=RC[round][0]; s[1]^=RC[round][1];
    }
  }
  function rotl1(lo,hi){return [((lo<<1)|(hi>>>31))>>>0,((hi<<1)|(lo>>>31))>>>0];}
  function rotl(lo,hi,n){
    n%=64; if(n===0)return[lo>>>0,hi>>>0];
    if(n<32)return[((lo<<n)|(hi>>>(32-n)))>>>0,((hi<<n)|(lo>>>(32-n)))>>>0];
    n-=32;return[((hi<<n)|(lo>>>(32-n)))>>>0,((lo<<n)|(hi>>>(32-n)))>>>0];
  }
  return async function(bytes){
    const rate=136; const s=new Array(50).fill(0);
    const padded=new Uint8Array(Math.ceil((bytes.length+1)/rate)*rate);
    padded.set(bytes); padded[bytes.length]=0x01; padded[padded.length-1]|=0x80;
    for(let off=0;off<padded.length;off+=rate){
      for(let i=0;i<rate/4;i++){
        const j=off+i*4;
        const w=padded[j]|(padded[j+1]<<8)|(padded[j+2]<<16)|(padded[j+3]<<24);
        s[i]^=(w>>>0);
      }
      keccakF(s);
    }
    let hex='0x';
    for(let i=0;i<8;i++){
      const w=s[i]>>>0;
      hex+=('00'+(w&0xff).toString(16)).slice(-2);
      hex+=('00'+((w>>>8)&0xff).toString(16)).slice(-2);
      hex+=('00'+((w>>>16)&0xff).toString(16)).slice(-2);
      hex+=('00'+((w>>>24)&0xff).toString(16)).slice(-2);
    }
    return hex;
  };
})();

const hexToBytes = (hex) => {
  hex = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i*2, 2), 16);
  return bytes;
};

const historyRef = (uid) => doc(db, 'artifacts', appId, 'users', uid, 'wallet_data', 'history');

export default function App() {
  const currentUidRef = useRef(null); 
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState('AUTO');
  const [allTransactions, setAllTransactions] = useState([]);
  const [rawTransactions, setRawTransactions] = useState([]); // 原始交易数据，用于计算余额
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
  const [trxApiKey, setTrxApiKey] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [isMobile, setIsMobile] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const [showTaxReport, setShowTaxReport] = useState(false);

  const [theme, setTheme] = useState('dark');
  const [activeTab, setActiveTab] = useState('search');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [singleTx, setSingleTx] = useState(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'dark';
    setTheme(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (t) => {
      if (t === 'dark') root.classList.add('dark');
      else if (t === 'light') root.classList.remove('dark');
      else {
        const sys = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', sys);
      }
    };
    apply(theme);
    localStorage.setItem('theme', theme);
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => apply('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      const prevUid = currentUidRef.current;
      const newUid = currentUser ? currentUser.uid : null;
      if (prevUid !== newUid) {
        setHistory([]);
        setCurrentQuery({ address: '', chain: '' });
        setAllTransactions([]);
        setRawTransactions([]);
        setWalletInfo(null);
        setSingleTx(null);
      }
      currentUidRef.current = newUid;
      if (currentUser) {
        setUser(currentUser);
      } else {
        setUser(null);
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          signInWithCustomToken(auth, __initial_auth_token).catch((e) => console.error('token 登录失败', e));
        } else {
          signInAnonymously(auth).catch((e) => console.error('匿名登录失败', e));
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    try {
      const savedKey = localStorage.getItem('eth_api_key');
      if (savedKey) setEthApiKey(savedKey);
      const savedTrxKey = localStorage.getItem('trx_api_key');
      if (savedTrxKey) setTrxApiKey(savedTrxKey);
    } catch (e) {}

    if (!user) { setHistory([]); return; }

    const uid = user.uid;
    const ref = historyRef(uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (currentUidRef.current !== uid) return;
      if (snap.exists()) setHistory(snap.data().items || []);
      else setHistory([]);
    }, (err) => console.error('云端同步异常', err));
    return () => unsub();
  }, [user]);

  const safeWriteHistory = useCallback((items) => {
    const uid = user?.uid;
    if (!uid || currentUidRef.current !== uid) return;
    setDoc(historyRef(uid), { items: cleanForFirestore(items) }).catch(console.error);
  }, [user]);

  const updateRemark = useCallback((addr, rmk) => {
    setHistory(prev => {
      const nh = prev.map(i => i.address === addr ? { ...i, remark: rmk } : i);
      safeWriteHistory(nh);
      return nh;
    });
  }, [safeWriteHistory]);

  const removeHistory = useCallback((addr) => {
    setHistory(prev => {
      const nh = prev.filter(i => i.address !== addr);
      safeWriteHistory(nh);
      return nh;
    });
  }, [safeWriteHistory]);

  useEffect(() => {
    const checkMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(checkMobile);
    if (!document.getElementById('html5-qrcode-script')) {
      const s = document.createElement('script');
      s.id = 'html5-qrcode-script';
      s.src = 'https://unpkg.com/html5-qrcode';
      s.async = true;
      document.head.appendChild(s);
    }
  }, []);

  const remarkMap = useMemo(() => {
    const m = {};
    history.forEach((i) => { if (i.remark) m[i.address.toLowerCase()] = i.remark; });
    return m;
  }, [history]);

  const detectChain = (addr) => {
    if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return 'ETH';
    if (/^T[a-zA-Z0-9]{33}$/.test(addr)) return 'TRX';
    return null;
  };

  const tronFetch = async (url) => {
    const headers = {};
    if (trxApiKey) headers['TRON-PRO-API-KEY'] = trxApiKey;
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      throw new Error('Tronscan 接口请求过于频繁');
    }
    return res;
  };

  const fetchWalletBalance = async (addr, targetChain) => {
    let native = 0, usdt = 0, price = 0;
    try {
      if (targetChain === 'ETH') {
        const k = ethApiKey ? `&apikey=${ethApiKey}` : '&apikey=YourApiKeyToken';
        const [e, u, p] = await Promise.all([
          fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${addr}&tag=latest${k}`).then(r => r.json()),
          fetch(`https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=0xdAC17F958D2ee523a2206206994597C13D831ec7&address=${addr}&tag=latest${k}`).then(r => r.json()),
          fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT').then(r => r.json()).catch(() => ({ price: 0 })),
        ]);
        native = (parseFloat(e.result) || 0) / 1e18;
        usdt = (parseFloat(u.result) || 0) / 1e6;
        price = parseFloat(p.price || 0);
      } else if (targetChain === 'TRX') {
        const [a, p] = await Promise.all([
          tronFetch(`https://apilist.tronscanapi.com/api/account?address=${addr}`).then(r => r.json()),
          fetch('https://api.binance.com/api/v3/ticker/price?symbol=TRXUSDT').then(r => r.json()).catch(() => ({ price: 0 })),
        ]);
        native = (a.balance || 0) / 1e6;
        if (a.trc20token_balances) {
          const t = a.trc20token_balances.find(x => x.tokenId === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' || x.tokenSymbol === 'USDT');
          if (t) usdt = parseFloat(t.balance) / Math.pow(10, t.tokenDecimal || 6);
        }
        price = parseFloat(p.price || 0);
      }
    } catch (e) { console.error('获取余额失败', e); }
    const totalUsd = native * price + usdt;
    return { native, usdt, price, totalUsd, chain: targetChain };
  };

  const fetchEthData = async (q, pageNum) => {
    const k = ethApiKey ? `&apikey=${ethApiKey}` : '&apikey=YourApiKeyToken';
    const base = 'https://api.etherscan.io/api?module=account';
    const [nR, tR] = await Promise.all([
      fetch(`${base}&action=txlist&address=${q}&startblock=0&endblock=99999999&page=${pageNum}&offset=${FETCH_LIMIT}&sort=desc${k}`),
      fetch(`${base}&action=tokentx&address=${q}&startblock=0&endblock=99999999&page=${pageNum}&offset=${FETCH_LIMIT}&sort=desc${k}`),
    ]);
    const [nD, tD] = await Promise.all([nR.json(), tR.json()]);
    if (nD.status === '0' && nD.message !== 'No transactions found' && !String(nD.result).includes('Rate limit')) {
      throw new Error(`Etherscan API: ${nD.result}`);
    }
    let txs = [];
    if (nD.status === '1' && Array.isArray(nD.result)) {
      txs = txs.concat(nD.result.map(tx => ({
        hash: tx.hash, timestamp: parseInt(tx.timeStamp) * 1000,
        from: tx.from, to: tx.to, amount: formatAmount(tx.value, 18),
        rawAmount: tx.value, decimals: 18,
        symbol: 'ETH', type: 'NATIVE', status: tx.isError === '0' ? '成功' : '失败',
        explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
      })));
    }
    if (tD.status === '1' && Array.isArray(tD.result)) {
      txs = txs.concat(tD.result.map(tx => ({
        hash: tx.hash, timestamp: parseInt(tx.timeStamp) * 1000,
        from: tx.from, to: tx.to, amount: formatAmount(tx.value, tx.tokenDecimal),
        rawAmount: tx.value, decimals: tx.tokenDecimal,
        symbol: tx.tokenSymbol || 'ERC20', type: 'TOKEN', status: '成功',
        explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
      })));
    }
    const nc = Array.isArray(nD.result) ? nD.result.length : 0;
    const tc = Array.isArray(tD.result) ? tD.result.length : 0;
    return { txs, hasMore: nc === FETCH_LIMIT || tc === FETCH_LIMIT };
  };

  const fetchTrxData = async (q, pageNum) => {
    const start = (pageNum - 1) * FETCH_LIMIT;
    const [nR, tR] = await Promise.all([
      tronFetch(`https://apilist.tronscanapi.com/api/transaction?sort=-timestamp&count=true&limit=${FETCH_LIMIT}&start=${start}&address=${q}`),
      tronFetch(`https://apilist.tronscanapi.com/api/token_trc20/transfers?limit=${FETCH_LIMIT}&start=${start}&sort=-timestamp&count=true&relatedAddress=${q}`),
    ]);
    if (!nR.ok || !tR.ok) throw new Error('Tronscan API 请求失败');
    const nD = await nR.json();
    const tD = await tR.json();
    let txs = [], nc = 0, tc = 0;
    if (nD.data && Array.isArray(nD.data)) {
      nc = nD.data.length;
      txs = txs.concat(nD.data.filter(tx => tx.amount && parseFloat(tx.amount) > 0).map(tx => ({
        hash: tx.hash, timestamp: tx.timestamp, from: tx.ownerAddress, to: tx.toAddress,
        amount: formatAmount(tx.amount, 6), rawAmount: tx.amount, decimals: 6,
        symbol: 'TRX', type: 'NATIVE',
        status: tx.contractRet === 'SUCCESS' ? '成功' : '失败',
        explorerUrl: `https://tronscan.org/#/transaction/${tx.hash}`,
      })));
    }
    const list = tD.token_transfers || tD.data;
    if (list && Array.isArray(list)) {
      tc = list.length;
      txs = txs.concat(list.map(tx => {
        const info = tx.token_info || tx.tokenInfo || {};
        const dec = info.decimals || info.tokenDecimal || 6;
        const sym = info.symbol || info.tokenAbbr || 'TRC20';
        return {
          hash: tx.transaction_id, timestamp: tx.block_ts, from: tx.from_address, to: tx.to_address,
          amount: formatAmount(tx.quant, dec), rawAmount: tx.quant, decimals: dec,
          symbol: sym, type: 'TOKEN',
          status: tx.status === 1 || tx.status === undefined ? '成功' : '失败',
          explorerUrl: `https://tronscan.org/#/transaction/${tx.transaction_id}`,
        };
      }));
    }
    return { txs, hasMore: nc === FETCH_LIMIT || tc === FETCH_LIMIT };
  };

  const fetchSingleTx = async (hash, txChain) => {
    if (txChain === 'ETH') {
      const k = ethApiKey ? `&apikey=${ethApiKey}` : '&apikey=YourApiKeyToken';
      const res = await fetch(`https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${hash}${k}`).then(r => r.json());
      const tx = res.result;
      if (!tx) throw new Error('未找到该交易');
      return {
        hash: tx.hash, from: tx.from, to: tx.to,
        amount: formatAmount(parseInt(tx.value, 16).toString(), 18),
        symbol: 'ETH', chain: 'ETH', block: parseInt(tx.blockNumber, 16),
        explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
      };
    } else {
      const res = await tronFetch(`https://apilist.tronscanapi.com/api/transaction-info?hash=${hash}`).then(r => r.json());
      if (!res || !res.hash) throw new Error('未找到该交易');
      return {
        hash: res.hash, from: res.ownerAddress, to: res.toAddress,
        amount: res.contractData?.amount ? formatAmount(res.contractData.amount, 6) : '-',
        symbol: 'TRX', chain: 'TRX', block: res.block,
        explorerUrl: `https://tronscan.org/#/transaction/${res.hash}`,
      };
    }
  };

  // 计算每笔交易后的余额（正确逻辑：从最新到最老倒推）
  const calculatePostTransactionBalances = useCallback((txs, info, addr) => {
    if (!txs || txs.length === 0 || !info) return txs.map(tx => ({ ...tx, postBalance: null }));
    
    const currentNative = info.native;
    const currentUsdt = info.usdt;
    const price = info.price || 0;
    const currentTotalUsd = info.totalUsd || 0;
    const addrLower = addr?.toLowerCase() || '';
    
    // 按时间倒序（最新在前）
    const sorted = [...txs].sort((a, b) => b.timestamp - a.timestamp);
    
    let runningNative = currentNative;
    let runningUsdt = currentUsdt;
    
    return sorted.map(tx => {
      const isOut = tx.from?.toLowerCase() === addrLower;
      const isUsdtToken = tx.symbol === 'USDT';
      const amountNum = parseFloat(tx.rawAmount || 0) / Math.pow(10, (tx.decimals || 18));
      
      // 记录变动前的余额（交易发生后的余额）
      const postBalance = {
        native: runningNative,
        usdt: runningUsdt,
        totalUsd: runningNative * price + runningUsdt,
      };
      
      // 反向计算上一笔交易前的余额
      if (isOut) {
        // 转出：从当前余额加上这笔转出
        if (tx.type === 'NATIVE') {
          runningNative += amountNum;
        } else if (isUsdtToken) {
          runningUsdt += amountNum;
        }
      } else if (tx.to?.toLowerCase() === addrLower) {
        // 转入：从当前余额减去这笔转入
        if (tx.type === 'NATIVE') {
          runningNative -= amountNum;
        } else if (isUsdtToken) {
          runningUsdt -= amountNum;
        }
      }
      
      return { ...tx, postBalance };
    });
  }, []);

  // 重新计算带余额的交易列表
  useEffect(() => {
    if (rawTransactions.length > 0 && walletInfo && currentQuery.address) {
      const withBalances = calculatePostTransactionBalances(rawTransactions, walletInfo, currentQuery.address);
      setAllTransactions(withBalances);
    }
  }, [rawTransactions, walletInfo, currentQuery.address, calculatePostTransactionBalances]);

  const handleSearch = async (rawInput, isLoadMore = false) => {
    const raw = (rawInput ?? address).trim();
    if (!raw) return;
    setSingleTx(null);
    setShowTaxReport(false);
    if (!isLoadMore) {
      const info = detectInputType(raw);
      if (info.type === 'ENS') {
        setActiveTab('search');
        setLoading(true); setError(null);
        const resolved = await resolveEns(raw);
        setLoading(false);
        if (!resolved) { setError(`无法解析 ENS 域名 "${raw}"`); return; }
        return doSearch(resolved, 'ETH', false, raw);
      }
      if (info.type === 'TX') {
        let txChain = chain === 'AUTO' ? info.chain : chain;
        setActiveTab('search');
        setLoading(true); setError(null); setWalletInfo(null);
        setCurrentQuery({ address: '', chain: '' }); setAllTransactions([]); setRawTransactions([]);
        try {
          const detail = await fetchSingleTx(raw, txChain);
          setSingleTx(detail);
        } catch (e) { setError(e.message || '交易查询失败'); }
        finally { setLoading(false); }
        return;
      }
      if (info.type === 'UNKNOWN') {
        setError('无法识别输入内容');
        return;
      }
    }
    let targetChain = chain;
    if (targetChain === 'AUTO') {
      targetChain = detectChain(raw);
      if (!targetChain) { setError('无法自动识别网络'); return; }
    }
    return doSearch(raw, targetChain, isLoadMore);
  };

  const doSearch = async (addr, targetChain, isLoadMore, ensName = null) => {
    if (!isLoadMore) {
      setLoading(true); setFetchingBalance(true); setWalletInfo(null);
      setError(null); setFilterType('ALL'); setCurrentPage(1); setApiPage(1);
      setActiveTab('search');
      setRawTransactions([]);
    } else setLoadingMore(true);

    const targetApiPage = isLoadMore ? apiPage + 1 : 1;
    try {
      if (!isLoadMore) {
        const info = await fetchWalletBalance(addr, targetChain);
        setWalletInfo(info); setFetchingBalance(false);
      }
      let result = { txs: [], hasMore: false };
      if (targetChain === 'ETH') result = await fetchEthData(addr, targetApiPage);
      else if (targetChain === 'TRX') result = await fetchTrxData(addr, targetApiPage);
      
      const merged = isLoadMore ? [...rawTransactions, ...result.txs] : result.txs;
      const unique = Array.from(new Map(merged.map(i => [i.hash + i.type, i])).values());
      unique.sort((a, b) => b.timestamp - a.timestamp);
      
      setRawTransactions(unique);
      setHasMoreData(result.hasMore);
      setApiPage(targetApiPage);
      setCurrentQuery({ address: addr.toLowerCase(), chain: targetChain, ens: ensName || null });

      if (!isLoadMore) {
        setHistory(prev => {
          const exist = prev.find(i => i.address.toLowerCase() === addr.toLowerCase());
          let nh;
          if (exist) nh = [{ ...exist, lastQueried: Date.now(), ens: ensName || exist.ens || null }, ...prev.filter(i => i.address.toLowerCase() !== addr.toLowerCase())];
          else nh = [{ address: addr, chain: targetChain, remark: exist?.remark || '', ens: ensName || null, lastQueried: Date.now() }, ...prev];
          safeWriteHistory(nh); 
          return nh;
        });
      }
    } catch (e) {
      if (!isLoadMore) { setError(e.message || '查询失败'); setFetchingBalance(false); }
    } finally { setLoading(false); setLoadingMore(false); }
  };

  const jumpToAddress = (addr) => {
    setActiveTab('search');
    setAddress(addr);
    const d = detectChain(addr);
    if (d) setChain(d);
    handleSearch(addr, false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleScan = (text) => {
    setShowScanner(false);
    jumpToAddress(parseQrAddress(text));
  };

  const saveApiKey = (ethKey, trxKey) => {
    setEthApiKey(ethKey);
    setTrxApiKey(trxKey);
    localStorage.setItem('eth_api_key', ethKey || '');
    localStorage.setItem('trx_api_key', trxKey || '');
  };

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((tx) => {
      const isOut = tx.from?.toLowerCase() === currentQuery.address;
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
  const paginated = filteredTransactions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const allocation = useMemo(() => {
    if (!walletInfo) return [];
    const nativeUsd = walletInfo.native * walletInfo.price;
    const usdtUsd = walletInfo.usdt;
    const total = nativeUsd + usdtUsd;
    if (total <= 0) return [];
    return [
      { label: walletInfo.chain, value: nativeUsd, pct: (nativeUsd / total) * 100, color: '#AB9FF2' },
      { label: 'USDT', value: usdtUsd, pct: (usdtUsd / total) * 100, color: '#26A17B' },
    ].filter(x => x.value > 0);
  }, [walletInfo]);

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => (b.lastQueried || 0) - (a.lastQueried || 0)),
    [history]
  );

  const mainContentProps = {
    chain, setChain, address, setAddress, handleSearch, loading,
    error, singleTx, currentQuery, fetchingBalance, walletInfo, allocation,
    filterType, setFilterType, paginated, remarkMap, jumpToAddress,
    currentPage, setCurrentPage, totalPages, filteredTransactions,
    hasMoreData, loadingMore, isMobile, setShowScanner,
    showTaxReport, setShowTaxReport,
    history, onUpdateRemark: updateRemark, onRemove: removeHistory,
  };

  const settingsProps = {
    user, onLogout: async () => {
      try {
        setHistory([]); setCurrentQuery({ address: '', chain: '' });
        setAllTransactions([]); setRawTransactions([]); setWalletInfo(null); setSingleTx(null);
        await signOut(auth);
        await signInAnonymously(auth);
      } catch (e) { console.error('登出失败', e); }
    }, theme, setTheme,
    ethApiKey, setEthApiKey, trxApiKey, setTrxApiKey,
    onSaveKey: saveApiKey, showKey, setShowKey,
  };

  return (
    <div className="min-h-screen bg-[#F7F7FB] dark:bg-[#0B0E14] text-slate-800 dark:text-slate-100 transition-colors"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <GlobalStyles />
      <div className="hidden lg:flex h-screen overflow-hidden">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)}
          activeTab={activeTab} setActiveTab={setActiveTab} history={sortedHistory}
          onJump={jumpToAddress} onUpdateRemark={updateRemark} onRemove={removeHistory} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopBar user={user} onLogin={async () => {
            try {
              const provider = new GoogleAuthProvider();
              const current = auth.currentUser;
              if (current && current.isAnonymous) {
                try { await linkWithPopup(current, provider); return; }
                catch (linkErr) {
                  if (linkErr.code === 'auth/credential-already-in-use') {
                    const cred = GoogleAuthProvider.credentialFromError(linkErr);
                    const pending = history;
                    const result = await signInWithCredential(auth, cred);
                    const newRef = historyRef(result.user.uid);
                    const newSnap = await getDoc(newRef);
                    const existing = newSnap.exists() ? (newSnap.data().items || []) : [];
                    const map = new Map();
                    [...existing, ...pending].forEach((item) => {
                      if (!item || !item.address) return;
                      const key = item.address.toLowerCase();
                      const prev = map.get(key);
                      if (!prev) map.set(key, item);
                      else map.set(key, { ...prev, ...item, remark: item.remark || prev.remark || '', lastQueried: Math.max(prev.lastQueried || 0, item.lastQueried || 0) });
                    });
                    await setDoc(newRef, { items: cleanForFirestore(Array.from(map.values()).sort((a, b) => (b.lastQueried || 0) - (a.lastQueried || 0))) });
                    return;
                  }
                  throw linkErr;
                }
              }
              await signInWithPopup(auth, provider);
            } catch (error) {
              console.error('Google 登录失败', error);
              if (error.code === 'auth/unauthorized-domain') setAuthError('当前域名未加入 Firebase 授权白名单');
              else if (error.code === 'auth/popup-closed-by-user') setAuthError('登录窗口被关闭');
              else setAuthError('登录失败');
              setTimeout(() => setAuthError(''), 5000);
            }
          }} onLogout={settingsProps.onLogout}
            theme={theme} setTheme={setTheme} onOpenSettings={() => setActiveTab('settings')} />
          <div key={activeTab} className="flex-1 overflow-y-auto px-8 py-6 page-enter">
            {activeTab === 'settings' ? <SettingsPanel {...settingsProps} /> : <MainContent {...mainContentProps} isMobileLayout={false} />}
          </div>
        </div>
      </div>
      <div className="lg:hidden flex flex-col min-h-screen pb-20">
        <MobileHeader user={user} onLogin={settingsProps.onLogout} onGoogleLogin={mainContentProps.onUpdateRemark} theme={theme} setTheme={setTheme} onAvatar={() => setActiveTab('settings')} />
        <div key={activeTab} className="flex-1 px-4 py-4 page-enter">
          {activeTab === 'settings' ? <SettingsPanel {...settingsProps} />
            : activeTab === 'history' ? <MobileHistoryList history={sortedHistory} onJump={jumpToAddress} onUpdateRemark={updateRemark} onRemove={removeHistory} />
            : <MainContent {...mainContentProps} isMobileLayout={true} />}
        </div>
        <MobileTabBar activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
      {authError && (
        <div className="fixed top-6 right-4 z-[80] p-4 bg-white dark:bg-[#1A1726] border-l-4 border-rose-500 rounded-xl shadow-2xl flex items-start gap-3 w-[300px] animate-[slideIn_0.3s_ease-out]">
          <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-bold mb-1">登录提示</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{authError}</p>
          </div>
          <button onClick={() => setAuthError('')} className="text-slate-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
        </div>
      )}
      {showScanner && <QrScannerModal onClose={() => setShowScanner(false)} onScan={handleScan} setError={setError} />}
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      html { -webkit-text-size-adjust: 100%; }
      body { overscroll-behavior: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      * { -webkit-touch-callout: none; }
      input, textarea { -webkit-user-select: text; user-select: text; }
      @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes scan { 0%,100% { top: 4%; } 50% { top: 92%; } }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      .page-enter { animation: fadeUp 0.25s ease-out; }
      .hide-scrollbar::-webkit-scrollbar { display: none; }
      .hide-scrollbar { scrollbar-width: none; }
    `}</style>
  );
}

function Sidebar({ collapsed, onToggle, activeTab, setActiveTab, history, onJump, onUpdateRemark, onRemove }) {
  const navItems = [
    { id: 'search', label: '查询', icon: Search },
    { id: 'history', label: '历史', icon: History },
    { id: 'settings', label: '设置', icon: Settings },
  ];
  return (
    <aside className={`${collapsed ? 'w-20' : 'w-72'} flex-shrink-0 bg-white dark:bg-[#13111C] border-r border-slate-200 dark:border-white/5 flex flex-col transition-all duration-300`}>
      <div className="p-5 flex items-center gap-3 border-b border-slate-100 dark:border-white/5">
        <div className="w-9 h-9 bg-gradient-to-br from-[#AB9FF2] to-[#5C4FE0] rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#AB9FF2]/20">
          <Wallet className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="font-bold text-base leading-tight">CryptoInsight</h1>
            <p className="text-[11px] text-slate-400">Web3 资产追踪</p>
          </div>
        )}
      </div>
      <nav className="p-3 space-y-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === id ? 'bg-[#AB9FF2]/15 text-[#7C6FE8] dark:text-[#AB9FF2]' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
            }`}>
            <Icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && label}
          </button>
        ))}
      </nav>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-3 pb-3 hide-scrollbar">
          <div className="text-[11px] font-semibold text-slate-400 px-3 py-2 uppercase tracking-wider">查询记录</div>
          <div className="space-y-2">
            {history.length === 0 ? (
              <p className="text-xs text-slate-400 px-3 py-4 text-center">暂无历史</p>
            ) : history.map(item => (
              <HistoryCard key={item.address} item={item} onSelect={() => onJump(item.address)}
                onUpdateRemark={onUpdateRemark} onRemove={onRemove} compact />
            ))}
          </div>
        </div>
      )}
      <button onClick={onToggle}
        className="m-3 p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-center">
        {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </button>
    </aside>
  );
}

function TopBar({ user, onLogin, onLogout, theme, setTheme, onOpenSettings }) {
  return (
    <header className="h-16 flex-shrink-0 px-8 flex items-center justify-between border-b border-slate-200 dark:border-white/5 bg-white/70 dark:bg-[#0B0E14]/70 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="font-bold text-lg">Web3 交易查询</span>
      </div>
      <div className="flex items-center gap-3">
        <ThemeToggleBtn theme={theme} setTheme={setTheme} />
        {user && !user.isAnonymous ? (
          <div className="flex items-center gap-2 bg-[#AB9FF2]/10 px-3 py-1.5 rounded-full">
            {user.photoURL ? <img src={user.photoURL} alt="" className="w-6 h-6 rounded-full" />
              : <div className="w-6 h-6 bg-[#AB9FF2] rounded-full flex items-center justify-center text-white text-xs font-bold">{(user.email || 'U').charAt(0).toUpperCase()}</div>}
            <span className="text-xs font-semibold max-w-[100px] truncate">{user.displayName || user.email}</span>
            <button onClick={onLogout} className="text-xs text-slate-400 hover:text-rose-500 ml-1">退出</button>
          </div>
        ) : (
          <button onClick={onLogin}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full text-sm font-medium hover:border-[#AB9FF2]/50 transition-colors">
            <GoogleIcon /> Google 登录
          </button>
        )}
        <button onClick={onOpenSettings} className="p-2 text-slate-400 hover:text-[#AB9FF2] rounded-full transition-colors">
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}

function MobileHeader({ user, onLogin, theme, setTheme, onAvatar }) {
  return (
    <header className="px-5 pt-5 pb-2 flex items-center justify-between sticky top-0 z-30 bg-[#F7F7FB]/80 dark:bg-[#0B0E14]/80 backdrop-blur-xl">
      <h1 className="font-bold text-xl text-[#7C6FE8] dark:text-[#AB9FF2]">CryptoInsight</h1>
      <div className="flex items-center gap-2">
        <ThemeToggleBtn theme={theme} setTheme={setTheme} />
        {user && !user.isAnonymous ? (
          <button onClick={onAvatar}>
            {user.photoURL ? <img src={user.photoURL} alt="" className="w-9 h-9 rounded-full" />
              : <div className="w-9 h-9 bg-[#AB9FF2] rounded-full flex items-center justify-center text-white text-sm font-bold">{(user.email || 'U').charAt(0).toUpperCase()}</div>}
          </button>
        ) : (
          <button onClick={onLogin} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-white/10 rounded-full text-xs font-medium">
            <GoogleIcon size={14} /> 登录
          </button>
        )}
      </div>
    </header>
  );
}

function ThemeToggleBtn({ theme, setTheme }) {
  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <button onClick={() => setTheme(next)}
      className="p-2 text-slate-400 hover:text-[#AB9FF2] rounded-full transition-colors" title={`主题: ${theme}`}>
      <Icon className="w-5 h-5" />
    </button>
  );
}

// ============ 移动端底部 Tab - 大按钮占满高度 ============
function MobileTabBar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'search', label: '查询', icon: Search },
    { id: 'history', label: '历史', icon: History },
    { id: 'settings', label: '设置', icon: Settings },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-[#13111C]/90 backdrop-blur-xl border-t border-slate-200 dark:border-white/5"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}>
      <div className="flex h-16">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === id ? 'text-[#7C6FE8] dark:text-[#AB9FF2]' : 'text-slate-400'
            }`}>
            <Icon className="w-6 h-6" />
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function MainContent(props) {
  const {
    chain, setChain, address, setAddress, handleSearch, loading, error, singleTx,
    currentQuery, fetchingBalance, walletInfo, allocation, filterType, setFilterType,
    paginated, remarkMap, jumpToAddress, currentPage, setCurrentPage, totalPages,
    filteredTransactions, hasMoreData, loadingMore, isMobile, setShowScanner, isMobileLayout,
    showTaxReport, setShowTaxReport,
    history, onUpdateRemark, onRemove,
  } = props;

  const currentRemark = currentQuery.address ? remarkMap[currentQuery.address] || '' : '';
  const [editingRemark, setEditingRemark] = useState(false);
  const [remarkVal, setRemarkVal] = useState('');

  const handleSaveRemark = () => {
    if (currentQuery.address) {
      onUpdateRemark(currentQuery.address, remarkVal);
      setEditingRemark(false);
    }
  };

  const handleEditRemark = () => {
    setRemarkVal(currentRemark || '');
    setEditingRemark(true);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 p-4">
        {!isMobileLayout && <h2 className="font-bold text-lg mb-3">探索链上数据</h2>}
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={chain} onChange={e => setChain(e.target.value)}
            className="px-3 py-3 rounded-xl bg-slate-100 dark:bg-white/5 text-sm font-medium focus:outline-none cursor-pointer">
            <option value="AUTO">🌐 自动识别</option>
            <option value="ETH">ETH 链</option>
            <option value="TRX">TRX 链</option>
          </select>
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={address} onChange={e => setAddress(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch(address, false)}
              placeholder="钱包地址、ENS 域名 或交易哈希"
              className="w-full pl-10 pr-12 py-3 rounded-xl bg-slate-100 dark:bg-white/5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#AB9FF2]/40 placeholder:font-sans placeholder:text-slate-400" />
            {isMobile && (
              <button onClick={() => { if (!window.Html5Qrcode) { alert('扫码组件加载中'); return; } setShowScanner(true); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#AB9FF2]">
                <Scan className="w-5 h-5" />
              </button>
            )}
          </div>
          <button onClick={() => handleSearch(address, false)} disabled={loading || !address}
            className="px-6 py-3 bg-gradient-to-r from-[#AB9FF2] to-[#5C4FE0] text-white font-semibold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-[#AB9FF2]/25 transition-all hover:shadow-[#AB9FF2]/40">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? '检索中' : '立即查询'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium break-all">{error}</span>
        </div>
      )}

      {singleTx && <SingleTxCard tx={singleTx} />}

      {currentQuery.address && !error && !singleTx && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-gradient-to-br from-[#6E5FE0] to-[#4B3FC0] rounded-2xl p-6 text-white relative overflow-hidden">
            {/* 操作按钮移到预估资产卡片内 */}
            <div className="absolute top-4 right-4 flex gap-2 z-10">
              <button onClick={handleEditRemark} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-medium backdrop-blur-sm transition-all">
                <Edit2 className="w-3.5 h-3.5" /> 编辑备注
              </button>
              <button onClick={() => setShowTaxReport(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-medium backdrop-blur-sm transition-all">
                <Calculator className="w-3.5 h-3.5" /> 税务报表
              </button>
            </div>
            
            {/* 备注显示 */}
            {currentRemark && (
              <div className="absolute top-4 left-4">
                <span className="bg-amber-500/30 text-amber-100 px-2 py-0.5 rounded text-xs font-medium">
                  {currentRemark}
                </span>
              </div>
            )}
            
            <div className="text-white/70 text-sm font-medium flex items-center gap-1.5 mb-2">
              <DollarSign className="w-4 h-4" /> 预估总资产 (USD)
            </div>
            {fetchingBalance ? <div className="h-10 w-48 bg-white/20 animate-pulse rounded-lg" />
              : <div className="text-3xl md:text-4xl font-bold tracking-tight break-all">
                  ${(walletInfo?.totalUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>}
            <div className="flex gap-6 mt-5 text-sm">
              <div>
                <div className="text-white/60 text-xs mb-0.5">{walletInfo?.chain || '主币'} 余额</div>
                <div className="font-semibold">{fetchingBalance ? '...' : (walletInfo?.native || 0).toLocaleString('en-US', { maximumFractionDigits: 4 })}</div>
              </div>
              <div>
                <div className="text-white/60 text-xs mb-0.5">USDT 余额</div>
                <div className="font-semibold">{fetchingBalance ? '...' : (walletInfo?.usdt || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
              </div>
            </div>
            
            {/* 备注编辑框 */}
            {editingRemark && (
              <div className="mt-4 flex items-center gap-2">
                <input
                  autoFocus
                  value={remarkVal}
                  onChange={e => setRemarkVal(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveRemark()}
                  placeholder="输入备注/标签..."
                  className="flex-1 px-3 py-2 rounded-lg bg-white/20 backdrop-blur-sm text-white text-sm placeholder:text-white/50 border border-white/20 focus:outline-none focus:border-white/40"
                />
                <button onClick={handleSaveRemark} className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-sm font-medium flex items-center gap-1">
                  <Check className="w-4 h-4" /> 保存
                </button>
                <button onClick={() => setEditingRemark(false)} className="px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium">
                  取消
                </button>
              </div>
            )}
          </div>
          <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 p-5">
            <h3 className="font-bold text-sm mb-3">资产分布</h3>
            {fetchingBalance ? <div className="h-32 bg-slate-100 dark:bg-white/5 animate-pulse rounded-xl" />
              : <AllocationChart data={allocation} mobile={isMobileLayout} />}
          </div>
        </div>
      )}

      {/* 税务报表弹窗 */}
      {showTaxReport && currentQuery.address && (
        <TaxReportModal
          transactions={filteredTransactions}
          walletInfo={walletInfo}
          currentAddress={currentQuery.address}
          onClose={() => setShowTaxReport(false)}
        />
      )}

      {currentQuery.address && !error && !singleTx && (
        <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2 overflow-x-auto hide-scrollbar">
              {['ALL', 'TOKEN', 'NATIVE', 'IN', 'OUT'].map(t => {
                const labels = { ALL: '全部', TOKEN: '代币', NATIVE: '主网币', IN: '转入', OUT: '转出' };
                return (
                  <button key={t} onClick={() => { setFilterType(t); setCurrentPage(1); }}
                    className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      filterType === t ? 'bg-[#AB9FF2] text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400'
                    }`}>{labels[t]}</button>
                );
              })}
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${currentQuery.chain === 'ETH' ? 'bg-blue-500' : 'bg-red-500'}`} />
              {currentQuery.ens ? <span className="font-semibold text-[#AB9FF2]">{currentQuery.ens}</span> : null}
              <span className="font-mono">{shortenAddress(currentQuery.address)}</span>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {loading ? <ListSkeleton />
              : paginated.length === 0 ? <div className="py-16 text-center text-slate-400 text-sm">该分类下未找到交易记录</div>
              : paginated.map((tx, i) => (
                <TxRow key={`${tx.hash}-${i}`} tx={tx} currentAddress={currentQuery.address}
                  remarkMap={remarkMap} onAddressClick={jumpToAddress} chain={currentQuery.chain} />
              ))}
          </div>
          {!loading && (
            <div className="p-4 border-t border-slate-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs text-slate-400">{currentPage} / {totalPages} 页 · 共 {filteredTransactions.length} 条</span>
              <div className="flex items-center gap-2">
                {currentPage === totalPages && hasMoreData && (
                  <button onClick={() => handleSearch(currentQuery.address, true)} disabled={loadingMore}
                    className="text-xs text-[#7C6FE8] dark:text-[#AB9FF2] bg-[#AB9FF2]/10 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5">
                    {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {loadingMore ? '拉取中' : '加载更多记录'}
                  </button>
                )}
                <button onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  disabled={currentPage === 1} className="p-2 border border-slate-200 dark:border-white/10 rounded-lg disabled:opacity-40">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  disabled={currentPage === totalPages} className="p-2 border border-slate-200 dark:border-white/10 rounded-lg disabled:opacity-40">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!currentQuery.address && !singleTx && !error && !loading && (
        <div className="py-24 text-center text-slate-400">
          <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="font-medium">输入地址、ENS 或交易哈希开始检索</p>
        </div>
      )}
    </div>
  );
}

function TaxReportModal({ transactions, walletInfo, currentAddress, onClose }) {
  const [reportType, setReportType] = useState('month');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedQuarter, setSelectedQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const quarters = [1, 2, 3, 4];

  const getDateRange = () => {
    const year = selectedYear;
    if (reportType === 'month') {
      return { start: new Date(year, selectedMonth - 1, 1), end: new Date(year, selectedMonth, 0, 23, 59, 59), label: `${year}年${selectedMonth}月` };
    } else if (reportType === 'quarter') {
      const startMonth = (selectedQuarter - 1) * 3;
      return { start: new Date(year, startMonth, 1), end: new Date(year, startMonth + 3, 0, 23, 59, 59), label: `${year}年第${selectedQuarter}季度` };
    } else {
      return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59), label: `${year}年` };
    }
  };

  const { start, end, label } = getDateRange();

  const filteredTxs = useMemo(() => {
    return transactions.filter(tx => tx.timestamp >= start.getTime() && tx.timestamp <= end.getTime());
  }, [transactions, start, end]);

  const reportData = useMemo(() => {
    let totalInflow = 0, totalOutflow = 0, trxInflow = 0, trxOutflow = 0, usdtInflow = 0, usdtOutflow = 0, txCount = 0;
    const addrLower = currentAddress.toLowerCase();
    const price = walletInfo?.price || 0;

    filteredTxs.forEach(tx => {
      const isOut = tx.from?.toLowerCase() === addrLower;
      const isIn = tx.to && tx.to.toLowerCase() === addrLower;
      const amount = parseFloat(tx.rawAmount || 0) / Math.pow(10, (tx.decimals || 18));
      txCount++;

      if (tx.symbol === 'TRX' || tx.type === 'NATIVE') {
        const usdValue = amount * price;
        if (isIn) { totalInflow += usdValue; trxInflow += amount; }
        else if (isOut) { totalOutflow += usdValue; trxOutflow += amount; }
      } else if (tx.symbol === 'USDT') {
        if (isIn) { totalInflow += amount; usdtInflow += amount; }
        else if (isOut) { totalOutflow += amount; usdtOutflow += amount; }
      }
    });

    return { txCount, totalInflow, totalOutflow, netFlow: totalInflow - totalOutflow, trxInflow, trxOutflow, usdtInflow, usdtOutflow };
  }, [filteredTxs, currentAddress, walletInfo]);

  const handleExportCSV = () => {
    const rows = [
      ['税务报表 - ' + label],
      ['钱包地址', currentAddress],
      ['生成时间', new Date().toLocaleString('zh-CN')],
      [''],
      ['时间区间', `${start.toLocaleDateString('zh-CN')} ~ ${end.toLocaleDateString('zh-CN')}`],
      [''],
      ['=== 交易统计 ==='],
      ['交易总数', reportData.txCount],
      [''],
      ['=== 资产流动 ==='],
      ['TRX 转入', reportData.trxInflow.toFixed(6)],
      ['TRX 转出', reportData.trxOutflow.toFixed(6)],
      ['USDT 转入', reportData.usdtInflow.toFixed(2)],
      ['USDT 转出', reportData.usdtOutflow.toFixed(2)],
      [''],
      ['=== 估值统计 (USD) ==='],
      ['总转入', reportData.totalInflow.toFixed(2)],
      ['总转出', reportData.totalOutflow.toFixed(2)],
      ['净流动', reportData.netFlow.toFixed(2)],
      [''],
      ['=== 交易明细 ==='],
      ['时间', '类型', '方向', '代币', '金额', '交易哈希'],
    ];

    filteredTxs.forEach(tx => {
      const isOut = tx.from?.toLowerCase() === currentAddress.toLowerCase();
      const isIn = tx.to && tx.to.toLowerCase() === currentAddress.toLowerCase();
      rows.push([formatDate(tx.timestamp), tx.type === 'NATIVE' ? '主网币' : '代币', isIn ? '转入' : '转出', tx.symbol, tx.amount, tx.hash]);
    });

    const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tax_report_${label.replace(/\s/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[90] p-4">
      <div className="bg-white dark:bg-[#1A1726] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2"><Calculator className="w-5 h-5 text-[#AB9FF2]" />税务报表</h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 border-b border-slate-200 dark:border-white/10 space-y-4">
          <div className="flex gap-2">
            {[{ id: 'month', label: '月报' }, { id: 'quarter', label: '季报' }, { id: 'year', label: '年报' }].map(t => (
              <button key={t.id} onClick={() => setReportType(t.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${reportType === t.id ? 'bg-[#AB9FF2] text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
              className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 text-sm">
              {years.map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
            {reportType === 'month' && (
              <select value={selectedMonth} onChange={e => setSelectedMonth(parseInt(e.target.value))}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 text-sm">
                {months.map(m => <option key={m} value={m}>{m}月</option>)}
              </select>
            )}
            {reportType === 'quarter' && (
              <select value={selectedQuarter} onChange={e => setSelectedQuarter(parseInt(e.target.value))}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 text-sm">
                {quarters.map(q => <option key={q} value={q}>Q{q}</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-4 text-white">
              <div className="text-white/70 text-xs mb-1">总转入 (USD)</div>
              <div className="text-xl font-bold">${reportData.totalInflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="bg-gradient-to-br from-rose-500 to-rose-600 rounded-xl p-4 text-white">
              <div className="text-white/70 text-xs mb-1">总转出 (USD)</div>
              <div className="text-xl font-bold">${reportData.totalOutflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-[#6E5FE0] to-[#4B3FC0] rounded-xl p-4 text-white">
            <div className="text-white/70 text-xs mb-1">净流动 (USD)</div>
            <div className="text-2xl font-bold">${reportData.netFlow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4 space-y-3">
            <h4 className="font-semibold text-sm">详细统计</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-slate-400 text-xs">交易总数</div><div className="font-semibold">{reportData.txCount}</div></div>
              <div><div className="text-slate-400 text-xs">TRX 转入</div><div className="font-semibold">{reportData.trxInflow.toFixed(2)}</div></div>
              <div><div className="text-slate-400 text-xs">TRX 转出</div><div className="font-semibold">{reportData.trxOutflow.toFixed(2)}</div></div>
              <div><div className="text-slate-400 text-xs">USDT 转入</div><div className="font-semibold">{reportData.usdtInflow.toFixed(2)}</div></div>
              <div><div className="text-slate-400 text-xs">USDT 转出</div><div className="font-semibold">{reportData.usdtOutflow.toFixed(2)}</div></div>
            </div>
          </div>
          <div className="text-center text-xs text-slate-400">时间区间: {start.toLocaleDateString('zh-CN')} ~ {end.toLocaleDateString('zh-CN')}</div>
        </div>
        <div className="p-5 border-t border-slate-200 dark:border-white/10 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 dark:bg-white/10 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-white/20">关闭</button>
          <button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium shadow-lg shadow-emerald-500/25">
            <Download className="w-4 h-4" /> 导出CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function AllocationChart({ data, mobile }) {
  if (!data || data.length === 0) return <p className="text-xs text-slate-400 py-8 text-center">暂无资产数据</p>;
  if (mobile) {
    const size = 120, stroke = 16, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let offset = 0;
    return (
      <div className="flex items-center gap-5">
        <svg width={size} height={size} className="flex-shrink-0">
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" className="text-slate-100 dark:text-white/5" strokeWidth={stroke} />
          {data.map((d, i) => {
            const len = (d.pct / 100) * c;
            const el = <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={d.color}
              strokeWidth={stroke} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${size/2} ${size/2})`} strokeLinecap="round" />;
            offset += len; return el;
          })}
          <text x="50%" y="46%" textAnchor="middle" className="fill-slate-400 text-[10px]">币种</text>
          <text x="50%" y="60%" textAnchor="middle" className="fill-current font-bold text-lg">{data.length}</text>
        </svg>
        <div className="flex-1 space-y-2">
          {data.map((d, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />{d.label}</span>
              <span className="font-semibold">{d.pct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />{d.label}</span>
            <span className="font-semibold">{d.pct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: d.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SingleTxCard({ tx }) {
  return (
    <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5 text-[#AB9FF2]" />
        <h3 className="font-bold">交易详情</h3>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-md font-bold ${tx.chain === 'ETH' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>{tx.chain}</span>
      </div>
      <div className="space-y-3 text-sm">
        <Row label="交易哈希" value={shortenHash(tx.hash)} mono onCopy={() => copyToClipboard(tx.hash)} />
        <Row label="发送方" value={shortenAddress(tx.from)} mono onCopy={() => copyToClipboard(tx.from)} />
        <Row label="接收方" value={shortenAddress(tx.to)} mono onCopy={() => copyToClipboard(tx.to)} />
        <Row label="金额" value={`${tx.amount} ${tx.symbol}`} />
        <Row label="区块" value={tx.block} />
      </div>
      <a href={tx.explorerUrl} target="_blank" rel="noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 text-sm text-[#7C6FE8] dark:text-[#AB9FF2] font-medium">
        在区块浏览器查看 <ExternalLink className="w-4 h-4" />
      </a>
    </div>
  );
}

function Row({ label, value, mono, onCopy }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-50 dark:border-white/5 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="flex items-center gap-2">
        <span className={mono ? 'font-mono' : 'font-semibold'}>{value}</span>
        {onCopy && <button onClick={onCopy} className="text-slate-400 hover:text-[#AB9FF2]"><Copy className="w-3.5 h-3.5" /></button>}
      </span>
    </div>
  );
}

function TxRow({ tx, currentAddress, remarkMap, onAddressClick, chain }) {
  const isOut = tx.from?.toLowerCase() === currentAddress.toLowerCase();
  const isIn = tx.to && tx.to.toLowerCase() === currentAddress.toLowerCase();
  const dir = isOut ? 'OUT' : isIn ? 'IN' : 'OTHER';
  const postBal = tx.postBalance;

  return (
    <div className="p-4 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
        dir === 'IN' ? 'bg-emerald-100 dark:bg-emerald-500/15' : dir === 'OUT' ? 'bg-rose-100 dark:bg-rose-500/15' : 'bg-slate-100 dark:bg-white/5'
      }`}>
        {dir === 'IN' ? <ArrowDownRight className="w-5 h-5 text-emerald-500" /> : dir === 'OUT' ? <ArrowUpRight className="w-5 h-5 text-rose-500" /> : <FileText className="w-5 h-5 text-slate-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-semibold text-sm">{dir === 'IN' ? '接收' : dir === 'OUT' ? '发送' : '交互'} {tx.symbol}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${tx.type === 'TOKEN' ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-600' : 'bg-[#AB9FF2]/15 text-[#7C6FE8] dark:text-[#AB9FF2]'}`}>{tx.type}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${tx.status === '成功' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono flex-wrap">
          <AddrChip addr={tx.from} currentAddress={currentAddress} remarkMap={remarkMap} onClick={onAddressClick} />
          <span>→</span>
          <AddrChip addr={tx.to} currentAddress={currentAddress} remarkMap={remarkMap} onClick={onAddressClick} />
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`font-bold text-sm ${dir === 'IN' ? 'text-emerald-500' : dir === 'OUT' ? 'text-rose-500' : ''}`}>
          {dir === 'IN' ? '+' : dir === 'OUT' ? '-' : ''}{tx.amount}
        </div>
        <div className="text-[11px] text-slate-400 flex items-center gap-1 justify-end mt-0.5">
          <Clock className="w-3 h-3" />{formatTime(tx.timestamp)}
        </div>
        <div className="flex gap-1.5 justify-end mt-1">
          <button onClick={() => copyToClipboard(tx.hash)} className="text-slate-300 dark:text-slate-500 hover:text-[#AB9FF2]" title="复制哈希"><Copy className="w-3.5 h-3.5" /></button>
          <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="text-slate-300 dark:text-slate-500 hover:text-[#AB9FF2]" title="浏览器查看"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
      </div>
      {postBal && (
        <div className="flex-shrink-0 bg-slate-50 dark:bg-white/5 rounded-lg p-2 text-xs min-w-[100px]">
          <div className="text-slate-400 mb-1">变动后余额</div>
          <div className="space-y-0.5">
            {chain === 'TRX' && (
              <>
                <div className="flex justify-between gap-2"><span className="text-slate-500">TRX:</span><span className="font-medium">{postBal.native.toFixed(2)}</span></div>
                <div className="flex justify-between gap-2"><span className="text-slate-500">USDT:</span><span className="font-medium">{postBal.usdt.toFixed(2)}</span></div>
              </>
            )}
            {chain === 'ETH' && (
              <div className="flex justify-between gap-2"><span className="text-slate-500">ETH:</span><span className="font-medium">{postBal.native.toFixed(4)}</span></div>
            )}
            <div className="flex justify-between gap-2 pt-1 border-t border-slate-200 dark:border-white/10">
              <span className="text-slate-500">USD:</span>
              <span className="font-medium text-[#AB9FF2]">${postBal.totalUsd.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddrChip({ addr, currentAddress, remarkMap, onClick }) {
  if (!addr) return <span>-</span>;
  const isMe = addr.toLowerCase() === currentAddress.toLowerCase();
  const remark = remarkMap[addr.toLowerCase()];
  if (isMe) return <span className="text-slate-500 dark:text-slate-300 font-semibold">ME</span>;
  return (
    <span onClick={(e) => { e.stopPropagation(); onClick(addr); }}
      className="text-[#7C6FE8] dark:text-[#AB9FF2] hover:underline cursor-pointer" title={addr}>
      {remark ? <span className="text-amber-600">{remark}</span> : shortenAddress(addr)}
    </span>
  );
}

function ListSkeleton() {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="p-4 flex items-center gap-4 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/5" />
          <div className="flex-1 space-y-2"><div className="h-3 bg-slate-100 dark:bg-white/5 rounded w-32" /><div className="h-3 bg-slate-100 dark:bg-white/5 rounded w-48" /></div>
          <div className="h-4 bg-slate-100 dark:bg-white/5 rounded w-16" />
        </div>
      ))}
    </>
  );
}

function HistoryCard({ item, onSelect, onUpdateRemark, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.remark || '');
  const save = (e) => { e.stopPropagation(); onUpdateRemark(item.address, val); setEditing(false); };
  return (
    <div onClick={onSelect}
      className="group bg-slate-50 dark:bg-white/5 hover:bg-[#AB9FF2]/10 border border-transparent hover:border-[#AB9FF2]/30 rounded-xl p-3 cursor-pointer transition-all relative">
      <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={(e) => { e.stopPropagation(); setEditing(true); setVal(item.remark || ''); }}
          className="p-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition-colors shadow-md" title="编辑备注">
          <Edit2 className="w-4 h-4" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); if(confirm('确定删除这条记录?')) onRemove(item.address); }}
          className="p-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white transition-colors shadow-md" title="删除记录">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 mb-2 pr-16">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${item.chain === 'ETH' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>{item.chain}</span>
        <span className="font-mono text-xs font-medium truncate">{item.ens || shortenAddress(item.address)}</span>
      </div>
      <div onClick={e => e.stopPropagation()}>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && save(e)}
              placeholder="输入备注/标签" className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-white dark:bg-white/10 border border-[#AB9FF2]/40 focus:outline-none" />
            <button onClick={save} className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"><Check className="w-4 h-4" /></button>
          </div>
        ) : (
          <span className={`text-xs truncate ${item.remark ? 'text-slate-600 dark:text-slate-300 font-medium' : 'text-slate-400'}`}>
            {item.remark || '点击添加备注'}
          </span>
        )}
      </div>
    </div>
  );
}

function MobileHistoryList({ history, onJump, onUpdateRemark, onRemove }) {
  const [q, setQ] = useState('');
  const filtered = history.filter(i =>
    i.address.toLowerCase().includes(q.toLowerCase()) ||
    (i.remark || '').toLowerCase().includes(q.toLowerCase()) ||
    (i.ens || '').toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div className="space-y-3">
      <h2 className="font-bold text-lg">查询记录</h2>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索钱包地址、备注或标签..."
          className="w-full pl-10 pr-3 py-3 rounded-xl bg-slate-100 dark:bg-white/5 text-sm focus:outline-none" />
      </div>
      <div className="space-y-2">
        {filtered.length === 0 ? <p className="text-center text-slate-400 text-sm py-10">暂无历史</p>
          : filtered.map(item => (
            <HistoryCard key={item.address} item={item} onSelect={() => onJump(item.address)}
              onUpdateRemark={onUpdateRemark} onRemove={onRemove} />
          ))}
      </div>
    </div>
  );
}

function SettingsPanel({ user, onLogout, theme, setTheme, ethApiKey, setEthApiKey, trxApiKey, setTrxApiKey, onSaveKey, showKey, setShowKey }) {
  const [saved, setSaved] = useState(false);
  const handleSave = () => { onSaveKey(ethApiKey, trxApiKey); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const themes = [
    { id: 'light', label: '浅色', icon: Sun },
    { id: 'dark', label: '深色', icon: Moon },
    { id: 'system', label: '跟随系统', icon: Monitor },
  ];
  const [networks, setNetworks] = useState({ ETH: true, TRX: true });
  const toggleNetwork = (id) => setNetworks(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h2 className="font-bold text-2xl">设置</h2>
        <p className="text-sm text-slate-400">管理您的账户偏好、外观和连接配置。</p>
      </div>
      <Section title="账户" icon={Wallet}>
        {user && !user.isAnonymous ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {user.photoURL ? <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full" />
                : <div className="w-10 h-10 bg-[#AB9FF2] rounded-full flex items-center justify-center text-white font-bold">{(user.email || 'U').charAt(0).toUpperCase()}</div>}
              <div>
                <div className="font-semibold text-sm">{user.displayName || user.email}</div>
                <div className="text-xs text-emerald-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />已连接 Google 账户</div>
              </div>
            </div>
            <button onClick={onLogout} className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 dark:border-white/10 rounded-full text-sm font-medium hover:border-rose-300 hover:text-rose-500 transition-colors">
              <LogOut className="w-4 h-4" /> 退出登录
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">当前未登录,登录后可云端同步查询历史。</p>
        )}
      </Section>
      <Section title="外观" icon={Sun}>
        <div className="grid grid-cols-3 gap-3">
          {themes.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTheme(id)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                theme === id ? 'border-[#AB9FF2] bg-[#AB9FF2]/10' : 'border-slate-200 dark:border-white/10'
              }`}>
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="API 配置" icon={Settings}>
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1">Etherscan API Key</label>
            <p className="text-xs text-slate-400 mb-2">用于加速以太坊网络数据获取(选填,留空用公共节点)。</p>
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} value={ethApiKey} onChange={e => setEthApiKey(e.target.value)}
                placeholder="留空则使用公共节点"
                className="w-full pl-3 pr-10 py-3 rounded-xl bg-slate-100 dark:bg-white/5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AB9FF2]/40" />
              <button onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">TronScan API Key</label>
            <p className="text-xs text-slate-400 mb-2">用于提高波场接口限额,避免频繁查询被限流(选填,留空用公共接口)。</p>
            <input type={showKey ? 'text' : 'password'} value={trxApiKey} onChange={e => setTrxApiKey(e.target.value)}
              placeholder="留空则使用公共接口"
              className="w-full px-3 py-3 rounded-xl bg-slate-100 dark:bg-white/5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AB9FF2]/40" />
          </div>
          <button onClick={handleSave}
            className="px-5 py-2.5 bg-gradient-to-r from-[#AB9FF2] to-[#5C4FE0] text-white text-sm font-semibold rounded-xl shadow-lg shadow-[#AB9FF2]/25 flex items-center gap-2">
            {saved ? <><Check className="w-4 h-4" /> 已保存</> : '保存配置'}
          </button>
        </div>
      </Section>
      <Section title="网络" icon={Network}>
        {[
          { id: 'ETH', name: 'Ethereum 主网', desc: '启用 ERC-20 代币及交易追踪' },
          { id: 'TRX', name: 'Tron 主网', desc: '启用 TRC-20 代币及交易追踪' },
        ].map(n => (
          <div key={n.id} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${n.id === 'ETH' ? 'bg-blue-500' : 'bg-red-500'}`}>{n.id}</span>
              <div>
                <div className="font-semibold text-sm">{n.name}</div>
                <div className="text-xs text-slate-400">{n.desc}</div>
              </div>
            </div>
            <button onClick={() => toggleNetwork(n.id)}
              className={`w-12 h-7 rounded-full transition-colors relative flex-shrink-0 ${networks[n.id] ? 'bg-[#AB9FF2]' : 'bg-slate-300 dark:bg-white/10'}`}>
              <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${networks[n.id] ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        ))}
        <p className="text-[11px] text-slate-400 mt-2">更多链(BSC、Polygon 等)将在后续版本支持。</p>
      </Section>
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 p-5">
      <h3 className="font-bold text-sm mb-4 flex items-center gap-2"><Icon className="w-4 h-4 text-[#AB9FF2]" />{title}</h3>
      {children}
    </div>
  );
}

function QrScannerModal({ onClose, onScan, setError }) {
  const fileRef = useRef(null);
  useEffect(() => {
    if (!window.Html5Qrcode) return;
    const qr = new window.Html5Qrcode('qr-reader');
    qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } },
      (decoded) => { qr.stop().then(() => onScan(decoded)).catch(() => onScan(decoded)); },
      () => {}
    ).catch(err => { console.error('启动摄像头失败', err); alert('无法访问摄像头'); onClose(); });
    return () => { if (qr.isScanning) qr.stop().catch(() => {}); };
  }, [onClose, onScan]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !window.Html5Qrcode) return;
    const qr = new window.Html5Qrcode('qr-file-reader');
    try {
      const decoded = await qr.scanFile(file, true);
      onScan(decoded);
    } catch (err) {
      console.error('图片识别失败', err);
      if (setError) setError('未能从图片中识别出二维码');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-[90] p-4">
      <div className="absolute top-6 left-6"><button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white"><ChevronLeft className="w-6 h-6" /></button></div>
      <h3 className="absolute top-7 left-1/2 -translate-x-1/2 text-white text-lg font-bold">扫描钱包二维码</h3>
      <div className="w-full max-w-sm flex flex-col items-center">
        <div className="px-4 py-2 bg-white/10 rounded-full text-white/80 text-sm mb-6">将二维码放入框内,即可自动扫描</div>
        <div className="relative w-full aspect-square bg-[#0D0B14] rounded-2xl overflow-hidden border-2 border-[#AB9FF2]/50 shadow-[0_0_30px_rgba(171,159,242,0.3)]">
          <div id="qr-reader" className="w-full h-full" />
          <div id="qr-file-reader" className="hidden" />
          <div className="absolute left-0 w-full h-0.5 bg-[#AB9FF2] shadow-[0_0_12px_#AB9FF2] animate-[scan_2.5s_ease-in-out_infinite]" />
        </div>
        <button onClick={() => fileRef.current?.click()}
          className="mt-6 flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full text-sm font-medium transition-colors">
          <ImageIcon className="w-4 h-4" /> 从相册导入
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
}

function GoogleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
