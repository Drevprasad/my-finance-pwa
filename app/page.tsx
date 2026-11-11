'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import Papa from 'papaparse';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Home() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [sysExpenseAcc, setSysExpenseAcc] = useState<number>(0);
  const [sysIncomeAcc, setSysIncomeAcc] = useState<number>(0);

  const [txnType, setTxnType] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [txnDate, setTxnDate] = useState('');
  
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  
  const [csvAccountId, setCsvAccountId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [selectedTxnIds, setSelectedTxnIds] = useState<number[]>([]);

  const [expenseChartData, setExpenseChartData] = useState<any[]>([]);
  const [cashFlowData, setCashFlowData] = useState<any[]>([]);
  
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'all'>('monthly');
  const [headerTitle, setHeaderTitle] = useState('');

  // Hydration-safe init
  useEffect(() => {
    setTxnDate(new Date().toISOString().split('T')[0]);
  }, []);

  useEffect(() => {
    fetchInitialData();
    
    // Dynamically set the heading based on timeRange
    const d = new Date();
    if (timeRange === 'daily') setHeaderTitle(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
    else if (timeRange === 'monthly') setHeaderTitle(d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
    else if (timeRange === 'yearly') setHeaderTitle(d.getFullYear().toString());
    else if (timeRange === 'weekly') setHeaderTitle('Last 7 Days');
    else setHeaderTitle('All Time');
  }, [timeRange]);

  useEffect(() => {
    const filteredCats = categories.filter(c => c.kind === txnType);
    if (filteredCats.length > 0) setSelectedCategoryId(filteredCats[0].id.toString());
  }, [txnType, categories]);

  const fetchInitialData = async () => {
    setIsLoading(true);
    
    let query = supabase
      .from('transactions')
      .select('id, txn_date, payee, notes, postings(amount_minor, account_id, category_id, accounts(name, type))')
      .order('txn_date', { ascending: false });

    if (timeRange !== 'all') {
      const targetDate = new Date();
      if (timeRange === 'daily') targetDate.setDate(targetDate.getDate() - 1);
      else if (timeRange === 'weekly') targetDate.setDate(targetDate.getDate() - 7);
      else if (timeRange === 'monthly') targetDate.setMonth(targetDate.getMonth() - 1);
      else if (timeRange === 'yearly') targetDate.setFullYear(targetDate.getFullYear() - 1);
      
      query = query.gte('txn_date', targetDate.toISOString().split('T')[0]);
    } else {
      query = query.limit(200); 
    }

    const { data: txns } = await query;
    const { data: allAccs } = await supabase.from('accounts').select('*');
    const { data: cats } = await supabase.from('categories').select('*');
    const { data: bals } = await supabase.from('account_balances').select('*');
    const { data: dbRules } = await supabase.from('rules').select('*');

    if (allAccs) {
      const expAcc = allAccs.find(a => a.type === 'expense');
      const incAcc = allAccs.find(a => a.type === 'income');
      if (expAcc) setSysExpenseAcc(expAcc.id);
      if (incAcc) setSysIncomeAcc(incAcc.id);

      const displayAccs = allAccs.filter(a => a.type !== 'expense' && a.type !== 'income');
      setAccounts(displayAccs);
      
      if (displayAccs.length > 0 && !selectedAccountId) {
        setSelectedAccountId(displayAccs[0].id.toString());
        setFromAccountId(displayAccs[0].id.toString());
        setToAccountId(displayAccs.length > 1 ? displayAccs[1].id.toString() : displayAccs[0].id.toString());
        if (!csvAccountId) setCsvAccountId(displayAccs[0].id.toString());
      }
    }

    setTransactions(txns || []);
    setCategories(cats || []);
    setBalances(bals || []);
    setRules(dbRules || []);
    setSelectedTxnIds([]); 
    
    if (txns && cats) {
      const expDataMap: Record<string, number> = {};
      let totalIncome = 0;
      let totalExpense = 0;

      txns.forEach(txn => {
        txn.postings.forEach((post: any) => {
          const amt = post.amount_minor / 100;
          if (post.accounts?.type === 'expense' && amt > 0) {
            const catName = cats.find(c => c.id === post.category_id)?.name || 'Uncategorized';
            expDataMap[catName] = (expDataMap[catName] || 0) + amt;
            totalExpense += amt;
          }
          if (post.accounts?.type === 'income' && amt < 0) {
            totalIncome += Math.abs(amt);
          }
        });
      });

      setExpenseChartData(Object.keys(expDataMap).map(name => ({ name, value: expDataMap[name] })).sort((a, b) => b.value - a.value));
      setCashFlowData([{ name: timeRange.toUpperCase(), Income: totalIncome, Expense: totalExpense }]);
    }

    setIsLoading(false);
  };

  const generateHash = async (text: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!csvAccountId) {
      setImportStatus('❌ Please select a target account first.');
      return;
    }
    setImportStatus('Parsing CSV...');
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        setImportStatus(`Processing ${results.data.length} rows...`);
        let successCount = 0;
        let duplicateCount = 0;

        for (const row of results.data as any[]) {
          if (!row.Date || !row.Amount) continue;

          const amountInPaise = Math.round(parseFloat(row.Amount) * 100);
          const uniqueString = `${csvAccountId}-${row.Date}-${amountInPaise}-${row.Narration}`;
          const dedupeHash = await generateHash(uniqueString);

          let finalPayee = 'Bank Import';
          let finalCategoryId = categories.find(c => c.kind === 'expense')?.id || 1; 

          const upperNarration = (row.Narration || '').toUpperCase();
          const matchedRule = rules.find(r => upperNarration.includes(r.search_term.toUpperCase()));
          
          if (matchedRule) {
            finalPayee = matchedRule.payee_name;
            finalCategoryId = matchedRule.category_id;
          }

          const { data: txn, error: txnError } = await supabase
            .from('transactions')
            .insert([{ txn_date: row.Date, payee: finalPayee, narration: row.Narration, dedupe_hash: dedupeHash }])
            .select().single();

          if (txnError) {
            if (txnError.code === '23505') duplicateCount++;
            continue;
          }

          if (txn) {
            await supabase.from('postings').insert([
              { txn_id: txn.id, account_id: parseInt(csvAccountId), amount_minor: -amountInPaise },
              { txn_id: txn.id, account_id: sysExpenseAcc, category_id: finalCategoryId, amount_minor: amountInPaise }
            ]);
            successCount++;
          }
        }
        setImportStatus(`✅ Imported ${successCount} new rows. Skipped ${duplicateCount} duplicates.`);
        fetchInitialData(); 
      }
    });
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const amountInPaise = Math.round(parseFloat(amount) * 100);
    
    const { data: txn, error: txnError } = await supabase
      .from('transactions')
      .insert([{ 
        txn_date: txnDate, 
        payee: txnType === 'transfer' ? 'Internal Transfer' : payee, 
        narration: `Manual-${payee || 'Transfer'}` 
      }])
      .select().single();

    if (!txnError && txn) {
      if (txnType === 'expense') {
        await supabase.from('postings').insert([
          { txn_id: txn.id, account_id: parseInt(selectedAccountId), amount_minor: -amountInPaise },
          { txn_id: txn.id, account_id: sysExpenseAcc, category_id: parseInt(selectedCategoryId), amount_minor: amountInPaise }
        ]);
      } else if (txnType === 'income') {
        await supabase.from('postings').insert([
          { txn_id: txn.id, account_id: parseInt(selectedAccountId), amount_minor: amountInPaise },
          { txn_id: txn.id, account_id: sysIncomeAcc, category_id: parseInt(selectedCategoryId), amount_minor: -amountInPaise }
        ]);
      } else {
        await supabase.from('postings').insert([
          { txn_id: txn.id, account_id: parseInt(fromAccountId), amount_minor: -amountInPaise },
          { txn_id: txn.id, account_id: parseInt(toAccountId), amount_minor: amountInPaise }
        ]);
      }
      setPayee(''); setAmount(''); fetchInitialData();
    }
    setIsSubmitting(false);
  };

  const handleDeleteTransaction = async (txnId: number) => {
    if (!window.confirm('Delete this transaction?')) return;
    await supabase.from('postings').delete().eq('txn_id', txnId);
    await supabase.from('transactions').delete().eq('id', txnId);
    fetchInitialData();
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedTxnIds(transactions.map(t => t.id));
    else setSelectedTxnIds([]);
  };

  const handleSelectTxn = (id: number, checked: boolean) => {
    if (checked) setSelectedTxnIds(prev => [...prev, id]);
    else setSelectedTxnIds(prev => prev.filter(txnId => txnId !== id));
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedTxnIds.length} transactions?`)) return;
    await supabase.from('postings').delete().in('txn_id', selectedTxnIds);
    await supabase.from('transactions').delete().in('id', selectedTxnIds);
    fetchInitialData();
  };

  const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#f43f5e'];

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8 font-sans">
      <div className="max-w-6xl mx-auto flex flex-col gap-8">
        
        {/* Dynamic Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Dashboard {headerTitle && <span className="text-blue-400">/ {headerTitle}</span>}
            </h1>
            <p className="text-gray-400 text-sm mt-1">Personal Finance Analytics</p>
          </div>
          
          <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
            <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-700">
              {['daily', 'weekly', 'monthly', 'yearly', 'all'].map(t => (
                <button 
                  key={t}
                  onClick={() => setTimeRange(t as any)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded capitalize transition-colors ${timeRange === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <a href="/reports" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm">
                📊 Reports
              </a>
              <a href="/settings" className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm">
                ⚙️
              </a>
            </div>
          </div>
        </div>

        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col items-center">
              <h2 className="text-lg font-bold text-gray-200 w-full mb-4">Expenses by Category</h2>
              {expenseChartData.length > 0 ? (
                <div className="w-full h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={expenseChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                        {expenseChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any) => value != null ? `₹${Number(value).toLocaleString('en-IN')}` : ''} contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }} />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">No expenses found for this period.</div>
              )}
            </div>

            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col">
              <h2 className="text-lg font-bold text-gray-200 w-full mb-4">Cash Flow Overview</h2>
              <div className="w-full h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cashFlowData} margin={{ top: 10, right: 10, left: 30, bottom: 0 }}>
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(val) => `₹${val.toLocaleString('en-IN')}`} />
                    <Tooltip cursor={{ fill: '#374151' }} formatter={(value) => `₹${Number(value ?? 0).toLocaleString('en-IN')}`} contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }} />
                    <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} barSize={50} />
                    <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={50} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {balances.filter(b => b.type !== 'expense' && b.type !== 'income').map((bal) => (
            <div key={bal.id} className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
              <h3 className="text-gray-400 text-sm font-medium">{bal.name}</h3>
              <div className="text-2xl font-bold mt-1 font-mono">
                ₹{(bal.type === 'liability' ? -(bal.balance_minor/100) : bal.balance_minor/100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="flex flex-col gap-8">
            
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg h-fit">
              <div className="flex bg-gray-900 rounded-lg p-1 mb-6 border border-gray-700">
                <button type="button" onClick={() => setTxnType('income')} className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${txnType === 'income' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}>Income</button>
                <button type="button" onClick={() => setTxnType('expense')} className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${txnType === 'expense' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>Expense</button>
                <button type="button" onClick={() => setTxnType('transfer')} className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${txnType === 'transfer' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>Transfer</button>
              </div>

              <form onSubmit={handleQuickAdd} className="space-y-4">
                <input type="date" required className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-sm" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />
                <input type="number" step="0.01" required className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (₹)" />
                
                {(txnType === 'expense' || txnType === 'income') ? (
                  <>
                    <input type="text" required className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Payee" />
                    <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
                      {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                    </select>
                    <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value)}>
                      {categories.filter(c => c.kind === txnType).map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">From Account</label>
                      <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                        {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">To Account</label>
                      <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                        {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <button type="submit" disabled={isSubmitting} className={`w-full font-bold py-2 rounded transition-colors disabled:opacity-50 ${txnType === 'income' ? 'bg-emerald-600 hover:bg-emerald-500' : txnType === 'expense' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-purple-600 hover:bg-purple-500'}`}>
                  {isSubmitting ? 'Saving...' : txnType === 'income' ? 'Add Income' : txnType === 'expense' ? 'Add Expense' : 'Log Transfer'}
                </button>
              </form>
            </div>

            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg h-fit border-dashed">
              <h2 className="text-xl font-bold mb-2">Bulk Import Bank CSV</h2>
              <p className="text-xs text-gray-400 mb-4">CSV must have headers: Date, Narration, Amount</p>
              <div className="mb-4">
                <label className="block text-sm text-gray-300 mb-1 font-semibold">Importing into:</label>
                <select className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none focus:border-blue-500" value={csvAccountId} onChange={(e) => setCsvAccountId(e.target.value)}>
                  {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                </select>
              </div>
              <input type="file" accept=".csv" onChange={handleCSVUpload} className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer" />
              {importStatus && <div className={`mt-4 text-sm font-mono ${importStatus.includes('❌') ? 'text-red-400' : 'text-emerald-400'}`}>{importStatus}</div>}
            </div>
          </div>

          <div className="md:col-span-2 bg-gray-800 rounded-xl border border-gray-700 shadow-lg overflow-hidden h-fit">
            <div className="p-4 border-b border-gray-700 bg-gray-900/50 flex justify-between items-center h-16">
              <h2 className="font-semibold text-gray-200">Transactions</h2>
              {selectedTxnIds.length > 0 && (
                <button onClick={handleBulkDelete} className="bg-red-900/50 hover:bg-red-900 text-red-400 hover:text-white border border-red-800 px-4 py-1.5 rounded text-sm transition-colors font-medium">
                  Delete Selected ({selectedTxnIds.length})
                </button>
              )}
            </div>
            {isLoading ? <div className="p-8 text-center text-gray-500 animate-pulse">Loading secure ledger...</div> : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-900/50 text-gray-400 text-sm border-b border-gray-700">
                    <th className="p-4 w-12"><input type="checkbox" className="accent-blue-500 w-4 h-4 rounded cursor-pointer" onChange={handleSelectAll} checked={transactions.length > 0 && selectedTxnIds.length === transactions.length} /></th>
                    <th className="p-4">Date</th>
                    <th className="p-4">Payee / Narration</th>
                    <th className="p-4">Impact</th>
                    <th className="p-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => (
                    <tr key={txn.id} className={`border-b border-gray-700/50 hover:bg-gray-700/20 group transition-colors ${selectedTxnIds.includes(txn.id) ? 'bg-blue-900/10' : ''}`}>
                      <td className="p-4"><input type="checkbox" className="accent-blue-500 w-4 h-4 rounded cursor-pointer" checked={selectedTxnIds.includes(txn.id)} onChange={(e) => handleSelectTxn(txn.id, e.target.checked)} /></td>
                      <td className="p-4 text-sm text-gray-300 font-mono">{txn.txn_date}</td>
                      <td className="p-4 font-medium text-gray-200">
                        {txn.payee}
                        <div className="text-xs text-gray-500 font-mono mt-1">{txn.notes || txn.narration}</div>
                      </td>
                      <td className="p-4 text-sm">
                        {txn.postings.map((post: any, i: number) => {
                          const amt = post.amount_minor / 100; 
                          const isSystemAcc = post.accounts?.type === 'expense' || post.accounts?.type === 'income';
                          const colorClass = isSystemAcc ? 'text-gray-500' : (amt < 0 ? 'text-red-400' : 'text-emerald-400');
                          return (
                            <div key={i} className="flex justify-between w-48 mb-1">
                              <span className="text-gray-400 truncate pr-2">{post.accounts.name}:</span>
                              <span className={`font-mono ${colorClass}`}>{amt < 0 ? '' : '+'}{amt.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </td>
                      <td className="p-4 text-right">
                        <button onClick={() => handleDeleteTransaction(txn.id)} className="text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100" title="Void Transaction">🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}