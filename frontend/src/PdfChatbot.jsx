import { useState, useRef, useEffect } from 'react';

export default function PdfChatbot() {
  const [user, setUser] = useState(null); 
  const [authMode, setAuthMode] = useState('login'); 
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  
  const chatEndRef = useRef(null);
  const activeChat = chats.find(c => c.id === activeChatId) || null;

  // ✅ Fixed: use activeChatId + chats instead of derived activeChat?.messages
  useEffect(() => {
    if (activeChatId && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeChatId, chats, loading]);

  const saveSessionToDatabase = async (userId, chatNode) => {
    try {
      await fetch('http://127.0.0.1:8000/api/chats/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          id: chatNode.id,
          title: chatNode.title,
          collection_id: chatNode.collectionId || '',
          response_type: chatNode.responseType,
          messages: chatNode.messages
        })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const fetchUserSessions = async (userId) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/chats/${userId}`);
      const data = await res.json();
      if (data.length > 0) {
        setChats(data);
        setActiveChatId(data[0].id);
      } else {
        const initialId = `chat_${Date.now()}`;
        const initialChat = {
          id: initialId, title: 'Workspace Node 1 🌿', file: null, collectionId: '', messages: [], responseType: 'normal'
        };
        setChats([initialChat]);
        setActiveChatId(initialId);
        saveSessionToDatabase(userId, initialChat);
      }
    } catch (err) {
      console.error("Failed syncing cloud clusters database", err);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!authForm.username.trim() || !authForm.password.trim()) return;
    const endpoint = authMode === 'login' ? 'login' : 'register';
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Authentication Failed.");
      const loggedInUser = { userId: data.user_id, username: data.username };
      setUser(loggedInUser);
      await fetchUserSessions(loggedInUser.userId);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setChats([]);
    setActiveChatId('');
    setAuthForm({ username: '', password: '' });
    setInput('');
    setAuthError('');
    window.location.reload();
  };

  const handleCreateNewChat = () => {
    if (!user) return;
    const newId = `chat_${Date.now()}`;
    const newChat = {
      id: newId, title: `Workspace Node ${chats.length + 1} 📊`, file: null, collectionId: '', messages: [], responseType: 'normal'
    };
    setChats([newChat, ...chats]);
    setActiveChatId(newId);
    setInput('');
    saveSessionToDatabase(user.userId, newChat);
  };

  const handleDeleteChat = async (idToDelete, e) => {
    e.stopPropagation(); 
    if (chats.length === 1) return;
    try {
      await fetch(`http://127.0.0.1:8000/api/chats/${idToDelete}`, { method: 'DELETE' });
      const updatedChats = chats.filter(c => c.id !== idToDelete);
      setChats(updatedChats);
      if (activeChatId === idToDelete) {
        setActiveChatId(updatedChats[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile || !activeChat) return;
    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, title: 'Processing...' } : c));
    setLoading(true);
    const formData = new FormData();
    formData.append('file', uploadedFile);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.collection_id) {
        const finalTitle = uploadedFile.name.length > 20 ? `${uploadedFile.name.substring(0, 18)}...` : uploadedFile.name;
        const updatedTarget = {
          ...activeChat,
          collectionId: data.collection_id,
          title: finalTitle,
          messages: [{ sender: 'bot', text: '🎉 Context layer synced. Input matrix open.' }]
        };
        setChats(prev => prev.map(c => c.id === activeChatId ? updatedTarget : c));
        saveSessionToDatabase(user.userId, updatedTarget);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeChat?.collectionId) return;
    const userMsg = input;
    const historySnapshot = [...activeChat.messages];
    const updatedMsgs = [...activeChat.messages, { sender: 'user', text: userMsg }];
    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, messages: updatedMsgs } : c));
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection_id: activeChat.collectionId,
          question: userMsg,
          response_type: activeChat.responseType,
          history: historySnapshot.map(m => ({ sender: m.sender, text: m.text }))
        }),
      });
      const data = await res.json();
      const finishedChatNode = { ...activeChat, messages: [...updatedMsgs, { sender: 'bot', text: data.response }] };
      setChats(prev => prev.map(c => c.id === activeChatId ? finishedChatNode : c));
      saveSessionToDatabase(user.userId, finishedChatNode);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-[#f7f4e9] font-sans">
        <div className="w-96 bg-white p-8 rounded-3xl border border-[#002b26]/10 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-[#002b26] text-[#ffefb3] rounded-2xl flex items-center justify-center text-2xl mx-auto font-bold">🌿</div>
            <h1 className="text-xl font-extrabold text-[#002b26]">Botanical Identity Node</h1>
            <p className="text-xs text-[#002b26]/50 uppercase tracking-wider font-semibold">
              {authMode === 'login' ? 'Secure Login Gate' : 'Register New Scope Profile'}
            </p>
          </div>
          {authError && <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl font-semibold text-center">{authError}</div>}
          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-[#002b26]/60 tracking-wider uppercase block mb-1">Username</label>
              <input 
                type="text" required
                value={authForm.username} onChange={e => setAuthForm({...authForm, username: e.target.value})}
                className="w-full bg-[#f7f4e9]/40 border border-[#002b26]/20 rounded-xl px-4 py-2.5 text-sm text-[#002b26] font-medium"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#002b26]/60 tracking-wider uppercase block mb-1">Secret Token Password</label>
              <input 
                type="password" required
                value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})}
                className="w-full bg-[#f7f4e9]/40 border border-[#002b26]/20 rounded-xl px-4 py-2.5 text-sm text-[#002b26] font-medium"
              />
            </div>
            <button type="submit" className="w-full bg-[#002b26] text-[#ffefb3] font-bold py-3 rounded-xl text-xs uppercase tracking-widest shadow-lg hover:opacity-95 transition-all">
              {authMode === 'login' ? 'Authenticate Session' : 'Create Cluster Access'}
            </button>
          </form>
          <div className="text-center pt-2">
            <button 
              onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}
              className="text-xs text-[#002b26]/60 hover:text-[#002b26] font-bold underline"
            >
              {authMode === 'login' ? "Don't have an account? Register profile node" : "Already verified? Return to entry gate"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex bg-[#f7f4e9] text-[#002b26] font-sans overflow-hidden antialiased">
      
      <aside className="w-72 bg-[#002b26] text-[#ffefb3] flex flex-col p-4 justify-between flex-shrink-0 shadow-2xl z-20">
        <div className="space-y-6 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between pb-4 border-b border-[#ffefb3]/10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-[#ffefb3] rounded-lg flex items-center justify-center font-bold text-[#002b26]">👤</div>
              <div className="truncate max-w-[120px]">
                <h2 className="font-bold text-xs text-[#ffefb3] truncate">{user.username}</h2>
                <p className="text-[8px] text-emerald-400 font-bold uppercase tracking-wider">Online Sync</p>
              </div>
            </div>
            <button onClick={handleLogout} className="text-[10px] bg-red-500/20 text-red-300 border border-red-500/20 px-2 py-1 rounded-md font-bold hover:bg-red-600 hover:text-white transition-all">Logout</button>
          </div>
          <button 
            onClick={handleCreateNewChat}
            className="w-full bg-[#ffefb3] hover:bg-[#fffae6] text-[#002b26] font-extrabold text-xs py-3 rounded-xl flex items-center justify-center gap-2"
          >
            <span>➕</span> New Workspace Scope
          </button>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
            <label className="text-[9px] font-bold text-[#ffefb3]/40 tracking-wider uppercase block mb-2 px-1">Session Channels</label>
            {chats.map(c => (
              <div
                key={c.id} onClick={() => { setActiveChatId(c.id); setInput(''); }}
                className={`w-full p-3 rounded-xl flex items-center justify-between cursor-pointer group select-none transition-all ${
                  c.id === activeChatId ? 'bg-[#013e37] text-[#ffefb3] border border-[#ffefb3]/10' : 'text-[#ffefb3]/60 hover:text-[#ffefb3] hover:bg-black/10'
                }`}
              >
                <div className="flex items-center gap-2 truncate mr-2">
                  <span className="text-xs">{c.collectionId ? '📄' : '💬'}</span>
                  <span className="truncate text-xs font-semibold">{c.title}</span>
                </div>
                {chats.length > 1 && (
                  <button onClick={(e) => handleDeleteChat(c.id, e)} className="p-1 rounded text-[#ffefb3]/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">🗑️</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <aside className="w-64 bg-[#013e37] text-[#ffefb3] flex flex-col p-5 flex-shrink-0 border-r border-black/10 shadow-lg z-10">
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-[#ffefb3]/60 tracking-wider uppercase block">Context Core Ingestion</label>
            <label className={`block border-2 border-dashed border-[#ffefb3]/20 bg-black/10 rounded-2xl p-5 text-center transition-all group ${!activeChat?.collectionId ? 'cursor-pointer hover:border-[#ffefb3]' : 'opacity-60'}`}>
              <input type="file" accept=".pdf" onChange={handleUpload} className="hidden" disabled={!activeChat || !!activeChat.collectionId} />
              <div className="text-2xl mb-2 text-[#ffefb3]/40">📥</div>
              <p className="text-xs font-semibold truncate max-w-full text-[#ffefb3]">{activeChat?.collectionId ? "Document Synced" : "Inject PDF Document"}</p>
            </label>
          </div>
          {loading && activeChat && !activeChat.collectionId && (
            <div className="p-3 bg-black/20 border border-[#ffefb3]/10 rounded-xl text-[10px] text-[#ffefb3] animate-pulse">Streaming chunks to database layer...</div>
          )}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-[#ffefb3]/60 tracking-wider uppercase">Architecture Framework</label>
            <div className="grid grid-cols-2 gap-1 bg-black/20 p-1 rounded-xl border border-[#ffefb3]/10">
              {['normal', 'short'].map(type => (
                <button
                  key={type} type="button" disabled={!activeChat}
                  onClick={() => {
                    const updated = { ...activeChat, responseType: type };
                    setChats(chats.map(c => c.id === activeChatId ? updated : c));
                    saveSessionToDatabase(user.userId, updated);
                  }}
                  className={`py-1.5 text-xs font-bold rounded-lg capitalize transition-all ${activeChat?.responseType === type ? 'bg-[#ffefb3] text-[#002b26]' : 'text-[#ffefb3]/60'}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden bg-gradient-to-b from-[#fdfbf7] to-[#f4f0df]">
        <div className="px-6 py-4 border-b bg-white/40 flex items-center justify-between shadow-sm flex-shrink-0">
          <h1 className="text-xs font-bold text-[#002b26]/70 uppercase tracking-wider">
            Active Workspace Scope: <span className="text-[#002b26] font-extrabold normal-case text-sm ml-1">{activeChat ? activeChat.title : 'None'}</span>
          </h1>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4 pb-32 custom-scrollbar">
          {(!activeChat || activeChat.messages.length === 0) ? (
            <div className="h-full flex flex-col items-center justify-center text-[#002b26]/30 space-y-2">
              <div className="text-4xl">🌱</div>
              <p className="text-xs font-bold">Workspace Channel Khali Hai</p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              {activeChat.messages.map((msg, idx) => (
                <div key={idx} className={`flex w-full ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xl rounded-2xl px-5 py-3 text-sm border shadow-sm leading-relaxed ${
                    msg.sender === 'user' ? 'bg-[#002b26] text-[#ffefb3] rounded-br-none border-[#002b26]' : 'bg-white text-[#002b26] rounded-bl-none border-[#002b26]/10'
                  }`}>
                    {msg.sender === 'bot' ? (
                      <div className="space-y-2">
                        {msg.text.replace(/\s+(\d+\.\s+)/g, '\n$1').split('\n').map((line, lIdx) => (
                          <p key={lIdx} className={/^\d+\.\s/.test(line.trim()) ? "pl-2 font-semibold text-emerald-950" : ""}>{line}</p>
                        ))}
                      </div>
                    ) : msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}
          {loading && activeChat?.collectionId && (
            <div className="max-w-2xl mx-auto text-xs font-bold text-[#002b26]/60 animate-pulse pl-4">Synthesizing cloud vector chunks...</div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#f4f0df] via-[#f4f0df]/90 to-transparent z-10 flex-shrink-0">
          <form onSubmit={handleSendMessage} className="max-w-2xl mx-auto bg-white border border-[#002b26]/10 rounded-2xl p-1.5 flex gap-2 items-center shadow-2xl">
            <input
              type="text"
              placeholder={activeChat?.collectionId ? "Query context layers or execute system blueprints..." : "⚠️ Please map a reference file first to open input channel..."}
              disabled={!activeChat?.collectionId || loading}
              value={input} onChange={e => setInput(e.target.value)}
              className="flex-1 bg-transparent px-4 py-2 text-sm text-[#002b26] font-medium focus:outline-none placeholder-[#002b26]/30 disabled:opacity-50"
            />
            <button type="submit" disabled={!activeChat?.collectionId || loading || !input.trim()} className="bg-[#002b26] text-[#ffefb3] font-extrabold px-6 py-2 rounded-xl text-xs tracking-wider uppercase transition-all disabled:opacity-20 flex-shrink-0">Execute</button>
          </form>
        </div>
      </main>
    </div>
  );
}