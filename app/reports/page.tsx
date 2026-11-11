'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Reports() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter Modes: 'range' | 'months' | 'years' | 'days'
  const [filterMode, setFilterMode] = useState<'range' | 'months' | 'years' | 'days'>('months');

  // 1. Date Range State
 const [startDate, setStartDate] = useState('2026-01-01');
 const [endDate, setEndDate] = useState('');

 // 2. Specific Months State (Format: 'YYYY-MM')
 const [pickerYear, setPickerYear] = useState('2026');
 const [selectedMonths, setSelectedMonths] = useState<string[]>([]);

 // 3. Specific Years State (Format: 'YYYY')
 const [selectedYears, setSelectedYears] = useState<string[]>(['2026']);

 // 4. Specific Days State (Format: 'YYYY-MM-DD')
 const [dayInput, setDayInput] = useState('');
 const [selectedDays, setSelectedDays] = useState<string[]>([]);

  // Summary Metrics & Charts
  const [totalIncome, setTotalIncome] = useState(0);
  const [totalExpense, setTotalExpense] = useState(0);
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [timelineData, setTimelineData] = useState<any[]>([]);
  const [filteredTxns, setFilteredTxns] = useState<any[]>([]);

  const MONTHS = [
    { num: '01', label: 'Jan' }, { num: '02', label: 'Feb' }, { num: '03', label: 'Mar' },
    { num: '04', label: 'Apr' }, { num: '05', label: 'May' }, { num: '06', label: 'Jun' },
    { num: '07', label: 'Jul' }, { num: '08', label: 'Aug' }, { num: '09', label: 'Sep' },
    { num: '10', label: 'Oct' }, { num: '11', label: 'Nov' }, { num: '12', label: 'Dec' }
  ];
  const YEARS = ['2023', '2024', '2025', '2026', '2027'];
  const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#f43f5e', '#ec4899'];

  useEffect(() => {
  const today = new Date().toISOString();
  setEndDate(today.split('T')[0]);
  setSelectedMonths([today.slice(0, 7)]);
  setSelectedDays([today.split('T')[0]]);

  fetchAllData();
  }, []);

  useEffect(() => {
    applyFiltersAndCalculate();
  }, [transactions, categories, filterMode, startDate, endDate, selectedMonths, selectedYears, selectedDays]);

  const fetchAllData = async () => {
    setIsLoading(true);
    const { data: txns } = await supabase
      .from('transactions')
      .select('id, txn_date, payee, narration, notes, postings(amount_minor, account_id, category_id, accounts(name, type))')
      .order('txn_date', { ascending: false });
    
    const { data: cats } = await supabase.from('categories').select('*');

    setTransactions(txns || []);
    setCategories(cats || []);
    setIsLoading(false);
  };

  const toggleMonth = (monthKey: string) => {
    setSelectedMonths(prev => 
      prev.includes(monthKey) ? prev.filter(m => m !== monthKey) : [...prev, monthKey].sort()
    );
  };

  const toggleYear = (yr: string) => {
    setSelectedYears(prev => 
      prev.includes(yr) ? prev.filter(y => y !== yr) : [...prev, yr].sort()
    );
  };

  const addDay = () => {
    if (dayInput && !selectedDays.includes(dayInput)) {
      setSelectedDays(prev => [...prev, dayInput].sort());
      setDayInput('');
    }
  };

  const removeDay = (day: string) => {
    setSelectedDays(prev => prev.filter(d => d !== day));
  };

  const formatMonthLabel = (ym: string) => {
    const [y, m] = ym.split('-');
    const mObj = MONTHS.find(item => item.num === m);
    return `${mObj ? mObj.label : m} '${y.slice(2)}`;
  };

  const applyFiltersAndCalculate = () => {
    // 1. Filter Transactions by Selected Calendar Mode
    const matched = transactions.filter(txn => {
      const date = txn.txn_date; // YYYY-MM-DD
      if (!date) return false;
      const ym = date.slice(0, 7); // YYYY-MM
      const y = date.slice(0, 4);  // YYYY

      if (filterMode === 'range') {
        return (!startDate || date >= startDate) && (!endDate || date <= endDate);
      }
      if (filterMode === 'months') {
        return selectedMonths.includes(ym);
      }
      if (filterMode === 'years') {
        return selectedYears.includes(y);
      }
      if (filterMode === 'days') {
        return selectedDays.includes(date);
      }
      return true;
    });

    setFilteredTxns(matched);

    // 2. Aggregate Totals, Category Breakdown, and Period Timeline
    let inc = 0;
    let exp = 0;
    const catMap: Record<string, number> = {};
    const periodMap: Record<string, { period: string; Income: number; Expense: number }> = {};

    matched.forEach(txn => {
      const date = txn.txn_date;
      // Group bar chart by Day if looking at specific days, Year if years, otherwise by Month (e.g., Mar '26)
      const periodKey = filterMode === 'days' ? date : filterMode === 'years' ? date.slice(0, 4) : date.slice(0, 7);

      if (!periodMap[periodKey]) {
        periodMap[periodKey] = { 
          period: filterMode === 'months' || filterMode === 'range' ? formatMonthLabel(periodKey) : periodKey, 
          Income: 0, 
          Expense: 0 
        };
      }

      txn.postings?.forEach((post: any) => {
        const amt = post.amount_minor / 100;
        if (post.accounts?.type === 'expense' && amt > 0) {
          exp += amt;
          const catName = categories.find(c => c.id === post.category_id)?.name || 'Uncategorized';
          catMap[catName] = (catMap[catName] || 0) + amt;
          periodMap[periodKey].Expense += amt;
        }
        if (post.accounts?.type === 'income' && amt < 0) {
          const cleanInc = Math.abs(amt);
          inc += cleanInc;
          periodMap[periodKey].Income += cleanInc;
        }
      });
    });

    setTotalIncome(inc);
    setTotalExpense(exp);
    setCategoryData(
      Object.keys(catMap)
        .map(name => ({ name, value: catMap[name] }))
        .sort((a, b) => b.value - a.value)
    );

    const sortedTimeline = Object.keys(periodMap)
      .sort()
      .map(k => periodMap[k]);
    setTimelineData(sortedTimeline);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8 font-sans">
      <div className="max-w-6xl mx-auto flex flex-col gap-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">📊 Summary Reports & Calendar Explorer</h1>
            <p className="text-gray-400 text-sm mt-1">Analyze custom date ranges, specific non-consecutive months, or years</p>
          </div>
          <div className="flex gap-3">
            <a href="/" className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm">
              ← Dashboard
            </a>
            <a href="/settings" className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm">
              ⚙️ Settings
            </a>
          </div>
        </div>

        {/* Calendar Filter Control Panel */}
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-700 pb-4">
            <span className="font-bold text-gray-200">Select Filter Mode:</span>
            <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-700">
              {[
                { id: 'months', label: '🗓️ Specific Months (e.g. Mar 26, Aug 25)' },
                { id: 'range', label: '📅 Custom Date Range' },
                { id: 'years', label: '📆 Specific Years' },
                { id: 'days', label: '📌 Specific Days' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setFilterMode(tab.id as any)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${filterMode === tab.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* MODE 1: SPECIFIC MONTHS PICKER */}
          {filterMode === 'months' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">Choose Year to toggle months:</span>
                {YEARS.map(yr => (
                  <button
                    key={yr}
                    onClick={() => setPickerYear(yr)}
                    className={`px-3 py-1 rounded text-sm font-bold border transition-colors ${pickerYear === yr ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-white'}`}
                  >
                    {yr}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-12 gap-2">
                {MONTHS.map(m => {
                  const key = `${pickerYear}-${m.num}`;
                  const isSelected = selectedMonths.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleMonth(key)}
                      className={`py-2 px-3 rounded-lg font-semibold text-xs border transition-all ${
                        isSelected 
                          ? 'bg-blue-600 border-blue-400 text-white shadow-md' 
                          : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
                      }`}
                    >
                      {m.label} '{pickerYear.slice(2)}
                    </button>
                  );
                })}
              </div>

              {/* Active Month Chips */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-xs text-gray-400">Active Months:</span>
                {selectedMonths.length === 0 && <span className="text-xs text-red-400">None selected (Click months above)</span>}
                {selectedMonths.map(m => (
                  <span key={m} className="bg-blue-900/50 border border-blue-700 text-blue-200 text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    {formatMonthLabel(m)}
                    <button onClick={() => toggleMonth(m)} className="hover:text-red-400 font-bold">×</button>
                  </span>
                ))}
                {selectedMonths.length > 0 && (
                  <button onClick={() => setSelectedMonths([])} className="text-xs text-gray-500 hover:text-red-400 ml-2 underline">
                    Clear All
                  </button>
                )}
              </div>
            </div>
          )}

          {/* MODE 2: CUSTOM DATE RANGE PICKER */}
          {filterMode === 'range' && (
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <label className="block text-xs text-gray-400 mb-1">From Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">To Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-white text-sm"
                />
              </div>
            </div>
          )}

          {/* MODE 3: SPECIFIC YEARS PICKER */}
          {filterMode === 'years' && (
            <div className="space-y-3">
              <span className="block text-xs text-gray-400">Toggle one or more years to compare:</span>
              <div className="flex flex-wrap gap-3">
                {YEARS.map(yr => {
                  const isSelected = selectedYears.includes(yr);
                  return (
                    <button
                      key={yr}
                      onClick={() => toggleYear(yr)}
                      className={`px-5 py-2.5 rounded-lg font-bold text-sm border transition-all ${
                        isSelected ? 'bg-blue-600 border-blue-400 text-white' : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {yr}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* MODE 4: SPECIFIC DAYS PICKER */}
          {filterMode === 'days' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Pick a Date to Add</label>
                  <input
                    type="date"
                    value={dayInput}
                    onChange={(e) => setDayInput(e.target.value)}
                    className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={addDay}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
                >
                  + Add Day
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">Selected Days:</span>
                {selectedDays.map(d => (
                  <span key={d} className="bg-blue-900/50 border border-blue-700 text-blue-200 text-xs px-3 py-1 rounded-full flex items-center gap-2">
                    {d}
                    <button onClick={() => removeDay(d)} className="hover:text-red-400 font-bold">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
            <h3 className="text-gray-400 text-sm font-medium">Total Income (Selected Period)</h3>
            <div className="text-2xl font-bold mt-2 font-mono text-emerald-400">
              +₹{totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
            <h3 className="text-gray-400 text-sm font-medium">Total Expenses (Selected Period)</h3>
            <div className="text-2xl font-bold mt-2 font-mono text-red-400">
              -₹{totalExpense.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
            <h3 className="text-gray-400 text-sm font-medium">Net Savings / Cash Flow</h3>
            <div className={`text-2xl font-bold mt-2 font-mono ${(totalIncome - totalExpense) >= 0 ? 'text-blue-400' : 'text-amber-400'}`}>
              {(totalIncome - totalExpense) >= 0 ? '+' : ''}₹{(totalIncome - totalExpense).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Charts & Category Table */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Period Comparison Bar Chart */}
          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col">
            <h2 className="text-lg font-bold text-gray-200 mb-4">Period-by-Period Breakdown</h2>
            {timelineData.length > 0 ? (
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timelineData} margin={{ top: 10, right: 10, left: 30, bottom: 0 }}>
                    <XAxis dataKey="period" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(val) => `₹${val.toLocaleString('en-IN')}`} />
                    <Tooltip cursor={{ fill: '#374151' }} formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`} contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }} />
                    <Legend />
                    <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500 text-sm h-64">No transactions match the selected dates.</div>
            )}
          </div>

          {/* Category Breakdown Donut + Table */}
          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col">
            <h2 className="text-lg font-bold text-gray-200 mb-4">Category Spending Summary</h2>
            {categoryData.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center flex-1">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={4} dataKey="value">
                        {categoryData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any) => value != null ? `₹${Number(value).toLocaleString('en-IN')}` : ''} contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-2">
                  {categoryData.map((cat, i) => {
                    const pct = totalExpense > 0 ? ((cat.value / totalExpense) * 100).toFixed(1) : '0';
                    return (
                      <div key={cat.name} className="flex justify-between items-center text-xs bg-gray-900 p-2.5 rounded border border-gray-700">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: COLORS[i % COLORS.length] }}></span>
                          <span className="font-medium text-gray-200">{cat.name}</span>
                        </div>
                        <div className="text-right font-mono">
                          <div className="text-white font-semibold">₹{cat.value.toLocaleString('en-IN')}</div>
                          <div className="text-gray-500">{pct}%</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500 text-sm h-64">No expense categories in this period.</div>
            )}
          </div>
        </div>

        {/* Filtered Transactions Table */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-lg overflow-hidden">
          <div className="p-4 border-b border-gray-700 bg-gray-900/50 flex justify-between items-center">
            <h2 className="font-semibold text-gray-200">Matching Transactions ({filteredTxns.length})</h2>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading ledger...</div>
          ) : filteredTxns.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No transactions found for the selected calendar filter.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-900/50 text-gray-400 text-sm border-b border-gray-700">
                  <th className="p-4">Date</th>
                  <th className="p-4">Payee / Narration</th>
                  <th className="p-4">Impact</th>
                </tr>
              </thead>
              <tbody>
                {filteredTxns.map(txn => (
                  <tr key={txn.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                    <td className="p-4 text-sm text-gray-300 font-mono">{txn.txn_date}</td>
                    <td className="p-4 font-medium text-gray-200">
                      {txn.payee}
                      <div className="text-xs text-gray-500 font-mono mt-1">{txn.notes || txn.narration}</div>
                    </td>
                    <td className="p-4 text-sm">
                      {txn.postings?.map((post: any, i: number) => {
                        const amt = post.amount_minor / 100;
                        const isSystemAcc = post.accounts?.type === 'expense' || post.accounts?.type === 'income';
                        const colorClass = isSystemAcc ? 'text-gray-500' : (amt < 0 ? 'text-red-400' : 'text-emerald-400');
                        return (
                          <div key={i} className="flex justify-between w-52 mb-1">
                            <span className="text-gray-400 truncate pr-2">{post.accounts?.name}:</span>
                            <span className={`font-mono ${colorClass}`}>{amt < 0 ? '' : '+'}{amt.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}