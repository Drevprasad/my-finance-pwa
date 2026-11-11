'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function Settings() {
  const [status, setStatus] = useState('');

  const [categories, setCategories] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);

  const [catName, setCatName] = useState('');
  const [catKind, setCatKind] = useState('expense');

  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState('asset');
  const [accSubtype, setAccSubtype] = useState('bank');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: catData } = await supabase.from('categories').select('*').order('name');
    const { data: accData } = await supabase.from('accounts').select('*').order('name');
    setCategories(catData || []);
    setAccounts(accData || []);
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Saving Category...');
    const { error } = await supabase.from('categories').insert([{ name: catName, kind: catKind }]);
    if (error) setStatus(`Error: ${error.message}`);
    else {
      setStatus(`✅ Success: Added "${catName}" category!`);
      setCatName('');
      fetchData();
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Saving Account...');
    const { error } = await supabase.from('accounts').insert([{ name: accName, type: accType, subtype: accSubtype }]);
    if (error) setStatus(`Error: ${error.message}`);
    else {
      setStatus(`✅ Success: Added "${accName}" account!`);
      setAccName('');
      fetchData();
    }
  };

  const handleDeleteCategory = async (id: number, name: string) => {
    if (!window.confirm(`Delete category "${name}"?`)) return;
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) {
      setStatus(`❌ Cannot delete "${name}". It is likely being used by existing transactions.`);
    } else {
      setStatus(`✅ Deleted category "${name}"`);
      fetchData();
    }
  };

  const handleDeleteAccount = async (id: number, name: string) => {
    if (!window.confirm(`Delete account "${name}"?`)) return;
    const { error } = await supabase.from('accounts').delete().eq('id', id);
    if (error) {
      setStatus(`❌ Cannot delete "${name}". It is likely being used by existing transactions.`);
    } else {
      setStatus(`✅ Deleted account "${name}"`);
      fetchData();
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8 font-sans">
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        
        <div className="flex justify-between items-center bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
          <div>
            <h1 className="text-2xl font-bold text-white">⚙️ Configuration</h1>
            <p className="text-gray-400 text-sm mt-1">Manage your accounts and categories</p>
          </div>
          <a href="/" className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-6 rounded-lg transition-colors">
            ← Back to Dashboard
          </a>
        </div>

        {status && (
          <div className={`p-4 rounded border text-sm font-mono ${status.startsWith('❌') ? 'bg-red-950/50 border-red-800 text-red-400' : 'bg-gray-950 border-gray-700 text-emerald-400'}`}>
            {status}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Categories Column */}
          <div className="flex flex-col gap-6">
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
              <h2 className="text-xl font-bold mb-4">Create Category</h2>
              <form onSubmit={handleAddCategory} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Category Name</label>
                  <input type="text" required className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Travel, Gym, Salary" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Type</label>
                  <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={catKind} onChange={(e) => setCatKind(e.target.value)}>
                    <option value="expense">Expense (Money Out)</option>
                    <option value="income">Income (Money In)</option>
                  </select>
                </div>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 font-bold py-2 rounded transition-colors">Save Category</button>
              </form>
            </div>

            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
              <h2 className="text-lg font-bold mb-4">Existing Categories</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700">
                    <div>
                      <div className="font-medium">{cat.name}</div>
                      <div className="text-xs text-gray-500 capitalize">{cat.kind}</div>
                    </div>
                    <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="text-gray-500 hover:text-red-400 transition-colors p-2" title="Delete">🗑️</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Accounts Column */}
          <div className="flex flex-col gap-6">
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
              <h2 className="text-xl font-bold mb-4">Create Account</h2>
              <form onSubmit={handleAddAccount} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Account Name</label>
                  <input type="text" required className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={accName} onChange={(e) => setAccName(e.target.value)} placeholder="e.g. SBI Savings" />
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Behavior</label>
                    <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={accType} onChange={(e) => setAccType(e.target.value)}>
                      <option value="asset">Asset (Bank / Cash)</option>
                      <option value="liability">Liability (Credit Card / Loan)</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Subtype</label>
                    <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={accSubtype} onChange={(e) => setAccSubtype(e.target.value)}>
                      <option value="bank">Bank</option>
                      <option value="credit_card">Credit Card</option>
                      <option value="cash">Cash</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 font-bold py-2 rounded transition-colors">Save Account</button>
              </form>
            </div>

            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
              <h2 className="text-lg font-bold mb-4">Existing Accounts</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {accounts.map(acc => (
                  <div key={acc.id} className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700">
                    <div>
                      <div className="font-medium">{acc.name}</div>
                      <div className="text-xs text-gray-500 capitalize">{acc.type} • {acc.subtype}</div>
                    </div>
                    {/* Hide delete button for system accounts */}
                    {acc.type !== 'expense' && acc.type !== 'income' && (
                      <button onClick={() => handleDeleteAccount(acc.id, acc.name)} className="text-gray-500 hover:text-red-400 transition-colors p-2" title="Delete">🗑️</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}