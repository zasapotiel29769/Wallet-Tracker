/**
 * CryptoInsight - Web3 交易查询工具 (增强版)
 * 新增功能：
 * 1. 交易后余额显示（TRX/USDT/USD）
 * 2. iOS左滑操作（历史+查询界面）
 * 3. 税务报表（按月/季度/年）
 */
import React from 'react';
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signInWithCredential, 
         signInAnonymously, signOut, linkWithPopup } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

// ============ Firebase 配置 ============
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

const formatTime = (ts) => {
  if (!ts) return '';
  return new Date(parseInt(ts)).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
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
  if (!value && value !== 0) return '0';
  const num = parseFloat(value) / Math.pow(10, parseInt(decimals || 18));
  if (num === 0) return '0';
  if (num < 0.000001) return '<0.000001';
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
};

const formatCurrency = (value, decimals = 2) => {
  if (!value && value !== 0) return '$0.00';
  return '$' + parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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

// ============ 计算交易后余额 ============
const calculateBalancesAfterTx = (txs, currentNative, currentUsdt, price) => {
  if (!txs || txs.length === 0) return [];
  
  // 按时间正序排列（从早到晚）
  const sortedTxs = [...txs].sort((a, b) => a.timestamp - b.timestamp);
  
  let runningNative = 0;
  let runningUsdt = 0;
  const results = [];
  
  // 从最后一笔交易开始往后推算当前余额
  for (let i = sortedTxs.length - 1; i >= 0; i--) {
    const tx = sortedTxs[i];
    const isOut = tx.from?.toLowerCase() === tx.currentAddress?.toLowerCase();
    const isIn = tx.to && tx.to.toLowerCase() === tx.currentAddress?.toLowerCase();
    
    if (tx.type === 'NATIVE' || !tx.type) {
      // 原生币交易
      const amount = parseFloat(tx.amountRaw || tx.amountRaw === 0 ? tx.amountRaw : tx.amount.replace(/,/g, ''));
      if (isOut) {
        runningNative += amount;
      } else if (isIn) {
        runningNative -= amount;
      }
    } else if (tx.type === 'TOKEN') {
      // 代币交易（主要是USDT）
      const amount = parseFloat(tx.amountRaw || tx.amountRaw === 0 ? tx.amountRaw : tx.amount.replace(/,/g, ''));
      if (tx.symbol === 'USDT' || tx.symbol === 'TRC20-USDT') {
        if (isOut) {
          runningUsdt += amount;
        } else if (isIn) {
          runningUsdt -= amount;
        }
      }
    }
    
    // 记录这笔交易执行后的余额
    results.unshift({
      ...tx,
      afterNative: currentNative - runningNative,
      afterUsdt: currentUsdt - runningUsdt,
      afterUsd: (currentNative - runningNative) * price + (currentUsdt - runningUsdt)
    });
  }
  
  return results;
};

// ============ 税务报表计算 ============
const calculateTaxReport = (txs, startDate, endDate) => {
  const filtered = txs.filter(tx => {
    const ts = tx.timestamp;
    return ts >= startDate && ts <= endDate;
  });

  let totalBuyNative = 0;
  let totalSellNative = 0;
  let totalBuyUsdt = 0;
  let totalSellUsdt = 0;
  let totalTransferIn = 0;
  let totalTransferOut = 0;
  let transactionCount = 0;
  let gasFees = 0;

  const buyTxs = [];
  const sellTxs = [];
  const transferTxs = [];

  filtered.forEach(tx => {
    const amount = parseFloat(tx.amountRaw || tx.amount.replace(/,/g, '')) || 0;
    const isOut = tx.from?.toLowerCase() === tx.currentAddress?.toLowerCase();
    const isIn = tx.to && tx.to.toLowerCase() === tx.currentAddress?.toLowerCase();

    if (tx.type === 'NATIVE' || !tx.type) {
      if (isIn) {
        totalBuyNative += amount;
        buyTxs.push(tx);
      } else if (isOut) {
        totalSellNative += amount;
        sellTxs.push(tx);
      }
      // 估算Gas费（简单处理）
      if (tx.gasFee) gasFees += parseFloat(tx.gasFee);
    } else if (tx.type === 'TOKEN') {
      if (tx.symbol === 'USDT' || tx.symbol === 'TRC20-USDT') {
        if (isIn) {
          totalBuyUsdt += amount;
          buyTxs.push(tx);
        } else if (isOut) {
          totalSellUsdt += amount;
          sellTxs.push(tx);
        }
      } else {
        // 其他代币计入转账
        if (isIn) {
          totalTransferIn += amount;
          transferTxs.push({ ...tx, direction: 'in' });
        } else if (isOut) {
          totalTransferOut += amount;
          transferTxs.push({ ...tx, direction: 'out' });
        }
      }
    } else {
      // 无法判断类型，算作转账
      if (isIn) {
        totalTransferIn += amount;
        transferTxs.push({ ...tx, direction: 'in' });
      } else if (isOut) {
        totalTransferOut += amount;
        transferTxs.push({ ...tx, direction: 'out' });
      }
    }
    transactionCount++;
  });

  // 计算盈亏（简化版：基于买卖差）
  const netNative = totalBuyNative - totalSellNative;
  const netUsdt = totalBuyUsdt - totalSellUsdt;

  return {
    period: { start: startDate, end: endDate },
    summary: {
      transactionCount,
      totalBuyNative,
      totalSellNative,
      netNative,
      totalBuyUsdt,
      totalSellUsdt,
      netUsdt,
      totalTransferIn,
      totalTransferOut,
      gasFees,
      realizedPnL: 0, // 需要价格数据才能计算
    },
    transactions: {
      buy: buyTxs,
      sell: sellTxs,
      transfer: transferTxs
    }
  };
};

// ============ 导出CSV ============
const exportTaxReportCSV = (report, address, chain) => {
  const headers = ['日期时间', '交易哈希', '类型', '方向', '代币', '金额', '状态', 'Gas费', '链接'];
  const rows = [];
  
  [...report.transactions.buy, ...report.transactions.sell, ...report.transactions.transfer]
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach(tx => {
      const isIn = tx.direction === 'in' || tx.to?.toLowerCase() === address.toLowerCase();
      const isOut = tx.direction === 'out' || tx.from?.toLowerCase() === address.toLowerCase();
      
      rows.push([
        new Date(tx.timestamp).toLocaleString('zh-CN'),
        tx.hash,
        tx.type || 'NATIVE',
        isIn ? '转入' : isOut ? '转出' : '未知',
        tx.symbol || 'ETH/TRX',
        tx.amount,
        tx.status || '成功',
        tx.gasFee || '-',
        tx.explorerUrl || ''
      ]);
    });

  const csvContent = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tax_report_${chain}_${address.slice(0, 8)}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ============ 左滑操作组件 ============
function SwipeAction({ children, onEdit, onDelete, editLabel = '编辑', deleteLabel = '删除' }) {
  const [offset, setOffset] = useState(0);
  const [startX, setStartX] = useState(0);
  const [startOffset, setStartOffset] = useState(0);
  const [isSwipeOpen, setIsSwipeOpen] = useState(false);
  const containerRef = useRef(null);

  const handleTouchStart = (e) => {
    setStartX(e.touches[0].clientX);
    setStartOffset(offset);
    setIsSwipeOpen(false);
  };

  const handleTouchMove = (e) => {
    const currentX = e.touches[0].clientX;
    const diff = startX - currentX;
    let newOffset = startOffset - diff;
    
    // 限制滑动范围
    if (diff > 0) {
      newOffset = Math.min(newOffset, 160); // 最大滑动距离（两个按钮）
    } else {
      newOffset = Math.max(newOffset, 0);
    }
    
    setOffset(newOffset);
  };

  const handleTouchEnd = () => {
    if (offset > 80) {
      setOffset(160);
      setIsSwipeOpen(true);
    } else {
      setOffset(0);
      setIsSwipeOpen(false);
    }
  };

  const handleClose = () => {
    setOffset(0);
    setIsSwipeOpen(false);
  };

  const handleEdit = () => {
    if (onEdit) onEdit();
    handleClose();
  };

  const handleDelete = () => {
    if (onDelete) onDelete();
    handleClose();
  };

  // 点击外部关闭
  useEffect(() => {
    if (!isSwipeOpen) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        handleClose();
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isSwipeOpen]);

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {/* 滑动按钮层 */}
      <div className="absolute right-0 top-0 bottom-0 flex items-center">
        <button
          onClick={handleEdit}
          className="h-full w-20 bg-amber-500 text-white flex items-center justify-center text-sm font-medium active:bg-amber-600"
        >
          <div className="flex flex-col items-center">
            <Edit2 className="w-5 h-5 mb-1" />
            <span>{editLabel}</span>
          </div>
        </button>
        <button
          onClick={handleDelete}
          className="h-full w-20 bg-rose-500 text-white flex items-center justify-center text-sm font-medium active:bg-rose-600"
        >
          <div className="flex flex-col items-center">
            <Trash2 className="w-5 h-5 mb-1" />
            <span>{deleteLabel}</span>
          </div>
        </button>
      </div>
      
      {/* 内容层 */}
      <div
        className="relative bg-white dark:bg-[#13111C] transition-transform"
        style={{ transform: `translateX(-${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

// ============ 主应用 ============
export default function App() {
  const currentUidRef = useRef(null); 
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
  const [trxApiKey, setTrxApiKey] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [isMobile, setIsMobile] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');

  const [theme, setTheme] = useState('dark');
  const [activeTab, setActiveTab] = useState('search');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [singleTx, setSingleTx] = useState(null);
  const [showKey, setShowKey] = useState(false);
  
  // 新增：税务报表相关
  const [showTaxReport, setShowTaxReport] = useState(false);
  const [taxReportData, setTaxReportData] = useState(null);
  const [taxPeriodType, setTaxPeriodType] = useState('month'); // month/quarter/year
  const [taxCustomStart, setTaxCustomStart] = useState('');
  const [taxCustomEnd, setTaxCustomEnd] = useState('');
  const [txsWithBalances, setTxsWithBalances] = useState([]);
  
  // 新增：编辑备注弹窗
  const [editingRemark, setEditingRemark] = useState({ address: '', remark: '', ens: '' });
  const [showRemarkModal, setShowRemarkModal] = useState(false);

  // ============ 主题 ============
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

  // ============ Auth ============
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      const prevUid = currentUidRef.current;
      const newUid = currentUser ? currentUser.uid : null;
      if (prevUid !== newUid) {
        setHistory([]);
        setCurrentQuery({ address: '', chain: '' });
        setAllTransactions([]);
        setWalletInfo(null);
        setSingleTx(null);
        setTxsWithBalances([]);
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

  // ============ 历史同步 ============
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

  const migrateHistory = async (newUid, localHistory) => {
    try {
      const newRef = historyRef(newUid);
      const newSnap = await getDoc(newRef);
      const existing = newSnap.exists() ? (newSnap.data().items || []) : [];
      const map = new Map();
      [...existing, ...localHistory].forEach((item) => {
        if (!item || !item.address) return;
        const key = item.address.toLowerCase();
        const prev = map.get(key);
        if (!prev) map.set(key, item);
        else map.set(key, {
          ...prev, ...item,
          remark: item.remark || prev.remark || '',
          lastQueried: Math.max(prev.lastQueried || 0, item.lastQueried || 0),
        });
      });
      const merged = Array.from(map.values()).sort((a, b) => (b.lastQueried || 0) - (a.lastQueried || 0));
      await setDoc(newRef, { items: cleanForFirestore(merged) });
    } catch (e) { console.error('历史迁移失败', e); }
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const current = auth.currentUser;
      if (current && current.isAnonymous) {
        try {
          await linkWithPopup(current, provider);
          return;
        } catch (linkErr) {
          if (linkErr.code === 'auth/credential-already-in-use') {
            const cred = GoogleAuthProvider.credentialFromError(linkErr);
            const pending = history;
            const result = await signInWithCredential(auth, cred);
            await migrateHistory(result.user.uid, pending);
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
  };

  const handleLogout = async () => {
    try {
      setHistory([]);
      setCurrentQuery({ address: '', chain: '' });
      setAllTransactions([]);
      setWalletInfo(null);
      setSingleTx(null);
      setTxsWithBalances([]);
      await signOut(auth);
      await signInAnonymously(auth);
    } catch (e) { console.error('登出失败', e); }
  };

  const safeWriteHistory = (items) => {
    const uid = user?.uid;
    if (!uid || currentUidRef.current !== uid) return;
    setDoc(historyRef(uid), { items: cleanForFirestore(items) }).catch(console.error);
  };

  // ============ 设备检测 ============
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
      throw new Error('请求过于频繁');
    }
    return res;
  };

  // ============ 余额 ============
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

  // ============ ETH 交易 ============
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
        amountRaw: parseFloat(tx.value) / 1e18,
        symbol: 'ETH', type: 'NATIVE', status: tx.isError === '0' ? '成功' : '失败',
        explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
        gasFee: tx.gasUsed ? formatAmount(parseInt(tx.gasUsed) * parseInt(tx.gasPrice), 18) : null,
      })));
    }
    if (tD.status === '1' && Array.isArray(tD.result)) {
      txs = txs.concat(tD.result.map(tx => ({
        hash: tx.hash, timestamp: parseInt(tx.timeStamp) * 1000,
        from: tx.from, to: tx.to, amount: formatAmount(tx.value, tx.tokenDecimal),
        amountRaw: parseFloat(tx.value) / Math.pow(10, tx.tokenDecimal),
        symbol: tx.tokenSymbol || 'ERC20', type: 'TOKEN', status: '成功',
        explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
      })));
    }
    const nc = Array.isArray(nD.result) ? nD.result.length : 0;
    const tc = Array.isArray(tD.result) ? tD.result.length : 0;
    return { txs, hasMore: nc === FETCH_LIMIT || tc === FETCH_LIMIT };
  };

  // ============ TRX 交易 ============
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
        amount: formatAmount(tx.amount, 6), amountRaw: parseFloat(tx.amount) / 1e6,
        symbol: 'TRX', type: 'NATIVE', status: tx.contractRet === 'SUCCESS' ? '成功' : '失败',
        explorerUrl: `https://tronscan.org/#/transaction/${tx.hash}`,
        gasFee: tx.fee ? formatAmount(tx.fee, 6) : null,
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
          amount: formatAmount(tx.quant, dec), amountRaw: parseFloat(tx.quant) / Math.pow(10, dec),
          symbol: sym, type: 'TOKEN',
          status: tx.status === 1 || tx.status === undefined ? '成功' : '失败',
          explorerUrl: `https://tronscan.org/#/transaction/${tx.transaction_id}`,
        };
      }));
    }
    return { txs, hasMore: nc === FETCH_LIMIT || tc === FETCH_LIMIT };
  };

  // ============ 单笔交易查询 ============
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

  // ============ 主查询入口 ============
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
        setCurrentQuery({ address: '', chain: '' }); setAllTransactions([]);
        setTxsWithBalances([]);
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
      setActiveTab('search'); setShowTaxReport(false);
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

      const merged = isLoadMore ? [...allTransactions, ...result.txs] : result.txs;
      const unique = Array.from(new Map(merged.map(i => [i.hash + i.type, i])).values());
      unique.sort((a, b) => b.timestamp - a.timestamp);
      
      // 为每笔交易添加当前地址标记
      const txsWithAddress = unique.map(tx => ({ ...tx, currentAddress: addr.toLowerCase() }));
      
      setAllTransactions(txsWithAddress);
      
      // 计算交易后余额
      if (walletInfo && !isLoadMore) {
        const txsWithBalances = calculateBalancesAfterTx(
          txsWithAddress, 
          walletInfo.native, 
          walletInfo.usdt, 
          walletInfo.price
        );
        setTxsWithBalances(txsWithBalances);
      } else if (isLoadMore && txsWithBalances.length > 0) {
        // 追加加载时重新计算
        const allTxs = [...txsWithAddress];
        const txsWithBalances = calculateBalancesAfterTx(
          allTxs, 
          walletInfo?.native || 0, 
          walletInfo?.usdt || 0, 
          walletInfo?.price || 0
        );
        setTxsWithBalances(txsWithBalances);
      } else {
        setTxsWithBalances(txsWithAddress);
      }
      
      setHasMoreData(result.hasMore);
      setApiPage(targetApiPage);
      setCurrentQuery({ address: addr.toLowerCase(), chain: targetChain, ens: ensName || null });

      if (!isLoadMore) {
        setHistory((prev) => {
          const exist = prev.find(i => i.address.toLowerCase() === addr.toLowerCase());
          let nh;
          if (exist) nh = [{ ...exist, lastQueried: Date.now(), ens: ensName || exist.ens || null }, ...prev.filter(i => i.address.toLowerCase() !== addr.toLowerCase())];
          else nh = [{ address: addr, chain: targetChain, remark: '', ens: ensName || null, lastQueried: Date.now() }, ...prev];
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

  const updateRemark = (addr, rmk, ens = null) => {
    setHistory((h) => {
      const nh = h.map(i => i.address === addr ? { ...i, remark: rmk, ens: ens || i.ens } : i);
      safeWriteHistory(nh);
      return nh;
    });
  };

  const removeHistory = (addr) => {
    setHistory((h) => {
      const nh = h.filter(i => i.address !== addr);
      safeWriteHistory(nh);
      return nh;
    });
  };

  const openEditRemark = (item) => {
    setEditingRemark({ address: item.address, remark: item.remark || '', ens: item.ens || '' });
    setShowRemarkModal(true);
  };

  const saveRemark = () => {
    updateRemark(editingRemark.address, editingRemark.remark, editingRemark.ens);
    setShowRemarkModal(false);
  };

  const filteredTransactions = useMemo(() => {
    return txsWithBalances.filter((tx) => {
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
  }, [txsWithBalances, currentQuery.address, filterType]);

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

  // ============ 税务报表相关 ============
  const getTaxPeriod = () => {
    const now = new Date();
    let start, end;
    
    switch (taxPeriodType) {
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), quarter * 3, 1);
        end = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999);
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        break;
      case 'custom':
        start = taxCustomStart ? new Date(taxCustomStart) : new Date(now.getFullYear(), 0, 1);
        end = taxCustomEnd ? new Date(taxCustomEnd + 'T23:59:59.999Z') : now;
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
    }
    
    return { start: start.getTime(), end: end.getTime() };
  };

  const generateTaxReport = () => {
    const period = getTaxPeriod();
    const report = calculateTaxReport(allTransactions, period.start, period.end);
    setTaxReportData(report);
    setShowTaxReport(true);
  };

  const mainContentProps = {
    chain, setChain, address, setAddress, handleSearch, loading,
    error, singleTx, currentQuery, fetchingBalance, walletInfo, allocation,
    filterType, setFilterType, paginated, remarkMap, jumpToAddress,
    currentPage, setCurrentPage, totalPages, filteredTransactions,
    hasMoreData, loadingMore, isMobile, setShowScanner,
    // 新增
    openEditRemark, showTaxReport, setShowTaxReport, taxReportData, taxPeriodType, 
    setTaxPeriodType, taxCustomStart, setTaxCustomStart, taxCustomEnd, setTaxCustomEnd,
    generateTaxReport, txsWithBalances, walletInfo,
  };

  const settingsProps = {
    user, onLogout: handleLogout, theme, setTheme,
    ethApiKey, setEthApiKey, trxApiKey, setTrxApiKey,
    onSaveKey: saveApiKey, showKey, setShowKey,
  };

  // ============ 渲染 ============
  return (
    <div className="min-h-screen bg-[#F7F7FB] dark:bg-[#0B0E14] text-slate-800 dark:text-slate-100 transition-colors"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <GlobalStyles />

      {/* ===== 桌面布局 ===== */}
      <div className="hidden lg:flex h-screen overflow-hidden">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)}
          activeTab={activeTab} setActiveTab={setActiveTab} history={sortedHistory}
          onJump={jumpToAddress} onUpdateRemark={openEditRemark} onRemove={removeHistory} />

        <div className="flex-1 flex flex-col overflow-hidden">
          <TopBar user={user} onLogin={handleGoogleLogin} onLogout={handleLogout}
            theme={theme} setTheme={setTheme} onOpenSettings={() => setActiveTab('settings')} />
          <div key={activeTab} className="flex-1 overflow-y-auto px-8 py-6 page-enter">
            {activeTab === 'settings'
              ? <SettingsPanel {...settingsProps} />
              : <MainContent {...mainContentProps} isMobileLayout={false} />}
          </div>
        </div>
      </div>

      {/* ===== 移动布局 ===== */}
      <div className="lg:hidden flex flex-col min-h-screen pb-20">
        <MobileHeader user={user} onLogin={handleGoogleLogin}
          theme={theme} setTheme={setTheme} onAvatar={() => setActiveTab('settings')} />
        <div key={activeTab} className="flex-1 px-4 py-4 page-enter">
          {activeTab === 'settings'
            ? <SettingsPanel {...settingsProps} />
            : activeTab === 'history'
            ? <MobileHistoryList history={sortedHistory} onJump={jumpToAddress}
                onUpdateRemark={openEditRemark} onRemove={removeHistory} />
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
      
      {/* 备注编辑弹窗 */}
      {showRemarkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-[#13111C] rounded-2xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-4">编辑备注</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">地址</label>
                <div className="font-mono text-sm text-slate-500">{shortenAddress(editingRemark.address)}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">备注名称</label>
                <input
                  type="text"
                  value={editingRemark.remark}
                  onChange={(e) => setEditingRemark(prev => ({ ...prev, remark: e.target.value }))}
                  placeholder="输入备注名称，如：我的钱包、项目方地址"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AB9FF2]/40"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">ENS 域名</label>
                <input
                  type="text"
                  value={editingRemark.ens}
                  onChange={(e) => setEditingRemark(prev => ({ ...prev, ens: e.target.value }))}
                  placeholder="可选，绑定ENS域名"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AB9FF2]/40"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowRemarkModal(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-white/10 rounded-xl text-sm font-medium">
                取消
              </button>
              <button onClick={saveRemark}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#AB9FF2] to-[#5C4FE0] text-white rounded-xl text-sm font-semibold">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 全局样式 ============
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
      /* 左滑样式 */
      .swipe-content { touch-action: pan-y; }
    `}</style>
  );
}

// ============ 桌面侧栏 ============
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
              <SwipeAction
                key={item.address}
                onEdit={() => onUpdateRemark(item)}
                onDelete={() => onRemove(item.address)}
                editLabel="编辑"
                deleteLabel="删除"
              >
                <HistoryCardContent 
                  item={item} 
                  onSelect={() => onJump(item.address)}
                  onEdit={() => onUpdateRemark(item)}
                />
              </SwipeAction>
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

// ============ 历史卡片内容（无编辑删除按钮）============
function HistoryCardContent({ item, onSelect, onEdit }) {
  return (
    <div onClick={onSelect}
      className="bg-slate-50 dark:bg-white/5 hover:bg-[#AB9FF2]/10 border border-transparent hover:border-[#AB9FF2]/30 rounded-xl p-3 cursor-pointer transition-all">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${item.chain === 'ETH' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>{item.chain}</span>
        <span className="font-mono text-xs font-medium truncate">{item.ens || shortenAddress(item.address)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs truncate ${item.remark ? 'text-slate-600 dark:text-slate-300 font-medium' : 'text-slate-400'}`}>
          {item.remark || '点击查看'}
        </span>
        {item.remark && (
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1 rounded text-slate-400 hover:text-[#AB9FF2] flex-shrink-0">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ============ 桌面顶栏 ============
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

// ============ 移动端顶栏 ============
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

// ============ 主题切换按钮 ============
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

// ============ 移动端底部 Tab ============
function MobileTabBar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'search', label: '查询', icon: Search },
    { id: 'history', label: '历史', icon: History },
    { id: 'settings', label: '设置', icon: Settings },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-[#13111C]/90 backdrop-blur-xl border-t border-slate-200 dark:border-white/5"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
              activeTab === id ? 'text-[#7C6FE8] dark:text-[#AB9FF2]' : 'text-slate-400'
            }`}>
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ============ 主内容 ============
function MainContent(props) {
  const {
    chain, setChain, address, setAddress, handleSearch, loading, error, singleTx,
    currentQuery, fetchingBalance, walletInfo, allocation, filterType, setFilterType,
    paginated, remarkMap, jumpToAddress, currentPage, setCurrentPage, totalPages,
    filteredTransactions, hasMoreData, loadingMore, isMobile, setShowScanner, isMobileLayout,
    openEditRemark, showTaxReport, setShowTaxReport, taxReportData, taxPeriodType,
    setTaxPeriodType, taxCustomStart, setTaxCustomStart, taxCustomEnd, setTaxCustomEnd,
    generateTaxReport, txsWithBalances,
  } = props;

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

      {/* 顶部操作栏：编辑备注、删除、历史按钮 */}
      {currentQuery.address && !error && !singleTx && (
        <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${currentQuery.chain === 'ETH' ? 'bg-blue-500' : 'bg-red-500'}`} />
            {currentQuery.ens ? <span className="font-semibold text-[#AB9FF2]">{currentQuery.ens}</span> : null}
            <span className="font-mono text-slate-500">{shortenAddress(currentQuery.address)}</span>
            {remarkMap[currentQuery.address] && (
              <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded text-xs font-medium">
                {remarkMap[currentQuery.address]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openEditRemark({ address: currentQuery.address, remark: remarkMap[currentQuery.address] || '', ens: currentQuery.ens })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-[#AB9FF2] hover:bg-[#AB9FF2]/10 rounded-lg transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              编辑备注
            </button>
            <button
              onClick={() => generateTaxReport()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              税务报表
            </button>
          </div>
        </div>
      )}

      {/* 税务报表弹窗 */}
      {showTaxReport && taxReportData && (
        <TaxReportModal
          report={taxReportData}
          address={currentQuery.address}
          chain={currentQuery.chain}
          periodType={taxPeriodType}
          setPeriodType={setTaxPeriodType}
          customStart={taxCustomStart}
          setCustomStart={setTaxCustomStart}
          customEnd={taxCustomEnd}
          setCustomEnd={setTaxCustomEnd}
          onClose={() => setShowTaxReport(false)}
          onGenerate={generateTaxReport}
          price={walletInfo?.price || 0}
        />
      )}

      {currentQuery.address && !error && !singleTx && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-gradient-to-br from-[#6E5FE0] to-[#4B3FC0] rounded-2xl p-6 text-white relative overflow-hidden">
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
          </div>
          <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 p-5">
            <h3 className="font-bold text-sm mb-3">资产分布</h3>
            {fetchingBalance ? <div className="h-32 bg-slate-100 dark:bg-white/5 animate-pulse rounded-xl" />
              : <AllocationChart data={allocation} mobile={isMobileLayout} />}
          </div>
        </div>
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
            <div className="text-xs text-slate-400">
              共 {filteredTransactions.length} 条记录
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {loading ? <ListSkeleton />
              : paginated.length === 0 ? <div className="py-16 text-center text-slate-400 text-sm">该分类下未找到交易记录</div>
              : paginated.map((tx, i) => (
                <TxRow key={`${tx.hash}-${i}`} tx={tx} currentAddress={currentQuery.address}
                  remarkMap={remarkMap} onAddressClick={jumpToAddress} walletInfo={walletInfo} />
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

// ============ 税务报表弹窗 ============
function TaxReportModal({ report, address, chain, periodType, setPeriodType, customStart, setCustomStart, customEnd, setCustomEnd, onClose, onGenerate, price }) {
  const { summary, transactions } = report;
  
  return (
    <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden">
      <div className="p-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
        <h3 className="font-bold flex items-center gap-2">
          <FileText className="w-5 h-5 text-emerald-500" />
          税务报表
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportTaxReportCSV(report, address, chain)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            导出CSV
          </button>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      <div className="p-4 space-y-4">
        {/* 时间区间选择 */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'month', label: '本月' },
            { id: 'quarter', label: '本季度' },
            { id: 'year', label: '本年' },
            { id: 'custom', label: '自定义' },
          ].map(p => (
            <button
              key={p.id}
              onClick={() => setPeriodType(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                periodType === p.id 
                  ? 'bg-emerald-500 text-white' 
                  : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        
        {periodType === 'custom' && (
          <div className="flex gap-3 items-center">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 text-sm"
            />
            <span className="text-slate-400">至</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 text-sm"
            />
            <button
              onClick={onGenerate}
              className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600"
            >
              生成
            </button>
          </div>
        )}
        
        {/* 汇总数据 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3">
            <div className="text-xs text-slate-400 mb-1">交易笔数</div>
            <div className="text-lg font-bold">{summary.transactionCount}</div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-3">
            <div className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">买入（{chain}）</div>
            <div className="text-lg font-bold text-emerald-600">{summary.totalBuyNative.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
          </div>
          <div className="bg-rose-50 dark:bg-rose-500/10 rounded-xl p-3">
            <div className="text-xs text-rose-600 dark:text-rose-400 mb-1">卖出（{chain}）</div>
            <div className="text-lg font-bold text-rose-600">{summary.totalSellNative.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
          </div>
          <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-3">
            <div className="text-xs text-amber-600 dark:text-amber-400 mb-1">净差额</div>
            <div className={`text-lg font-bold ${summary.netNative >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {summary.netNative >= 0 ? '+' : ''}{summary.netNative.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl p-3">
            <div className="text-xs text-blue-600 dark:text-blue-400 mb-1">买入USDT</div>
            <div className="text-lg font-bold text-blue-600">{summary.totalBuyUsdt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-purple-50 dark:bg-purple-500/10 rounded-xl p-3">
            <div className="text-xs text-purple-600 dark:text-purple-400 mb-1">卖出USDT</div>
            <div className="text-lg font-bold text-purple-600">{summary.totalSellUsdt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-cyan-50 dark:bg-cyan-500/10 rounded-xl p-3">
            <div className="text-xs text-cyan-600 dark:text-cyan-400 mb-1">转入代币</div>
            <div className="text-lg font-bold text-cyan-600">{summary.totalTransferIn.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
          </div>
          <div className="bg-orange-50 dark:bg-orange-500/10 rounded-xl p-3">
            <div className="text-xs text-orange-600 dark:text-orange-400 mb-1">转出代币</div>
            <div className="text-lg font-bold text-orange-600">{summary.totalTransferOut.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
          </div>
        </div>
        
        {/* 估算Gas费 */}
        {summary.gasFees > 0 && (
          <div className="bg-slate-100 dark:bg-white/5 rounded-xl p-3 flex items-center justify-between">
            <span className="text-sm text-slate-500">估算Gas费（{chain}）</span>
            <span className="font-semibold">{summary.gasFees.toLocaleString(undefined, { maximumFractionDigits: 6 })} {chain}</span>
          </div>
        )}
        
        {/* 时间范围 */}
        <div className="text-xs text-slate-400 text-center">
          统计周期：{new Date(summary.period.start).toLocaleDateString('zh-CN')} ~ {new Date(summary.period.end).toLocaleDateString('zh-CN')}
        </div>
      </div>
    </div>
  );
}

// ============ 资产分布图 ============
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

// ============ 单笔交易详情卡 ============
function SingleTxCard({ tx }) {
  return (
    <div className="bg-white dark:bg-[#13111C] rounded-2xl border border-slate-200 dark:border-white/5 p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5 text-[#AB9FF2]" />
        <h3 className="font-bold">交易详情</h3>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-md font-bold ${tx.chain === 'ETH' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>{tx.chain}</span>
      </div>
      <div className="space-y-3 text-sm">
        <Row label="交易哈希" value={shortenAddress(tx.hash)} mono onCopy={() => copyToClipboard(tx.hash)} />
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

// ============ 交易行（新增交易后余额）============
function TxRow({ tx, currentAddress, remarkMap, onAddressClick, walletInfo }) {
  const isOut = tx.from?.toLowerCase() === currentAddress?.toLowerCase();
  const isIn = tx.to && tx.to.toLowerCase() === currentAddress?.toLowerCase();
  const dir = isOut ? 'OUT' : isIn ? 'IN' : 'OTHER';
  
  // 交易后余额显示
  const showAfterBalance = tx.afterNative !== undefined || tx.afterUsdt !== undefined;
  const afterNative = tx.afterNative ?? 0;
  const afterUsdt = tx.afterUsdt ?? 0;
  const afterUsd = tx.afterUsd ?? 0;
  
  return (
    <div className="p-4 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
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
        {/* 交易后余额 */}
        {showAfterBalance && (
          <div className="text-[10px] text-slate-400 mt-1 flex flex-col items-end gap-0.5">
            {tx.type === 'TOKEN' || !tx.type ? (
              <span>{tx.symbol}: {afterNative.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
            ) : null}
            {(tx.symbol === 'USDT' || tx.type === 'TOKEN') && afterUsdt > 0 && (
              <span>USDT: {afterUsdt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            )}
            {afterUsd > 0 && (
              <span className="text-emerald-500 font-medium">≈{formatCurrency(afterUsd)}</span>
            )}
          </div>
        )}
        <div className="flex gap-1.5 justify-end mt-1">
          <button onClick={() => copyToClipboard(tx.hash)} className="text-slate-300 dark:text-slate-500 hover:text-[#AB9FF2]"><Copy className="w-3.5 h-3.5" /></button>
          <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="text-slate-300 dark:text-slate-500 hover:text-[#AB9FF2]"><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
      </div>
    </div>
  );
}

function AddrChip({ addr, currentAddress, remarkMap, onClick }) {
  if (!addr) return <span>-</span>;
  const isMe = addr.toLowerCase() === currentAddress?.toLowerCase();
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

// ============ 移动端历史列表 ============
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
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索钱包地址、备注..."
          className="w-full pl-10 pr-3 py-3 rounded-xl bg-slate-100 dark:bg-white/5 text-sm focus:outline-none" />
      </div>
      <div className="space-y-2">
        {filtered.length === 0 ? <p className="text-center text-slate-400 text-sm py-10">暂无历史</p>
          : filtered.map(item => (
            <SwipeAction
              key={item.address}
              onEdit={() => onUpdateRemark(item)}
              onDelete={() => onRemove(item.address)}
              editLabel="编辑"
              deleteLabel="删除"
            >
              <div onClick={() => onJump(item.address)}
                className="bg-slate-50 dark:bg-white/5 hover:bg-[#AB9FF2]/10 border border-transparent hover:border-[#AB9FF2]/30 rounded-xl p-3 cursor-pointer transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${item.chain === 'ETH' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>{item.chain}</span>
                  <span className="font-mono text-xs font-medium truncate">{item.ens || shortenAddress(item.address)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs truncate ${item.remark ? 'text-slate-600 dark:text-slate-300 font-medium' : 'text-slate-400'}`}>
                    {item.remark || '点击查看'}
                  </span>
                  {item.remark && (
                    <button onClick={(e) => { e.stopPropagation(); onUpdateRemark(item); }}
                      className="p-1 rounded text-slate-400 hover:text-[#AB9FF2] flex-shrink-0">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </SwipeAction>
          ))}
      </div>
    </div>
  );
}

// ============ 设置面板 ============
function SettingsPanel({ user, onLogout, theme, setTheme, ethApiKey, setEthApiKey, trxApiKey, setTrxApiKey, onSaveKey, showKey, setShowKey }) {
  const [saved, setSaved] = useState(false);
  const handleSave = () => { onSaveKey(ethApiKey, trxApiKey); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const themes = [
    { id: 'light', label: '浅色', icon: Sun },
    { id: 'dark', label: '深色', icon: Moon },
    { id: 'system', label: '跟随系统', icon: Monitor },
  ];
  const [networks, setNetworks] = useState({ ETH: true, TRX: true });
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
            <p className="text-xs text-slate-400 mb-2">用于加速以太坊网络数据获取(选填)。</p>
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
            <p className="text-xs text-slate-400 mb-2">用于提高波场接口限额(选填)。</p>
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
            <button onClick={() => setNetworks(s => ({ ...s, [n.id]: !s[n.id] }))}
              className={`w-12 h-7 rounded-full transition-colors relative flex-shrink-0 ${networks[n.id] ? 'bg-[#AB9FF2]' : 'bg-slate-300 dark:bg-white/10'}`}>
              <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${networks[n.id] ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        ))}
        <p className="text-[11px] text-slate-400 mt-2">更多链将在后续版本支持。</p>
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

// ============ 扫码弹窗 ============
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

// ============ 图标组件（需要根据你的项目配置）============
// 这些图标组件需要你从 lucide-react 或其他图标库导入
// 或者使用内联的 SVG 组件

// 示例：基础图标组件（实际使用时替换为真实图标）
const Search = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeWidth="2"/><path d="m21 21-4.35-4.35" strokeWidth="2" strokeLinecap="round"/></svg>;
const History = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 3v5h5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 7v5l4 2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Settings = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" strokeWidth="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" strokeWidth="2"/></svg>;
const Wallet = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" strokeWidth="2"/></svg>;
const ChevronRight = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const ChevronLeft = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Moon = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Sun = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" strokeWidth="2"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeWidth="2" strokeLinecap="round"/></svg>;
const Monitor = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" strokeWidth="2"/><path d="M8 21h8M12 17v4" strokeWidth="2" strokeLinecap="round"/></svg>;
const Scan = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" strokeWidth="2" strokeLinecap="round"/><rect x="7" y="7" width="10" height="10" rx="1" strokeWidth="2"/></svg>;
const Loader2 = ({ className }) => <svg className={`animate-spin ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56" strokeWidth="2" strokeLinecap="round"/></svg>;
const AlertCircle = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth="2"/><path d="M12 8v4M12 16h.01" strokeWidth="2" strokeLinecap="round"/></svg>;
const X = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const DollarSign = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const FileText = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeWidth="2" strokeLinejoin="round"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeWidth="2" strokeLinecap="round"/></svg>;
const ArrowDownRight = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 7h10v10M7 17 17 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const ArrowUpRight = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 17 17 7M7 7h10v10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Copy = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2"/></svg>;
const ExternalLink = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Clock = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth="2"/><path d="M12 6v6l4 2" strokeWidth="2" strokeLinecap="round"/></svg>;
const Edit2 = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="m15 5 4 4" strokeWidth="2"/></svg>;
const Trash2 = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 11v6M14 11v6" strokeWidth="2" strokeLinecap="round"/></svg>;
const Check = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const LogOut = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Eye = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeWidth="2"/><circle cx="12" cy="12" r="3" strokeWidth="2"/></svg>;
const EyeOff = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Network = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="16" y="16" width="6" height="6" rx="1" strokeWidth="2"/><rect x="2" y="16" width="6" height="6" rx="1" strokeWidth="2"/><rect x="9" y="2" width="6" height="6" rx="1" strokeWidth="2"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8" strokeWidth="2"/></svg>;
const ImageIcon = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="2"/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth="2"/><path d="m21 15-5-5L5 21" strokeWidth="2"/></svg>;
const Download = ({ className }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;

// React Hooks
const { useState, useEffect, useRef, useMemo } = React || window.React || {};
